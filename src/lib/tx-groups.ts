/*
 * Liste des opérations rangée par mois (écran Opérations) : une boîte par mois, ses jours dans l'ordre reçu, et le
 * bilan de chaque mois (calculé par le serveur sur toute la liste filtrée, pas sur les seules lignes chargées).
 */

export type DayGroup<T> = { day: string; items: T[] };
export type MonthGroup<T> = { month: string; days: DayGroup<T>[]; count: number };

/** Opérations déjà triées par date (dans un sens ou dans l'autre) : une suite de mois, chacun fait de ses jours. */
export function groupByMonth<T extends { date: string }>(rows: T[]): MonthGroup<T>[] {
  const months: MonthGroup<T>[] = [];
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    let month = months.at(-1);
    if (month?.month !== key) months.push((month = { month: key, days: [], count: 0 }));
    const day = month.days.at(-1);
    if (day?.day === row.date) day.items.push(row);
    else month.days.push({ day: row.date, items: [row] });
    month.count++;
  }
  return months;
}

/** Bilan d'un mois de la liste : mêmes définitions que l'Analyse (un mouvement interne ne compte pas). */
export type MonthTotals = { count: number; uncategorized: number; revenus: number; depenses: number; epargne: number };

const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** Solde : revenus moins dépenses. L'épargne n'en est pas retirée (comme le « Solde du mois » de l'Analyse). */
export const balanceOf = (m: Pick<MonthTotals, "revenus" | "depenses">) => r2(m.revenus - m.depenses);

/** Bilan de plusieurs mois réunis (toute la liste filtrée). */
export function sumMonths(months: MonthTotals[]): MonthTotals {
  const sum = (key: keyof MonthTotals) => months.reduce((s, m) => s + m[key], 0);
  return { count: sum("count"), uncategorized: sum("uncategorized"), revenus: r2(sum("revenus")), depenses: r2(sum("depenses")), epargne: r2(sum("epargne")) };
}

/**
 * Rang de couleur du poste d'une dépense (1 à 8, `--series-N`), le même que sur l'anneau des dépenses de l'Analyse ;
 * null : poste non coloré (gris « Autres »), ou ligne qui n'est pas une dépense.
 */
export function posteSlot(colored: string[] | undefined, t: { category_poste: string | null; category_kind: string | null }): number | null {
  if (t.category_kind !== "depense" || !t.category_poste) return null;
  const i = colored?.indexOf(t.category_poste) ?? -1;
  return i < 0 ? null : i + 1;
}

/** Ce qui ne compte pas dans le bilan du mois : un mouvement entre deux comptes du foyer. Sa ligne s'efface. */
export const isInternal = (t: { category_kind: string | null }) => t.category_kind === "interne";
