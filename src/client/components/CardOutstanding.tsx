import { useQuery } from "@tanstack/react-query";
import { api, useDemo } from "../api.ts";

/** `debitAccountId` : le compte qui sera prélevé, quand un relevé passé de la carte le désigne. */
type CardRow = { accountId: string; name: string; tail: string | null; debitAccountId?: string | null; outstanding: { amount: number; debitDate: string | null; count: number } };

/** Encours des cartes à débit différé (lu par la connexion bancaire) : ce qui sera prélevé à la prochaine échéance. */
export const useCardOutstanding = () => {
  const demo = useDemo();
  return useQuery({ queryKey: ["bank", "cards"], queryFn: () => api<{ cards: CardRow[] }>("/bank/cards"), enabled: !demo, staleTime: 10 * 60_000 });
};

/** Total de l'encours, toutes cartes confondues : ce qui sortira des comptes à la prochaine échéance (négatif), et quand. */
export function useOutstandingTotal(): { total: number; debitDate: string | null; count: number } | null {
  const cards = useCardOutstanding().data?.cards ?? [];
  if (!cards.length) return null;
  const dates = cards.map((c) => c.outstanding.debitDate).filter((d): d is string => !!d).sort();
  return { total: Math.round(cards.reduce((s, c) => s + c.outstanding.amount, 0) * 100) / 100, debitDate: dates[0] ?? null, count: cards.reduce((s, c) => s + c.outstanding.count, 0) };
}
