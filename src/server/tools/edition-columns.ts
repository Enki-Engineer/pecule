/*
 * Colonnes que les outils d'édition écrivent, table par table. Rangées à part du code qui les écrit pour qu'un
 * test les compare au schéma : un champ accepté par un outil sans colonne pour le recevoir échouait à l'écriture.
 */
export const EDITED_COLUMNS = {
  properties: ["rent_monthly", "charges_monthly", "deposit", "lease_kind", "lease_start", "next_rent_revision", "tax_regime"],
  income_sources: ["label", "monthly", "annual_gross", "valid_from", "valid_to", "notes"],
  categories: ["name", "poste", "kind", "description"],
} as const;
