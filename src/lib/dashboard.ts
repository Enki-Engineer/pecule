import { tk } from "./i18n.ts";

/*
 * Tableau de bord (ordinateur) : ce qu'un membre y a posé — ses chiffres clés et ses cartes, dans l'ordre, chacune
 * avec sa largeur — et les modèles dont il peut partir. Règles pures : l'écran (pages/Dashboard.tsx) dessine, le
 * serveur garde l'agencement du membre (src/server/dashboard.ts) après l'avoir nettoyé ici.
 */

/** Largeur d'une carte, en colonnes d'une grille de douze : un tiers, la moitié, deux tiers, toute la largeur. */
export const DASH_WIDTHS = [4, 6, 8, 12] as const;
export type DashWidth = (typeof DASH_WIDTHS)[number];
export const WIDTH_LABELS: Record<DashWidth, string> = { 4: tk("Un tiers"), 6: tk("La moitié"), 8: tk("Deux tiers"), 12: tk("Toute la largeur") };

/** Les cartes, dans l'ordre où le tiroir d'ajout les propose. `w` : largeur d'origine ; `min` : la plus étroite qui reste lisible. */
export const DASH_CARDS = [
  { id: "comptes", label: tk("Comptes"), hint: tk("Chaque compte avec son solde, ses cartes à débit différé et ses alertes de solde bas ; épargne, placements et crédits à la suite."), w: 4, min: 4 },
  { id: "atraiter", label: tk("À traiter"), hint: tk("Ce qui demande une action : opérations à classer, factures sans paiement, soldes bas, valeurs à mettre à jour."), w: 4, min: 4 },
  { id: "semaine", label: tk("Les sept prochains jours"), hint: tk("Ce qui est attendu sur tes comptes, jour par jour."), w: 12, min: 8 },
  { id: "operations", label: tk("Dernières opérations"), hint: tk("Les huit dernières opérations, tous comptes confondus."), w: 8, min: 4 },
  { id: "echeances", label: tk("Prochaines échéances"), hint: tk("Crédits, garanties, impôts et tâches des soixante prochains jours."), w: 4, min: 4 },
  { id: "natures", label: tk("Où part l'argent ce mois-ci"), hint: tk("Les dépenses du mois selon la façon de payer : achats par carte, prélèvements, virements, espèces."), w: 12, min: 6 },
  { id: "postes", label: tk("Dépenses du mois par poste"), hint: tk("Les six postes les plus lourds du mois."), w: 4, min: 4 },
  { id: "enveloppes", label: tk("Enveloppes du mois"), hint: tk("Où en sont tes enveloppes de budget."), w: 6, min: 4 },
  { id: "objectifs", label: tk("Objectifs d'épargne"), hint: tk("L'avancée de tes trois premiers objectifs."), w: 6, min: 4 },
  { id: "resume", label: tk("Résumé de la semaine"), hint: tk("Le point du lundi préparé par l'assistant."), w: 12, min: 4 },
  { id: "evolution", label: tk("Évolution du patrimoine net"), hint: tk("La courbe de ton patrimoine net, jour après jour."), w: 8, min: 4 },
  { id: "repartition", label: tk("Répartition du patrimoine"), hint: tk("Ce que pèsent l'immobilier, les placements, l'épargne et les comptes."), w: 4, min: 4 },
  { id: "amusant", label: tk("Le chiffre du moment"), hint: tk("Une dépense du mois dite autrement."), w: 12, min: 6 },
] as const satisfies readonly { id: string; label: string; hint: string; w: DashWidth; min: DashWidth }[];
export type DashCardId = (typeof DASH_CARDS)[number]["id"];

/** Les chiffres clés de la rangée du haut. */
export const DASH_KPIS = [
  { id: "patrimoine", label: tk("Patrimoine net") },
  { id: "disponible", label: tk("Disponible") },
  { id: "differe", label: tk("Cartes à débit différé") },
  { id: "depense", label: tk("Dépensé ce mois") },
  { id: "solde", label: tk("Solde du mois") },
  { id: "revenus", label: tk("Revenus du mois") },
  { id: "epargne", label: tk("Mis de côté ce mois") },
  { id: "dettes", label: tk("Dettes restantes") },
] as const satisfies readonly { id: string; label: string }[];
export type DashKpiId = (typeof DASH_KPIS)[number]["id"];

