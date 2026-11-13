import { isDemo } from "./demo-context.ts";
import { DEFAULT_REGION, dayIn, type Region } from "../lib/countries.ts";
import { currencySymbol, formatMoney } from "../lib/currencies.ts";
import { locale } from "../lib/i18n.ts";

/*
 * Pays, devise et fuseau horaire du foyer (Réglages → Foyer, gardés avec les réglages du foyer dans `app_kv`).
 * Lus en mémoire : le code les demande sans attendre, pour mettre en forme un montant ou savoir quel jour on est.
 * La démo est un foyer français en euros : elle n'appelle aucun service de cours.
 * Module sans accès à la base : c'est `household.ts` qui sait lire le réglage (`watchRegion`).
 */

const REFRESH_MS = 60_000;
let stored: Region = DEFAULT_REGION;
let loadedAt = 0;
let refreshing: Promise<void> | null = null;
let reader: (() => Promise<Region>) | null = null;

/** Donne le moyen de relire le réglage en base (au démarrage, puis de temps en temps). */
export function watchRegion(read: () => Promise<Region>) {
  reader = read;
}

export async function loadRegion() {
  if (!reader) return;
  stored = await reader();
  loadedAt = Date.now();
}

/** Le réglage vient d'être enregistré : la mémoire suit sans attendre. */
export function setRegion(next: Region) {
  stored = next;
  loadedAt = Date.now();
}

export function region(): Region {
  if (isDemo()) return DEFAULT_REGION;
  // Relecture de temps en temps, une fois le réglage lu au démarrage (avant, la base n'est peut-être pas encore créée).
  if (loadedAt && Date.now() - loadedAt > REFRESH_MS && !refreshing) {
    loadedAt = Date.now();
    refreshing = loadRegion()
      .catch((e) => console.error("[foyer] pays et devise illisibles", e))
      .finally(() => {
        refreshing = null;
      });
  }
  return stored;
}

/** Devise du foyer (code ISO) : celle de tous les totaux. */
export const householdCurrency = (): string => region().currency;

/** Date du jour (AAAA-MM-JJ) dans le fuseau du foyer. */
export const today = (at: Date = new Date()): string => dayIn(region().timeZone, at);

/** La même, sous un nom qui ne se confond pas avec une variable locale `today`. */
export const householdDay = today;

/** Fuseau horaire du foyer (« Europe/Paris »). */
export const householdTimeZone = (): string => region().timeZone;

/** Montant dans la devise du foyer, écrit dans la langue de la requête ; `round` retire les centimes. */
export const money = (n: number, round = false): string => formatMoney(n, householdCurrency(), locale(), round);

/** Montant dans une devise donnée (facture d'un achat à l'étranger), écrit dans la langue de la requête. */
export const moneyIn = (n: number, currency: string | null | undefined): string => formatMoney(n, currency || householdCurrency(), locale());

/** Signe de la devise du foyer dans la langue de la requête (« € », « CHF »). */
export const moneySymbol = (): string => currencySymbol(householdCurrency(), locale());
