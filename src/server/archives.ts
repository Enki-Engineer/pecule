import { accessSync, constants, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { finished } from "node:stream/promises";
import { env, isProd, rpID } from "./env.ts";
import { chooseBackupDir, type BackupDirChoice } from "./backup-dir.ts";
import { one, pool } from "./db.ts";
import { verifyBackup, writeBackup } from "./backup.ts";
import { parsePreMigrationName } from "./backup-format.ts";
import { appRoot } from "./version.ts";
import { fileSource } from "./zip.ts";
import { parseAutoName } from "../lib/backup-plan.ts";
import { isArchiveName } from "../lib/restore.ts";

/*
 * Les sauvegardes que le serveur garde chez lui : un dossier choisi pour survivre à une mise à jour (`backup-dir.ts` :
 * BACKUP_DIR, sinon un dossier du compte du serveur, hors de l'installation ; le volume avec Docker) où
 * s'écrivent celles d'avant migration (`pre-migration.ts`) et les automatiques (`auto-backup.ts`), et où la commande
 * de mise à jour dépose la sienne. Elles sont sur le même serveur que la base : elles protègent d'une erreur ou d'une
 * mise à jour qui tourne mal, pas de la perte du serveur.
 */

/** Marge de disque libre exigée en plus de la taille estimée de l'archive. */
const MARGIN = 64 * 1_048_576;
const PARTIAL = ".partiel";

/** Le dossier, ou son premier parent qui existe, est-il inscriptible par le compte du serveur ? */
function writable(dir: string): boolean {
  let at = path.resolve(dir);
  while (!existsSync(at) && path.dirname(at) !== at) at = path.dirname(at);
  try {
    accessSync(at, constants.W_OK | constants.X_OK);
    return statSync(at).isDirectory();
  } catch {
    return false;
  }
}

/** Le serveur a-t-il déjà écrit des archives dans ce dossier (automatiques ou d'avant migration) ? */
function hasServerArchives(dir: string): boolean {
  try {
    return readdirSync(dir).some((name) => parseAutoName(name) !== null || parsePreMigrationName(name) !== null);
  } catch {
    return false;
  }
}

const homeDir = () => {
  try {
    return os.homedir();
  } catch {
    return null;
  }
};

let chosen: BackupDirChoice | null = null;

/**
 * Dossier des sauvegardes du serveur et raison de ce choix (`backup-dir.ts`). Décidé une fois par démarrage : le
 * dossier ne change pas sous les pieds d'une écriture en cours.
 */
export function backupDirChoice(): BackupDirChoice {
  if (chosen) return chosen;
  chosen = chooseBackupDir({
    explicit: env.BACKUP_DIR,
    root: appRoot(),
    home: homeDir(),
    appUrl: env.APP_URL,
    production: isProd,
    container: existsSync("/.dockerenv") || existsSync("/run/.containerenv"),
    writable,
    hasServerArchives,
  });
  console.log(`[sauvegardes] dossier du serveur : ${chosen.dir}`);
  return chosen;
}

/** Dossier des sauvegardes écrites par le serveur. */
export const backupDir = () => backupDirChoice().dir;

/**
 * Crée un dossier de sauvegardes s'il manque, fermé aux autres comptes de la machine : les archives portent toutes
 * les données du foyer, et leurs noms n'ont pas à être lus non plus.
 */
export const ensurePrivateDir = (dir: string) => mkdirSync(dir, { recursive: true, mode: 0o700 });

export type ServerBackup = { name: string; octets: number; at: number };
/** D'où vient une archive du dossier : écrite chaque nuit, avant une migration, ou déposée là (mise à jour, copie à la main). */
export type ArchiveKind = "auto" | "migration" | "autre";
export type ServerArchive = ServerBackup & { kind: ArchiveKind };

const kindOf = (name: string): ArchiveKind => (parseAutoName(name) !== null ? "auto" : parsePreMigrationName(name) ? "migration" : "autre");

/** Toutes les archives du dossier des sauvegardes, la plus récente d'abord. */
export function listArchives(dir = backupDir()): ServerArchive[] {
  if (!existsSync(dir)) return [];
  const out: ServerArchive[] = [];
  for (const name of readdirSync(dir)) {
    if (!isArchiveName(name)) continue;
    try {
      const s = statSync(path.join(dir, name));
      // Une sauvegarde automatique porte son instant dans son nom : une copie du dossier ne le change pas.
      if (s.isFile()) out.push({ name, octets: s.size, at: parseAutoName(name) ?? Math.round(s.mtimeMs), kind: kindOf(name) });
    } catch {
      // Retirée entre-temps : rien à lister.
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Chemin d'une archive du dossier, d'après son nom ; `null` si le nom n'en est pas un (jamais un chemin) ou si elle n'y est pas. */
export function archivePath(name: string, dir = backupDir()): string | null {
  if (!isArchiveName(name)) return null;
  const file = path.join(dir, name);
  return existsSync(file) ? file : null;
}

const mo = (octets: number) => `${(octets / 1_048_576).toFixed(1).replace(".", ",")} Mo`;

/**
 * Écrit une sauvegarde complète dans le dossier, sous `name`. L'archive s'écrit sous un nom provisoire : le nom final
 * ne désigne jamais qu'une archive écrite jusqu'au bout — et, avec `verify`, relue en entier et conforme à son
 * manifeste. `prefix` : les restes d'une écriture de la même famille, coupée par l'arrêt du serveur, sont retirés
 * d'abord (jamais ceux d'une autre : la commande de mise à jour télécharge peut-être la sienne au même moment).
 */
export async function writeArchiveFile(dir: string, name: string, opts: { prefix: string; now?: Date; verify?: boolean }): Promise<ServerBackup> {
  ensurePrivateDir(dir);
  for (const f of readdirSync(dir)) if (f.startsWith(opts.prefix) && f.endsWith(PARTIAL)) rmSync(path.join(dir, f), { force: true });

  const size = await one<{ octets: number }>("SELECT COALESCE(SUM(DATA_LENGTH), 0) AS octets FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
  const needed = Number(size?.octets ?? 0) + MARGIN;
  const disk = await statfs(dir);
  const free = Number(disk.bavail) * Number(disk.bsize);
  if (free < needed) throw new Error(`pas assez de place dans ${dir} (${mo(free)} libres, ${mo(needed)} à prévoir)`);

  const now = opts.now ?? new Date();
  const file = path.join(dir, name);
  const partial = `${file}${PARTIAL}`;
  // L'archive porte toutes les données du foyer : lisible par le seul compte du serveur.
  const out = createWriteStream(partial, { mode: 0o600 });
  let failure: unknown = null;
  out.on("error", (e) => (failure ??= e));
  const conn = await pool.getConnection();
  // Le wait_timeout de certains hébergeurs est court : la connexion reste vivante si le disque est lent.
  const keepAlive = setInterval(() => conn.query("SELECT 1").catch(() => {}), 5000);
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
  } finally {
    clearInterval(keepAlive);
  }
  if (opts.verify) {
    const src = await fileSource(partial);
    try {
      const { problems } = await verifyBackup(src);
      if (problems.length) throw new Error(`archive relue, non conforme à son manifeste : ${problems[0]}`);
    } catch (e) {
      rmSync(partial, { force: true });
      throw e;
    } finally {
      await src.close?.();
    }
  }
  renameSync(partial, file);
  return { name, octets: statSync(file).size, at: now.getTime() };
}
