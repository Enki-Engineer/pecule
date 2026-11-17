import { describe, expect, it } from "vitest";
import { getTableConfig, MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "./db/schema/index.ts";
import {
  alreadyCompressed,
  backupFileName,
  columnKind,
  FILE_TABLES,
  filePath,
  InsertBuilder,
  parsePreMigrationName,
  partPath,
  portableView,
  preMigrationBackupDue,
  preMigrationBackupsToPrune,
  preMigrationFileName,
  readme,
  safeName,
  schemaSql,
  schemaStatements,
  sqlStatements,
  sqlString,
  sqlValue,
} from "./backup-format.ts";

describe("écriture SQL des valeurs", () => {
  it("range chaque type de colonne dans sa façon d'écrire", () => {
    for (const t of ["int", "tinyint", "bigint", "decimal", "double", "float", "year"]) expect(columnKind(t)).toBe("nombre");
    for (const t of ["blob", "longblob", "mediumblob", "varbinary", "binary", "bit"]) expect(columnKind(t)).toBe("binaire");
    for (const t of ["varchar", "char", "text", "mediumtext", "longtext", "date", "datetime", "timestamp", "json", "enum"]) expect(columnKind(t)).toBe("texte");
  });

  it("écrit nombres, textes, binaires et NULL", () => {
    expect(sqlValue(null, "texte")).toBe("NULL");
    expect(sqlValue(Buffer.from("-12.50"), "nombre")).toBe("-12.50");
    expect(sqlValue(Buffer.from("1.5e-7"), "nombre")).toBe("1.5e-7");
    expect(sqlValue(Buffer.from("2026-11-12 08:00:00"), "texte")).toBe("'2026-11-12 08:00:00'");
    expect(sqlValue(Buffer.from([0, 255, 16]), "binaire")).toBe("0x00ff10");
    expect(sqlValue(Buffer.alloc(0), "binaire")).toBe("''");
    expect(sqlValue(Buffer.alloc(0), "texte")).toBe("''");
    // Une valeur inattendue dans une colonne numérique n'est jamais écrite nue.
    expect(sqlValue(Buffer.from("1; DROP TABLE x"), "nombre")).toBe("'1; DROP TABLE x'");
  });

  it("échappe un texte sur une seule ligne", () => {
    expect(sqlString("L'été — « Pécule » 🪙")).toBe("'L\\'été — « Pécule » 🪙'");
    const tricky = "a\nb\r\nc\\d\0e\x1af';--";
    const out = sqlString(tricky);
    expect(out).not.toMatch(/[\n\r\0\x1a]/);
    expect(out).toBe("'a\\nb\\r\\nc\\\\d\\0e\\Zf\\';--'");
  });
});

describe("découpage d'une table", () => {
  it("regroupe les lignes en instructions puis en parties", () => {
    const b = new InsertBuilder("INSERT INTO `t` (`a`) VALUES ", { statement: 30, part: 70 });
    const parts: string[][] = [];
    for (let i = 0; i < 12; i++) {
      const p = b.add([`'ligne ${String(i).padStart(2, "0")}'`]);
      if (p) parts.push(p);
    }
    const rest = b.end();
    if (rest) parts.push(rest);
    expect(b.end()).toBeNull();
    expect(parts.length).toBeGreaterThan(1);
    const statements = parts.flat();
    for (const s of statements) expect(s).toMatch(/^INSERT INTO `t` \(`a`\) VALUES \('ligne \d\d'\)(,\('ligne \d\d'\))*;$/);
    // Aucune ligne perdue ni doublée, dans l'ordre.
    expect(statements.join("").match(/ligne \d\d/g)).toEqual(Array.from({ length: 12 }, (_, i) => `ligne ${String(i).padStart(2, "0")}`));
  });

  it("garde entière une ligne plus grosse que la limite", () => {
    const b = new InsertBuilder("INSERT INTO `t` (`a`) VALUES ", { statement: 10, part: 1000 });
    b.add(["'petite'"]);
    b.add([`'${"x".repeat(50)}'`]);
    b.add(["'fin'"]);
    expect(b.end()).toHaveLength(3);
  });

  it("nomme les parties et relit leurs instructions", () => {
    expect(partPath("transactions", 0)).toBe("base/donnees/transactions.sql");
    expect(partPath("transactions", 1)).toBe("base/donnees/transactions.002.sql");
    expect(sqlStatements("-- Pécule\nSET NAMES utf8mb4;\n\nINSERT INTO `t` VALUES ('a\\nb');\n")).toEqual(["SET NAMES utf8mb4;", "INSERT INTO `t` VALUES ('a\\nb');"]);
  });
});

describe("structure", () => {
  it("écrit puis relit une instruction par table et par vue", () => {
    const table = "CREATE TABLE `a` (\n  `id` int(11) NOT NULL,\n  `note` varchar(20) DEFAULT 'x;y',\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB";
    const view = "CREATE OR REPLACE VIEW `v` AS select `a`.`id` AS `id` from `a`";
    const text = schemaSql("Pécule — structure", [
      { label: "table a", sql: table },
      { label: "vue v", sql: `${view};` },
    ]);
    const statements = schemaStatements(text);
    expect(statements.slice(0, 2)).toEqual(["SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS = 0;"]);
    expect(statements.slice(-2)).toEqual([table, view]);
  });

  it("rend une vue rejouable ailleurs", () => {
    const shown = "CREATE ALGORITHM=UNDEFINED DEFINER=`u123456789_pecule`@`127.0.0.1` SQL SECURITY DEFINER VIEW `tx_lines` AS select `t`.`id` AS `id` from `u123456789_pecule`.`transactions` `t`";
    expect(portableView(shown, "u123456789_pecule")).toBe("CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `tx_lines` AS select `t`.`id` AS `id` from `transactions` `t`");
  });
});

describe("fichiers de l'archive", () => {
  it("donne un nom sûr et lisible", () => {
    expect(safeName("  Facture / août: 2026?.pdf ")).toBe("Facture _ août_ 2026_.pdf");
    expect(safeName("..caché")).toBe("caché");
    expect(safeName("été.pdf")).toBe("été.pdf");
    const long = safeName(`${"a".repeat(200)}.pdf`);
    expect(long).toHaveLength(110);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  it("range factures, documents et logos", () => {
    const [invoices, documents, logos] = FILE_TABLES;
    expect(filePath(invoices, { id: 12, name: "2026-02-17 AMAZON commande.pdf", mime: "application/pdf", folder: "2026" })).toBe("fichiers/factures/2026/000012 - 2026-02-17 AMAZON commande.pdf");
    expect(filePath(invoices, { id: 7, name: "photo ticket", mime: "image/jpeg", folder: null })).toBe("fichiers/factures/000007 - photo ticket.jpg");
    expect(filePath(documents, { id: 340, name: null, mime: "application/pdf", folder: "impots" })).toBe("fichiers/documents/impots/000340.pdf");
    expect(filePath(documents, { id: 5, name: "bail.docx", mime: "application/octet-stream", folder: "immobilier" })).toBe("fichiers/documents/immobilier/000005 - bail.docx");
    expect(filePath(logos, { id: "d:amazon.fr", name: null, mime: "image/png", folder: null })).toBe("fichiers/logos/d_amazon.fr.png");
    expect(filePath(logos, { id: "coin:bitcoin", name: null, mime: null, folder: null })).toBe("fichiers/logos/coin_bitcoin");
  });

  it("ne recompresse pas ce qui l'est déjà", () => {
    expect(alreadyCompressed("application/pdf")).toBe(true);
    expect(alreadyCompressed("image/jpeg")).toBe(true);
    expect(alreadyCompressed("text/plain")).toBe(false);
    expect(alreadyCompressed(null)).toBe(false);
  });

  // Une colonne LONGBLOB ajoutée au schéma doit être déclarée dans FILE_TABLES : sinon son contenu
  // partirait dans le SQL en hexadécimal au lieu d'un vrai fichier.
  it("connaît toutes les colonnes de fichiers du schéma", () => {
    const blobs: string[] = [];
    for (const value of Object.values(schema))
      if (value instanceof MySqlTable) {
        const cfg = getTableConfig(value);
        for (const c of cfg.columns) if (c.getSQLType() === "longblob") blobs.push(`${cfg.name}.${c.name}`);
      }
    expect(blobs.sort()).toEqual(FILE_TABLES.map((f) => `${f.table}.${f.column}`).sort());
    for (const f of FILE_TABLES) {
      const table = Object.values(schema).find((v) => v instanceof MySqlTable && getTableConfig(v).name === f.table) as MySqlTable;
      const cfg = getTableConfig(table);
      expect(cfg.columns.find((c) => c.name === f.key)?.primary).toBe(true);
      // Sans autres colonnes, la restauration recrée la ligne avec la clé et le contenu seulement.
      if (!f.rows) expect(cfg.columns.map((c) => c.name).sort()).toEqual([f.column, f.key].sort());
    }
  });
});

describe("notice", () => {
  it("résume la sauvegarde", () => {
    const text = readme({ creeLe: "2026-11-12T14:05:09.000Z", serveur: "11.8.3-MariaDB", base: "pecule", derniereMigration: "drizzle/0019_traductions_donnees.sql", totaux: { tables: 58, lignes: 123456, fichiers: 1830, octetsFichiers: 262_144_000 } });
    expect(text).toContain("Sauvegarde du 12/11/2026 à 14:05 (UTC)");
    // Le séparateur de milliers est une espace fine insécable.
    expect(text).toMatch(/1\s830 fichiers \(250,0 Mo\)/);
    expect(text).toContain("pnpm restaurer");
  });

  it("nomme le fichier à l'heure de Paris", () => {
    expect(backupFileName(new Date("2026-11-12T14:05:09Z"))).toBe("pecule-sauvegarde-2026-11-12-1505.zip");
    expect(backupFileName(new Date("2026-07-01T22:30:00Z"))).toBe("pecule-sauvegarde-2026-07-02-0030.zip");
  });
});

describe("instructions admises à la restauration", () => {
  it("accepte ce qu'une sauvegarde écrit", async () => {
    const { allowedRestoreStatement, SQL_PREAMBLE, InsertBuilder } = await import("./backup-format.ts");
    for (const s of SQL_PREAMBLE) expect(allowedRestoreStatement(s, "structure")).toBe(true);
    expect(allowedRestoreStatement("CREATE TABLE `users` (\n  `id` int NOT NULL\n)", "structure")).toBe(true);
    expect(allowedRestoreStatement("CREATE OR REPLACE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `tx_lines` AS select `t`.`id` AS `id` from `transactions` `t`", "structure")).toBe(true);
    const b = new InsertBuilder("INSERT INTO `users` (`id`, `name`) VALUES ");
    b.add(["1", "'Alex'"]);
    for (const line of b.end() ?? []) expect(allowedRestoreStatement(line, "donnees", "users"), line.slice(0, 40)).toBe(true);
  });
  it("refuse tout le reste", async () => {
    const { allowedRestoreStatement } = await import("./backup-format.ts");
    for (const s of ["DROP DATABASE autre", "CREATE USER 'x'@'%'", "GRANT ALL ON *.* TO 'x'", "SET GLOBAL local_infile = 1", "CREATE TABLE autre.`t` (id int)", "CREATE OR REPLACE VIEW `v` AS select 1 into outfile '/tmp/x'", "SELECT * FROM users"])
      expect(allowedRestoreStatement(s, "structure"), s).toBe(false);
    expect(allowedRestoreStatement("INSERT INTO `sessions` (`id`) VALUES (1)", "donnees", "users")).toBe(false);
    expect(allowedRestoreStatement("DELETE FROM `users`", "donnees", "users")).toBe(false);
    expect(allowedRestoreStatement("INSERT INTO `users` (`id`) VALUES (1)", "donnees", "users; drop")).toBe(false);
  });
});

describe("sauvegarde d'avant migration", () => {
  const now = new Date("2026-11-17T14:32:09Z");
  const name = preMigrationFileName(now, 31, "ab12cd34");

  it("porte dans son nom l'instant, l'état de la base et une fin au hasard", () => {
    expect(name).toBe("pecule-avant-migration-2026-11-17-1432-m31-ab12cd34.zip");
    expect(parsePreMigrationName(name)).toEqual({ applied: 31 });
    expect(parsePreMigrationName(`${name}.partiel`)).toBeNull();
    expect(parsePreMigrationName("pecule-sauvegarde-2026-11-17-1532.zip")).toBeNull();
  });

  it("n'est pas refaite quand le démarrage recommence sur la même base", () => {
    const at = now.getTime();
    expect(preMigrationBackupDue([], 31, at)).toBe(true);
    expect(preMigrationBackupDue([{ name, at }], 31, at + 60_000)).toBe(false);
    // Une migration de plus est passée depuis, ou la sauvegarde date : il en faut une nouvelle.
    expect(preMigrationBackupDue([{ name, at }], 32, at + 60_000)).toBe(true);
    expect(preMigrationBackupDue([{ name, at }], 31, at + 25 * 3_600_000)).toBe(true);
  });

  it("ne garde que les plus récentes, sans toucher aux autres fichiers du dossier", () => {
    const files = [1, 2, 3, 4, 5].map((d) => ({ name: preMigrationFileName(new Date(`2026-11-0${d}T08:00:00Z`), 20 + d, "00ff"), at: d }));
    const other = { name: "pecule-sauvegarde-2026-11-17-1532.zip", at: 0 };
    expect(preMigrationBackupsToPrune([...files, other], 3)).toEqual([files[1].name, files[0].name]);
    expect(preMigrationBackupsToPrune(files.slice(0, 2), 3)).toEqual([]);
  });
});
