import { createHash } from "node:crypto";
import type { Writable } from "node:stream";
import type { Connection, RowDataPacket } from "mysql2/promise";
import { readZip, ZipWriter, type ZipSource } from "./zip.ts";
import {
  alreadyCompressed,
  BACKUP_FORMAT,
  columnKind,
  FILE_TABLES,
  filePath,
  InsertBuilder,
  MANIFEST_PATH,
  partPath,
  portableView,
  readme,
  README_PATH,
  SCHEMA_PATH,
  schemaSql,
  allowedRestoreStatement, schemaStatements,
  SQL_PREAMBLE,
  sqlIdent,
  sqlStatements,
  sqlValue,
  type BackupManifest,
} from "./backup-format.ts";

/*
 * Sauvegarde complète de Pécule dans une archive zip : toute la base (structure et lignes en SQL)
 * et les fichiers qu'elle garde (factures, documents du coffre, logos) comme de vrais fichiers.
 * - writeBackup : écrit l'archive au fil de l'eau, sur une photo cohérente de la base ;
 * - verifyBackup : relit une archive et la compare à son manifeste ;
 * - restoreBackup : recharge une archive dans une base vide et contrôle le résultat.
 * Ce module ne dépend ni de l'environnement ni du pool : il travaille sur la connexion qu'on lui
 * donne (route /api/backup, commandes `pnpm sauvegarde` et `pnpm restaurer`).
 */

/** Le destinataire a coupé le téléchargement : rien à signaler. */
export class BackupAborted extends Error {}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Attend que le destinataire ait absorbé ce qui est écrit (ou qu'il s'en aille). */
function drained(out: Writable): Promise<void> {
  return new Promise((resolve, reject) => {
    const off = () => {
      out.off("drain", ok);
      out.off("close", ko);
      out.off("error", ko);
    };
    const ok = () => (off(), resolve());
    const ko = () => (off(), reject(new BackupAborted("Téléchargement interrompu")));
    out.once("drain", ok);
    out.once("close", ko);
    out.once("error", ko);
  });
}

type Row = RowDataPacket;
const rows = async <T = Row>(conn: Connection, sql: string, values: unknown[] = []): Promise<T[]> => (await conn.query<Row[]>(sql, values))[0] as T[];

/**
 * Écrit l'archive dans `out` (sans le fermer) et renvoie son manifeste et sa taille. Toutes les lectures se font
 * dans une même transaction en lecture cohérente : l'archive est l'état de la base à un instant,
 * même si une synchro ou un classement passe pendant ce temps. Mémoire bornée : les tables sont
 * lues par pages, les fichiers un par un, et l'écriture attend le destinataire.
 */
