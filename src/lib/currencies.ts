/*
 * Devises : celle du foyer (tous les totaux s'y expriment), celle de chaque compte, et la conversion de l'une à
 * l'autre. Pécule sait convertir l'euro et les devises dont la Banque centrale européenne publie un cours de
 * référence chaque jour ouvré ; le pivot est l'euro (un cours = unités de la devise pour 1 euro).
 */

export const DEFAULT_CURRENCY = "EUR";

/** L'euro puis les devises cotées par la BCE, les plus courantes d'abord. */
export const CURRENCIES = [
  "EUR", "USD", "CHF", "GBP", "CAD", "AUD", "NZD", "JPY", "SEK", "NOK", "DKK", "ISK", "PLN", "CZK", "HUF", "RON", "TRY",
  "BRL", "MXN", "CNY", "HKD", "SGD", "KRW", "INR", "IDR", "MYR", "PHP", "THB", "ILS", "ZAR",
] as const;
export type Currency = (typeof CURRENCIES)[number];

export const isCurrency = (v: unknown): v is Currency => typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
/** Code lu dans un fichier ou chez une banque : en majuscules, ou la devise par défaut s'il n'est pas reconnu. */
export const cleanCurrency = (v: unknown, fallback: string = DEFAULT_CURRENCY): string => {
  const code = typeof v === "string" ? v.trim().toUpperCase() : "";
  return isCurrency(code) ? code : fallback;
};

/* ---------- Mise en forme ---------- */

const formatters = new Map<string, Intl.NumberFormat>();
function formatter(locale: string, currency: string, round: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${round ? 0 : 1}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, { style: "currency", currency, ...(round ? { maximumFractionDigits: 0 } : {}) });
    formatters.set(key, f);
  }
  return f;
}

/** « 1 234,56 € », « CHF 1'234.56 »… selon la langue ; `round` retire les centimes. */
export const formatMoney = (n: number, currency: string, locale: string, round = false): string => formatter(locale, currency, round).format(n);

const symbols = new Map<string, string>();
/** Le signe de la devise dans une langue : « € », « $US », « CHF ». */
export function currencySymbol(currency: string, locale: string): string {
  const key = `${locale}|${currency}`;
  let s = symbols.get(key);
  if (s === undefined) {
    s = formatter(locale, currency, true).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency;
    symbols.set(key, s);
  }
  return s;
}

/** Suffixe d'un axe ou d'une étiquette courte : « 12 k€ », « 12 k CHF » (un signe d'une lettre se colle, un code s'écarte). */
export const withUnit = (text: string, prefix: string, symbol: string): string => `${text} ${prefix}${prefix && symbol.length > 1 ? " " : ""}${symbol}`;

const digits = new Map<string, number>();
/** Nombre de décimales de la devise (2 pour l'euro, 0 pour le yen). */
export function currencyDigits(currency: string): number {
  let d = digits.get(currency);
  if (d === undefined) {
    try {
      d = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      d = 2;
    }
    digits.set(currency, d);
  }
  return d;
}

/** Arrondi à la plus petite unité de la devise. */
export function roundMoney(n: number, currency: string): number {
  const f = 10 ** currencyDigits(currency);
  return Math.round((n + Number.EPSILON * Math.sign(n)) * f) / f + 0;
}

/* ---------- Conversion ---------- */

/** Cours d'un jour : unités de chaque devise pour 1 euro (l'euro vaut 1, sans y figurer). */
export type Rates = Readonly<Record<string, number>>;

const rateOf = (currency: string, rates: Rates): number | null => (currency === "EUR" ? 1 : rates[currency] > 0 ? rates[currency] : null);

/** Cours croisé : combien de `to` pour 1 `from` ; null si l'une des deux devises n'a pas de cours. */
export function crossRate(from: string, to: string, rates: Rates): number | null {
  if (from === to) return 1;
  const a = rateOf(from, rates);
  const b = rateOf(to, rates);
  return a && b ? b / a : null;
}

/** Montant converti et arrondi à l'unité de la devise d'arrivée ; null sans cours. */
export function convert(amount: number, from: string, to: string, rates: Rates): number | null {
  const rate = crossRate(from, to, rates);
  return rate == null ? null : roundMoney(amount * rate, to);
}

/**
 * Lecture d'un fichier de cours de la BCE (du jour, des 90 derniers jours ou de tout l'historique) :
 * `<Cube time="2026-01-02"><Cube currency="USD" rate="1.0321"/>…</Cube>`.
 */
export function parseEcbRates(xml: string): { date: string; rates: Record<string, number> }[] {
  const days: { date: string; rates: Record<string, number> }[] = [];
  const day = /<Cube\s+time=["'](\d{4}-\d{2}-\d{2})["']\s*>([\s\S]*?)<\/Cube>/g;
  for (let m = day.exec(xml); m; m = day.exec(xml)) {
    const rates: Record<string, number> = {};
    const line = /<Cube\s+currency=["']([A-Z]{3})["']\s+rate=["']([\d.]+)["']\s*\/>/g;
    for (let r = line.exec(m[2]); r; r = line.exec(m[2])) {
      const rate = Number(r[2]);
      if (rate > 0) rates[r[1]] = rate;
    }
    if (Object.keys(rates).length) days.push({ date: m[1], rates });
  }
  return days;
}

/* ---------- Montant d'une opération ---------- */

/** Ce qu'on garde d'un montant : sa valeur dans la devise du foyer, et l'original s'il était dans une autre devise. */
export type Converted = { amount: number; originalAmount: number | null; originalCurrency: string | null };

/** Montant d'un compte ramené à la devise du foyer ; null si le cours manque. */
export function toHousehold(amount: number, currency: string, household: string, rates: Rates): Converted | null {
  if (currency === household) return { amount, originalAmount: null, originalCurrency: null };
  const converted = convert(amount, currency, household, rates);
  return converted == null ? null : { amount: converted, originalAmount: amount, originalCurrency: currency };
}
