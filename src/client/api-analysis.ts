import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { currentScopeKey } from "./shell.ts";
import type { TimelinePoint } from "../lib/timeline.ts";

/* Analyse : flux d'une période (un mois ou une année), natures mois par mois, frise, prélèvements, marchands, prévision. */

export type Flows = {
  month: string;
  incomes: { id: string | null; name: string; total: number }[];
  flows: { nature: string; poste: string; total: number; count: number }[];
  totals: { income: number; grossSpend: number; refunds: number; netSpend: number; savings: number; balance: number };
};
export type NatureMonth = { month: string } & Record<string, number | string>;
export type MonthDebits = {
  month: string;
  debits: { id: string; date: string; day: number; amount: number; name: string; category: string | null; poste: string | null }[];
  expected: { name: string; day: number; amount: number; category: string | null; late: boolean }[];
  missed: { name: string; day: number; amount: number; category: string | null }[];
};
/** Prélèvements d'une année : une ligne par créancier, un montant par mois. */
export type YearDebits = { year: string; series: { name: string; category: string | null; byMonth: number[]; count: number; total: number }[]; totals: number[] };
export type Merchant = { name: string; total: number; count: number; previous: number; poste: string | null };

// Le périmètre (Foyer / Moi) fait partie de la clé : chaque vue garde ses propres chiffres.
export const useFlows = (period: string) => useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "flows", period, currentScopeKey()], queryFn: () => api<Flows>(`/analysis/flows?period=${period}`) });
export const useNatureTrend = (from: string, to: string) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "natures", from, to, currentScopeKey()], queryFn: () => api<{ months: NatureMonth[] }>(`/analysis/natures?from=${from}&to=${to}`) });
export const useMonthDebits = (month: string, enabled = true) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "debits", month, currentScopeKey()], queryFn: () => api<MonthDebits>(`/analysis/debits?period=${month}`), enabled });
export const useYearDebits = (year: string, enabled = true) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "debits", year, currentScopeKey()], queryFn: () => api<YearDebits>(`/analysis/debits?period=${year}`), enabled });
export const useMerchants = (period: string) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "merchants", period, currentScopeKey()], queryFn: () => api<{ merchants: Merchant[] }>(`/analysis/merchants?period=${period}`) });

/** Ce qui est attendu d'après les récurrences : `slot` = le jour (frise d'un mois) ou le mois (frise d'une année) ; montant signé. */
export type Expected = { name: string; slot: number; amount: number; category: string | null; nature: string; kind: "depense" | "revenu"; late: boolean };
export type Timeline = { period: string; unit: "jour" | "mois"; today: number | null; points: TimelinePoint[]; upcoming: Expected[]; overdue: Expected[] };
export const useTimeline = (period: string) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "timeline", period, currentScopeKey()], queryFn: () => api<Timeline>(`/analysis/timeline?period=${period}`) });

/** Prévision : le mois en cours et les trois suivants — ce qui est déjà écrit, et ce qui est attendu d'après les récurrences. */
export type ForecastMonth = {
  month: string;
  known: { revenus: number; depenses: number };
  expected: { revenus: number; depenses: number };
  items: { day: number; name: string; amount: number; category: string | null }[];
  count: number;
};
export const useForecast = (enabled = true) =>
  useQuery({ queryKey: ["analysis", "forecast", currentScopeKey()], queryFn: () => api<{ current: string; months: ForecastMonth[] }>("/analysis/forecast"), enabled, staleTime: 5 * 60_000 });

export type Comparison = {
  label: string;
  a: { from: string; to: string; depenses: number; revenus: number; epargne: number };
  b: { from: string; to: string; depenses: number; revenus: number; epargne: number };
  postes: { poste: string; a: number; b: number; diff: number; pct: number | null }[];
};
export const useCompare = (p: { from: string; to: string; base: string; bfrom?: string; bto?: string }) => {
  const sp = new URLSearchParams({ from: p.from, to: p.to, base: p.base });
  if (p.base === "custom" && p.bfrom && p.bto) sp.set("bfrom", p.bfrom), sp.set("bto", p.bto);
  return useQuery({ placeholderData: keepPreviousData, queryKey: ["compare", sp.toString(), currentScopeKey()], queryFn: () => api<Comparison>(`/analysis/compare?${sp}`), enabled: p.base !== "custom" || !!(p.bfrom && p.bto) });
};
