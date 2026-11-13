/*
 * Périodes, sans dépendance au serveur : la période d'analyse (un mois ou une année entière), la fenêtre du
 * graphique « mois par mois », et les périodes de comparaison (écran Analyse → Comparer).
 */

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


/* ---------- Période d'analyse : un mois (« 2026-11 ») ou une année entière (« 2026 ») ---------- */

export const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
export const isYearPeriod = (p: string) => /^\d{4}$/.test(p);

/** Mois décalé de `n` mois (« 2026-01 », −1 → « 2025-12 »). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((((k % 12) + 12) % 12) + 1).padStart(2, "0")}`;
}

/** Période voisine : le mois ou l'année d'avant (−1), d'après (+1). */
export const shiftPeriod = (p: string, delta: number) => (isYearPeriod(p) ? String(Number(p) + delta) : addMonths(p, delta));

/** Mois d'une période, dans l'ordre : douze pour une année, un pour un mois. */
export const monthsOfPeriod = (p: string): string[] => (isYearPeriod(p) ? Array.from({ length: 12 }, (_, i) => `${p}-${String(i + 1).padStart(2, "0")}`) : [p]);

/** La période contient-elle ce mois ? */
export const periodHasMonth = (p: string, month: string) => (isYearPeriod(p) ? month.startsWith(`${p}-`) : p === month);

/** Bornes d'une période : premier jour, lendemain du dernier (exclu), et la période d'avant, de même longueur. */
export function periodRange(p: string): { start: string; end: string; previous: string; prevStart: string; year: boolean } {
  const year = isYearPeriod(p);
  const previous = shiftPeriod(p, -1);
  const first = (x: string) => (isYearPeriod(x) ? `${x}-01-01` : `${x}-01`);
  return { start: first(p), end: first(shiftPeriod(p, 1)), previous, prevStart: first(previous), year };
}

/** Les `n` mois qui finissent à `end` (compris), du plus ancien au plus récent. */
export const monthsEnding = (end: string, n: number): string[] => Array.from({ length: n }, (_, i) => addMonths(end, i - n + 1));

/** Mois prévus affichés après le mois en cours. */
export const FORECAST_MONTHS = 3;

/**
 * Dernier mois réel du graphique « mois par mois » (douze mois glissants). La fenêtre ne bouge pas tant que le mois
 * choisi y reste ; quand il en sort, elle glisse juste assez pour le montrer (au bord gauche en reculant, au bord
 * droit en avançant), sans jamais dépasser le mois en cours.
 */
export function trendEnd(previousEnd: string, month: string, current: string): string {
  const end = previousEnd > current ? current : previousEnd;
  if (month > end) return month > current ? current : month;
  if (month < addMonths(end, -11)) return addMonths(month, 11);
  return end;
}

/**
 * Mois du graphique « mois par mois » : pour une année, ses douze mois ; pour un mois, les douze mois qui finissent
 * à `end`. `forecast` : les mois à venir montrés en prévision (trois au plus après le mois en cours), ajoutés à la
 * suite quand la fenêtre touche le présent.
 */
export function trendMonths(period: string, end: string, current: string): { months: string[]; forecast: string[] } {
  const horizon = addMonths(current, FORECAST_MONTHS);
  if (isYearPeriod(period)) {
    const months = monthsOfPeriod(period);
    return { months, forecast: months.filter((m) => m > current && m <= horizon) };
  }
  const real = monthsEnding(end, 12);
  const forecast = end === current ? Array.from({ length: FORECAST_MONTHS }, (_, i) => addMonths(current, i + 1)) : [];
  return { months: [...real, ...forecast], forecast };
}
