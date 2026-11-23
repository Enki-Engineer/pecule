/*
 * Erreurs d'affichage remontées au serveur du foyer : ce qu'un appareil envoie quand un écran tombe (garde-fou
 * d'affichage) ou qu'une erreur de script n'est attrapée par personne, et ce que le serveur en garde — une alerte du
 * Suivi technique. Règles pures, partagées par l'écran (quoi envoyer, quoi taire : src/client/report.ts) et par le
 * serveur (quoi écrire : POST /api/client-errors). Rien ne quitte l'installation : l'erreur va au serveur du foyer.
 */

/** D'où vient l'erreur : le rendu d'un écran (garde-fou), un script, une promesse que personne n'attendait. */
export const CLIENT_ERROR_KINDS = ["rendu", "script", "promesse"] as const;
export type ClientErrorKind = (typeof CLIENT_ERROR_KINDS)[number];

export type ClientErrorReport = {
  kind: ClientErrorKind;
  message: string;
  stack?: string;
  /** Pile des composants (garde-fou d'affichage). */
  component?: string;
  /** Chemin de l'écran, sans ses paramètres. */
  path: string;
  /** Fichier de code d'entrée de l'écran (« index-ab12cd.js ») : dit si l'appareil tourne sur la construction en service. */
  build?: string;
};

/** Longueurs gardées : l'écran coupe avant d'envoyer, le serveur recoupe. */
export const REPORT_LIMITS = { message: 300, stack: 3000, component: 1500, path: 200, build: 80 } as const;

/**
 * Bruit qui n'est pas une panne de l'écran : réseau coupé, requête abandonnée, fichier de code d'une version d'avant,
 * et ce que le serveur a refusé (« ApiError » : limite de débit, accès, élément introuvable — il garde lui-même la
 * trace de ses propres pannes). « NetworkError » : le nom que l'écran donne à un serveur injoignable (src/client/api.ts).
 */
const NOISE = [
  /^ResizeObserver loop/i,
  /^Script error\.?$/i,
  /^ApiError: /,
  /Failed to fetch|Load failed|NetworkError|network connection was lost|Internet connection appears to be offline/i,
  /AbortError|operation was aborted|signal is aborted|The user aborted a request/i,
  /dynamically imported module|Importing a module script failed|Unable to preload CSS/i,
];
/** Code d'une extension du navigateur : pas celui de Pécule. */
const FOREIGN = /\b(?:chrome|moz|safari|safari-web|webkit-masked)-(?:extension|url):\/\//i;

/** Une erreur vaut-elle d'être remontée ? */
export function worthReporting(message: string, stack = ""): boolean {
  if (!message.trim()) return false;
  if (NOISE.some((re) => re.test(message))) return false;
  return !FOREIGN.test(stack) && !FOREIGN.test(message);
}

/** Message et pile de ce qui a été lancé : une erreur, un texte, n'importe quoi d'autre. */
export function describeError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) return { message: `${error.name}: ${error.message}`, stack: error.stack ?? "" };
  if (typeof error === "string") return { message: error, stack: "" };
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return { message: (error as { message: string }).message, stack: "" };
  return { message: error === undefined || error === null ? "" : String(error), stack: "" };
}

/** Première ligne de la pile qui désigne du code (« at … », « fonction@fichier »). */
const firstFrame = (stack: string) => stack.split("\n").map((l) => l.trim()).find((l) => /^at |@/.test(l)) ?? "";

/** Empreinte d'une erreur : même message, même première ligne de pile — elle ne part qu'une fois par séance. */
export const errorSignature = (message: string, stack = ""): string => `${message}\n${firstFrame(stack)}`;

/** Chemin de l'écran, sans ses paramètres : une recherche ou un filtre n'ont pas à figurer dans une alerte. */
export function screenPath(href: string): string {
  try {
    return new URL(href, "http://x").pathname.slice(0, REPORT_LIMITS.path);
  } catch {
    return "/";
  }
}

/** Fichier de code d'entrée d'une page de l'écran construite (« index-ab12cd.js »), ou null. */
export function entryScript(html: string): string | null {
  const tag = /<script\b[^>]*\bsrc="\/assets\/([^"/]+\.js)"[^>]*>/i.exec(html);
  return tag && /type="module"/i.test(tag[0]) ? tag[1] : null;
}

const KIND_TEXT: Record<ClientErrorKind, string> = { rendu: "Écran en panne", script: "Erreur de script à l'écran", promesse: "Erreur de script à l'écran" };
const KIND_DETAIL: Record<ClientErrorKind, string> = {
  rendu: "le rendu d'un écran (le garde-fou d'affichage a pris le relais : « Cet écran n'a pas pu s'afficher »)",
  script: "un script que rien n'attrapait (l'écran a pu continuer)",
  promesse: "une opération en attente que rien n'attrapait (l'écran a pu continuer)",
};
const clip = (text: string | undefined, max: number) => (text ?? "").slice(0, max);

/**
 * L'alerte que le serveur garde d'une erreur remontée. Le message regroupe : même écran, même erreur = même alerte
 * (un compteur). Les détails disent ce qu'il faut pour chercher : qui, où, sur quelle construction, la pile.
 * `current` : le fichier d'entrée de la construction en service (null si le serveur ne le sait pas).
 */
export function alertOf(report: ClientErrorReport, context: { member: string; agent: string; current: string | null }): { message: string; details: string } {
  // Le chemin seul, même si l'appareil a envoyé l'adresse entière : une recherche ou un filtre n'entrent pas dans une alerte.
  const path = screenPath(report.path);
  const message = clip(report.message, REPORT_LIMITS.message);
  const build = clip(report.build, REPORT_LIMITS.build);
  const same = !build ? "inconnue" : !context.current ? build : build === context.current ? `${build} — celle en service` : `${build} — pas celle en service (${context.current}) : appareil resté sur une version d'avant`;
  const stack = clip(report.stack, REPORT_LIMITS.stack).trim();
  const component = clip(report.component, REPORT_LIMITS.component).trim();
  return {
    message: `${KIND_TEXT[report.kind]} (${path}) : ${message}`,
    details: [
      `Écran : ${path}`,
      `Membre : ${context.member}`,
      `Pendant : ${KIND_DETAIL[report.kind]}`,
      `Construction de l'écran : ${same}`,
      `Navigateur : ${clip(context.agent, 200) || "inconnu"}`,
      `Erreur : ${message}`,
      ...(stack ? ["Pile :", stack] : []),
      ...(component ? ["Composants :", component] : []),
    ].join("\n"),
  };
}
