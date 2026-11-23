import { describeError, errorSignature, REPORT_LIMITS, screenPath, worthReporting, type ClientErrorKind, type ClientErrorReport } from "../lib/client-errors.ts";

/*
 * Remontée des erreurs d'affichage au serveur du foyer : un écran tombé (garde-fou d'affichage) ou une erreur de
 * script que rien n'attrape ne laissait de trace que dans la console du navigateur. Elle devient une alerte du Suivi
 * technique (Réglages). Rien n'est envoyé ailleurs qu'au serveur de l'installation, ni le contenu de l'écran ni les
 * paramètres de l'adresse : le message de l'erreur, sa pile, le chemin de l'écran.
 */

/** Une même erreur ne part qu'une fois par séance, et une séance n'en envoie qu'une poignée : une boucle ne remplit rien. */
const MAX_PER_SESSION = 12;
const sent = new Set<string>();

/** Fichier de code d'entrée de cette page (« index-ab12cd.js ») : le serveur y reconnaît sa construction en service. */
const build = (): string | undefined => {
  const src = document.querySelector<HTMLScriptElement>('script[type="module"][src^="/assets/"]')?.getAttribute("src");
  return src ? src.split("/").pop()?.slice(0, REPORT_LIMITS.build) : undefined;
};

/** Remonte une erreur au serveur. Ne lève jamais : signaler une panne ne doit pas en créer une. */
export function reportError(kind: ClientErrorKind, error: unknown, component?: string | null): void {
  try {
    const { message, stack } = describeError(error);
    if (!worthReporting(message, stack)) return;
    const signature = errorSignature(message, stack);
    if (sent.has(signature) || sent.size >= MAX_PER_SESSION) return;
    sent.add(signature);
    const report: ClientErrorReport = {
      kind,
      message: message.slice(0, REPORT_LIMITS.message),
      stack: stack.slice(0, REPORT_LIMITS.stack) || undefined,
      component: component?.slice(0, REPORT_LIMITS.component) || undefined,
      path: screenPath(window.location.href),
      build: build(),
    };
    // `keepalive` : l'envoi aboutit même si la page se recharge juste après (bouton « Recharger » de l'écran d'erreur).
    void fetch("/api/client-errors", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify(report) }).catch(() => undefined);
  } catch {
    // Rien : l'écran continue comme il peut.
  }
}

/** Écoute ce que rien n'attrape : erreurs de script et promesses rejetées sans suite. À appeler une fois, au démarrage. */
export function watchErrors(): void {
  window.addEventListener("error", (e) => {
    reportError("script", e.error ?? e.message);
  });
  window.addEventListener("unhandledrejection", (e) => {
    reportError("promesse", e.reason);
  });
}
