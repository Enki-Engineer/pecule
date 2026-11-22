/*
 * Visite guidée : le tour de l'appli, bulle après bulle, dans l'appli elle-même (src/client/components/Tour.tsx).
 * Elle se lance depuis le menu (« Visite guidée », sous l'assistant), éclaire tour à tour les vrais éléments de la
 * coquille — les familles du menu avec leur écran affiché derrière, puis les outils de la barre du haut — et ne
 * change rien : elle montre. Ici, ce qui est pur : les étapes selon la coquille que le membre a sous les yeux, et la
 * place de la bulle près de ce qu'elle montre. Aucun accès à la page.
 *
 * Une étape montre un repère de la coquille, marqué `data-tour="<repère>"` (Layout.tsx, MobileShell.tsx). Ajouter une
 * étape = son identifiant ici, à sa place dans `tourSteps`, son repère dans la coquille, son titre et son texte dans
 * Tour.tsx.
 */

/** Étapes de la visite : celles de l'ordinateur (menu latéral, barre du haut), celles du téléphone (onglets, boutons du haut). */
export type TourStepId =
  | "depart"
  | "tableau"
  | "quotidien"
  | "patrimoine"
  | "situation"
  | "documents"
  | "recherche"
  | "perimetre"
  | "discret"
  | "aide"
  | "assistant"
  | "onglet-accueil"
  | "onglet-operations"
  | "onglet-mois"
  | "onglet-patrimoine"
  | "onglet-assistant"
  | "outils"
  | "fin";

/** Côté du repère où se pose la bulle. */
export type TourSide = "droite" | "gauche" | "haut" | "bas";

export type TourStep = {
  id: TourStepId;
  /** Repère de la coquille que la bulle montre (`data-tour`) ; sans repère, la bulle est au centre. */
  target?: string;
  /** Écran affiché derrière la bulle : l'étape y mène. Sans adresse, on reste où l'on est. */
  to?: string;
  /** Côtés où poser la bulle, du préféré au dernier recours. */
  sides: readonly TourSide[];
};

/** Familles du menu latéral (src/client/nav.ts) : la visite en montre une par étape. */
export const TOUR_GROUPS = ["quotidien", "patrimoine", "situation", "documents"] as const;
export type TourGroup = (typeof TOUR_GROUPS)[number];

export type TourContext = {
  /** Coquille de l'ordinateur (menu latéral, barre du haut) ou du téléphone (onglets). */
  desktop: boolean;
  /** Familles du menu que ce foyer a gardées, avec leur premier écran (une famille vidée de ses écrans n'y est pas). */
  groups: Partial<Record<TourGroup, string>>;
  /** La bascule Foyer / Moi est proposée à ce membre (il a des comptes à lui, et d'autres). */
  scopeChoice: boolean;
};

const BESIDE: readonly TourSide[] = ["droite", "bas", "haut", "gauche"];
const BELOW: readonly TourSide[] = ["bas", "gauche", "droite", "haut"];
const ABOVE: readonly TourSide[] = ["haut", "bas"];

/**
 * Étapes de la visite, dans l'ordre. Ordinateur : le menu de haut en bas (chaque famille ouvre son premier écran),
 * puis la barre du haut de gauche à droite, et retour au menu pour finir sur l'entrée qui la relance. Téléphone :
 * les onglets (chacun ouvre son écran), l'assistant, puis les boutons du haut, pour finir sur « Tout Pécule ».
 */
