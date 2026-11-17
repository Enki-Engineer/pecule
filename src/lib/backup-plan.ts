import { dayIn } from "./countries.ts";

/*
 * Sauvegardes automatiques (Réglages → Compte et sécurité, `src/server/auto-backup.ts`) : le réglage, et les règles
 * qui ne dépendent de rien — quand en faire une, lesquelles garder, quand rappeler qu'il n'y en a plus. Testées.
 */

export type BackupFrequency = "jour" | "semaine";

export type BackupSettings = {
  /** Le serveur écrit lui-même une sauvegarde complète, à la fréquence choisie. Éteint tant qu'on ne l'a pas demandé. */
  auto: boolean;
  frequence: BackupFrequency;
  /** Nombre de sauvegardes automatiques gardées sur le serveur (les plus récentes). */
  garder: number;
};

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { auto: false, frequence: "jour", garder: 7 };
export const KEEP_MIN = 1;
export const KEEP_MAX = 60;

/** Réglage lu en base, ramené à des valeurs sûres (une valeur absente ou inattendue prend celle d'origine). */
export function cleanBackupSettings(raw: unknown): BackupSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const keep = Number(r.garder);
  return {
    auto: r.auto === true,
    frequence: r.frequence === "semaine" ? "semaine" : "jour",
    garder: Number.isFinite(keep) ? Math.max(KEEP_MIN, Math.min(KEEP_MAX, Math.round(keep))) : DEFAULT_BACKUP_SETTINGS.garder,
  };
}

/** Heure (du foyer) à partir de laquelle la sauvegarde de la nuit est faite. */
export const NIGHT_HOUR = 3;
/** Après un échec, un nouvel essai attend au moins ce délai. */
export const RETRY_MS = 6 * 3_600_000;
const DAY_MS = 86_400_000;

export const AUTO_PREFIX = "pecule-auto-";

/** Nom d'une sauvegarde automatique : `pecule-auto-AAAA-MM-JJ-HHMM.zip` (UTC). */
export function autoBackupName(now: Date): string {
  return `${AUTO_PREFIX}${now.toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.zip`;
}

/** Instant porté par le nom d'une sauvegarde automatique ; `null` si ce n'en est pas une. */
export function parseAutoName(name: string): number | null {
  const m = /^pecule-auto-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})\.zip$/.exec(name);
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isNaN(at) ? null : at;
}

const hourIn = (timeZone: string, at: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(at));
const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS);

/**
 * Faut-il écrire une sauvegarde automatique maintenant ? Une par nuit (ou par semaine), à partir de trois heures à
 * l'heure du foyer ; la toute première part sans attendre la nuit ; après un échec, un nouvel essai attend six heures.
 */
export function autoBackupDue(s: Pick<BackupSettings, "auto" | "frequence">, state: { lastOk: number | null; lastTry: number | null }, now: Date, timeZone: string): boolean {
  if (!s.auto) return false;
  if (state.lastTry !== null && state.lastTry > (state.lastOk ?? 0) && now.getTime() - state.lastTry < RETRY_MS) return false;
  if (state.lastOk === null) return true;
  const days = dayNumber(dayIn(timeZone, now)) - dayNumber(dayIn(timeZone, new Date(state.lastOk)));
  if (days < (s.frequence === "semaine" ? 7 : 1)) return false;
  return hourIn(timeZone, now) >= NIGHT_HOUR;
}

/** Sauvegardes automatiques à retirer pour n'en garder que `keep`, les plus récentes. Les autres archives ne sont jamais touchées. */
export function autoBackupsToPrune(names: string[], keep: number): string[] {
  return names
    .map((name) => ({ name, at: parseAutoName(name) }))
    .filter((f): f is { name: string; at: number } => f.at !== null)
    .sort((a, b) => b.at - a.at)
    .slice(Math.max(0, keep))
    .map((f) => f.name);
}

/** Au-delà de ce nombre de jours sans aucune sauvegarde, Pécule le rappelle à l'administrateur. */
export const REMINDER_DAYS = 30;

/**
 * Nombre de jours sans sauvegarde à rappeler, ou `null` s'il n'y a rien à dire. `last` : la dernière sauvegarde de
 * toute sorte (téléchargée, automatique, d'avant migration) ; `since` : le début de l'installation, qui sert de
 * repère tant qu'aucune n'a été prise.
 */
export function backupReminder(last: number | null, since: number | null, now: number): number | null {
  const from = last ?? since;
  if (from === null) return null;
  const days = Math.floor((now - from) / DAY_MS);
  return days >= REMINDER_DAYS ? days : null;
}
