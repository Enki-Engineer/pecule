import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";
import { currentScopeKey } from "./shell.ts";
import type { TimelinePoint } from "../lib/timeline.ts";

/* Analyse (phase 15, lot B) : flux du mois, natures sur 12 mois, prélèvements, marchands. */

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
export type Merchant = { name: string; total: number; count: number; previous: number; poste: string | null };

// Le périmètre (Foyer / Moi) fait partie de la clé : chaque vue garde ses propres chiffres.
export const useFlows = (month: string) => useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "flows", month, currentScopeKey()], queryFn: () => api<Flows>(`/analysis/flows?month=${month}`) });
export const useNatureTrend = () => useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "natures", currentScopeKey()], queryFn: () => api<{ months: NatureMonth[] }>("/analysis/natures") });
export const useMonthDebits = (month: string) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "debits", month, currentScopeKey()], queryFn: () => api<MonthDebits>(`/analysis/debits?month=${month}`) });
export const useMerchants = (month: string) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "merchants", month, currentScopeKey()], queryFn: () => api<{ merchants: Merchant[] }>(`/analysis/merchants?month=${month}`) });

export type Expected = { name: string; day: number; amount: number; category: string | null };
export type Timeline = { month: string; today: number | null; points: TimelinePoint[]; upcoming: Expected[]; overdue: Expected[] };
export const useTimeline = (month: string) =>
  useQuery({ placeholderData: keepPreviousData, queryKey: ["analysis", "timeline", month, currentScopeKey()], queryFn: () => api<Timeline>(`/analysis/timeline?month=${month}`) });

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