export type DashCard = { id: DashCardId; w: DashWidth };
/** Ce qui est affiché, dans l'ordre. Une carte ou un chiffre absent de la liste est rangé dans le tiroir d'ajout. */
export type DashLayout = { kpis: DashKpiId[]; cards: DashCard[] };

const CARD = new Map<string, (typeof DASH_CARDS)[number]>(DASH_CARDS.map((c) => [c.id, c]));
const KPI = new Set<string>(DASH_KPIS.map((k) => k.id));

/** Largeurs proposées pour une carte : de sa plus étroite à toute la largeur. */
export const widthsOf = (id: DashCardId): DashWidth[] => DASH_WIDTHS.filter((w) => w >= CARD.get(id)!.min);
export const cardOf = (id: DashCardId): DashCard => ({ id, w: CARD.get(id)!.w });

/**
 * Modèles : des points de départ. En appliquer un remplace l'agencement, qui se modifie ensuite librement.
 * Chacun répond à une question ; « Vue d'ensemble » est l'agencement d'origine de Pécule.
 */
export const DASH_TEMPLATES = [
  {
    id: "ensemble",
    label: tk("Vue d'ensemble"),
    hint: tk("Un peu de tout : l'agencement d'origine."),
    kpis: ["patrimoine", "disponible", "differe", "depense", "solde", "dettes"],
    cards: [["evolution", 8], ["atraiter", 4], ["semaine", 12], ["natures", 12], ["amusant", 12], ["resume", 12], ["enveloppes", 6], ["objectifs", 6], ["operations", 8], ["echeances", 4], ["postes", 4], ["repartition", 4], ["comptes", 4]],
  },
  {
    id: "quotidien",
    label: tk("Quotidien"),
    hint: tk("Combien j'ai, là, maintenant ? Les comptes comme à la banque, ce qui arrive cette semaine, les dernières opérations."),
    kpis: ["disponible", "differe", "depense", "solde"],
    cards: [["comptes", 8], ["atraiter", 4], ["semaine", 12], ["operations", 8], ["echeances", 4]],
  },
  {
    id: "budget",
    label: tk("Budget##modèle"),
    hint: tk("Est-ce que je tiens mon mois ? Où part l'argent, les enveloppes, les postes qui pèsent."),
    kpis: ["depense", "solde", "revenus", "epargne"],
    cards: [["natures", 12], ["enveloppes", 8], ["postes", 4], ["resume", 8], ["echeances", 4]],
  },
  {
    id: "patrimoine",
    label: tk("Patrimoine##modèle"),
    hint: tk("Où je vais ? La courbe du patrimoine, sa répartition, les crédits et les objectifs d'épargne."),
    kpis: ["patrimoine", "dettes", "disponible", "epargne"],
    cards: [["evolution", 8], ["repartition", 4], ["comptes", 8], ["atraiter", 4], ["objectifs", 6], ["echeances", 6]],
  },
] as const satisfies readonly { id: string; label: string; hint: string; kpis: readonly DashKpiId[]; cards: readonly (readonly [DashCardId, DashWidth])[] }[];
export type DashTemplateId = (typeof DASH_TEMPLATES)[number]["id"];
export const DASH_TEMPLATE_IDS = DASH_TEMPLATES.map((m) => m.id) as [DashTemplateId, ...DashTemplateId[]];

export function templateLayout(id: DashTemplateId): DashLayout {
  const m = DASH_TEMPLATES.find((x) => x.id === id)!;
  return { kpis: [...m.kpis], cards: m.cards.map(([cid, w]) => ({ id: cid, w })) };
}

/** Sans agencement enregistré : la vue d'ensemble. */
export const defaultLayout = (): DashLayout => templateLayout("ensemble");

