/*
 * Périmètre Foyer / Moi : il ne change que les écrans qui comptent les opérations des comptes (accueil, opérations,
 * analyse, budget). Ailleurs (patrimoine, situation, documents, réglages), il n'a aucun effet : la barre le grise.
 */

const SCOPED = /^\/(operations|tri|mois|comparer|budget)(\/|$)/;

/** L'écran de cette adresse dépend-il du périmètre Foyer / Moi ? */
export function scopeApplies(path: string): boolean {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return clean === "/" || SCOPED.test(clean);
}
