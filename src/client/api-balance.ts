import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import type { BalancePoint, BalanceRule, LowPoint, Movement } from "../lib/balance.ts";

/* Solde bas : la règle du membre et la prévision de ses comptes (src/server/balance.ts). */

export type AccountForecast = { id: string; name: string; kind: string; balance: number; watched: boolean; threshold: number; low: LowPoint | null; min: BalancePoint | null; points: BalancePoint[]; movements: Movement[] };
export type BalanceAlert = { rule: BalanceRule; today: string; horizon: number; accounts: AccountForecast[] };
export type BalanceRulePatch = Partial<Omit<BalanceRule, "accounts">> & { accounts?: Record<string, { watch?: boolean; threshold?: number | null }> };

const KEY = ["balance-alert"];

export const useBalanceAlert = () => useQuery({ queryKey: KEY, queryFn: () => api<BalanceAlert>("/balance-alert"), staleTime: 5 * 60_000 });

export function useSaveBalanceRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BalanceRulePatch) => api<BalanceAlert>("/balance-alert", { method: "PUT", json: patch }),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
    },
  });
}

/** Comptes surveillés qui passeraient sous leur seuil dans le délai de prévenance (ou qui y sont déjà). */
export const lowAccounts = (data: BalanceAlert | undefined): (AccountForecast & { low: LowPoint })[] => (data?.accounts ?? []).filter((a): a is AccountForecast & { low: LowPoint } => a.watched && !!a.low);
