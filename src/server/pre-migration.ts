import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { env, rpID } from "./env.ts";
import { one, pool } from "./db.ts";
import { writeBackup } from "./backup.ts";
import { PRE_MIGRATION_PREFIX, parsePreMigrationName, preMigrationBackupDue, preMigrationBackupsToPrune, preMigrationFileName } from "./backup-format.ts";
import { recordAlert } from "./journal.ts";
import { appRoot } from "./version.ts";

/*
 * Sauvegarde d'avant migration. Une mise à jour change la structure de la base au démarrage, et une instruction de
 * structure ne se défait pas : avant d'y toucher, le serveur écrit donc lui-même une sauvegarde complète (la même
 * archive que Réglages → Compte et sécurité) dans un dossier de l'installation. Elle sert à revenir en arrière :
 * `pnpm restaurer` dans une base vide, puis la version précédente de Pécule.
 *
 * Filet de sécurité, pas condition de démarrage : dossier non inscriptible, disque plein ou base injoignable sont
 * signalés (journal, alerte du Suivi technique) et la migration se poursuit. BACKUP_BEFORE_MIGRATION=0 le coupe.
 */

/** Nombre de sauvegardes d'avant migration gardées sur le serveur. */
const KEEP = 3;
/** Marge de disque libre exigée en plus de la taille estimée de l'archive. */
const MARGIN = 64 * 1_048_576;
const PARTIAL = ".partiel";

/** Dossier des sauvegardes écrites par le serveur. */
export const backupDir = () => path.resolve(env.BACKUP_DIR ?? path.join(appRoot(), "data", "sauvegardes"));

export type ServerBackup = { name: string; octets: number; at: number };

/** Sauvegardes d'avant migration présentes sur le serveur, la plus récente d'abord. */
export function listServerBackups(dir = backupDir()): ServerBackup[] {
  if (!existsSync(dir)) return [];
  const out: ServerBackup[] = [];
  for (const name of readdirSync(dir)) {
    if (!parsePreMigrationName(name)) continue;
    try {
      const s = statSync(path.join(dir, name));
      if (s.isFile()) out.push({ name, octets: s.size, at: Math.round(s.mtimeMs) });
    } catch {
      // Retirée entre-temps : rien à lister.
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

const mo = (octets: number) => `${(octets / 1_048_576).toFixed(1).replace(".", ",")} Mo`;

async function write(dir: string, applied: number): Promise<ServerBackup> {
  mkdirSync(dir, { recursive: true });
  // Restes d'une écriture coupée par l'arrêt du serveur.
  for (const name of readdirSync(dir)) if (name.startsWith(PRE_MIGRATION_PREFIX) && name.endsWith(PARTIAL)) rmSync(path.join(dir, name), { force: true });

  const size = await one<{ octets: number }>("SELECT COALESCE(SUM(DATA_LENGTH), 0) AS octets FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
  const needed = Number(size?.octets ?? 0) + MARGIN;
  const disk = await statfs(dir);
  const free = Number(disk.bavail) * Number(disk.bsize);
  if (free < needed) throw new Error(`pas assez de place dans ${dir} (${mo(free)} libres, ${mo(needed)} à prévoir)`);

  const now = new Date();
  const name = preMigrationFileName(now, applied, randomBytes(4).toString("hex"));
  const file = path.join(dir, name);
  const partial = `${file}${PARTIAL}`;
  // L'archive porte toutes les données du foyer : lisible par le seul compte du serveur.
  const out = createWriteStream(partial, { mode: 0o600 });
  let failure: unknown = null;
  out.on("error", (e) => (failure ??= e));
  const conn = await pool.getConnection();
  try {
    await writeBackup(conn, out, { now, origine: rpID });
    out.end();
    await finished(out);
    if (failure) throw failure;
    conn.release();
  } catch (e) {
    // Connexion peut-être au milieu d'une lecture : elle ne retourne pas dans la réserve.
    conn.destroy();
    out.destroy();
    rmSync(partial, { force: true });
    throw failure ?? e;
  }
  // Le nom final ne désigne jamais qu'une archive écrite jusqu'au bout.
  renameSync(partial, file);
  return { name, octets: statSync(file).size, at: now.getTime() };
}

/**
 * Écrit la sauvegarde d'avant migration, sauf si la même base vient déjà d'être sauvegardée (démarrage qui recommence
 * après un échec), puis ne garde que les plus récentes. Appelée sous le verrou des migrations : un seul processus à la fois.
 */
export async function backupBeforeMigration({ applied, pending }: { applied: number; pending: string[] }): Promise<void> {
  if (!env.BACKUP_BEFORE_MIGRATION) return;
  const dir = backupDir();
  try {
    if (!preMigrationBackupDue(listServerBackups(dir), applied, Date.now())) {
      console.log("[db] sauvegarde d'avant migration : celle de cette base est déjà sur le serveur");
      return;
    }
    const started = Date.now();
    console.log(`[db] ${pending.length} migration(s) à appliquer : sauvegarde complète d'abord…`);
    const done = await write(dir, applied);
    console.log(`[db] sauvegarde d'avant migration : ${path.join(dir, done.name)} (${mo(done.octets)}, ${Math.round((Date.now() - started) / 1000)} s)`);
    for (const name of preMigrationBackupsToPrune(listServerBackups(dir), KEEP)) rmSync(path.join(dir, name), { force: true });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[db] sauvegarde d'avant migration impossible, la migration se poursuit : ${why}`);
    void recordAlert("sauvegarde", `Sauvegarde d'avant migration impossible (${pending.join(", ")}) : ${why}`, e, "alerte");
  }
}
