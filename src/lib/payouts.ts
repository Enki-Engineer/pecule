/*
 * Versements reçus d'un placement (coupons, intérêts, ce qu'une plateforme reverse) : ce qu'ils disent, sans base
 * de données. Un versement est une entrée d'argent dont le libellé porte le texte indiqué sur le placement.
 */

export type Payout = { date: string; amount: number };

export type PayoutSummary = {
  count: number;
  total: number;
  /** Le plus récent et le plus ancien (null : aucun versement). */
  last: Payout | null;
  first: Payout | null;
  /** Par année, la plus récente d'abord. */
  years: { year: string; total: number; count: number }[];
  /** Reçu sur les douze derniers mois, jour pour jour. */
  last12: number;
  /** Les versements remontent à douze mois au moins : `last12` vaut pour une année entière. */
  fullYear: boolean;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Même jour, un an plus tôt (AAAA-MM-JJ) ; le 29 février recule au 28. */
export function yearBefore(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const leap = (n: number) => (n % 4 === 0 && n % 100 !== 0) || n % 400 === 0;
  const dd = m === 2 && d === 29 && !leap(y - 1) ? 28 : d;
  return `${y - 1}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** Résume des versements à une date : total, par année, douze derniers mois. L'ordre des lignes est libre. */
export function summarizePayouts(rows: readonly Payout[], today: string): PayoutSummary {
  const sorted = [...rows].map((r) => ({ date: r.date.slice(0, 10), amount: Number(r.amount) })).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const since = yearBefore(today);
  const years = new Map<string, { year: string; total: number; count: number }>();
  for (const r of sorted) {
    const y = years.get(r.date.slice(0, 4)) ?? { year: r.date.slice(0, 4), total: 0, count: 0 };
    y.total += r.amount;
    y.count += 1;
    years.set(y.year, y);
  }
  const first = sorted.at(-1) ?? null;
  return {
    count: sorted.length,
    total: r2(sorted.reduce((s, r) => s + r.amount, 0)),
    last: sorted[0] ?? null,
    first,
    years: [...years.values()].map((y) => ({ ...y, total: r2(y.total) })).sort((a, b) => (a.year < b.year ? 1 : -1)),
    last12: r2(sorted.filter((r) => r.date > since && r.date <= today).reduce((s, r) => s + r.amount, 0)),
    fullYear: !!first && first.date <= since,
  };
}

/**
 * Rendement sur douze mois : ce qui a été reçu, rapporté à la valeur du placement, en pourcentage. Rien à dire tant
 * que les versements ne couvrent pas une année entière, ni sans valeur.
 */
export function payoutYield(s: Pick<PayoutSummary, "last12" | "fullYear">, value: number | null | undefined): number | null {
  if (!s.fullYear || !value || value <= 0 || s.last12 <= 0) return null;
  return Math.round((s.last12 / value) * 1000) / 10;
}

/** Texte cherché par LIKE : `%` et `_` saisis par le membre sont lus tels quels. */
export const likeText = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
