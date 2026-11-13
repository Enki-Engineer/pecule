import { useEffect, useSyncExternalStore } from "react";

/*
 * Contexte de l'assistant en panneau : l'élément ouvert à l'écran (opération, facture, mois…).
 * Les pages le déclarent avec useAssistantEntity ; le panneau le joint au message suivant, pour
 * que « cette opération » ou « cette facture » désigne la bonne chose.
 */

export type AssistantEntity = { type: "operation" | "facture" | "mois" | "credit" | "placement" | "document" | "bien"; id: string; label: string };

let current: AssistantEntity | null = null;
const listeners = new Set<() => void>();

function set(e: AssistantEntity | null) {
  current = e;
  for (const l of listeners) l();
}

/** Déclare l'élément ouvert tant que le composant est affiché (null : rien d'ouvert). */
export function useAssistantEntity(entity: AssistantEntity | null) {
  const key = entity ? `${entity.type}|${entity.id}|${entity.label}` : "";
  useEffect(() => {
    if (!key) return;
    const [type, id, ...label] = key.split("|");
    set({ type: type as AssistantEntity["type"], id, label: label.join("|") });
    return () => {
      if (current && `${current.type}|${current.id}|${current.label}` === key) set(null);
    };
  }, [key]);
}

export function useCurrentEntity(): AssistantEntity | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/** Nom des écrans, pour le contexte envoyé à l'assistant. */
export const SCREENS: [RegExp, string][] = [
  [/^\/$/, "Accueil"],
  [/^\/operations/, "Opérations"],
  [/^\/factures/, "Factures"],
  [/^\/mois/, "Mois"],
  [/^\/patrimoine\/crypto/, "Crypto"],
  [/^\/patrimoine/, "Patrimoine"],
  [/^\/credits\//, "Crédit"],
  [/^\/documents/, "Documents"],
  [/^\/echeancier/, "Échéancier"],
  [/^\/budget/, "Budget"],
  [/^\/immobilier/, "Immobilier"],
  [/^\/revenus/, "Revenus"],
  [/^\/impots/, "Impôts"],
  [/^\/retraite/, "Retraite"],
  [/^\/projections/, "Projections"],
  [/^\/reglages/, "Réglages"],
];
export const screenName = (path: string) => SCREENS.find(([re]) => re.test(path))?.[1];
