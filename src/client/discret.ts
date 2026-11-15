import { useSyncExternalStore } from "react";

/*
 * Mode discret : les montants sont remplacés par « ••• » (montrer l'écran à quelqu'un, travailler dans un lieu
 * public). Réglage de l'appareil, mémorisé ; les formateurs de montants (src/client/format.ts) le lisent, et l'appli
 * est rendue de nouveau à chaque bascule (src/client/app.tsx). Ce qui n'est pas un montant reste lisible :
 * pourcentages, nombres d'opérations, libellés — et le texte déjà écrit par l'assistant.
 */

const KEY = "pecule.discret";
const listeners = new Set<() => void>();
let on = localStorage.getItem(KEY) === "1";

export const isDiscreet = () => on;

export function setDiscreet(next: boolean) {
  if (next === on) return;
  on = next;
  if (next) localStorage.setItem(KEY, "1");
  else localStorage.removeItem(KEY);
  for (const l of listeners) l();
}

export const toggleDiscreet = () => setDiscreet(!on);

export const useDiscreet = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    isDiscreet,
  );