/**
 * Agencement lu d'un enregistrement (serveur, navigateur) : ne garde que ce que cette version connaît, une fois
 * chacun, avec une largeur permise. `null` si ce n'est pas un agencement.
 */
export function cleanLayout(raw: unknown): DashLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const { kpis, cards } = raw as { kpis?: unknown; cards?: unknown };
  if (!Array.isArray(kpis) || !Array.isArray(cards)) return null;
  const out: DashLayout = { kpis: [], cards: [] };
  for (const k of kpis) if (typeof k === "string" && KPI.has(k) && !out.kpis.includes(k as DashKpiId)) out.kpis.push(k as DashKpiId);
  for (const c of cards) {
    const id = (c as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || !CARD.has(id) || out.cards.some((x) => x.id === id)) continue;
    const allowed = widthsOf(id as DashCardId);
    const w = Number((c as { w?: unknown }).w);
    // Une largeur devenue trop étroite pour la carte prend la plus petite permise ; une largeur inconnue, celle d'origine.
    out.cards.push({ id: id as DashCardId, w: allowed.includes(w as DashWidth) ? (w as DashWidth) : (DASH_WIDTHS as readonly number[]).includes(w) ? allowed[0] : CARD.get(id)!.w });
  }
  return out;
}

/**
 * L'ancien réglage, gardé par le navigateur (ordre des blocs et blocs masqués) : repris tel quel, largeurs
 * d'origine. Un bloc né depuis prend sa place d'origine, comme le faisait l'ancien écran.
 */
export function fromLegacy(raw: unknown): DashLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const { order, hidden } = raw as { order?: unknown; hidden?: unknown };
  if (!Array.isArray(order)) return null;
  const base = defaultLayout();
  const origin = base.cards.map((c) => c.id);
  const ids = order.filter((id): id is DashCardId => typeof id === "string" && CARD.has(id)).filter((id, i, all) => all.indexOf(id) === i);
  for (const id of origin) if (!ids.includes(id)) ids.splice(ids.indexOf(origin[origin.indexOf(id) - 1]) + 1, 0, id);
  const off = new Set(Array.isArray(hidden) ? hidden : []);
  return { kpis: base.kpis, cards: ids.filter((id) => !off.has(id)).map((id) => base.cards.find((c) => c.id === id) ?? cardOf(id)) };
}

export const sameLayout = (a: DashLayout, b: DashLayout): boolean =>
  a.kpis.length === b.kpis.length && a.cards.length === b.cards.length && a.kpis.every((k, i) => k === b.kpis[i]) && a.cards.every((c, i) => c.id === b.cards[i].id && c.w === b.cards[i].w);

/** Le modèle que l'agencement reproduit exactement, s'il y en a un (il est alors coché dans la liste des modèles). */
export const templateOf = (layout: DashLayout): DashTemplateId | null => DASH_TEMPLATES.find((m) => sameLayout(templateLayout(m.id), layout))?.id ?? null;

/** Déplace l'élément du rang `from` au rang `to` (les autres se décalent). */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, item);
  return out;
}

/** Cartes et chiffres absents de l'agencement : ce que le tiroir d'ajout propose. */
export const missingCards = (layout: DashLayout): DashCardId[] => DASH_CARDS.map((c) => c.id).filter((id) => !layout.cards.some((c) => c.id === id));
export const missingKpis = (layout: DashLayout): DashKpiId[] => DASH_KPIS.map((k) => k.id).filter((id) => !layout.kpis.includes(id));

/**
 * Rangées que forment les cartes, de gauche à droite, dans une grille de douze colonnes : sert à l'aperçu d'un
 * modèle. Une carte qui ne tient plus sur la rangée passe à la suivante.
 */
export function rowsOf(cards: readonly DashCard[]): DashCard[][] {
  const rows: DashCard[][] = [];
  let used = 12;
  for (const c of cards) {
    if (used + c.w > 12) {
      rows.push([]);
      used = 0;
    }
    rows.at(-1)!.push(c);
    used += c.w;
  }
  return rows;
}
