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

/** Nature d'un contrat (`TOPICS`, src/lib/contracts.ts) : les étiquettes du coffre. */
export const TOPIC_LABELS: Record<string, string> = labels({
  assurance_auto: tk("Assurance auto"),
  assurance_habitation: tk("Assurance habitation"),
  assurance_emprunteur: tk("Assurance emprunteur"),
  assurance_sante: tk("Mutuelle santé"),
  assurance_autre: tk("Autre assurance"),
  energie: tk("Électricité et gaz"),
  internet: tk("Box internet"),
  mobile: tk("Forfait mobile"),
  vehicule: tk("Location ou crédit auto"),
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
