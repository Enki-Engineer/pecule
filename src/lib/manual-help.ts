/*
 * Aide de l'écran ouvert : à quelle page du manuel mène le « ? » de la barre du haut, et quel article l'assistant
 * lit quand on lui demande « comment marche cet écran ? ». Module à part, sans le texte du manuel : la coquille
 * de l'appli le charge au démarrage, le manuel seulement quand on l'ouvre. Un test vérifie que chaque écran a sa
 * page et que chaque page existe.
 */

/** Une règle : l'adresse commence par `path` et, s'il est donné, le paramètre d'adresse a cette valeur. */
type HelpRule = { path: string; param?: [name: string, value: string]; to: string };

/** Les plus précises d'abord ; `to` est l'identifiant d'un article ou d'un thème du manuel. */
export const HELP_RULES: readonly HelpRule[] = [
  { path: "/operations", param: ["a_classer", "1"], to: "classer-une-operation" },
  { path: "/operations", to: "liste-des-operations" },
  { path: "/tri", to: "tri-rapide" },
  { path: "/mois", param: ["onglet", "calendrier"], to: "calendrier-du-mois" },
  { path: "/mois", param: ["onglet", "frise"], to: "frise" },
  { path: "/mois", param: ["onglet", "comparer"], to: "comparer" },
  { path: "/mois", to: "analyse" },
  { path: "/comparer", to: "comparer" },
  { path: "/budget", to: "budget" },
  { path: "/soldes", to: "soldes-a-venir" },
  { path: "/factures", to: "factures" },
  { path: "/objectifs", to: "objectifs" },
  { path: "/patrimoine/crypto", to: "crypto" },
  { path: "/patrimoine", to: "patrimoine-vue-ensemble" },
  { path: "/immobilier", to: "immobilier" },
  { path: "/credits", to: "credits" },
  { path: "/projections", to: "projections" },
  { path: "/revenus", to: "revenus" },
  { path: "/impots", to: "impots" },
  { path: "/retraite", to: "retraite" },
  { path: "/documents", param: ["vue", "imports"], to: "import-massif" },
  { path: "/documents", to: "coffre" },
  { path: "/importer", to: "import-massif" },
  { path: "/echeancier", to: "echeancier" },
  { path: "/assistant", to: "assistant" },
  { path: "/reglages/compte", to: "securite" },
  { path: "/reglages/foyer", to: "foyer" },
  { path: "/reglages/demo", to: "mode-demo" },
  { path: "/reglages/connexions", param: ["c", "banque"], to: "relier-une-banque" },
  { path: "/reglages/connexions", param: ["c", "fichiers"], to: "importer-fichier-banque" },
  { path: "/reglages/connexions", param: ["c", "manuel"], to: "compte-a-la-main" },
  { path: "/reglages/connexions", param: ["c", "ia"], to: "brancher-ia" },
  { path: "/reglages/connexions", param: ["c", "coinstats"], to: "crypto" },
  { path: "/reglages/connexions", param: ["c", "coingecko"], to: "crypto" },
  { path: "/reglages/connexions", param: ["c", "applications"], to: "claude-mcp" },
  { path: "/reglages/connexions", param: ["c", "raccourci"], to: "raccourci-iphone" },
  { path: "/reglages/connexions", param: ["c", "calendrier"], to: "calendrier-abonnement" },
  { path: "/reglages/connexions", param: ["c", "jetons"], to: "acces-exterieurs" },
  { path: "/reglages/connexions", to: "comptes" },
  { path: "/reglages/classement", to: "regles-de-classement" },
  { path: "/reglages/apparence", to: "personnaliser" },
  { path: "/reglages/notifications", to: "notifications" },
  { path: "/reglages/assistant", to: "assistant" },
  { path: "/reglages/cout-ia", to: "assistant-cout" },
  { path: "/reglages/suivi", to: "suivi-technique" },
  { path: "/reglages", to: "personnaliser" },
  { path: "/", to: "tableau-de-bord" },
];

/** Anciennes adresses de groupes de réglages, encore valides (src/client/pages/Settings.tsx). */
const ALIASES: [string, string][] = [
  ["/reglages/appareil", "/reglages/notifications"],
  ["/reglages/comptes", "/reglages/connexions"],
];

const under = (path: string, base: string) => (base === "/" ? path === "/" : path === base || path.startsWith(`${base}/`));

/**
 * Page du manuel qui explique un écran : l'identifiant d'un article ou d'un thème, ou null (le manuel lui-même,
 * une adresse inconnue). `location` : le chemin, avec ses paramètres s'il en a (« /mois?onglet=frise »).
 */
export function helpFor(location: string): string | null {
  const url = new URL(location, "https://pecule.invalid");
  let path = url.pathname.replace(/\/+$/, "") || "/";
  for (const [old, now] of ALIASES) if (under(path, old)) path = now + path.slice(old.length);
  // Relecture d'un import : le lot ouvert dans le coffre.
  if (under(path, "/documents") && url.searchParams.has("lot")) return "relire-un-import";
  return HELP_RULES.find((r) => under(path, r.path) && (!r.param || url.searchParams.get(r.param[0]) === r.param[1]))?.to ?? null;
}

/** Adresse de l'aide d'un écran (le sommaire du manuel quand l'écran n'a pas sa page). */
export const helpPath = (location: string): string => {
  const to = helpFor(location);
  return to ? `/manuel/${to}` : "/manuel";
};
