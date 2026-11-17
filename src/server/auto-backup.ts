import { rmSync } from "node:fs";
import path from "node:path";
import { exec, one, withLock } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { backupDir, listArchives, writeArchiveFile } from "./archives.ts";
import { logAudit, recordAlert } from "./journal.ts";
import { householdTimeZone } from "./region.ts";
import { AUTO_PREFIX, autoBackupDue, autoBackupName, autoBackupsToPrune, backupReminder, cleanBackupSettings, type BackupSettings } from "../lib/backup-plan.ts";

/*
 * Sauvegardes automatiques. Quand l'administrateur l'a demandé (Réglages → Compte et sécurité), le serveur écrit
 * lui-même une sauvegarde complète chaque nuit — ou chaque semaine — dans le dossier des sauvegardes, la relit en
 * entier, puis ne garde que les plus récentes. Éteint tant qu'on ne l'a pas demandé : une installation existante ne
 * change pas, et ne voit pas son disque se remplir sans l'avoir voulu.
 *
 * Le réglage et l'état (dernière réussite, dernier échec) vivent dans `app_kv`, toujours dans la vraie base. Un
 * échec est signalé (alerte du Suivi technique, notification de l'administrateur) et retenté six heures plus tard.
 */

const SETTINGS = "sauvegarde:reglages";
const STATE = "sauvegarde:etat";
/** Action du journal d'une sauvegarde automatique aboutie. */
export const AUTO_AUDIT = "sauvegarde automatique";
/** Action du journal d'une sauvegarde téléchargée (Réglages, `pnpm sauvegarde`, commande de mise à jour). */
export const DOWNLOAD_AUDIT = "sauvegarde complète";

export type BackupState = {
  /** Dernière sauvegarde automatique écrite et relue. */
  ok: { at: string; name: string; octets: number; secondes: number } | null;
  /** Dernier essai (ISO), abouti ou non. */
  essai: string | null;
  /** Dernier échec, tant qu'aucune sauvegarde n'a abouti depuis. */
  echec: { at: string; raison: string } | null;
};

const read = async (key: string): Promise<unknown> => {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key]));
  try {
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
};
const save = (key: string, value: unknown) => runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, JSON.stringify(value)]));

export const backupSettings = async (): Promise<BackupSettings> => cleanBackupSettings(await read(SETTINGS));

export async function saveBackupSettings(patch: Partial<BackupSettings>): Promise<BackupSettings> {
  const next = cleanBackupSettings({ ...(await backupSettings()), ...patch });
  await save(SETTINGS, next);
  return next;
}

export async function backupState(): Promise<BackupState> {
  const s = (await read(STATE)) as Partial<BackupState> | null;
  return { ok: s?.ok ?? null, essai: s?.essai ?? null, echec: s?.echec ?? null };
}

let current: Promise<BackupState> | null = null;

/** Une sauvegarde automatique est en cours d'écriture dans ce processus. */
export const autoBackupRunning = () => current !== null;

async function run(): Promise<BackupState> {
  const started = Date.now();
  const now = new Date(started);
  const dir = backupDir();
  const before = await backupState();
  try {
    // Un seul processus à la fois : un second (redémarrage en cours) laisse faire le premier.
    const done = await runReal(() =>
      withLock("pecule:sauvegarde-auto", async () => {
        await save(STATE, { ...before, essai: now.toISOString() });
        const settings = await backupSettings();
        const file = await writeArchiveFile(dir, autoBackupName(now), { prefix: AUTO_PREFIX, now, verify: true });
        for (const name of autoBackupsToPrune(listArchives(dir).map((a) => a.name), settings.garder)) rmSync(path.join(dir, name), { force: true });
        return file;
      }),
    );
    if (!done) return before;
    const secondes = Math.round((Date.now() - started) / 1000);
    const next: BackupState = { ok: { at: now.toISOString(), name: done.name, octets: done.octets, secondes }, essai: now.toISOString(), echec: null };
    await save(STATE, next);
    await runReal(() => logAudit(AUTO_AUDIT, done.name, { octets: done.octets, secondes }));
    console.log(`[sauvegarde] ${path.join(dir, done.name)} écrite et relue (${(done.octets / 1_048_576).toFixed(1).replace(".", ",")} Mo, ${secondes} s)`);
    return next;
  } catch (e) {
    const raison = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error(`[sauvegarde] sauvegarde automatique impossible : ${raison}`);
    const next: BackupState = { ...before, essai: now.toISOString(), echec: { at: now.toISOString(), raison } };
    await save(STATE, next).catch(() => {});
    void recordAlert("sauvegarde", `Sauvegarde automatique impossible : ${raison}`, e, "alerte");
    return next;
  }
}

/** Écrit une sauvegarde automatique maintenant (une seule à la fois) et rend l'état qui en résulte. */
export function runAutoBackup(): Promise<BackupState> {
  current ??= run().finally(() => {
    current = null;
  });
  return current;
}

/** Instant (millisecondes) de la dernière sauvegarde de toute sorte : téléchargée, automatique, ou gardée par le serveur. */
export async function lastBackupAt(): Promise<number | null> {
  const row = await runReal(() => one<{ at: number | null }>("SELECT UNIX_TIMESTAMP(MAX(at)) AS at FROM audit_log WHERE action IN (?, ?)", [DOWNLOAD_AUDIT, AUTO_AUDIT]));
  const fromLog = row?.at ? Number(row.at) * 1000 : 0;
  const onDisk = listArchives()[0]?.at ?? 0;
  return Math.max(fromLog, onDisk) || null;
}

/** Ce qu'il faut dire à l'administrateur : un échec de la sauvegarde automatique, ou trop de jours sans aucune sauvegarde. */
export async function backupWatch(now = Date.now()): Promise<{ echec: BackupState["echec"]; jours: number | null }> {
  const [settings, state, last, first] = await Promise.all([
    backupSettings(),
    backupState(),
    lastBackupAt(),
    runReal(() => one<{ at: number | null }>("SELECT UNIX_TIMESTAMP(MIN(created_at)) AS at FROM users")),
  ]);
  return { echec: settings.auto ? state.echec : null, jours: backupReminder(last, first?.at ? Number(first.at) * 1000 : null, now) };
}

let scheduled = false;

/**
 * Regarde toutes les vingt minutes si une sauvegarde automatique est due (elle ne part qu'une fois par nuit, ou par
 * semaine). `ready` : le serveur a fini de démarrer et n'est pas en maintenance.
 */
export function scheduleAutoBackup(ready: () => boolean) {
  if (scheduled) return;
  scheduled = true;
  const tick = async () => {
    if (!ready() || current) return;
    try {
      const settings = await backupSettings();
      if (!settings.auto) return;
      const state = await backupState();
      const due = autoBackupDue(settings, { lastOk: state.ok ? Date.parse(state.ok.at) : null, lastTry: state.essai ? Date.parse(state.essai) : null }, new Date(), householdTimeZone());
      if (due) await runAutoBackup();
    } catch (e) {
      console.error("[sauvegarde] vérification en échec", e);
    }
  };
  setTimeout(tick, 120_000).unref();
  setInterval(tick, 20 * 60_000).unref();
}
