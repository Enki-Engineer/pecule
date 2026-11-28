/*
 * Catégories proposées à un foyer déjà installé : celles que le jeu de départ a reçues après lui (`added`) et qu'il
 * n'a pas. Rien ne s'écrit sans son geste : il les ajoute une à une (Réglages → Classement). Une catégorie ajoutée
 * arrive avec ses règles de départ ; la règle d'avant la suit si le foyer ne l'a pas reprise à son compte, et avec
 * elle les opérations que cette règle avait classées — jamais un classement fait à la main.
 *
 * Règles pures ; ce qui lit et écrit la base est dans `src/server/starter.ts`.
 */
import { STARTER_CATEGORIES, STARTER_PRIORITY, STARTER_RULES, STARTER_RULES_BEFORE, type StarterCategory } from "./starter.ts";

export type OwnCategory = { id: string; name: string; sort_order: number };
/** Ce que le foyer a déjà reçu du jeu de départ : code du jeu → code chez lui (le même, sauf s'il était pris). */
export type Received = Record<string, string>;
export type Rule = { pattern: string; category_id: string; priority: number };

/** Nom réduit à l'essentiel pour reconnaître une catégorie que le foyer a créée lui-même (« Carburant » = « Carburant (essence, gazole) »). */
const nameKey = (name: string) =>
  name
    .replace(/\(.*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .trim();

/**
 * Code, chez le foyer, d'une catégorie du jeu de départ ; null s'il ne l'a pas. Une catégorie d'origine se reconnaît
 * à son code. Une catégorie ajoutée après coup, à ce que le foyer a reçu (son code a pu être pris entre-temps par
 * une catégorie à lui — on ne s'y fie pas), sinon à son nom.
 */
export function ownCode(c: StarterCategory, own: OwnCategory[], received: Received): string | null {
  if (!c.added) return own.some((o) => o.id === c.id) ? c.id : null;
  const got = received[c.id];
  if (got && own.some((o) => o.id === got)) return got;
  return own.find((o) => nameKey(o.name) === nameKey(c.name))?.id ?? null;
}

/** Catégories à proposer, dans l'ordre du jeu de départ. */
export const proposals = (own: OwnCategory[], received: Received): StarterCategory[] => STARTER_CATEGORIES.filter((c) => c.added && ownCode(c, own, received) === null);

/**
 * Rang d'une catégorie ajoutée : juste après la catégorie du jeu de départ qui la précède et que le foyer tient de
 * lui — celles qui suivent se décalent d'un rang. Une catégorie reconnue à son seul nom n'y sert pas de repère : le
 * foyer l'a rangée où il voulait. À la fin du référentiel s'il n'en a aucune.
 */
export function insertRank(c: StarterCategory, own: OwnCategory[], received: Received): number {
  for (let i = STARTER_CATEGORIES.findIndex((x) => x.id === c.id) - 1; i >= 0; i--) {
    const s = STARTER_CATEGORIES[i];
    const code = s.added ? received[s.id] : s.id;
    const before = code === undefined ? undefined : own.find((o) => o.id === code);
    if (before) return before.sort_order + 1;
  }
  return Math.max(-1, ...own.map((o) => o.sort_order)) + 1;
}

/** Règle qui classe un libellé : la plus prioritaire, puis le motif le plus long (comme `guessCategory`, côté serveur). */
export function ruleFor(rules: Rule[], key: string): Rule | null {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!r.pattern || !key.includes(r.pattern)) continue;
    if (!best || r.priority < best.priority || (r.priority === best.priority && r.pattern.length > best.pattern.length)) best = r;
  }
  return best;
}

export type RulePlan = {
  /** Motifs de la catégorie que le foyer n'a pas. */
  add: string[];
  /** Motifs qu'il porte encore tels que le jeu de départ les avait posés (même priorité, cible d'avant) : ils la suivent. */
  move: string[];
  /** Règles de départ plus précises qu'une des siennes, pour une autre catégorie du foyer : motif → code chez lui. */
  guard: [pattern: string, code: string][];
};

/**
 * Ce que deviennent les règles de départ quand on ajoute une catégorie. Un motif que le foyer a repris — autre
 * cible, ou règle à lui — n'est pas touché. `guard` : une règle de départ dont le motif contient un des siens
 * (« nespresso » contient « esso ») arrive avec elle si le foyer ne l'a pas, sans quoi ses règles prendraient ce qui
 * ne lui revient pas ; `codeOf` donne le code, chez le foyer, de la catégorie qu'elle vise (null : il ne l'a pas).
 */
export function rulePlan(starterId: string, rules: Rule[], codeOf: (starterId: string) => string | null = (id) => id): RulePlan {
  const mine = STARTER_RULES.filter(([, id]) => id === starterId).map(([pattern]) => pattern);
  const have = new Map(rules.map((r) => [r.pattern, r]));
  const guard: RulePlan["guard"] = [];
  for (const [pattern, id] of STARTER_RULES) {
    if (id === starterId || have.has(pattern) || !mine.some((m) => pattern.includes(m))) continue;
    const code = codeOf(id);
    if (code !== null) guard.push([pattern, code]);
  }
  return {
    add: mine.filter((p) => !have.has(p)),
    move: mine.filter((p) => {
      const r = have.get(p);
      return !!r && r.priority === STARTER_PRIORITY && r.category_id === STARTER_RULES_BEFORE[p];
    }),
    guard,
  };
}

/** Les règles du foyer une fois le plan appliqué ; `code` : le code de la catégorie chez lui. */
export function plannedRules(rules: Rule[], plan: RulePlan, code: string): Rule[] {
  const moved = new Set(plan.move);
  return [
    ...rules.map((r) => (moved.has(r.pattern) ? { ...r, category_id: code } : r)),
    ...plan.add.map((pattern) => ({ pattern, category_id: code, priority: STARTER_PRIORITY })),
    ...plan.guard.map(([pattern, category_id]) => ({ pattern, category_id, priority: STARTER_PRIORITY })),
  ];
}

/** Opérations de même libellé et de même classement, comptées. */
export type KeyState = { label_key: string; category_id: string | null; category_source: string | null; n: number };

/**
 * Opérations qui suivent la catégorie ajoutée : celles que ses règles classeraient aujourd'hui chez elle, et qui
 * sont soit restées sans catégorie faute de règle, soit là où la règle d'avant les avait mises. Une opération
 * classée à la main, par une facture ou par un libellé déjà vu n'en fait jamais partie.
 */
export function followers(states: KeyState[], before: Rule[], after: Rule[], code: string): KeyState[] {
  return states.filter((s) => {
    if (ruleFor(after, s.label_key)?.category_id !== code) return false;
    const was = ruleFor(before, s.label_key);
    if (s.category_id === null) return was === null;
    return s.category_source === "regle" && was?.category_id === s.category_id;
  });
}
