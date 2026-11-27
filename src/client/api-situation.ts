import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { currentScopeKey } from "./shell.ts";
import { t } from "../lib/i18n.ts";
import type { PayslipYear } from "../lib/payslips.ts";

/* Situation du foyer : types et requêtes des écrans. */

export type LoanLine = { id: string; name: string; rate: number | null; endDate: string; remaining: number; monthly: number | null; progress: number };
export type PropertyFigures = {
  value: number | null;
  valueDate: string | null;
  share: number;
  debt: number;
  equity: number | null;
  monthlyLoans: number;
  acquisitionTotal: number | null;
  grossYield: number | null;
  monthlyCashflow: number | null;
  loans: LoanLine[];
};
export type Property = {
  id: string;
  owner_user_id: number | null;
  name: string;
  kind: string;
  city: string | null;
  surface: number | null;
  rooms: number | null;
  acquisition_date: string | null;
  acquisition_price: number | null;
  acquisition_costs: number | null;
  rent_monthly: number | null;
  charges_monthly: number | null;
  deposit: number | null;
  lease_kind: string | null;
  lease_start: string | null;
  next_rent_revision: string | null;
  tax_regime: string | null;
  asset_id: number | null;
  figures: PropertyFigures;
};
export type Fact = { fact_key: string; label: string; value: string; unit: string | null; as_of: string | null };
export type DocLine = { id: number; title: string; kind: string; doc_date: string | null; expires_at?: string | null; file_mime?: string | null };
export type PropertyDetail = {
  property: Omit<Property, "figures">;
  figures: PropertyFigures;
  facts: Fact[];
  documents: DocLine[];
  taxes: { year: number; total: number | null; teom: number | null; notes: string | null }[];
  commitments: { id: number; label: string; type: string; status: string; monthly: number | null; annual: number | null }[];
  tasks: { id: number; kind: string; title: string; due_date: string | null; status: string }[];
};

export type Commitment = {
  id: number;
  owner_user_id: number | null;
  label: string;
  group_name: string | null;
  type: string;
  status: string;
  monthly: number | null;
  annual: number | null;
  monthly_equiv: number;
  category_id: string | null;
  match_pattern: string | null;
  label_regex: string | null;
  property_id: string | null;
  provider: string | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  notice_days: number | null;
  notes: string | null;
  last_seen: { date: string; amount: number } | null;
};
export type Budget = {
  commitments: Commitment[];
  income: { id: number; person: string; label: string; kind: string; monthly: number | null; annual_gross: number | null; notes: string | null }[];
  actualByPoste: { poste: string; monthly: number }[];
  totals: { fixedMonthly: number; incomeMonthly: number; remainingAfterFixed: number; actualMonthly: number; remainingAfterActual: number };
};

export type TaxReturn = {
  income_year: number;
  /** Déclarant : 0 pour la déclaration commune du foyer, sinon le membre. */
  owner_user_id: number;
  /** Membre déclarant (null : déclaration commune). */
  owner: { id: number; name: string } | null;
  /** Le membre peut dire si c'est la déclaration du foyer ou la sienne. */
  editable: boolean;
  notice_year: number | null;
  parts: number | null;
  situation: string | null;
  /** Salaires déclarés par chaque membre, dans l'ordre des membres. */
  salaries: { user_id: number; name: string; amount: number }[];
  other_income: number | null;
  taxable_income: number | null;
  rfr: number | null;
  net_tax: number | null;
  social_levies: number | null;
  total: number | null;
  decote: number | null;
  credits: number | null;
  balance: number | null;
  tmi: number | null;
  avg_rate: number | null;
  credits_detail: string | null;
  notes: string | null;
  document_id: number | null;
};
export type Taxes = {
  scope: "foyer" | "moi";
  /** Le foyer compte plusieurs membres : une déclaration peut être commune ou personnelle. */
  several: boolean;
  /** Le membre partage-t-il ses revenus avec le foyer ? */
  sharing: boolean;
  /** Vue du foyer : membres dont les déclarations personnelles ne sont pas comptées, faute de partage. */
  withheld: string[];
  returns: TaxReturn[];
  propertyTaxes: { year: number; property_id: string; property_name: string | null; base: number | null; contributions: number | null; teom: number | null; fees: number | null; total: number | null; notes: string | null; document_id: number | null }[];
  documents: DocLine[];
};

export type Retirement = {
  simulations: { id: number; simulated_on: string; label: string; age: number | null; quarters: number | null; base_pension: number | null; complementary: number | null; gross_monthly: number | null; net_monthly: number | null; adjustment: string | null; source: string; notes: string | null }[];
  career: { id: number; period: string; start_year: number | null; end_year: number | null; employer: string | null; income: number | null; quarters: number | null; points: number | null; notes: string | null }[];
  facts: Fact[];
  documents: DocLine[];
};

