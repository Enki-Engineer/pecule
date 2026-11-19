import { tk } from "./i18n.ts";
import type { CardLayout } from "./card-layout.ts";

/*
 * Accueil du téléphone : ses blocs et les modèles dont on peut partir — les mêmes quatre questions que le tableau
 * de bord de l'ordinateur (src/lib/dashboard.ts), en une seule colonne. L'agencement est gardé par l'appareil
 * (src/lib/card-layout.ts) ; l'écran est pages/Home.tsx.
 */

/** Les blocs, dans leur ordre d'origine. */
export const HOME_CARDS = [
  { id: "disponible", label: tk("Disponible sur les comptes") },
  { id: "depense", label: tk("Dépensé ce mois-ci") },
  { id: "semaine", label: tk("Les sept prochains jours") },
  { id: "aclasser", label: tk("Opérations à classer") },
  { id: "amusant", label: tk("Le chiffre du moment") },
  { id: "resume", label: tk("Résumé de la semaine") },
  { id: "enveloppes", label: tk("Enveloppes du mois") },
  { id: "objectifs", label: tk("Objectifs d'épargne") },
  { id: "echeances", label: tk("Prochaines échéances") },
  { id: "comptes", label: tk("Comptes") },
  { id: "patrimoine", label: tk("Patrimoine net") },
  { id: "apercu", label: tk("Comptes en bref") },
] as const satisfies readonly { id: string; label: string }[];
export type HomeCardId = (typeof HOME_CARDS)[number]["id"];
export const HOME_IDS = HOME_CARDS.map((c) => c.id);

/**
 * Modèles de l'accueil : les blocs affichés, de haut en bas ; les autres attendent dans « Ajouter ».
 * « Vue d'ensemble » est l'accueil d'origine de Pécule.
 */
export const HOME_TEMPLATES = [
  {
    id: "ensemble",
    label: tk("Vue d'ensemble"),
    hint: tk("Un peu de tout : l'accueil d'origine."),
    cards: ["disponible", "depense", "semaine", "aclasser", "amusant", "resume", "enveloppes", "objectifs", "echeances", "comptes"],
  },
  {
    id: "essentiel",
    label: tk("Essentiel"),
    hint: tk("Le moins possible à lire : ce qui est disponible, les comptes en bref, ce qui est dépensé et ce qui demande ton attention."),
    cards: ["disponible", "apercu", "depense", "aclasser"],
  },
  {
    id: "quotidien",
    label: tk("Quotidien"),
    hint: tk("Combien j'ai, là, maintenant ? Les comptes comme à la banque, avec leurs cartes, puis ce qui est disponible, dépensé et attendu."),
    cards: ["comptes", "disponible", "depense", "aclasser", "semaine", "echeances"],
  },
  {
    id: "budget",
    label: tk("Budget##modèle"),
    hint: tk("Est-ce que je tiens mon mois ? Ce qui est dépensé, les enveloppes, le résumé de la semaine."),
    cards: ["depense", "enveloppes", "aclasser", "resume", "semaine", "echeances"],
  },
  {
    id: "patrimoine",
    label: tk("Patrimoine##modèle"),
    hint: tk("Où je vais ? Le patrimoine net, les comptes et les crédits, les objectifs d'épargne."),
    cards: ["patrimoine", "comptes", "objectifs", "echeances"],
  },
] as const satisfies readonly { id: string; label: string; hint: string; cards: readonly HomeCardId[] }[];
export type HomeTemplateId = (typeof HOME_TEMPLATES)[number]["id"];

/** L'agencement que pose un modèle : ses blocs dans l'ordre, puis les autres, retirés, dans leur ordre d'origine. */
export function homeTemplate(id: HomeTemplateId): CardLayout<HomeCardId> {
  const shown: readonly HomeCardId[] = HOME_TEMPLATES.find((m) => m.id === id)!.cards;
  const hidden = HOME_IDS.filter((c) => !shown.includes(c));
  return { order: [...shown, ...hidden], hidden };
}

/** Sans réglage sur l'appareil : la vue d'ensemble. */
export const homeDefault = (): CardLayout<HomeCardId> => homeTemplate("ensemble");

/** Blocs nés après l'accueil d'origine : un appareil qui a déjà son réglage les reçoit retirés, à ajouter si on veut. */
export const HOME_QUIET: readonly HomeCardId[] = homeDefault().hidden;

/** Le modèle que l'agencement reproduit — mêmes blocs affichés, dans le même ordre —, s'il y en a un. */
export function homeTemplateOf(layout: CardLayout<HomeCardId>): HomeTemplateId | null {
  const shown = layout.order.filter((id) => !layout.hidden.includes(id)).join("|");
  return HOME_TEMPLATES.find((m) => m.cards.join("|") === shown)?.id ?? null;
}
