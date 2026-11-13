import type { WealthCategory } from "./api.ts";
import { t } from "../lib/i18n.ts";

/**
 * Poches du patrimoine : libellé et couleur fixes (palette des graphiques, validée daltonisme,
 * ordre fixe : une poche garde sa couleur partout, quel que soit le filtre).
 */
export const CATEGORY: Record<WealthCategory, { label: string; color: string }> = {
  immobilier: { label: t("Immobilier"), color: "var(--series-1)" },
  crypto: { label: t("Crypto"), color: "var(--series-2)" },
  placement: { label: t("Placements"), color: "var(--series-3)" },
  epargne: { label: t("Épargne"), color: "var(--series-4)" },
  comptes: { label: t("Comptes"), color: "var(--series-5)" },
  autre: { label: t("Autres"), color: "#9aa5b4" },
};

/** Ordre d'empilement et de lecture (du plus stable au plus liquide). */
export const ORDER: WealthCategory[] = ["immobilier", "crypto", "placement", "epargne", "comptes", "autre"];