export async function writeBackup(conn: Connection, out: Writable, opts: { now?: Date } = {}): Promise<{ manifest: BackupManifest; octets: number }> {
  const now = opts.now ?? new Date();
  const zip = new ZipWriter({ date: now });
  const entrees: BackupManifest["entrees"] = [];
  const used = new Set<string>();
  const write = async (chunks: Buffer[]) => {
    for (const chunk of chunks) {
      if (out.destroyed || out.writableEnded) throw new BackupAborted("Téléchargement interrompu");
      if (!out.write(chunk)) await drained(out);
    }
  };
  const put = async (chemin: string, data: Buffer, store = false) => {
    if (used.has(chemin)) throw new Error(`Deux fichiers du même nom dans l'archive : ${chemin}`);
    used.add(chemin);
    await write(await zip.file(chemin, data, { store }));
    entrees.push({ chemin, octets: data.length, sha256: sha256(data) });
  };

  await conn.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
  try {
    const [meta] = await rows<{ version: string; base: string }>(conn, "SELECT VERSION() AS version, DATABASE() AS base");
    const all = await rows<{ name: string; type: string; avg: number | string | null }>(
      conn,
      "SELECT TABLE_NAME AS name, TABLE_TYPE AS type, AVG_ROW_LENGTH AS avg FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
    );
    const tables = all.filter((t) => t.type === "BASE TABLE");
    const views = all.filter((t) => t.type === "VIEW").map((t) => t.name);
    const columns = await rows<{ tbl: string; col: string; type: string; extra: string }>(
      conn,
      "SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, DATA_TYPE AS type, EXTRA AS extra FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
    );
    const primary = await rows<{ tbl: string; col: string }>(
      conn,
      "SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND INDEX_NAME = 'PRIMARY' ORDER BY TABLE_NAME, SEQ_IN_INDEX",
    );
    const derniereMigration = tables.some((t) => t.name === "_migrations")
      ? ((await rows<{ name: string }>(conn, "SELECT name FROM _migrations ORDER BY applied_at DESC, name DESC LIMIT 1"))[0]?.name ?? null)
      : null;

    // Structure : tables puis vues, telles que la base les décrit.
    const creates: { label: string; sql: string }[] = [];
    for (const t of tables) {
      const [r] = await rows<Record<string, string>>(conn, `SHOW CREATE TABLE ${sqlIdent(t.name)}`);
      creates.push({ label: `table ${t.name}`, sql: r["Create Table"] });
    }
    for (const v of views) {
      const [r] = await rows<Record<string, string>>(conn, `SHOW CREATE VIEW ${sqlIdent(v)}`);
      creates.push({ label: `vue ${v}`, sql: portableView(r["Create View"], meta.base) });
    }
    await put(SCHEMA_PATH, Buffer.from(schemaSql(`Pécule — structure de la base « ${meta.base} », sauvegarde du ${now.toISOString()}`, creates)));

    // Lignes de chaque table, par pages dans l'ordre de la clé primaire.
    const manifestTables: BackupManifest["tables"] = [];
    for (const t of tables) {
      const fileTable = FILE_TABLES.find((f) => f.table === t.name);
      if (fileTable && !fileTable.rows) continue;
      const cols = columns.filter((c) => c.tbl === t.name && !/GENERATED|VIRTUAL|PERSISTENT|STORED/i.test(c.extra) && c.col !== fileTable?.column);
      const kinds = cols.map((c) => columnKind(c.type));
      const list = cols.map((c) => sqlIdent(c.col)).join(",");
      // Sans clé primaire, l'ordre de toutes les colonnes : les pages ne se recouvrent pas.
      const key = primary.filter((p) => p.tbl === t.name).map((p) => p.col);
      const order = (key.length ? key : cols.map((c) => c.col)).map(sqlIdent).join(",");
      const builder = new InsertBuilder(`INSERT INTO ${sqlIdent(t.name)} (${list}) VALUES `);
      const parties: string[] = [];
      const putPart = async (statements: string[]) => {
        const chemin = partPath(t.name, parties.length);
        const head = `-- Pécule — table ${t.name}${parties.length ? `, partie ${parties.length + 1}` : ""}, sauvegarde du ${now.toISOString()}`;
        await put(chemin, Buffer.from([head, ...SQL_PREAMBLE, ...statements, ""].join("\n")));
        parties.push(chemin);
      };
      // Pages d'environ 4 Mo d'après la taille moyenne d'une ligne (une table de textes longs avance par petites pages).
      const page = Math.min(2000, Math.max(10, Math.floor(4_000_000 / Math.max(Number(t.avg) || 0, 200))));
      let lignes = 0;
      for (let offset = 0; ; offset += page) {
        const [chunk] = await conn.query<Row[]>({
          sql: `SELECT ${list} FROM ${sqlIdent(t.name)} ORDER BY ${order} LIMIT ? OFFSET ?`,
          values: [page, offset],
          rowsAsArray: true,
          // Chaque valeur telle que la base l'envoie (octets bruts) : aucune conversion ne peut l'abîmer.
          typeCast: (field) => field.buffer(),
        });
        for (const r of chunk as unknown as (Buffer | null)[][]) {
          const part = builder.add(r.map((v, i) => sqlValue(v, kinds[i])));
          if (part) await putPart(part);
        }
        lignes += chunk.length;
        if (chunk.length < page) break;
      }
      const rest = builder.end();
      if (rest) await putPart(rest);
      manifestTables.push({ nom: t.name, lignes, parties });
    }

    // Fichiers gardés en base : un par un, rangés comme de vrais fichiers.
    const fichiers: BackupManifest["fichiers"] = [];
    let octetsFichiers = 0;
    for (const f of FILE_TABLES) {
      if (!tables.some((t) => t.name === f.table)) continue;
      const listed = await rows<{ id: string | number; name: string | null; mime: string | null; folder: string | null }>(conn, f.list);
      let n = 0;
      for (const item of listed) {
        const [r] = await rows<{ data: Buffer | null }>(conn, `SELECT ${sqlIdent(f.column)} AS data FROM ${sqlIdent(f.table)} WHERE ${sqlIdent(f.key)} = ?`, [item.id]);
        if (!r?.data) continue;
        let chemin = filePath(f, item);
        for (let i = 2; used.has(chemin); i++) chemin = filePath(f, { ...item, id: `${item.id} (${i})` });
        await put(chemin, r.data, alreadyCompressed(item.mime));
        fichiers.push({ table: f.table, colonne: f.column, cle: f.key, valeur: item.id, chemin });
        octetsFichiers += r.data.length;
        n++;
      }
      if (!f.rows) manifestTables.push({ nom: f.table, lignes: n, parties: [] });
    }
    manifestTables.sort((a, b) => (a.nom < b.nom ? -1 : 1));

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      application: "Pécule",
      creeLe: now.toISOString(),
      serveur: meta.version,
      base: meta.base,
      derniereMigration,
      tables: manifestTables,
      vues: views,
      fichiers,
      entrees,
      totaux: { tables: manifestTables.length, lignes: manifestTables.reduce((s, t) => s + t.lignes, 0), fichiers: fichiers.length, octetsFichiers },
    };
    await put(README_PATH, Buffer.from(readme(manifest)));
    // Le manifeste recense tout ce qui précède ; lui-même est protégé par le contrôle (CRC) de l'archive.
    await write([...(await zip.file(MANIFEST_PATH, Buffer.from(JSON.stringify(manifest, null, 1)))), zip.end()]);
    return { manifest, octets: zip.bytes };
  } finally {
    await conn.query("ROLLBACK").catch(() => {});
  }
}

