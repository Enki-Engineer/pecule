import { SPEND_NATURES } from "../lib/nature.ts";

/** Couleur d'une nature (ordre fixe : la même couleur partout ; palette validée daltonisme). */
export const natureColor = (n: string) => `var(--series-${Math.max(0, SPEND_NATURES.indexOf(n as (typeof SPEND_NATURES)[number])) + 1})`;

/** Gris « Autres » : un poste qui n'a pas sa couleur. */
const OTHER = "#9aa5b4";
/** Couleur d'un rang (1 à 8) ; sans rang, le gris « Autres ». La même sur les anneaux de l'Analyse et dans la liste des opérations. */
export const colorOf = (slot: number | null) => (slot ? `var(--series-${slot})` : OTHER);
