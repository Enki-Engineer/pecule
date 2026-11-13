/**
 * Compare le schéma Drizzle (src/server/db/schema) à la base de prod, lue par
 * GET /api/admin/schema (lecture seule) : tables, colonnes (type, NULL), index, clés étrangères.
 * Usage : pnpm db:check   (PECULE_URL et PECULE_API_TOKEN dans .env)
 */
import "dotenv/config";
import { getTableConfig, MySqlTable } from "drizzle-orm/mysql-core";
import { getViewConfig, MySqlView } from "drizzle-orm/mysql-core";
import * as schema from "../src/server/db/schema/index.ts";

type DbColumn = { tbl: string; col: string; type: string; nullable: "YES" | "NO" };
/** Index que Drizzle ne sait pas décrire, créés à la main dans une migration (FULLTEXT). */
const MANUAL_INDEXES = new Set(["documents.ft_documents"]);
type DbIndex = { tbl: string; name: string; non_unique: number; cols: string };
type DbFk = { tbl: string; name: string; cols: string; ref_tbl: string; on_delete: string };

const url = process.env.PECULE_URL;
const token = process.env.PECULE_API_TOKEN;
if (!url || !token) throw new Error("PECULE_URL et PECULE_API_TOKEN requis dans .env");
const res = await fetch(`${url}/api/admin/schema`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) throw new Error(`/api/admin/schema → HTTP ${res.status}`);
const db = (await res.json()) as { tables: { tbl: string; type: string }[]; columns: DbColumn[]; indexes: DbIndex[]; foreignKeys: DbFk[] };

// MariaDB affiche une largeur d'affichage (« int(11) ») que Drizzle n'écrit pas.
const norm = (t: string) => t.toLowerCase().replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, "$1").replace(/^tinyint$/, "tinyint");
const problems: string[] = [];
const seen = new Set<string>();

for (const value of Object.values(schema)) {
  if (value instanceof MySqlTable) {
    const cfg = getTableConfig(value);
    seen.add(cfg.name);
    const dbCols = db.columns.filter((c) => c.tbl === cfg.name);
    if (!dbCols.length) {
      problems.push(`${cfg.name} : table absente de la base`);
      continue;
    }
    for (const col of cfg.columns) {
      const d = dbCols.find((c) => c.col === col.name);
      if (!d) problems.push(`${cfg.name}.${col.name} : colonne absente de la base`);
      else {
        if (norm(d.type) !== norm(col.getSQLType())) problems.push(`${cfg.name}.${col.name} : type ${d.type} en base, ${col.getSQLType()} dans le schéma`);
        if ((d.nullable === "NO") !== col.notNull && !col.primary) problems.push(`${cfg.name}.${col.name} : NULL ${d.nullable} en base, notNull=${col.notNull} dans le schéma`);
      }
    }
    for (const d of dbCols) if (!cfg.columns.some((c) => c.name === d.col)) problems.push(`${cfg.name}.${d.col} : colonne en base absente du schéma`);

    const schemaIdx = [
      ...cfg.indexes.map((i) => ({ name: i.config.name, unique: !!i.config.unique, cols: i.config.columns.map((c) => ("name" in c ? c.name : "?")).join(",") })),
      ...cfg.uniqueConstraints.map((u) => ({ name: u.name ?? "?", unique: true, cols: u.columns.map((c) => c.name).join(",") })),
      ...cfg.columns.filter((c) => c.isUnique).map((c) => ({ name: c.uniqueName ?? c.name, unique: true, cols: c.name })),
    ];
    const dbIdx = db.indexes.filter((i) => i.tbl === cfg.name && i.name !== "PRIMARY");
    for (const i of dbIdx) {
      const s = schemaIdx.find((x) => x.cols === i.cols && x.unique === !Number(i.non_unique));
      // Un index créé automatiquement par MySQL pour une clé étrangère n'a pas à figurer dans le schéma.
      const fkAuto = db.foreignKeys.some((f) => f.tbl === cfg.name && f.name === i.name);
      if (!s && !fkAuto && !MANUAL_INDEXES.has(`${cfg.name}.${i.name}`)) problems.push(`${cfg.name} : index ${i.name} (${i.cols}${Number(i.non_unique) ? "" : ", unique"}) absent du schéma`);
    }
    for (const s of schemaIdx) if (!dbIdx.some((i) => i.cols === s.cols)) problems.push(`${cfg.name} : index ${s.name} (${s.cols}) absent de la base`);

    const dbFks = db.foreignKeys.filter((f) => f.tbl === cfg.name);
    for (const fk of cfg.foreignKeys) {
      const ref = fk.reference();
      const name = fk.getName();
      const d = dbFks.find((f) => f.name === name);
      if (!d) problems.push(`${cfg.name} : clé étrangère ${name} absente de la base`);
      else if (d.ref_tbl !== getTableConfig(ref.foreignTable).name || d.cols !== ref.columns.map((c) => c.name).join(",") || d.on_delete.toLowerCase() !== (fk.onDelete ?? "no action").toLowerCase())
        problems.push(`${cfg.name} : clé étrangère ${name} différente (${d.cols} → ${d.ref_tbl}, ${d.on_delete})`);
    }
    for (const d of dbFks) if (!cfg.foreignKeys.some((fk) => fk.getName() === d.name)) problems.push(`${cfg.name} : clé étrangère ${d.name} en base absente du schéma`);
  } else if (value instanceof MySqlView) {
    const cfg = getViewConfig(value);
    seen.add(cfg.name);
    const dbCols = db.columns.filter((c) => c.tbl === cfg.name);
    for (const [, col] of Object.entries(cfg.selectedFields)) {
      const name = (col as { name: string }).name;
      if (!dbCols.some((c) => c.col === name)) problems.push(`vue ${cfg.name}.${name} : colonne absente de la base`);
    }
  }
}
for (const t of db.tables) if (!seen.has(t.tbl) && t.tbl !== "_migrations" && !t.tbl.startsWith("__drizzle")) problems.push(`${t.tbl} : en base, absente du schéma`);

if (problems.length) {
  console.error(`✗ ${problems.length} écart(s) entre le schéma Drizzle et la base :\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`✓ Schéma Drizzle conforme à la base (${seen.size} tables et vues, ${db.columns.length} colonnes).`);
