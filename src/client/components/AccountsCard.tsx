import { useMemo } from "react";
import { Link } from "react-router";
import { Bitcoin, CreditCard, Landmark, LineChart, TrendingDown } from "lucide-react";
import { useAccounts, useWealth } from "../api.ts";
import { lowAccounts, useBalanceAlert, type AccountForecast } from "../api-balance.ts";
import { useCardOutstanding } from "./CardOutstanding.tsx";
import { BankBadge, Card, Spinner } from "./ui.tsx";
import { cn } from "../cn.ts";
import { isDiscreet } from "../discret.ts";
import { dateLong, dateShort, money, moneyIn } from "../format.ts";
import { accountGroups, type AccountLine, type GroupId } from "../../lib/account-groups.ts";
import { ownerLabel } from "../../lib/labels.ts";
import type { LowPoint } from "../../lib/balance.ts";
import { t, tn } from "../../lib/i18n.ts";

/*
 * Carte « Comptes » du tableau de bord, rangée comme l'appli d'une banque (src/lib/account-groups.ts) : chaque
 * compte avec son solde, sous lui ses cartes à débit différé (ce qui sera prélevé, et quand) et, quand la prévision
 * le signale, son alerte de solde bas ; puis l'épargne, les placements et les crédits, un sous-total par groupe.
 * La carte s'étale sur deux ou trois colonnes quand on lui donne de la largeur. Sur téléphone (`sections`), chaque
 * groupe a son titre, son total et sa carte, l'un sous l'autre.
 */

type Low = AccountForecast & { low: LowPoint };

const GROUP_LABELS = (): Record<GroupId, string> => ({ courants: t("Comptes courants"), epargne: t("Épargne"), placements: t("Placements"), credits: t("Crédits"), hors: t("Hors statistiques") });
const ICONS = { carte: CreditCard, actif: LineChart, crypto: Bitcoin, credit: Landmark } as const;

const target = (l: AccountLine) => (l.accountId ? `/operations?compte=${encodeURIComponent(l.accountId)}` : l.kind === "crypto" ? "/patrimoine/crypto" : "/patrimoine");
const lowText = (a: Low) => (a.balance < a.threshold ? t("Sous son seuil de {montant}", { montant: money(a.threshold, true) }) : t("Passerait à {montant} le {date}", { montant: money(a.low.balance, true), date: dateLong(a.low.date) }));

