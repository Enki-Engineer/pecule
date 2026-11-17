import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { env } from "./env.ts";
import { backupDir, writeArchiveFile, type ServerBackup } from "./archives.ts";
import { PRE_MIGRATION_PREFIX, parsePreMigrationName, preMigrationBackupDue, preMigrationBackupsToPrune, preMigrationFileName } from "./backup-format.ts";
import { recordAlert } from "./journal.ts";

/*
 * Sauvegarde d'avant migration. Une mise à jour change la structure de la base au démarrage, et une instruction de
 * structure ne se défait pas : avant d'y toucher, le serveur écrit donc lui-même une sauvegarde complète (la même
 * archive que Réglages → Compte et sécurité) dans un dossier de l'installation. Elle sert à revenir en arrière :
 * `pnpm restaurer` dans une base vide, puis la version précédente de Pécule.
 *
 * Filet de sécurité, pas condition de démarrage : dossier non inscriptible, disque plein ou base injoignable sont
 * signalés (journal, alerte du Suivi technique) et la migration se poursuit. BACKUP_BEFORE_MIGRATION=0 le coupe.
 */

export { backupDir, type ServerBackup };

/** Nombre de sauvegardes d'avant migration gardées sur le serveur. */
const KEEP = 3;

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

const write = (dir: string, applied: number) => {
  const now = new Date();
  return writeArchiveFile(dir, preMigrationFileName(now, applied, randomBytes(4).toString("hex")), { prefix: PRE_MIGRATION_PREFIX, now });
};

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