export type Projections = {
  rows: { scenario: string; horizon_year: number; poche: string; value: number | null; hypothesis: string | null; as_of: string | null }[];
  totals: Record<string, number>;
  documents: { id: number; title: string }[];
};

/** Un mouvement du journal crypto ; `type` : un genre de `EVENT_KINDS`, ou le texte gardé d'une reprise. */
export type CryptoEvent = {
  id: number;
  date: string;
  /** Dernier jour, quand le mouvement résume une période. */
  end_date?: string | null;
  title: string;
  asset: string | null;
  type: string | null;
  platform: string | null;
  quantity: number | null;
  value: number | null;
  /** Cours unitaire noté et frais, dans la devise du foyer. */
  price?: number | null;
  fee?: number | null;
  /** fait | attente */
  status?: string;
  note: string | null;
};

export const useProperties = () => useQuery({ queryKey: ["properties"], queryFn: () => api<{ properties: Property[] }>("/properties") });
export const useProperty = (id: string) => useQuery({ queryKey: ["property", id], queryFn: () => api<PropertyDetail>(`/properties/${encodeURIComponent(id)}`) });
export const useBudget = () => useQuery({ queryKey: ["budget"], queryFn: () => api<Budget>("/budget") });
// Revenus et impôts dépendent du périmètre Foyer / Moi : la clé le porte, et l'écran garde ses chiffres pendant la bascule.
export const useTaxes = () => useQuery({ placeholderData: keepPreviousData, queryKey: ["taxes", currentScopeKey()], queryFn: () => api<Taxes>("/taxes") });
export const useRetirement = () => useQuery({ queryKey: ["retirement"], queryFn: () => api<Retirement>("/retirement") });
export const useProjections = () => useQuery({ queryKey: ["projections"], queryFn: () => api<Projections>("/projections") });
export const useCryptoEvents = () => useQuery({ queryKey: ["crypto-events"], queryFn: () => api<{ events: CryptoEvent[] }>("/crypto/events") });

export const COMMITMENT_TYPES: Record<string, string> = { credit: t("Crédit"), assurance: t("Assurance"), abonnement: t("Contrat & abonnement"), taxe: t("Taxe & impôt"), garde: t("Garde & école"), budget: t("Budget courant") };
export const COMMITMENT_STATUS: Record<string, string> = { actif: t("Actif##engagement"), a_verifier: t("À vérifier"), a_completer: t("À compléter"), resilie: t("Résilié"), non_compte: t("Non compté") };
export const PROPERTY_KINDS: Record<string, string> = { residence_principale: t("Résidence principale"), locatif: t("Location##bien"), sci: "SCI" };

export type Payslip = { user_id: number; period: string; employer: string; gross: number | null; net_taxable: number | null; income_tax: number | null; net_paid: number | null; bonus: number | null; tax_rate: number | null; document_id: number | null; notes: string | null };
export type Payslips = {
  scope: "foyer" | "moi";
  /** Membres comptés qui ont au moins un bulletin, dans l'ordre des membres. */
  members: { id: number; name: string; me: boolean }[];
  /** Vue du foyer : membres dont les revenus ne sont pas comptés, faute de partage. */
  withheld: string[];
  several: boolean;
  sharing: boolean;
  payslips: Payslip[];
  years: PayslipYear[];
};
export const usePayslips = () => useQuery({ placeholderData: keepPreviousData, queryKey: ["payslips", currentScopeKey()], queryFn: () => api<Payslips>("/payslips") });

/** Partage de ses revenus avec le foyer (Réglages → Compte et sécurité). */
export const useSharing = () => useQuery({ queryKey: ["sharing"], queryFn: () => api<{ income: boolean; several: boolean }>("/sharing") });

/* ---------- Enveloppes et objectifs d'épargne ---------- */

export type Envelope = {
  id: number;
  private: boolean;
  scope: "poste" | "categorie";
  ref: string;
  label: string;
  poste: string | null;
  monthly: number;
  alertPct: number;
  spent: number;
  left: number;
  pct: number;
  projected: number | null;
  average: number;
  state: "ok" | "alerte" | "depasse";
};
export type EnvelopeCandidates = { postes: { ref: string; label: string; average: number }[]; categories: { ref: string; label: string; poste: string | null; average: number }[] };
export const useEnvelopes = () => useQuery({ placeholderData: keepPreviousData, queryKey: ["envelopes", currentScopeKey()], queryFn: () => api<{ envelopes: Envelope[]; candidates: EnvelopeCandidates }>("/envelopes") });

export type Goal = {
  id: number;
  private: boolean;
  name: string;
  emoji: string | null;
  target: number;
  targetDate: string | null;
  assetId: number | null;
  assetName: string | null;
  current: number;
  currentManual: number | null;
  pct: number;
  remaining: number;
  monthsLeft: number | null;
  monthlyNeeded: number | null;
  notes: string | null;
  status: string;
};
export const useGoals = () => useQuery({ queryKey: ["goals"], queryFn: () => api<{ goals: Goal[] }>("/goals") });