export function AccountsCard({ className, sections = false }: { className?: string; /** Accueil du téléphone : un titre, un total et une carte par groupe. */ sections?: boolean }) {
  const accounts = useAccounts();
  const wealth = useWealth();
  const cards = useCardOutstanding();
  const balance = useBalanceAlert();
  const w = wealth.data;
  const groups = useMemo(
    () => accountGroups({ accounts: accounts.data?.accounts ?? [], cards: cards.data?.cards, assets: w?.assets, cryptoTotal: w?.crypto.total, cryptoLabel: t("Crypto"), loans: w?.loans }),
    [accounts.data, cards.data, w],
  );
  const low = useMemo(() => new Map(lowAccounts(balance.data).map((a) => [a.id, a])), [balance.data]);
  // Le titulaire n'est écrit que s'il distingue quelque chose : un foyer d'une personne ne lit pas son prénom partout.
  const owners = new Set(groups.flatMap((g) => g.lines.map((l) => l.owner).filter(Boolean)));
  const labels = GROUP_LABELS();

  if (sections)
    return (
      <>
        {groups.map((g) => (
          <section key={g.id}>
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 className="text-[15px] font-semibold text-ink">{labels[g.id]}</h2>
              <span className={cn("tnum text-[15px] font-semibold", g.id === "hors" && "font-medium text-muted")}>{money(g.total)}</span>
            </div>
            <Card className="divide-y divide-line px-4">
              {g.lines.map((l) => (
                <Line key={l.key} line={l} low={l.accountId ? low.get(l.accountId) : undefined} showOwner={owners.size > 1} muted={g.id === "hors"} large />
              ))}
            </Card>
          </section>
        ))}
      </>
    );

  return (
    <Card className={cn("@container", className)}>
      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <h2 className="font-semibold">{t("Comptes")}</h2>
        <Link to="/soldes" viewTransition className="text-sm text-accent">
          {t("Soldes à venir")}
        </Link>
      </div>
      {!accounts.data ? (
        <Spinner />
      ) : !groups.length ? (
        <div className="px-5 pb-4 text-sm text-muted">{t("Aucun compte pour l'instant.")}</div>
      ) : (
        <div className="gap-x-8 px-5 pb-3 @2xl:columns-2 @5xl:columns-3">
          {groups.map((g) => (
            <section key={g.id} className="break-inside-avoid pb-3 pt-2">
              <div className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
                <h3 className="text-[13px] font-medium text-muted">{labels[g.id]}</h3>
                <span className={cn("tnum text-sm font-semibold", g.id === "hors" && "font-medium text-muted")}>{money(g.total)}</span>
              </div>
              {g.lines.map((l) => (
                <Line key={l.key} line={l} low={l.accountId ? low.get(l.accountId) : undefined} showOwner={owners.size > 1} muted={g.id === "hors"} />
              ))}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function Line({ line: l, low, showOwner, muted, large = false }: { line: AccountLine; low?: Low; showOwner: boolean; muted: boolean; /** Téléphone : lignes plus hautes, texte plus grand. */ large?: boolean }) {
  const Icon = l.kind === "compte" ? null : ICONS[l.kind];
  const sub = [l.institution, showOwner && l.owner ? ownerLabel(l.owner) : null].filter(Boolean).join(" · ");
  // Une carte sans compte prélevé connu : sa ligne dit quand elle sera prélevée.
  const loose = l.kind === "carte" ? l.cards[0] : undefined;
  return (
    <div className={large ? "py-2.5" : "border-b border-line/70 py-1.5 last:border-b-0"}>
      <Link to={target(l)} className="group flex items-center gap-3 py-1">
        {Icon ? (
          <span className={cn("grid shrink-0 place-items-center bg-bg text-muted", large ? "size-9 rounded-[10px]" : "size-7 rounded-md")}>
            <Icon size={large ? 17 : 15} />
          </span>
        ) : (
          <BankBadge bank={l.institution} size={large ? "md" : "sm"} />
        )}
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate font-medium group-hover:text-accent", large ? "text-[15px]" : "text-sm")}>{l.name}</span>
          {(sub || loose?.debitDate) && <span className="block truncate text-xs text-muted">{loose?.debitDate ? t("prélevé le {date}", { date: dateShort(loose.debitDate) }) : sub}</span>}
        </span>
        <span className={cn("tnum shrink-0 text-[15px] font-semibold", muted && "font-medium text-muted", !muted && !isDiscreet() && l.kind === "compte" && (l.amount ?? 0) < 0 && "text-neg")} title={l.original ? moneyIn(l.original.amount, l.original.currency) : undefined}>
          {money(l.amount)}
        </span>
      </Link>
      {l.kind === "compte" &&
        l.cards.map((c) => (
          <Link
            key={c.id}
            to={`/operations?compte=${encodeURIComponent(c.id)}`}
            title={[tn("{n} achat", "{n} achats", c.count, { n: c.count }), c.debitDate ? t("prélevé le {date}", { date: dateLong(c.debitDate) }) : null].filter(Boolean).join(" · ")}
            className={cn("flex items-center gap-2 text-muted hover:text-ink", large ? "py-1 pl-12 text-[13.5px]" : "py-0.5 pl-10 text-[13px]")}
          >
            <CreditCard size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {c.name}
              {c.debitDate && <span> · {t("prélevé le {date}", { date: dateShort(c.debitDate) })}</span>}
            </span>
            <span className="tnum shrink-0 text-ink">{money(c.amount)}</span>
          </Link>
        ))}
      {l.afterCards != null && l.cards.length > 1 && (
        <div className={cn("flex items-center justify-between gap-2 text-muted", large ? "py-1 pl-12 text-[13.5px]" : "py-0.5 pl-10 text-[13px]")}>
          <span>{t("Après les cartes")}</span>
          <span className="tnum">{money(l.afterCards)}</span>
        </div>
      )}
      {low && (
        <Link to={`/soldes?compte=${encodeURIComponent(low.id)}`} viewTransition title={t("Voir la prévision de ce compte")} className={cn("chip chip-warn mb-0.5 mt-1 text-[12.5px]", large ? "ml-12" : "ml-10")}>
          <TrendingDown size={13} /> {lowText(low)}
        </Link>
      )}
    </div>
  );
}
