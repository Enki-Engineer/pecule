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

/**
 * Un vrai poste, qui réunit plusieurs catégories : la liste des opérations sait se filtrer sur lui tout entier.
 * Un groupe sans poste (rangé sous son groupe ou sous son nom) ne le peut pas ; une seule catégorie, c'est déjà elle.
 */
export const wholePoste = <C extends { poste: string | null }>(g: PosteGroup<C>) => g.list.length > 1 && g.list.every((c) => c.poste === g.poste);

const plain = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Groupes réduits à ce que désigne une recherche, sans tenir compte des accents ni des majuscules. Un poste trouvé
 * par son nom garde toutes ses catégories ; sinon ne restent que les catégories trouvées. `shown` : le nom tel
 * qu'il est affiché (traduit) — on cherche dans le nom d'origine comme dans celui-là.
 */
export function searchGroups<C extends { name: string }>(groups: PosteGroup<C>[], query: string, shown: (name: string) => string = (x) => x): PosteGroup<C>[] {
  const f = plain(query.trim());
  if (!f) return groups;
  const has = (name: string) => plain(`${name} ${shown(name)}`).includes(f);
  return groups.map((g) => (has(g.poste) ? g : { poste: g.poste, list: g.list.filter((c) => has(c.name)) })).filter((g) => g.list.length > 0);
}
