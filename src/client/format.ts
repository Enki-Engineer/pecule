import { locale, t } from "../lib/i18n.ts";
import { currencySymbol, formatMoney, withUnit } from "../lib/currencies.ts";
import { region } from "./region.ts";

/** Montant dans la devise du foyer, écrit dans la langue de l'appli ; `round` retire les centimes. */
export const money = (n: number | null | undefined, round = false) => (n == null ? "—" : formatMoney(n, region().currency, locale(), round));
/** Montant dans une devise donnée : facture d'un achat à l'étranger, opération ou solde d'un compte en devise. */
export const moneyIn = (n: number | null | undefined, currency: string = region().currency) => (n == null ? "—" : formatMoney(n, currency, locale()));
/** Signe de la devise du foyer (« € », « CHF ») ; celui d'une autre devise avec `currency`. */
export const moneySymbol = (currency: string = region().currency) => currencySymbol(currency, locale());
/** Milliers abrégés d'un axe : « 12 k€ », « 12 k CHF » ; `digits` : décimales gardées. */
export const kMoney = (n: number, digits = 0) => withUnit((n / 1000).toLocaleString(locale(), { maximumFractionDigits: digits }), "k", moneySymbol());
/** Montant entier suivi du signe, pour un axe : « 850 € ». */
export const unitMoney = (n: number) => withUnit(String(Math.round(n)), "", moneySymbol());

export const pct = (n: number, digits = 2) => `${n.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits })} %`;

const parse = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`);

export const dateFr = (d: string) => parse(d).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });
/** Jour d'une ligne de liste : « 13/11 » ; avec l'année (« 01/07/24 ») quand ce n'est pas celle en cours, pour une liste qui en traverse plusieurs. */
export const dateShort = (d: string) => {
  const otherYear = d.slice(0, 4) !== new Date().toLocaleDateString("sv-SE").slice(0, 4);
  return parse(d).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", ...(otherYear ? { year: "2-digit" as const } : {}) });
};
export const dayLabel = (d: string) => {
  const today = new Date().toLocaleDateString("sv-SE");
  const yesterday = new Date(Date.now() - 86400_000).toLocaleDateString("sv-SE");
  if (d === today) return t("Aujourd'hui");
  if (d === yesterday) return t("Hier");
  // L'année n'est écrite que si ce n'est pas celle en cours (« lundi 1 juillet 2024 »).
  return parse(d).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long", ...(d.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" as const } : {}) });
};
export const monthLabel = (m: string) => {
  const s = parse(`${m}-01`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** Nom d'une période : « Novembre 2026 » pour un mois, « 2026 » pour une année entière. */
export const periodLabel = (p: string) => (/^\d{4}$/.test(p) ? p : monthLabel(p));
export const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return t("jamais");
  const ms = Date.now() - Date.parse(iso.replace(" ", "T") + (iso.endsWith("Z") ? "" : "Z"));
  const min = Math.round(ms / 60_000);
  if (min < 1) return t("à l'instant");
  if (min < 60) return t("il y a {n} min", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("il y a {n} h", { n: h });
  return t("il y a {n} j", { n: Math.round(h / 24) });
};
export const currentMonth = () => new Date().toLocaleDateString("sv-SE").slice(0, 7);
export const shiftMonth = (m: string, delta: number) => {
  const d = parse(`${m}-01`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return d.toISOString().slice(0, 7);
};
/** « janv », « févr », « juin », « juil »… (uniques, pour les axes). */
export const monthShort = (m: string) => parse(`${m}-01`).toLocaleDateString(locale(), { month: "short" }).replace(".", "");

/** Moment d'un message ou d'une conversation (date ISO) : l'heure le jour même, sinon le jour (« 3 nov. », avec l'année si ce n'est pas celle en cours). */
export const momentLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString(locale(), { day: "numeric", month: "short", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}) });
};

/** Coût de l'IA : compté en euros quelle que soit la devise du foyer (c'est la facture du fournisseur). */
export const aiCost = (n: number) => (n < 0.01 ? "< 0,01 €" : new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR", maximumFractionDigits: n < 1 ? 3 : 2 }).format(n));