export function tourSteps(ctx: TourContext): TourStep[] {
  if (!ctx.desktop)
    return [
      { id: "depart", to: "/", sides: [] },
      { id: "onglet-accueil", target: "onglet-accueil", to: "/", sides: ABOVE },
      { id: "onglet-operations", target: "onglet-operations", to: "/operations", sides: ABOVE },
      { id: "onglet-mois", target: "onglet-mois", to: "/mois", sides: ABOVE },
      { id: "onglet-patrimoine", target: "onglet-patrimoine", to: "/patrimoine", sides: ABOVE },
      { id: "onglet-assistant", target: "onglet-assistant", sides: ABOVE },
      // Les boutons du haut sont ceux d'un écran principal : on est resté sur le dernier onglet ouvert.
      { id: "outils", target: "outils", sides: BELOW },
      // Pour finir : « Tout Pécule », où sont les autres écrans — et l'entrée qui relance la visite.
      { id: "fin", target: "tout", sides: BELOW },
    ];
  const groups: TourStep[] = TOUR_GROUPS.flatMap((g) => (ctx.groups[g] ? [{ id: g, target: g, to: ctx.groups[g], sides: BESIDE }] : []));
  return [
    { id: "depart", to: "/", sides: [] },
    { id: "tableau", target: "accueil", to: "/", sides: BESIDE },
    ...groups,
    // La barre du haut se lit sur le tableau de bord : Foyer / Moi y agit.
    { id: "recherche", target: "recherche", to: "/", sides: BELOW },
    ...(ctx.scopeChoice ? [{ id: "perimetre" as const, target: "perimetre", sides: BELOW }] : []),
    { id: "discret", target: "discret", sides: BELOW },
    { id: "aide", target: "aide", sides: BELOW },
    { id: "assistant", target: "assistant", sides: BELOW },
    // Pour finir : le bas du menu, où sont le manuel, les réglages — et l'entrée qui relance la visite.
    { id: "fin", target: "pied", sides: BESIDE },
  ];
}

/* ---------- Place de la bulle ---------- */

export type TourBox = { x: number; y: number; width: number; height: number };
export type TourSize = { width: number; height: number };
export type TourPlacement = {
  /** Coin haut gauche de la bulle, dans la fenêtre. */
  x: number;
  y: number;
  /** Côté du repère où elle est posée ; null : au centre, sans pointe. */
  side: TourSide | null;
  /** Où mettre la pointe, le long du bord de la bulle qui regarde le repère (depuis son coin haut ou gauche). */
  arrow: number;
};

const SIDES: readonly TourSide[] = ["droite", "bas", "haut", "gauche"];
const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

/**
 * Pose la bulle près du repère : du premier côté préféré où elle tient en entier, à défaut de celui qui a le plus de
 * place ; elle se centre sur le repère autant que la fenêtre le permet, et sa pointe reste en face de lui. Sans
 * repère, elle est au centre de la fenêtre.
 */
export function placeBubble(target: TourBox | null, bubble: TourSize, view: TourSize, sides: readonly TourSide[], gap = 14, margin = 12): TourPlacement {
  if (!target) return { x: Math.round((view.width - bubble.width) / 2), y: Math.round((view.height - bubble.height) / 2), side: null, arrow: 0 };
  const room: Record<TourSide, number> = { droite: view.width - (target.x + target.width), gauche: target.x, bas: view.height - (target.y + target.height), haut: target.y };
  const slack = (s: TourSide) => room[s] - ((s === "droite" || s === "gauche" ? bubble.width : bubble.height) + gap + margin);
  const side = sides.find((s) => slack(s) >= 0) ?? [...SIDES].sort((a, b) => slack(b) - slack(a))[0];
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  // Pointe : en face du centre du repère, sans approcher les coins arrondis de la bulle.
  const corner = 22;
  if (side === "droite" || side === "gauche") {
    const x = side === "droite" ? target.x + target.width + gap : target.x - gap - bubble.width;
    const y = clamp(cy - bubble.height / 2, margin, view.height - bubble.height - margin);
    return { x: Math.round(clamp(x, margin, view.width - bubble.width - margin)), y: Math.round(y), side, arrow: Math.round(clamp(cy - y, corner, bubble.height - corner)) };
  }
  const y = side === "bas" ? target.y + target.height + gap : target.y - gap - bubble.height;
  const x = clamp(cx - bubble.width / 2, margin, view.width - bubble.width - margin);
  return { x: Math.round(x), y: Math.round(clamp(y, margin, view.height - bubble.height - margin)), side, arrow: Math.round(clamp(cx - x, corner, bubble.width - corner)) };
}

/** Zone éclairée autour d'un repère : le repère et une petite marge, sans sortir de la fenêtre. */
export function spotlight(target: TourBox, view: TourSize, pad = 6): TourBox {
  const x = Math.max(0, target.x - pad);
  const y = Math.max(0, target.y - pad);
  return { x, y, width: Math.min(view.width, target.x + target.width + pad) - x, height: Math.min(view.height, target.y + target.height + pad) - y };
}
