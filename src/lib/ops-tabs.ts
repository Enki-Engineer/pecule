/*
 * « Opérations | Factures » : deux adresses, une seule section. Passer de l'une à l'autre ne change pas d'écran au
 * sens de la coquille (rien n'est démonté) : les deux listes restent montées et l'on n'affiche que celle de l'adresse.
 */

export type OpsTab = "operations" | "factures";
export const OPS_TABS: readonly OpsTab[] = ["operations", "factures"];
export const OPS_PATHS: Record<OpsTab, string> = { operations: "/operations", factures: "/factures" };

const clean = (path: string) => path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";

/** L'écran de la section qu'affiche cette adresse, ou null (autre écran). */
export function opsTab(path: string): OpsTab | null {
  const p = clean(path);
  return OPS_TABS.find((t) => OPS_PATHS[t] === p) ?? null;
}

/** Clé de l'écran d'une adresse : celle qui, en changeant, démonte l'écran affiché. La même pour toute la section. */
export const screenKey = (path: string): string => (opsTab(path) ? OPS_PATHS.operations : path);

export type TabMemory = { search: string; y: number };

/**
 * Hauteur de défilement à l'arrivée sur un écran de la section : celle qu'on y avait laissée s'il revient tel quel
 * (mêmes filtres dans l'adresse), le haut de la liste sinon (un lien qui filtre autrement montre une autre liste).
 */
export const scrollOnReturn = (left: TabMemory | undefined, search: string): number => (left && left.search === search ? left.y : 0);
