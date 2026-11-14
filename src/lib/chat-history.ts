/*
 * Historique des conversations de l'assistant : rangement par ancienneté (« Aujourd'hui », « Hier »…),
 * les épinglées en tête. Fonction pure : le jour est celui de l'appareil.
 */

export type HistoryGroup = "pinned" | "today" | "yesterday" | "week" | "month" | "older";

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Groupe d'une conversation d'après sa dernière activité (date ISO). */
export function historyGroup(updatedAt: string, pinned: boolean, now: Date = new Date()): HistoryGroup {
  if (pinned) return "pinned";
  const days = Math.round((dayStart(now) - dayStart(new Date(updatedAt))) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  if (days < 31) return "month";
  return "older";
}

/** Conversations regroupées, dans l'ordre reçu (épinglées puis plus récentes d'abord). */
export function groupHistory<T extends { updatedAt: string; pinned: boolean }>(threads: T[], now: Date = new Date()): { group: HistoryGroup; threads: T[] }[] {
  const out: { group: HistoryGroup; threads: T[] }[] = [];
  for (const t of threads) {
    const group = historyGroup(t.updatedAt, t.pinned, now);
    const last = out.at(-1);
    if (last?.group === group) last.threads.push(t);
    else out.push({ group, threads: [t] });
  }
  return out;
}
