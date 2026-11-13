import { region } from "./region.ts";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";
import { useSeason } from "./theme.ts";
import { equivalence, workTime, type FunData } from "../lib/fun.ts";

/**
 * Équivalences amusantes : un montant écrit dans l'unité du thème affiché (litres de bière, kilos de bonbons…)
 * et en temps de travail. Rien si le membre les a coupées (Réglages → Apparence) ; pas d'unité de thème quand
 * l'appareil n'affiche aucun thème.
 */
export function useFun() {
  const season = useSeason();
  const query = useQuery({ placeholderData: keepPreviousData, staleTime: 5 * 60_000, queryKey: ["fun", season], queryFn: () => api<FunData>(`/fun${season ? `?saison=${season}` : ""}`) });
  const data = query.data;
  const enabled = data?.enabled === true;
  // Les unités des thèmes ont un prix fixé en euros : elles ne valent que pour un foyer en euros.
  const priced = region().currency === "EUR";
  return {
    enabled,
    priced,
    loaded: data !== undefined,
    season,
    data,
    themed: (amount: number) => (enabled && priced && season ? equivalence(amount, season) : null),
    work: (amount: number) => (enabled ? workTime(amount, data?.hourly) : null),
  };
}

/** Réglage du membre (tous ses appareils). */
export function useSetFun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api("/fun", { method: "PUT", json: { enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fun"] }),
  });
}
