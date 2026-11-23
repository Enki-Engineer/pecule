/*
 * Calculs du patrimoine sans base de données (testés dans lib.test.ts) : valeur d'un placement,
 * quote-part d'un compte, valorisation et variation 24 h de la crypto.
 */

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Placement coté (quantité × cours + espèces) si le cours est connu, sinon la valeur saisie. */
export function assetValue(a: { valuation: string; price: number | null; quantity: number | null; cash: number | null; value: number | null }): { value: number; quoted: boolean } {
  const quoted = a.valuation === "cotation" && a.price != null && a.quantity != null;
  return { quoted, value: r2(quoted ? Number(a.quantity) * Number(a.price) + Number(a.cash ?? 0) : Number(a.value ?? 0)) };
}

/** Quote-part d'un compte dans le patrimoine d'un membre : commun pour moitié, le sien en entier, sinon rien. */
export function accountShare(owner: string, memberKey: string): number {
  return owner === "joint" ? 0.5 : owner === memberKey ? 1 : 0;
}

type CryptoInput = { quantity: number | string; manual_value: number | string | null; price: number | string | null; change_24h: number | string | null; price_at: string | null };

/** Valorise les positions (valeur manuelle prioritaire), les trie, et pondère la variation 24 h par la valeur. */
export function valueCrypto<T extends CryptoInput>(rows: T[]) {
  const positions = rows
    .map((r) => {
      const value = r.manual_value != null ? Number(r.manual_value) : r.price != null ? Number(r.quantity) * Number(r.price) : null;
      return { ...r, quantity: Number(r.quantity), value: value == null ? null : r2(value) };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const total = r2(positions.reduce((s, p) => s + (p.value ?? 0), 0));
  const priced = positions.filter((p) => p.change_24h != null && p.value);
  const pricedTotal = priced.reduce((s, p) => s + (p.value ?? 0), 0);
  const change24h = pricedTotal ? priced.reduce((s, p) => s + (p.value ?? 0) * Number(p.change_24h), 0) / pricedTotal : null;
  const pricesAt = positions.map((p) => p.price_at).filter(Boolean).sort().at(-1) ?? null;
  return { positions, total, change24h, pricesAt };
}

/* ---------- Durées de la courbe d'évolution ---------- */

/** Durées proposées au-dessus de la courbe d'évolution, en jours ; « tout » n'a pas de limite. */
/**
 * Patrimoine net tel qu'il était il y a `days` jours : le dernier relevé de l'historique à cette date ou avant
 * (à défaut le plus ancien). Sert à dire « +X sur 30 jours ». `history` : du plus ancien au plus récent.
 */
export function netBefore(history: readonly { date: string; net: number | string }[], days: number, now: number = Date.now()): number | null {
  const limit = now - days * 86_400_000;
  const at = (d: string) => Date.parse(`${d.slice(0, 10)}T12:00:00Z`);
  const found = [...history].reverse().find((h) => at(h.date) <= limit) ?? history[0];
  return found ? Number(found.net) : null;
}

/**
 * Valeur des cryptos jour après jour, tirée des instantanés du patrimoine (leur poche « crypto »). Le point du jour
 * est la valeur à l'instant, celle que l'écran affiche en tête : la courbe finit sur le même chiffre. `snapshots` :
 * du plus ancien au plus récent ; un instantané sans répartition (les tout premiers) n'a pas de point.
 */
export function cryptoSeries(snapshots: readonly { date: string; breakdown: Record<string, number> | null }[], today: string, total: number): { date: string; value: number }[] {
  const points = snapshots
    .map((s) => ({ date: s.date.slice(0, 10), value: Number(s.breakdown?.crypto) }))
    .filter((p) => Number.isFinite(p.value) && p.date < today);
  // Un foyer sans crypto n'a pas de courbe : rien que des zéros ne dit rien.
  if (!(total > 0) && points.every((p) => p.value === 0)) return [];
  return [...points, { date: today, value: r2(total) }];
}

export const HISTORY_RANGES = { "1m": 31, "3m": 92, "6m": 183 } as const;
export type HistoryRange = keyof typeof HISTORY_RANGES | "tout";

/** Premier instant affiché pour une durée (0 : tout l'historique). */
export const historyRangeStart = (range: HistoryRange, now: number = Date.now()): number => (range === "tout" ? 0 : now - HISTORY_RANGES[range] * 86_400_000);

/**
 * Une durée sert-elle à quelque chose ? Seulement si l'historique remonte plus loin qu'elle : sinon elle montrerait
 * exactement la même courbe que « tout ». `first` : instant du premier point affichable (null : aucun point).
 */
export const historyRangeUseful = (range: HistoryRange, first: number | null | undefined, now: number = Date.now()): boolean =>
  range === "tout" || (first != null && first < historyRangeStart(range, now));
