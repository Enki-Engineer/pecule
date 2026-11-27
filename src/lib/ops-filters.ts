/*
 * Barre des filtres de l'écran Opérations sur téléphone : l'ordre de ses pastilles et la grille du choix du mois.
 */

/** Les filtres de la barre, dans l'ordre où ils sont proposés ; chacun porte le nom de son paramètre dans l'adresse. */
export const FILTER_KEYS = ["a_classer", "categorie", "compte", "nature", "mois"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** Pastilles dans l'ordre de la rangée : celles qui filtrent d'abord (on les voit sans faire défiler), les autres ensuite. */
export function pillOrder(active: Record<FilterKey, boolean>): FilterKey[] {
  return [...FILTER_KEYS.filter((k) => active[k]), ...FILTER_KEYS.filter((k) => !active[k])];
}

/**
 * Années que le choix du mois laisse parcourir : de la plus ancienne qui a des opérations à l'année en cours.
 * L'année du filtre en fait toujours partie, même sans opération (arrivée par un lien).
 */
export function yearBounds(months: string[], current: string, selected?: string): { min: number; max: number } {
  const years = [...months, current, ...(selected ? [selected] : [])].map((m) => Number(m.slice(0, 4)));
  return { min: Math.min(...years), max: Math.max(...years) };
}

export type GridMonth = {
  month: string;
  /** Nombre d'opérations du mois ; null tant qu'il n'est pas connu. */
  count: number | null;
  /** Rien à y voir : un mois à venir, ou un mois sans opération. */
  empty: boolean;
};

/** Les douze mois d'une année. `counts` : opérations par mois (« AAAA-MM »), null tant que le serveur n'a pas répondu. */
export function yearGrid(year: number, counts: Map<string, number> | null, current: string): GridMonth[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = `${year}-${String(i + 1).padStart(2, "0")}`;
    const count = counts ? (counts.get(month) ?? 0) : null;
    return { month, count, empty: month > current || count === 0 };
  });
}
