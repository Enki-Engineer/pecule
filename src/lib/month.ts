/** Revenus, dépenses et épargne d'un mois à partir des totaux par catégorie (montants signés). */
export function monthTotals(rows: { kind: string | null; total: number }[]) {
  const sum = (kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.total), 0);
  // « + 0 » évite l'affichage « -0 € ».
  return { revenus: sum("revenu") + 0, depenses: -sum("depense") + 0, epargne: -sum("epargne") + 0 };
}

/** Cumul jour par jour (jours 1 à `days`), arrondi à l'euro. */
export function cumulative(daily: { day: number; total: number }[], days: number): number[] {
  const out: number[] = [];
  let acc = 0;
  for (let d = 1; d <= days; d++) {
    acc += Number(daily.find((x) => x.day === d)?.total ?? 0);
    out.push(Math.round(acc));
  }
  return out;
}
