/*
 * Définitions uniques des agrégats : tous les totaux (accueil, mois, tendance, assistant)
 * s'appuient sur ces fragments SQL, pour qu'un même chiffre ait partout la même valeur.
 * Alias attendus : t = tx_lines, a = comptes visibles, c = categories (LEFT JOIN).
 */

/** Opérations comptées : réglées ou en attente, sur un compte non exclu. */
export const STAT_SCOPE = "t.status IN ('posted', 'pending') AND a.excluded = 0";

/** Nature d'une ligne : celle de sa catégorie ; sans catégorie, un débit est une dépense et un crédit un revenu. */
export const LINE_KIND = "COALESCE(c.kind, IF(t.amount < 0, 'depense', 'revenu'))";

/** Ligne comptée en dépense (montant net : un remboursement classé en dépense vient en déduction). */
export const IS_EXPENSE = `${LINE_KIND} = 'depense'`;
