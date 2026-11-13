/* Libellés du coffre de documents et de l'échéancier (écrans et assistant). */

import { labels, tk } from "./i18n.ts";

export const KIND_LABELS: Record<string, string> = labels({
  avis_impot: tk("Avis d'impôt"),
  taxe_fonciere: tk("Taxe foncière"),
  contrat: tk("Contrat"),
  bail: tk("Bail"),
  acte: tk("Acte"),
  pret: tk("Prêt"),
  assurance: tk("Assurance"),
  releve: tk("Relevé"),
  diagnostic: tk("Diagnostic"),
  fiscal: tk("Fiscal"),
  statuts: tk("Statuts"),
  devis: tk("Devis"),
  facture: tk("Facture"),
  prospectus: tk("Prospectus"),
  bulletin: tk("Bulletin"),
  export: tk("Export"),
  fiche: tk("Fiche"),
  note: tk("Note"),
  autre: tk("Autre"),
});

export const DOMAIN_LABELS: Record<string, string> = labels({
  banque: tk("Banque"),
  immobilier: tk("Immobilier"),
  patrimoine: tk("Patrimoine"),
  crypto: tk("Crypto"),
  impots: tk("Impôts"),
  retraite: tk("Retraite"),
  revenus: tk("Revenus"),
  budget: tk("Budget"),
  autre: tk("Autre"),
});

export const RECURRENCE_LABELS: Record<string, string> = labels({ mensuel: tk("chaque mois"), trimestriel: tk("chaque trimestre"), annuel: tk("chaque année") });
