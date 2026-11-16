import { useQuery } from "@tanstack/react-query";
import { CreditCard } from "lucide-react";
import { api, useDemo } from "../api.ts";
import { Card } from "./ui.tsx";
import { dateFr, money } from "../format.ts";
import { t, tn } from "../../lib/i18n.ts";

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

function Rows({ cards }: { cards: CardRow[] }) {
  return (
    <>
      {cards.map((c) => (
        <div key={c.accountId} className="flex items-center gap-2 py-1.5 text-sm">
          <CreditCard size={15} className="shrink-0 text-muted" />
          <div className="min-w-0 grow">
            <div className="truncate">{c.name}</div>
            <div className="text-xs text-muted">
              {tn("{n} achat", "{n} achats", c.outstanding.count, { n: c.outstanding.count })}
              {c.outstanding.debitDate ? ` · ${t("prélevé le {date}", { date: dateFr(c.outstanding.debitDate) })}` : ""}
            </div>
          </div>
          <span className="tnum shrink-0 font-medium">{money(c.outstanding.amount)}</span>
        </div>
      ))}
    </>
  );
}

/** Tableau de bord : bloc à la suite des comptes (rien si aucune carte n'est lue). */
export function CardOutstandingBlock() {
  const cards = useCardOutstanding().data?.cards ?? [];
  if (!cards.length) return null;
  return (
    <div className="border-t border-line px-5 py-2">
      <div className="text-[12.5px] font-medium text-muted">{t("Encours des cartes à débit différé")}</div>
      <Rows cards={cards} />
    </div>
  );
}

/** Accueil : section à la suite des comptes (rien si aucune carte n'est lue). */
export function CardOutstandingSection() {
  const cards = useCardOutstanding().data?.cards ?? [];
  if (!cards.length) return null;
  return (
    <section>
      <h2 className="mb-2 px-1 text-[15px] font-semibold text-ink">{t("Encours des cartes à débit différé")}</h2>
      <Card className="px-4 py-1.5">
        <Rows cards={cards} />
      </Card>
    </section>
  );
}
