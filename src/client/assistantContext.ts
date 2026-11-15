import { useEffect, useSyncExternalStore } from "react";

/*
 * Contexte de l'assistant : l'élément ouvert à l'écran (opération, facture, mois…), que les pages déclarent avec
 * useAssistantEntity et que le panneau joint au message suivant, et l'élément joint par un bouton « Demander à
 * l'assistant » (pinEntity), qui vaut aussi en plein écran. Ainsi « cette opération » ou « cette facture » désigne
 * la bonne chose.
 */

export type AssistantEntity = { type: "operation" | "facture" | "mois" | "annee" | "credit" | "placement" | "document" | "bien"; id: string; label: string };

let current: AssistantEntity | null = null;
const listeners = new Set<() => void>();

/*
 * Élément joint à la question par un bouton « Demander à l'assistant » (askAssistant). Il suit la conversation même
 * quand sa fiche se ferme — sur téléphone ou dans une fenêtre étroite, l'assistant prend tout l'écran — jusqu'à
 * l'envoi du message, la croix de la pastille, ou l'ouverture d'un autre élément.
 */
let pinned: AssistantEntity | null = null;

export const sameEntity = (a: AssistantEntity | null, b: AssistantEntity | null) => !!a && !!b && a.type === b.type && a.id === b.id;

function set(e: AssistantEntity | null) {
  current = e;
  // Un autre élément s'ouvre : celui qu'on avait joint sans envoyer de message ne suit plus.
  if (e && pinned && !sameEntity(e, pinned)) pinned = null;
  for (const l of listeners) l();
}

export function pinEntity(e: AssistantEntity | null) {
  pinned = e;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const usePinnedEntity = (): AssistantEntity | null => useSyncExternalStore(subscribe, () => pinned);

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
  return useSyncExternalStore(subscribe, () => current);
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
  [/^\/soldes/, "Soldes à venir"],
  [/^\/objectifs/, "Objectifs"],
  [/^\/manuel/, "Manuel"],
  [/^\/reglages/, "Réglages"],
];
export const screenName = (path: string) => SCREENS.find(([re]) => re.test(path))?.[1];