/** Relit une archive en entier et la compare à son manifeste (présence, taille, empreinte de chaque fichier). */
export async function verifyBackup(src: ZipSource): Promise<{ manifest: BackupManifest; problems: string[]; extract(chemin: string): Promise<Buffer> }> {
  const zip = await readZip(src);
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const extract = async (chemin: string) => {
    const e = byName.get(chemin);
    if (!e) throw new Error(`Absent de l'archive : ${chemin}`);
    return zip.extract(e);
  };
  if (!byName.has(MANIFEST_PATH)) throw new Error("Ce zip n'est pas une sauvegarde de Pécule (manifeste absent)");
  const manifest = JSON.parse((await extract(MANIFEST_PATH)).toString("utf8")) as BackupManifest;
  if (manifest.application !== "Pécule" || !Array.isArray(manifest.entrees)) throw new Error("Ce zip n'est pas une sauvegarde de Pécule (manifeste inattendu)");
  if (manifest.format > BACKUP_FORMAT) throw new Error(`Sauvegarde d'un format plus récent (${manifest.format}) : mets Pécule à jour avant de la relire`);
  const problems: string[] = [];
  const listed = new Set(manifest.entrees.map((e) => e.chemin));
  for (const e of manifest.entrees) {
    try {
      const data = await extract(e.chemin);
      if (data.length !== e.octets) problems.push(`${e.chemin} : ${data.length} octets, ${e.octets} attendus`);
      else if (sha256(data) !== e.sha256) problems.push(`${e.chemin} : empreinte différente de celle du manifeste`);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : String(err));
    }
  }
  for (const name of byName.keys()) if (name !== MANIFEST_PATH && !listed.has(name)) problems.push(`${name} : présent dans l'archive, absent du manifeste`);
  for (const p of [SCHEMA_PATH, ...manifest.tables.flatMap((t) => t.parties), ...manifest.fichiers.map((f) => f.chemin)])
    if (!listed.has(p)) problems.push(`${p} : cité par le manifeste, absent de son inventaire`);
  return { manifest, problems, extract };
}

/**
 * Recharge une archive dans la base de `conn`, qui doit être vide : structure, lignes, fichiers,
 * puis contrôle (nombre de lignes de chaque table, empreinte de chaque fichier relue dans la base).
 * Refuse d'écrire si l'archive ne correspond pas à son manifeste ou si la base contient déjà une table.
 */
