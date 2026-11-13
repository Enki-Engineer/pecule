import { DEFAULT_CURRENCY, isCurrency } from "./currencies.ts";

/*
 * Pays du foyer : il donne la devise et le fuseau horaire proposés, la banque cherchée par défaut, et dit si ce
 * qui est propre à la France s'applique (calendrier fiscal, bulletins de paie, avis d'impôt, relevé de carrière,
 * fêtes locales). Le nom d'un pays s'affiche par `Intl.DisplayNames`, dans la langue du membre.
 */

export const DEFAULT_COUNTRY = "FR";
export const DEFAULT_TIME_ZONE = "Europe/Paris";

/** Pays proposés : [devise, fuseau horaire le plus courant]. */
export const COUNTRIES: Readonly<Record<string, readonly [currency: string, timeZone: string]>> = {
  FR: ["EUR", "Europe/Paris"],
  BE: ["EUR", "Europe/Brussels"],
  CH: ["CHF", "Europe/Zurich"],
  LU: ["EUR", "Europe/Luxembourg"],
  MC: ["EUR", "Europe/Monaco"],
  DE: ["EUR", "Europe/Berlin"],
  AT: ["EUR", "Europe/Vienna"],
  IT: ["EUR", "Europe/Rome"],
  ES: ["EUR", "Europe/Madrid"],
  PT: ["EUR", "Europe/Lisbon"],
  NL: ["EUR", "Europe/Amsterdam"],
  IE: ["EUR", "Europe/Dublin"],
  GB: ["GBP", "Europe/London"],
  FI: ["EUR", "Europe/Helsinki"],
  EE: ["EUR", "Europe/Tallinn"],
  LV: ["EUR", "Europe/Riga"],
  LT: ["EUR", "Europe/Vilnius"],
  GR: ["EUR", "Europe/Athens"],
  CY: ["EUR", "Asia/Nicosia"],
  MT: ["EUR", "Europe/Malta"],
  SI: ["EUR", "Europe/Ljubljana"],
  SK: ["EUR", "Europe/Bratislava"],
  HR: ["EUR", "Europe/Zagreb"],
  BG: ["EUR", "Europe/Sofia"],
  SE: ["SEK", "Europe/Stockholm"],
  NO: ["NOK", "Europe/Oslo"],
  DK: ["DKK", "Europe/Copenhagen"],
  IS: ["ISK", "Atlantic/Reykjavik"],
  PL: ["PLN", "Europe/Warsaw"],
  CZ: ["CZK", "Europe/Prague"],
  HU: ["HUF", "Europe/Budapest"],
  RO: ["RON", "Europe/Bucharest"],
  TR: ["TRY", "Europe/Istanbul"],
  US: ["USD", "America/New_York"],
  CA: ["CAD", "America/Toronto"],
  MX: ["MXN", "America/Mexico_City"],
  BR: ["BRL", "America/Sao_Paulo"],
  AU: ["AUD", "Australia/Sydney"],
  NZ: ["NZD", "Pacific/Auckland"],
  JP: ["JPY", "Asia/Tokyo"],
  CN: ["CNY", "Asia/Shanghai"],
  HK: ["HKD", "Asia/Hong_Kong"],
  SG: ["SGD", "Asia/Singapore"],
  KR: ["KRW", "Asia/Seoul"],
  IN: ["INR", "Asia/Kolkata"],
  ID: ["IDR", "Asia/Jakarta"],
  MY: ["MYR", "Asia/Kuala_Lumpur"],
  PH: ["PHP", "Asia/Manila"],
  TH: ["THB", "Asia/Bangkok"],
  IL: ["ILS", "Asia/Jerusalem"],
  ZA: ["ZAR", "Africa/Johannesburg"],
};

export const isCountry = (v: unknown): v is string => typeof v === "string" && Object.hasOwn(COUNTRIES, v);

/** Un fuseau horaire que le moteur connaît (« Europe/Zurich ») ? */
export function isTimeZone(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
}

/** Pays, devise et fuseau du foyer. */
export type Region = { country: string; currency: string; timeZone: string };
export const DEFAULT_REGION: Region = { country: DEFAULT_COUNTRY, currency: DEFAULT_CURRENCY, timeZone: DEFAULT_TIME_ZONE };

/** Réglage valide à partir de n'importe quelle valeur enregistrée ; ce qui manque prend la valeur par défaut. */
export function cleanRegion(v: { country?: unknown; currency?: unknown; timeZone?: unknown } | null | undefined): Region {
  return {
    country: isCountry(v?.country) ? v.country : DEFAULT_COUNTRY,
    currency: isCurrency(v?.currency) ? v.currency : DEFAULT_CURRENCY,
    timeZone: isTimeZone(v?.timeZone) ? v.timeZone : DEFAULT_TIME_ZONE,
  };
}

/** Ce qu'on propose pour un pays : sa devise et son fuseau. */
export const regionOf = (country: string): Region => {
  const [currency, timeZone] = COUNTRIES[country] ?? COUNTRIES[DEFAULT_COUNTRY];
  return { country: isCountry(country) ? country : DEFAULT_COUNTRY, currency, timeZone };
};

/**
 * Pays deviné d'après le navigateur (fuseau d'abord, région de la langue sinon), pour préremplir le réglage à
 * l'installation. Rien n'est appliqué sans que le membre le voie.
 */
export function guessRegion(timeZone: string | undefined, languages: readonly string[] = []): Region {
  const byZone = timeZone && Object.keys(COUNTRIES).find((c) => COUNTRIES[c][1] === timeZone);
  const byLanguage = languages.map((l) => l.split("-")[1]?.toUpperCase()).find((c) => c && isCountry(c));
  const country = byZone || byLanguage || DEFAULT_COUNTRY;
  return { ...regionOf(country), timeZone: isTimeZone(timeZone) ? timeZone : regionOf(country).timeZone };
}

/** Ce qui est propre à la France (calendrier fiscal, documents français, fêtes locales) s'applique-t-il ? */
export const isFrance = (country: string): boolean => country === "FR";

/** Date du jour (AAAA-MM-JJ) dans un fuseau. */
export const dayIn = (timeZone: string, at: Date = new Date()): string => at.toLocaleDateString("sv-SE", { timeZone });
