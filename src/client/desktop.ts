import { useEffect, useState } from "react";
import { useMe } from "./api.ts";
import { shownZoom, ZOOM_DATASET, ZOOM_EVENT } from "../lib/desktop.ts";
import { t } from "../lib/i18n.ts";

/**
 * L'appli de bureau (`src/lib/desktop.ts`) : Pécule tourne sur l'ordinateur de celui qui s'en sert, dans sa propre
 * fenêtre. Il n'y a ni serveur à nommer ni commande à lancer : l'écran y parle de « cet ordinateur » et du menu de
 * l'appli. C'est le serveur qui le dit (`desktop`, dans `/auth/me`).
 */
export const useDesktop = (): boolean => useMe().data?.desktop === true;

/** La fenêtre de l'appli de bureau est là (et pas un navigateur ouvert sur l'appli lancée à la main). */
export const useShell = (): boolean => useMe().data?.shell === true;

/**
 * Demande quelque chose à la fenêtre de l'appli de bureau : la taille de l'affichage, l'icône du Dock. La page n'a
 * aucune API de la fenêtre ; elle part vers une adresse à elle (« pecule-action://… »), que la fenêtre reconnaît et
 * n'ouvre pas — rien ne bouge à l'écran. À n'appeler que si `useShell()` : un navigateur n'en ferait rien.
 */
export function shellAction(action: "zoom" | "icone", params: Record<string, string | number>): void {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  window.location.assign(`pecule-action://${action}?${query}`);
}

/** Où la fenêtre écrit la taille de l'affichage en cours, et l'événement par lequel elle dit qu'elle a changé. */
const zoomNow = (): number => shownZoom(document.documentElement.dataset[ZOOM_DATASET]);

/** La taille de l'affichage en cours dans la fenêtre de l'appli de bureau, en pour cent ; elle suit le menu de l'appli. */
export function useZoom(): number {
  const [zoom, setZoom] = useState(zoomNow);
  useEffect(() => {
    const onZoom = () => setZoom(zoomNow());
    window.addEventListener(ZOOM_EVENT, onZoom);
    return () => window.removeEventListener(ZOOM_EVENT, onZoom);
  }, []);
  return zoom;
}

/**
 * Une clé enregistrée que Pécule ne sait plus lire. Sur un serveur, c'est son secret qui a changé ; dans l'appli de
 * bureau, la clé vient d'une sauvegarde faite ailleurs, restaurée ici.
 */
export const unreadableKeyText = (desktop: boolean): string =>
  desktop
    ? t("La clé enregistrée n'est plus lisible (elle vient d'une sauvegarde faite sur une autre installation) : saisis-la de nouveau.")
    : t("La clé enregistrée n'est plus lisible (le secret du serveur a changé) : saisis-la de nouveau.");