export async function restoreBackup(src: ZipSource, conn: Connection, log: (line: string) => void = () => {}): Promise<{ manifest: BackupManifest; problems: string[] }> {
  const { manifest, problems: damaged, extract } = await verifyBackup(src);
  if (damaged.length) throw new Error(`Archive abîmée, rien n'a été écrit :\n  ${damaged.join("\n  ")}`);
  const [{ n: existing }] = await rows<{ n: number }>(conn, "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
  if (Number(existing) > 0) throw new Error("La base de destination n'est pas vide : la restauration ne se fait que dans une base sans aucune table");
  const sizes = new Map(manifest.entrees.map((e) => [e.chemin, e]));
  const biggest = Math.max(0, ...manifest.fichiers.map((f) => sizes.get(f.chemin)?.octets ?? 0));
  const [{ max }] = await rows<{ max: number }>(conn, "SELECT @@max_allowed_packet AS max");
  if (Number(max) < biggest + 1_048_576)
    throw new Error(`Le serveur n'accepte que ${Math.floor(Number(max) / 1_048_576)} Mo par envoi et le plus gros fichier en fait ${Math.ceil(biggest / 1_048_576)} : augmente max_allowed_packet (ex. 256M) sur le serveur de destination`);

  for (const s of SQL_PREAMBLE) await conn.query(s);
  const schema = schemaStatements((await extract(SCHEMA_PATH)).toString("utf8"));
  // Rien d'autre que ce qu'une sauvegarde de Pécule écrit : une archive venue d'ailleurs ne fait pas exécuter son propre SQL.
  const refused = schema.find((s) => !allowedRestoreStatement(s, "structure"));
  if (refused) throw new Error(`Archive refusée : son fichier de structure porte une instruction inattendue (« ${refused.slice(0, 60)}… »)`);
  for (const s of schema) await conn.query(s);
  log(`structure : ${manifest.tables.length} tables, ${manifest.vues.length} vues`);

  for (const t of manifest.tables) {
    for (const p of t.parties)
      for (const s of sqlStatements((await extract(p)).toString("utf8"))) {
        if (!allowedRestoreStatement(s, "donnees", t.nom)) throw new Error(`Archive refusée : ${p} porte autre chose que des lignes de la table ${t.nom}`);
        await conn.query(s);
      }
    if (t.parties.length) log(`${t.nom} : ${t.lignes} lignes`);
  }
  let done = 0;
  for (const f of manifest.fichiers) {
    const col = sqlIdent(f.colonne);
    // Protocole binaire : le contenu part tel quel (en texte, il doublerait de taille).
    await conn.execute(`INSERT INTO ${sqlIdent(f.table)} (${sqlIdent(f.cle)}, ${col}) VALUES (?, ?) ON DUPLICATE KEY UPDATE ${col} = VALUES(${col})`, [f.valeur, await extract(f.chemin)]);
    if (++done % 250 === 0) log(`fichiers : ${done} sur ${manifest.fichiers.length}`);
  }
  log(`fichiers : ${done} remis en place`);

  // Contrôle : ce qui est dans la base correspond au manifeste.
  const problems: string[] = [];
  for (const t of manifest.tables) {
    const [{ n }] = await rows<{ n: number }>(conn, `SELECT COUNT(*) AS n FROM ${sqlIdent(t.nom)}`);
    if (Number(n) !== t.lignes) problems.push(`${t.nom} : ${n} lignes dans la base, ${t.lignes} dans la sauvegarde`);
  }
  for (const v of manifest.vues) await conn.query(`SELECT 1 FROM ${sqlIdent(v)} LIMIT 1`).catch((e) => problems.push(`vue ${v} : ${e instanceof Error ? e.message : e}`));
  const groups = new Map<string, BackupManifest["fichiers"]>();
  for (const f of manifest.fichiers) groups.set(`${f.table}\n${f.cle}\n${f.colonne}`, [...(groups.get(`${f.table}\n${f.cle}\n${f.colonne}`) ?? []), f]);
  for (const [key, files] of groups) {
    const [table, cle, colonne] = key.split("\n");
    const inDb = await rows<{ k: string | number; h: string | null }>(conn, `SELECT ${sqlIdent(cle)} AS k, SHA2(${sqlIdent(colonne)}, 256) AS h FROM ${sqlIdent(table)}`);
    const hashes = new Map(inDb.map((r) => [String(r.k), r.h]));
    for (const f of files) if (hashes.get(String(f.valeur)) !== sizes.get(f.chemin)?.sha256) problems.push(`${f.chemin} : contenu différent dans ${table} (${f.valeur})`);
  }
  return { manifest, problems };
}
