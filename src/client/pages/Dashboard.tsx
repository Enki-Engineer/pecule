import { useMemo } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bitcoin, CalendarClock, ChevronRight, FileWarning, RefreshCw, ShieldCheck, Tags, Wallet } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { api, useAccounts, useDemo, useMe, useMonth, useSummary, useSync, useWealth, type Transaction, type WealthCategory } from "../api.ts";
import { Amount, Card, Spinner } from "../components/ui.tsx";
import { cn } from "../cn.ts";
import { currentMonth, dateFr, money, moneyIn, timeAgo } from "../format.ts";
import { monthTotals } from "../../lib/month.ts";
import { txTitle } from "../../lib/labels.ts";
import { groupByOwner, OWNER_ORDER, ownerLabel } from "../../lib/labels.ts";
import { CardOutstandingBlock } from "../components/CardOutstanding.tsx";
import { Welcome } from "../components/Welcome.tsx";
import { useFlows } from "../api-analysis.ts";
import { NATURE_LABELS, SPEND_NATURES } from "../../lib/nature.ts";
import { natureColor } from "../charts.ts";
import { openDrill } from "../components/DrillDrawer.tsx";
import { CATEGORY } from "../wealth.ts";
import { TxLogo } from "../components/Logo.tsx";
import { HoverPreview } from "../components/HoverPreview.tsx";
import { EnvelopesCard, GoalsCard } from "../components/Planning.tsx";
import { WeeklySummaryCard } from "../components/WeeklySummary.tsx";
import { useSeasonGreeting } from "../theme.ts";
import { FunCard } from "../components/FunCard.tsx";
import { locale, t, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Tableau de bord (ordinateur) : chiffres clés avec leur source et leur fraîcheur, ce qui demande
 * une action, l'évolution du patrimoine, les dernières opérations et les échéances à venir.
 * Chaque chiffre vient de la même définition que l'écran détaillé (src/server/stats.ts, wealth.ts).
 */

type Dash = {
  alertsOpen: number;
  invoicesToMatch: number;
  staleAssets: { id: number; name: string; value_date: string | null }[];
  cryptoRun: { status: string; finished_at: string | null; started_at: string } | null;
  tasksOverdue: number;
  upcoming: { kind: string; date: string; label: string; amount: number | null; link: string }[];
};

const CATEGORY_LABELS: Record<string, string> = { immobilier: t("Immobilier"), crypto: t("Crypto"), placement: t("Placements"), epargne: t("Épargne"), comptes: t("Comptes"), autre: t("Autres") };
const daysSince = (d: string | null) => (d ? Math.floor((Date.now() - Date.parse(`${d.slice(0, 10)}T12:00:00Z`)) / 86_400_000) : null);

export function Dashboard() {
  const demo = useDemo();
  const greeting = useSeasonGreeting();
  const me = useMe();
  const summary = useSummary();
  const accounts = useAccounts();
  const wealth = useWealth();
  const month = useMonth(currentMonth());
  const sync = useSync();
  const dash = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dash>("/dashboard") });
  const recent = useQuery({ queryKey: ["transactions", "recent"], queryFn: () => api<{ transactions: Transaction[] }>("/transactions?limit=8&offset=0") });
  const navigate = useNavigate();

  const s = summary.data;
  const w = wealth.data;
  const visible = (accounts.data?.accounts ?? []).filter((a) => !a.hidden && !(a.kind === "carte" && a.balance == null));
  const cash = visible.filter((a) => a.kind !== "carte" && !a.excluded).reduce((sum, a) => sum + (a.balance ?? 0), 0);
  const totals = month.data ? monthTotals(month.data.categories) : null;

  const history = useMemo(() => (w?.history ?? []).map((h) => ({ t: Date.parse(`${h.date.slice(0, 10)}T12:00:00Z`), net: Number(h.net) })), [w]);
  const net30 = useMemo(() => {
    const limit = Date.now() - 30 * 86_400_000;
    return [...history].reverse().find((h) => h.t <= limit)?.net ?? history[0]?.net ?? null;
  }, [history]);

  const postes = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of month.data?.categories ?? []) if (r.kind === "depense") map.set(r.poste ?? tk("À classer"), (map.get(r.poste ?? tk("À classer")) ?? 0) - Number(r.total));
    return [...map].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [month.data]);

  async function refresh() {
    try {
      const r = await sync.mutateAsync();
      toast.success(r.inserted ? tn("{n} nouvelle opération", "{n} nouvelles opérations", r.inserted) : t("Tout est à jour"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Synchronisation impossible"));
    }
  }

  const todo = [
    s && s.uncategorized > 0 && { icon: Tags, label: tn("{n} opération à classer · mode tri", "{n} opérations à classer · mode tri", s.uncategorized), to: "/tri" },
    dash.data && dash.data.invoicesToMatch > 0 && { icon: FileWarning, label: tn("{n} facture sans paiement retrouvé", "{n} factures sans paiement retrouvé", dash.data.invoicesToMatch), to: "/factures?filtre=a_rapprocher" },
    dash.data && dash.data.tasksOverdue > 0 && { icon: CalendarClock, label: tn("{n} tâche en retard", "{n} tâches en retard", dash.data.tasksOverdue), to: "/echeancier" },
    dash.data && dash.data.alertsOpen > 0 && { icon: AlertTriangle, label: tn("{n} alerte technique", "{n} alertes techniques", dash.data.alertsOpen), to: "/reglages/suivi" },
    ...(dash.data?.staleAssets ?? []).map((a) => ({ icon: Wallet, label: a.value_date ? t("{nom} : valeur saisie il y a {n} j", { nom: a.name, n: daysSince(a.value_date) ?? 0 }) : t("{nom} : valeur saisie jamais", { nom: a.name }), to: "/patrimoine" })),
    dash.data?.cryptoRun &&
      (dash.data.cryptoRun.status === "error" || (daysSince(dash.data.cryptoRun.finished_at) ?? 99) > 1) && { icon: Bitcoin, label: t("Crypto : synchro CoinStats en retard ou en échec"), to: "/patrimoine/crypto" },
  ].filter(Boolean) as { icon: typeof Tags; label: string; to: string }[];

  const groups = groupByOwner(visible, OWNER_ORDER);

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 pb-2">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight">{t("Bonjour {nom}", { nom: me.data?.user?.name ?? "" })}</h1>
          <div className="text-sm text-muted">
            {greeting && <span className="font-medium text-accent">{greeting} · </span>}
            {demo ? t("Données fictives (mode démo)") : t("Banques synchronisées {quand}", { quand: timeAgo(s?.lastSync?.finished_at ?? s?.lastSync?.started_at) })}
            {s?.lastSync?.status === "error" && <span className="text-neg"> · {t("erreur")}</span>}
          </div>
        </div>
        <button type="button" onClick={refresh} disabled={sync.isPending} className="press card flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-accent">
          <RefreshCw size={16} className={cn(sync.isPending && "animate-spin")} /> {t("Synchroniser")}
        </button>
      </header>
      <Welcome />

      {/* Chiffres clés */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          label={t("Patrimoine net")}
          value={w ? money(w.net, true) : "…"}
          delta={w && net30 != null ? w.net - net30 : null}
          deltaLabel={t("sur 30 jours")}
          source={w ? t("cours {quand}", { quand: timeAgo(w.crypto.pricesAt) }) : undefined}
          to="/patrimoine"
        />
        <Kpi label={t("Disponible")} value={accounts.data ? money(cash, true) : "…"} source={t("comptes courants, hors cartes")} to="/operations" />
        <Kpi
          label={t("Dépensé ce mois")}
          value={s ? money(s.spentThisMonth, true) : "…"}
          delta={s ? s.spentThisMonth - s.spentPrevMonthSameDay : null}
          deltaLabel={t("vs même date du mois dernier")}
          invert
          to="/mois"
        />
        <Kpi label={t("Solde du mois")} value={totals ? money(totals.revenus - totals.depenses, true) : "…"} source={totals ? t("revenus {montant}", { montant: money(totals.revenus, true) }) : undefined} to="/mois" />
        <Kpi label={t("Dettes restantes")} value={w ? money(w.debts, true) : "…"} source={w ? tn("{n} crédit, ta part", "{n} crédits, ta part", w.loans.length) : undefined} to="/patrimoine" />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 p-5 lg:col-span-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">{t("Évolution du patrimoine net")}</h2>
            <Link to="/patrimoine" className="text-sm text-accent">
              {t("Détail")}
            </Link>
          </div>
          <div className="h-56">
            {history.length >= 2 ? (
              <ResponsiveContainer>
                <AreaChart data={history} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={["dataMin", "dataMax"]}
                    tickLine={false}
                    axisLine={false}
                    tickCount={6}
                    tickFormatter={(v: number) => new Date(v).toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" })}
                  />
                  <YAxis tickLine={false} axisLine={false} width={56} domain={["dataMin - 5000", "dataMax + 5000"]} tickFormatter={(v: number) => `${Math.round(v / 1000)} k`} />
                  <Tooltip
                    formatter={(v) => [money(Number(v), true), t("Patrimoine net")]}
                    labelFormatter={(v) => dateFr(new Date(Number(v)).toISOString().slice(0, 10))}
                    contentStyle={{ background: "var(--color-card)", border: "none", borderRadius: 12 }}
                  />
                  <Area type="monotone" dataKey="net" stroke="var(--color-accent)" fill="url(#dg)" strokeWidth={2.5} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Spinner />
            )}
          </div>
        </Card>

        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 font-semibold">{t("À traiter")}</h2>
          {todo.length ? (
            <div className="space-y-1">
              {todo.map((x, i) => (
                <Link key={i} to={x.to} className="press flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-bg">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
                    <x.icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1 text-sm">{x.label}</span>
                  <ChevronRight size={16} className="text-muted" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-pos">
              <ShieldCheck size={18} /> {t("Tout est à jour.")}
            </div>
          )}
        </Card>

        <MonthNatures />

        <FunCard className="col-span-12" />
        <WeeklySummaryCard className="col-span-12" />
        <EnvelopesCard className="col-span-12 md:col-span-6 lg:col-span-7" />
        <GoalsCard className="col-span-12 md:col-span-6 lg:col-span-5" />

        <Card className="col-span-12 lg:col-span-7">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <h2 className="font-semibold">{t("Dernières opérations")}</h2>
            <Link to="/operations" className="text-sm text-accent">
              {t("Toutes##opérations")}
            </Link>
          </div>
          <div className="divide-y divide-line">
            {(recent.data?.transactions ?? []).map((tx) => (
              <button
                key={tx.id}
                type="button"
                onClick={() => navigate("/operations", { state: { openTx: tx.id } })}
                className="press flex w-full items-center gap-3 px-5 py-2 text-left hover:bg-bg"
              >
                <span className="tnum w-11 shrink-0 text-xs text-muted">{tx.date.slice(8, 10)}/{tx.date.slice(5, 7)}</span>
                <TxLogo t={tx} size="sm" />
                <HoverPreview target={{ kind: "operation", t: tx }} className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">{txTitle(tx)}</span>
                </HoverPreview>
                <span className={cn("hidden w-48 shrink-0 truncate text-sm md:block", tx.category_name ? "text-muted" : "font-medium text-warn")}>{td(tx.category_name ?? tk("À classer"))}</span>
                <Amount value={tx.amount} className="w-28 shrink-0 text-right text-[15px] font-semibold" />
              </button>
            ))}
            {recent.isLoading && <Spinner />}
          </div>
        </Card>

        <Card className="col-span-12 p-5 lg:col-span-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold">
            <CalendarClock size={18} className="text-accent" /> {t("Prochaines échéances")}
          </h2>
          {dash.data?.upcoming.length ? (
            <div className="space-y-1">
              {dash.data.upcoming.map((u, i) => (
                <Link key={i} to={u.link} className="press flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-bg">
                  <span className="tnum w-14 shrink-0 text-xs text-muted">{dateFr(u.date).slice(0, 5)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{u.label}</span>
                  {u.amount != null && <Amount value={u.amount} className="text-sm font-semibold" />}
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted">{t("Rien dans les 60 prochains jours.")}</div>
          )}
          <Link to="/echeancier" className="mt-3 block text-sm font-medium text-accent">
            {t("Tout l'échéancier →")}
          </Link>
        </Card>

        <Card className="col-span-12 p-5 md:col-span-6 lg:col-span-4">
          <h2 className="mb-3 font-semibold">{t("Dépenses du mois par poste")}</h2>
          <div className="space-y-1">
            {postes.map(([poste, total]) => (
              <button
                key={poste}
                type="button"
                onClick={() => openDrill(td(poste), poste === tk("À classer") ? { month: currentMonth(), debits: true, uncategorized: true } : { month: currentMonth(), poste, debits: true }, t("Ce mois-ci ·"))}
                className="-mx-2 block w-[calc(100%+1rem)] rounded-md px-2 py-1 text-left hover:bg-bg"
              >
                <div className="flex justify-between text-sm">
                  <span className={cn(poste === tk("À classer") && "text-warn")}>{td(poste)}</span>
                  <span className="tnum font-medium">{money(total, true)}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(total / Math.max(1, postes[0]?.[1] ?? 1)) * 100}%` }} />
                </div>
              </button>
            ))}
          </div>
        </Card>

        <Card className="col-span-12 p-5 md:col-span-6 lg:col-span-4">
          <h2 className="mb-3 font-semibold">{t("Répartition du patrimoine")}</h2>
          <div className="space-y-1">
            {w &&
              Object.entries(w.byCategory)
                .filter(([, v]) => v > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => (
                  <Link key={k} to={k === "crypto" ? "/patrimoine/crypto" : "/patrimoine"} viewTransition className="-mx-2 block rounded-md px-2 py-1 hover:bg-bg">
                    <div className="flex justify-between text-sm">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-sm" style={{ background: CATEGORY[k as WealthCategory]?.color }} />
                        {CATEGORY_LABELS[k] ?? k}
                      </span>
                      <span className="tnum font-medium">
                        {money(v, true)} <span className="text-muted">· {Math.round((v / w.gross) * 100)} %</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg">
                      <div className="h-full rounded-full" style={{ width: `${(v / w.gross) * 100}%`, background: CATEGORY[k as WealthCategory]?.color }} />
                    </div>
                  </Link>
                ))}
          </div>
        </Card>

        <Card className="col-span-12 lg:col-span-4">
          <h2 className="px-5 pb-1 pt-4 font-semibold">{t("Comptes")}</h2>
          {groups.map((g) => (
            <div key={g.owner} className="px-5 py-2">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{ownerLabel(g.owner)}</div>
              {g.list.map((a) => (
                <Link key={a.id} to={`/operations?compte=${encodeURIComponent(a.id)}`} className="flex items-center justify-between gap-3 py-1 text-sm hover:text-accent">
                  <span className="min-w-0 truncate">{a.display_name ?? a.name}</span>
                  <span title={a.balance_original != null ? moneyIn(a.balance_original, a.currency) : undefined}>
                    <Amount value={a.balance} className="font-medium" />
                  </span>
                </Link>
              ))}
            </div>
          ))}
          <CardOutstandingBlock />
        </Card>
      </div>
    </div>
  );
}

function Kpi({ label, value, delta, deltaLabel, invert, source, to }: { label: string; value: string; delta?: number | null; deltaLabel?: string; invert?: boolean; source?: string; to: string }) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <Link to={to} className="press card block p-4 hover:ring-1 hover:ring-accent/30">
      <div className="text-sm text-muted">{label}</div>
      <div className="tnum mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {delta != null && (
        <div className={cn("tnum mt-0.5 text-xs", good ? "text-pos" : "text-neg")}>
          {delta >= 0 ? "+" : ""}
          {money(delta, true)} {deltaLabel}
        </div>
      )}
      {source && <div className="mt-1 truncate text-[11px] text-muted">{source}</div>}
    </Link>
  );
}

/** Où part l'argent ce mois-ci : barre segmentée par nature, chaque segment ouvre ses opérations. */
function MonthNatures() {
  const month = currentMonth();
  const flows = useFlows(month);
  const f = flows.data;
  const parts = useMemo(() => {
    const map = new Map<string, number>();
    for (const x of f?.flows ?? []) if ((SPEND_NATURES as readonly string[]).includes(x.nature)) map.set(x.nature, (map.get(x.nature) ?? 0) + x.total);
    return SPEND_NATURES.filter((n) => map.get(n)).map((n) => ({ nature: n, total: map.get(n)! }));
  }, [f]);
  const total = parts.reduce((s, p) => s + p.total, 0);
  return (
    <Card className="col-span-12 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold">{t("Où part l'argent ce mois-ci")}</h2>
        <Link to="/mois?onglet=flux" viewTransition className="text-sm text-accent">
          {t("Voir les flux")}
        </Link>
      </div>
      {!f ? (
        <Spinner />
      ) : !total ? (
        <div className="text-sm text-muted">{t("Pas encore de dépenses ce mois-ci.")}</div>
      ) : (
        <>
          <div className="flex h-9 w-full gap-0.5 overflow-hidden rounded-md">
            {parts.map((p) => (
              <button
                key={p.nature}
                type="button"
                onClick={() => openDrill(NATURE_LABELS[p.nature], { month, nature: p.nature, debits: true })}
                className="flex h-full min-w-0 items-center justify-center text-[12px] font-semibold text-white transition-[filter] hover:brightness-110"
                style={{ width: `${(p.total / total) * 100}%`, background: natureColor(p.nature) }}
                title={t("{nom} : {montant}", { nom: NATURE_LABELS[p.nature], montant: money(p.total) })}
              >
                {p.total / total > 0.08 && <span className="truncate px-1">{Math.round((p.total / total) * 100)} %</span>}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
            {parts.map((p) => (
              <span key={p.nature} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: natureColor(p.nature) }} />
                <span className="text-muted">{NATURE_LABELS[p.nature]}</span>
                <span className="tnum font-semibold">{money(p.total, true)}</span>
              </span>
            ))}
            <span className="ml-auto text-muted">
              {t("Sorties")} <span className="tnum font-semibold text-ink">{money(total, true)}</span>
            </span>
          </div>
        </>
      )}
    </Card>
  );
}
