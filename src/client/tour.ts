import { useSyncExternalStore } from "react";

/*
 * Visite guidée (components/Tour.tsx) : en cours ou non. Elle se lance de partout — l'entrée du menu, « Tout Pécule »
 * sur téléphone, ou une adresse qui porte `?visite=1` (recherche, manuel, fin de la présentation de bienvenue) — et
 * c'est la coquille (Layout.tsx) qui l'affiche. Étapes et place de la bulle : src/lib/tour.ts.
 */

/** Paramètre d'adresse qui lance la visite à l'ouverture d'un écran de l'appli (la coquille le retire aussitôt). */
export const TOUR_PARAM = "visite";
/** Adresse qui ouvre le tableau de bord et lance la visite. */
export const TOUR_LINK = `/?${TOUR_PARAM}=1`;

let active = false;
/** Ce qui a lancé la visite (l'entrée du menu) : le focus y revient à la fin. */
let opener: HTMLElement | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Lance la visite. `from` : le bouton qui la lance — Safari ne donne pas le focus à un bouton cliqué, on le lui rendra nous-mêmes. */
export function startTour(from?: HTMLElement | null) {
  if (active) return;
  opener = from ?? null;
  active = true;
  emit();
}

export function stopTour() {
  if (!active) return;
  active = false;
  opener = null;
  emit();
}

/** Ce qui a lancé la visite en cours, s'il est encore dans la page. */
export const tourOpener = () => (opener?.isConnected ? opener : null);

/* Lancement différé (arrivée de la présentation de bienvenue : le coffre va d'abord se ranger dans le menu). La demande
   est gardée ici, pas dans la coquille : si celle-ci est remontée entre-temps, la visite commence quand même ; si elle
   est partie pour de bon (session fermée), la demande tombe. */
let shells = 0;
let soon: ReturnType<typeof setTimeout> | undefined;

/** La coquille de l'appli est à l'écran (à appeler dans un effet ; rend ce qu'il faut appeler quand elle s'en va). */
export function tourShell() {
  shells++;
  return () => {
    shells--;
  };
}

/** Lance la visite dans `ms` millisecondes, si l'appli est toujours là. */
export function startTourSoon(ms: number) {
  clearTimeout(soon);
  soon = setTimeout(() => {
    if (shells > 0) startTour();
  }, ms);
}

/** La visite guidée est-elle en cours ? */
export const useTourActive = () => useSyncExternalStore(subscribe, () => active);
/** Même question hors d'un composant : pendant la visite, les raccourcis de l'appli attendent. */
export const tourActive = () => active;
