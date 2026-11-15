import { pinEntity, type AssistantEntity } from "./assistantContext.ts";

/*
 * Ouvrir l'assistant depuis n'importe quel écran, sans charger son code : de simples événements,
 * écoutés par la coquille (Layout) et par la conversation (AssistantChat).
 */

/** Largeur à partir de laquelle l'assistant s'ouvre en panneau, à côté de l'écran ; en dessous, il prend tout l'écran. */
export const PANEL_MEDIA = "(min-width: 1280px)";

/**
 * Ouvre l'assistant avec une question pré-remplie (palette ⌘K, boutons « Demander à l'assistant »). `about` joint
 * l'élément dont on parle (une opération…) : la conversation l'affiche en pastille et l'envoie avec le message, pour que
 * « cette opération » désigne la bonne, même une fois sa fiche fermée. Sans question, le champ reste libre.
 */
export const askAssistant = (question: string, about?: AssistantEntity) => {
  if (about) pinEntity(about);
  window.dispatchEvent(new CustomEvent("pecule-ask", { detail: question }));
};

/** Ouvre l'assistant sur une conversation existante (ex. résumé de la semaine). */
export const openThread = (id: string) => {
  localStorage.setItem("pecule.assistant.thread", id);
  window.dispatchEvent(new CustomEvent("pecule-thread", { detail: id }));
};
