import { entryScript } from "../lib/client-errors.ts";

/*
 * Fichier de code d'entrée de l'écran que ce serveur sert (« index-ab12cd.js ») : un appareil qui remonte une erreur
 * dit le sien, et l'alerte sait s'il tournait sur la construction en service ou sur celle d'une version d'avant
 * (fenêtre restée ouverte, appli installée pas encore rafraîchie). Inconnu hors production : le développement sert
 * l'écran sans le construire.
 */
let current: string | null = null;

/** À l'ouverture du serveur, depuis la page qu'il sert. */
export const setClientBuild = (page: string): void => {
  current = entryScript(page);
};

export const clientBuild = (): string | null => current;
