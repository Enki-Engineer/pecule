import { canReload } from "../lib/reload.ts";

/*
 * Morceau de code introuvable (une nouvelle version a été déployée pendant que l'appli était ouverte) :
 * la page est rechargée une fois, elle repart sur la nouvelle version au même endroit.
 */

const KEY = "pecule.recharge";

/** Recharge la page si c'est utile (en ligne, pas déjà tenté à l'instant). Vrai si le rechargement est lancé. */
export function reloadForNewVersion(): boolean {
  let last: number | null = null;
  try {
    const stored = sessionStorage.getItem(KEY);
    last = stored ? Number(stored) : null;
  } catch {
    // Stockage refusé (navigation privée) : on ne sait pas si on a déjà essayé, donc on n'essaie pas.
    return false;
  }
  if (!canReload(last, Date.now(), navigator.onLine)) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Charge un morceau de code dont l'écran a besoin maintenant. S'il manque, la page se recharge : la promesse reste
 * alors en attente (l'écran garde son squelette jusqu'au rechargement). Sinon l'erreur remonte au garde-fou de l'écran.
 */
export const loadChunk = <T,>(load: () => Promise<T>): Promise<T> =>
  load().catch((e: unknown) => {
    if (reloadForNewVersion()) return new Promise<T>(() => {});
    throw e;
  });
