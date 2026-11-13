import { cleanRegion, dayIn, DEFAULT_REGION, type Region } from "../lib/countries.ts";

/*
 * Pays, devise et fuseau horaire du foyer, tels que le serveur les donne avec l'identité (`/auth/me`).
 * Gardés ici pour que la mise en forme des montants les lise sans attendre ; l'appli se remonte quand ils changent.
 */

const COUNTRY_KEY = "pecule.pays";
let current: Region = DEFAULT_REGION;

export const region = (): Region => current;

/** Adopte le réglage reçu du serveur ; vrai s'il a changé. */
export function adoptRegion(next: Partial<Region> | null | undefined): boolean {
  const clean = cleanRegion(next);
  const changed = clean.country !== current.country || clean.currency !== current.currency || clean.timeZone !== current.timeZone;
  current = clean;
  // Le thème appliqué avant le premier rendu (public/theme-init.js) lit le pays sur l'appareil.
  try {
    if (localStorage.getItem(COUNTRY_KEY) !== clean.country) localStorage.setItem(COUNTRY_KEY, clean.country);
  } catch {
    /* stockage indisponible : le thème suit au prochain rendu */
  }
  return changed;
}

/** Date du jour (AAAA-MM-JJ) dans le fuseau du foyer. */
export const householdDay = (at: Date = new Date()) => dayIn(current.timeZone, at);
