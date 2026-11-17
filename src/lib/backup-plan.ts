import { dayIn } from "./countries.ts";

/*
 * Sauvegardes automatiques (Réglages → Compte et sécurité, `src/server/auto-backup.ts`) : le réglage, et les règles
 * qui ne dépendent de rien — quand en faire une, lesquelles garder, quand rappeler qu'il n'y en a plus. Testées.
 */

export type BackupFrequency = "jour" | "semaine";

/** Ce qui est gardé hors du serveur : les dernières copies, puis la première de chaque semaine et de chaque mois. */
export type Retention = { jours: number; semaines: number; mois: number };

export type BackupSettings = {
  /** Le serveur écrit lui-même une sauvegarde complète, à la fréquence choisie. Éteint tant qu'on ne l'a pas demandé. */
  auto: boolean;
  frequence: BackupFrequency;
  /** Nombre de sauvegardes automatiques gardées sur le serveur (les plus récentes). */
  garder: number;
  /** Conservation des copies chiffrées envoyées hors du serveur. */
  dehors: Retention;
};

export const DEFAULT_RETENTION: Retention = { jours: 7, semaines: 4, mois: 6 };
/** Conservations proposées à l'écran, de la plus courte à la plus longue. */
export const RETENTION_CHOICES: Retention[] = [{ jours: 7, semaines: 0, mois: 0 }, { jours: 7, semaines: 4, mois: 0 }, DEFAULT_RETENTION, { jours: 7, semaines: 4, mois: 12 }];
export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { auto: false, frequence: "jour", garder: 7, dehors: DEFAULT_RETENTION };
export const KEEP_MIN = 1;
export const KEEP_MAX = 60;

/** Réglage lu en base, ramené à des valeurs sûres (une valeur absente ou inattendue prend celle d'origine). */
export function cleanBackupSettings(raw: unknown): BackupSettings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const keep = Number(r.garder);
  const out = r.dehors && typeof r.dehors === "object" ? (r.dehors as Record<string, unknown>) : {};
  const count = (v: unknown, fallback: number, min: number) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.max(min, Math.min(120, Math.round(Number(v)))) : fallback);
  return {
    auto: r.auto === true,
    frequence: r.frequence === "semaine" ? "semaine" : "jour",
    garder: Number.isFinite(keep) ? Math.max(KEEP_MIN, Math.min(KEEP_MAX, Math.round(keep))) : DEFAULT_BACKUP_SETTINGS.garder,
    // Au moins une copie reste toujours dehors.
    dehors: { jours: count(out.jours, DEFAULT_RETENTION.jours, 1), semaines: count(out.semaines, DEFAULT_RETENTION.semaines, 0), mois: count(out.mois, DEFAULT_RETENTION.mois, 0) },
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

/** Stockage extérieur tel que l'écran le saisit ; `secret` vide : garder celui qui est déjà enregistré. */
export type DestinationInput =
  | { type: "s3"; endpoint: string; region: string; bucket: string; prefix: string; accessKey: string; secret: string }
  | { type: "webdav"; url: string; user: string; secret: string };

/** Le même, tel que le serveur le rend : jamais le secret. `unreadable` : le secret enregistré ne s'ouvre plus (secret du serveur changé). */
export type PublicDestination = (Omit<Extract<DestinationInput, { type: "s3" }>, "secret"> | Omit<Extract<DestinationInput, { type: "webdav" }>, "secret">) & { unreadable: boolean };

/** Une copie envoyée hors du serveur est chiffrée (format age) : son nom est celui de l'archive, suivi de « .age ». */
export const ENCRYPTED_SUFFIX = ".age";
export const remoteName = (archive: string) => `${archive}${ENCRYPTED_SUFFIX}`;

/** Instant porté par le nom d'une copie hors du serveur ; `null` si ce n'en est pas une de Pécule. */
export const parseRemoteName = (name: string): number | null => (name.endsWith(ENCRYPTED_SUFFIX) ? parseAutoName(name.slice(0, -ENCRYPTED_SUFFIX.length)) : null);

/**
 * Copies à retirer du stockage extérieur. Restent : les `jours` dernières, puis la première de chacune des
 * `semaines` dernières semaines où il y en a eu, et la première de chacun des `mois` derniers mois. Un fichier qui
 * n'est pas une copie de Pécule n'est jamais touché.
 */
export function remoteToPrune(names: string[], keep: Retention): string[] {
  const items = names
    .map((name) => ({ name, at: parseRemoteName(name) }))
    .filter((f): f is { name: string; at: number } => f.at !== null)
    .sort((a, b) => b.at - a.at);
  const kept = new Set(items.slice(0, Math.max(1, keep.jours)).map((f) => f.name));
  // La première copie de chaque période, pour les périodes les plus récentes (les semaines commencent le lundi).
  const firstOfEach = (periodOf: (at: number) => string, periods: number) => {
    const first = new Map<string, string>();
    for (const f of items) first.set(periodOf(f.at), f.name);
    for (const name of [...first.values()].slice(0, Math.max(0, periods))) kept.add(name);
  };
  firstOfEach((at) => String(Math.floor((Math.floor(at / DAY_MS) + 3) / 7)), keep.semaines);
  firstOfEach((at) => new Date(at).toISOString().slice(0, 7), keep.mois);
  return items.filter((f) => !kept.has(f.name)).map((f) => f.name);
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
