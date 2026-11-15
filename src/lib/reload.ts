/*
 * Nouvelle version déployée pendant que l'appli est ouverte : les morceaux de code chargés à la demande (écrans,
 * graphiques) de la version en mémoire n'existent plus sur le serveur. L'écran demandé ne peut alors s'afficher
 * qu'après un rechargement de la page, qui repart sur la nouvelle version au même endroit.
 */

/** Délai pendant lequel on ne recharge pas une seconde fois : si le rechargement n'a rien arrangé, on n'insiste pas. */
export const RELOAD_EVERY_MS = 60_000;

/** Peut-on recharger la page pour retrouver un morceau de code manquant ? Pas hors ligne, ni en boucle. */
export const canReload = (lastAttempt: number | null, now: number, online: boolean) => online && (lastAttempt == null || now - lastAttempt >= RELOAD_EVERY_MS);
