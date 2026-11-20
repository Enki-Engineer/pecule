import { setupCodeFromHash } from "../lib/settings-file.ts";

/*
 * Lien du premier démarrage (`scripts/lien.mjs`) : l'adresse de l'appli avec le code d'installation dans le fragment
 * (« #code=… »), que le navigateur n'envoie pas au serveur. Il est lu ici une seule fois, à l'ouverture de la page —
 * avant que l'écran ne renvoie vers la connexion, ce qui efface le fragment — puis retiré de l'adresse : il ne reste
 * ni dans la barre d'adresse, ni dans l'historique du navigateur.
 *
 * Le code est gardé pour cet onglet seulement (`sessionStorage`), le temps de créer le foyer : choisir sa langue sur
 * l'écran de bienvenue recharge la page, et sans cela le code serait perdu avec le fragment. Il est oublié dès qu'il
 * a servi, ou que le serveur l'a refusé.
 */
const KEY = "pecule:code-installation";

function kept(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    return null; // navigation privée stricte : pas de stockage, le code ne vaut que jusqu'au prochain rechargement
  }
}

const fromLink = setupCodeFromHash(window.location.hash);
if (fromLink) {
  try {
    window.sessionStorage.setItem(KEY, fromLink);
  } catch {
    /* voir plus haut */
  }
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}

/** Le code d'installation reçu avec le lien du premier démarrage ; `null` si la page a été ouverte autrement. */
export const linkedSetupCode = (): string | null => fromLink ?? kept();

/** Le code a servi, ou n'est pas le bon : il n'est plus gardé. */
export function forgetSetupCode() {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* rien n'était gardé */
  }
}
