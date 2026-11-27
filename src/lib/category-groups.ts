/*
 * Catégories rangées par poste, dans l'ordre du référentiel, pour une liste de choix. Deux catégories peuvent porter
 * le même nom — un revenu et une dépense, par exemple — : rangée sous son poste, chacune se reconnaît.
 */

export type PosteGroup<C> = { poste: string; list: C[] };

export function groupByPoste<C extends { name: string; poste: string | null; group_name: string | null; sort_order: number }>(list: C[]): PosteGroup<C>[] {
  const out: PosteGroup<C>[] = [];
  for (const c of [...list].sort((a, b) => a.sort_order - b.sort_order)) {
    const poste = c.poste ?? c.group_name ?? c.name;
    const g = out.find((x) => x.poste === poste);
    if (g) g.list.push(c);
    else out.push({ poste, list: [c] });
  }
  return out;
}
