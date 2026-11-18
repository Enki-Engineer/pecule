/*
 * Périmètre Foyer / Moi. Deux familles d'écrans en dépendent :
 * - ceux qui comptent les opérations des comptes (accueil, opérations, analyse, budget) : « Moi » = mes comptes,
 *   sans le compte commun ;
 * - Revenus et Impôts : « Moi » = mes bulletins et les déclarations où je figure, « Foyer » = ceux de tous les
 *   membres qui partagent les leurs.
 * Ailleurs (patrimoine, retraite, documents, réglages), il n'a aucun effet : la barre le grise.
 */

export type ScopeKind = "comptes" | "situation";

const ACCOUNTS = /^\/(operations|tri|mois|comparer|budget)(\/|$)/;
const SITUATION = /^\/(revenus|impots)(\/|$)/;

/** Ce que le périmètre règle sur l'écran de cette adresse : les comptes lus, les membres comptés, ou rien (null). */
export function scopeKind(path: string): ScopeKind | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (clean === "/" || ACCOUNTS.test(clean)) return "comptes";
  return SITUATION.test(clean) ? "situation" : null;
}

/** L'écran de cette adresse dépend-il du périmètre Foyer / Moi ? */
export const scopeApplies = (path: string): boolean => scopeKind(path) !== null;
