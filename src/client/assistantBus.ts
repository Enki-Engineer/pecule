/*
 * Ouvrir l'assistant depuis n'importe quel écran, sans charger son code : de simples événements,
 * écoutés par la coquille (Layout) et par la conversation (AssistantChat).
 */

/** Ouvre l'assistant avec une question pré-remplie (palette ⌘K, boutons « Demander à l'assistant »). */
export const askAssistant = (question: string) => window.dispatchEvent(new CustomEvent("pecule-ask", { detail: question }));

/** Ouvre l'assistant sur une conversation existante (ex. résumé de la semaine). */
export const openThread = (id: string) => {
  localStorage.setItem("pecule.assistant.thread", id);
  window.dispatchEvent(new CustomEvent("pecule-thread", { detail: id }));
};
