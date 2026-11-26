import { useMe } from "./api.ts";

/**
 * L'appli de bureau (`src/lib/desktop.ts`) : Pécule tourne sur l'ordinateur de celui qui s'en sert, dans sa propre
 * fenêtre. Il n'y a ni serveur à nommer ni commande à lancer : l'écran y parle de « cet ordinateur » et du menu de
 * l'appli. C'est le serveur qui le dit (`desktop`, dans `/auth/me`).
 */
export const useDesktop = (): boolean => useMe().data?.desktop === true;
