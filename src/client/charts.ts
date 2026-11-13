import { SPEND_NATURES } from "../lib/nature.ts";

/** Couleur d'une nature (ordre fixe : la même couleur partout ; palette validée daltonisme). */
export const natureColor = (n: string) => `var(--series-${Math.max(0, SPEND_NATURES.indexOf(n as (typeof SPEND_NATURES)[number])) + 1})`;
