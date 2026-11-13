/* Périodes de comparaison (écran Analyse → Comparer), sans dépendance au serveur. */

import { t } from "./i18n.ts";

export type CompareBase = "prev" | "year" | "avg3" | "avg6" | "avg12" | "custom";
export type Span = { from: string; to: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shiftMonths = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
};
const monthsIn = (s: Span) => {
  const [y1, m1] = s.from.split("-").map(Number);
  const [y2, m2] = s.to.split("-").map(Number);
  return Math.max(1, (y2 - y1) * 12 + (m2 - m1) + 1);
};

/** Période de référence : précédente, même période l'an dernier, ou moyenne des N mois qui précèdent. */
export function comparisonSpan(a: Span, base: CompareBase, custom?: Span): Span & { divisor: number; label: string } {
  const n = monthsIn(a);
  if (base === "custom" && custom) return { ...custom, divisor: 1, label: t("Période choisie") };
  if (base === "year") return { from: shiftMonths(a.from, -12), to: shiftMonths(a.to, -12), divisor: 1, label: t("Même période l'an dernier") };
  if (base.startsWith("avg")) {
    const k = Number(base.slice(3));
    // Moyenne de k périodes de même longueur juste avant (k mois si la période est un mois).
    const from = shiftMonths(a.from, -k * n);
    const to = iso(new Date(Date.parse(`${a.from}T12:00:00Z`) - 86_400_000));
    return { from, to, divisor: k, label: n === 1 ? t("Moyenne des {k} mois précédents", { k }) : t("Moyenne des {k} périodes précédentes", { k }) };
  }
  const to = iso(new Date(Date.parse(`${a.from}T12:00:00Z`) - 86_400_000));
  return { from: shiftMonths(a.from, -n), to, divisor: 1, label: n === 1 ? t("Mois précédent") : t("Période précédente") };
}

