import { isDiscreet } from "../discret.ts";
import { AccountsCard } from "../components/AccountsCard.tsx";
import { AddDrawer, EditBar, EditFrame, EmptySlot, TemplatesDrawer, WidthPicker } from "../components/DashEdit.tsx";
import { useDashLayout } from "../api-dashboard.ts";
import { useDragSort } from "../dragSort.ts";
import { lowAccounts, useBalanceAlert } from "../api-balance.ts";
import { lowBalanceText } from "../components/LowBalance.tsx";
import { WeekAhead } from "../components/MonthCalendar.tsx";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bitcoin, CalendarClock, ChevronRight, FileWarning, LayoutDashboard, RefreshCw, TrendingDown, ShieldCheck, Tags, Wallet } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { api, useAccounts, useDemo, useMe, useMonth, useSummary, useSync, useWealth, type Transaction, type WealthCategory } from "../api.ts";
import { Amount, Card, InfoTip, Spinner } from "../components/ui.tsx";
import { cn } from "../cn.ts";
import { currentMonth, dateFr, money, timeAgo, kAxis } from "../format.ts";
import { monthTotals } from "../../lib/month.ts";
import { txTitle } from "../../lib/labels.ts";
import { useOutstandingTotal } from "../components/CardOutstanding.tsx";
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
import { DASH_CARDS, DASH_KPIS, cardOf, missingCards, missingKpis, moveItem, sameLayout, templateLayout, type DashCardId, type DashKpiId, type DashLayout, type DashWidth } from "../../lib/dashboard.ts";
import { locale, t, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Tableau de bord (ordinateur) : chiffres clés avec leur source et leur fraîcheur, puis des cartes — les comptes,
 * ce qui demande une action, l'évolution du patrimoine, les dernières opérations, les échéances à venir…
 * Chaque chiffre vient de la même définition que l'écran détaillé (src/server/stats.ts, wealth.ts).
 *
 * Le membre arrange l'écran lui-même (src/lib/dashboard.ts) : « Modifier » ouvre le mode construction, où chaque
 * carte se glisse, change de largeur ou se retire, où l'on ajoute ce qui manque et où l'on repart d'un modèle.
 * Rien n'est enregistré avant « Terminé » ; l'agencement est gardé par le serveur, par membre.
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

/** Place d'une carte dans la grille de douze colonnes ; sur une fenêtre étroite, un tiers devient la moitié et deux tiers toute la largeur. */
const SPAN: Record<DashWidth, string> = { 4: "col-span-12 md:col-span-6 lg:col-span-4", 6: "col-span-12 md:col-span-6", 8: "col-span-12 lg:col-span-8", 12: "col-span-12" };
/** Colonnes de la rangée des chiffres clés, selon leur nombre (six : deux rangées de trois, une seule sur très grand écran). */
const KPI_COLS = ["lg:grid-cols-4", "lg:grid-cols-4", "lg:grid-cols-4", "lg:grid-cols-3", "lg:grid-cols-4", "lg:grid-cols-5", "lg:grid-cols-3 2xl:grid-cols-6", "lg:grid-cols-4", "lg:grid-cols-4"];
const labelOf = (id: DashCardId) => t(DASH_CARDS.find((c) => c.id === id)!.label);
const kpiLabel = (id: DashKpiId) => t(DASH_KPIS.find((k) => k.id === id)!.label);
type KpiProps = Parameters<typeof Kpi>[0];

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
  const outstanding = useOutstandingTotal();

  const balance = useBalanceAlert();
  // Mode construction : on arrange un brouillon ; « Terminé » l'enregistre, « Annuler » l'oublie.
  const { layout: saved, save } = useDashLayout();
  const [draft, setDraft] = useState<DashLayout | null>(null);
  const [drawer, setDrawer] = useState<"ajout" | "modeles" | null>(null);
  const editing = draft !== null;
  const layout = draft ?? saved;
  const kpiZone = useRef<HTMLDivElement>(null);
  const cardZone = useRef<HTMLDivElement>(null);
  const kpiSort = useDragSort({ ids: layout.kpis, signature: layout.kpis.join("|"), zone: kpiZone, onReorder: (ids) => setDraft((d) => d && { ...d, kpis: ids as DashKpiId[] }) });
  const cardSort = useDragSort({
    ids: useMemo(() => layout.cards.map((c) => c.id), [layout.cards]),
    signature: layout.cards.map((c) => `${c.id}:${c.w}`).join("|"),
    zone: cardZone,
    onReorder: (ids) => setDraft((d) => d && { ...d, cards: ids.map((id) => d.cards.find((c) => c.id === id)!) }),
  });
  /** Change le brouillon ; les blocs glissent vers leur nouvelle place. */
  const change = (next: (d: DashLayout) => DashLayout) => {
    kpiSort.snapshot();
    cardSort.snapshot();
    setDraft((d) => d && next(d));
  };
  const done = () => {
    if (draft && !sameLayout(draft, saved)) save(draft);
    setDraft(null);
    setDrawer(null);
  };
  const cancel = () => {
    kpiSort.snapshot();
    cardSort.snapshot();
    setDraft(null);
    setDrawer(null);
  };
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
    // Solde bas, aujourd'hui ou à venir : en tête, c'est ce qui presse.
    ...lowAccounts(balance.data).map((a) => ({ icon: TrendingDown, label: lowBalanceText(a), to: `/soldes?compte=${encodeURIComponent(a.id)}` })),
    s && s.uncategorized > 0 && { icon: Tags, label: tn("{n} opération à classer · mode tri", "{n} opérations à classer · mode tri", s.uncategorized), to: "/tri" },
    dash.data && dash.data.invoicesToMatch > 0 && { icon: FileWarning, label: tn("{n} facture sans paiement retrouvé", "{n} factures sans paiement retrouvé", dash.data.invoicesToMatch), to: "/factures?filtre=a_rapprocher" },
    dash.data && dash.data.tasksOverdue > 0 && { icon: CalendarClock, label: tn("{n} tâche en retard", "{n} tâches en retard", dash.data.tasksOverdue), to: "/echeancier" },
    dash.data && dash.data.alertsOpen > 0 && { icon: AlertTriangle, label: tn("{n} alerte technique", "{n} alertes techniques", dash.data.alertsOpen), to: "/reglages/suivi" },
    ...(dash.data?.staleAssets ?? []).map((a) => ({ icon: Wallet, label: a.value_date ? t("{nom} : valeur saisie il y a {n} j", { nom: a.name, n: daysSince(a.value_date) ?? 0 }) : t("{nom} : valeur saisie jamais", { nom: a.name }), to: "/patrimoine" })),
    dash.data?.cryptoRun &&
      (dash.data.cryptoRun.status === "error" || (daysSince(dash.data.cryptoRun.finished_at) ?? 99) > 1) && { icon: Bitcoin, label: t("Crypto : synchro CoinStats en retard ou en échec"), to: "/patrimoine/crypto" },
  ].filter(Boolean) as { icon: typeof Tags; label: string; to: string }[];

  // Les blocs du tableau de bord, par identifiant : l'ordre et la visibilité viennent du réglage de l'appareil.
  const blocks: Record<DashCardId, ReactNode> = {
    evolution: (
          <Card className="h-full p-5">
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
                    <YAxis tickLine={false} axisLine={false} width={56} domain={["dataMin - 5000", "dataMax + 5000"]} tickFormatter={(v: number) => kAxis(v)} />
                    <Tooltip
                      formatter={(v) => [money(Number(v), true), t("Patrimoine net")]}
                      labelFormatter={(v) => dateFr(new Date(Number(v)).toISOString().slice(0, 10))}
                      
                    />
                    <Area type="monotone" dataKey="net" stroke="var(--color-accent)" fill="url(#dg)" strokeWidth={2.5} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <Spinner />
              )}
            </div>
          </Card>
    ),
    atraiter: (
          <Card className="h-full p-5">
            <h2 className="mb-3 font-semibold">{t("À traiter")}</h2>
            {todo.length ? (
              <div className="space-y-1">
                {todo.map((x, i) => (
                  <Link key={i} to={x.to} className="press flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-bg">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-bg text-ink">
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
    ),
    semaine: <WeekAhead className="h-full" />,
    natures: <MonthNatures />,
    amusant: <FunCard className="h-full" />,
    resume: <WeeklySummaryCard className="h-full" />,
    enveloppes: <EnvelopesCard className="h-full" />,
    objectifs: <GoalsCard className="h-full" />,
    operations: (
          <Card className="@container h-full">
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
                  <span className={cn("hidden w-48 shrink-0 truncate text-sm @2xl:block", tx.category_name ? "text-muted" : "font-medium text-warn")}>{td(tx.category_name ?? tk("À classer"))}</span>
                  <Amount value={tx.amount} className="w-28 shrink-0 text-right text-[15px] font-semibold" />
                </button>
              ))}
              {recent.isLoading && <Spinner />}
            </div>
          </Card>
    ),
    echeances: (
          <Card className="h-full p-5">
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
    ),
    postes: (
          <Card className="h-full p-5">
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
    ),
    repartition: (
          <Card className="h-full p-5">
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
    ),
    comptes: <AccountsCard className="h-full" />,
  };

  // Les chiffres clés, par identifiant. Sans encours de carte connu, « Cartes à débit différé » n'a rien à dire :
  // il ne s'affiche qu'en construction, pour pouvoir être déplacé ou retiré.
  const kpis: Record<DashKpiId, KpiProps | null> = {
    patrimoine: {
      label: kpiLabel("patrimoine"),
      info: t("Ce que tu possèdes (comptes, épargne, biens, crypto) moins ce que tu dois encore. Les biens et les crédits communs comptent pour ta part."),
      value: w ? money(w.net, true) : "…",
      delta: w && net30 != null ? w.net - net30 : null,
      deltaLabel: t("sur 30 jours"),
      source: w ? t("cours {quand}", { quand: timeAgo(w.crypto.pricesAt) }) : undefined,
      to: "/patrimoine",
    },
    disponible: {
      label: kpiLabel("disponible"),
      value: accounts.data ? money(cash, true) : "…",
      source: t("comptes courants, hors cartes"),
      to: "/operations",
      info: t("Ce qu'il y a sur tes comptes aujourd'hui. Les achats par carte à débit différé pas encore prélevés n'en sont pas déduits."),
    },
    differe: outstanding
      ? {
          label: kpiLabel("differe"),
          info: t("Achats déjà faits avec une carte à débit différé : la banque les prélèvera en une fois, à la date indiquée."),
          value: money(outstanding.total, true),
          source: [
            outstanding.debitDate ? t("prélevé le {date}", { date: dateFr(outstanding.debitDate) }) : null,
            tn("{n} achat", "{n} achats", outstanding.count, { n: outstanding.count }),
            accounts.data ? t("il restera {montant}", { montant: money(cash + outstanding.total, true) }) : null,
          ]
            .filter(Boolean)
            .join(" · "),
          to: "/mois?onglet=frise",
        }
      : editing
        ? { label: kpiLabel("differe"), value: "—", source: t("Aucun encours connu pour l'instant"), to: "/mois?onglet=frise" }
        : null,
    depense: {
      label: kpiLabel("depense"),
      info: t("Dépenses du mois en cours, remboursements déduits. L'étiquette compare au mois dernier, à la même date."),
      value: s ? money(s.spentThisMonth, true) : "…",
      delta: s ? s.spentThisMonth - s.spentPrevMonthSameDay : null,
      deltaLabel: t("vs même date du mois dernier"),
      invert: true,
      to: "/mois",
    },
    solde: {
      label: kpiLabel("solde"),
      tone: totals ? (totals.revenus - totals.depenses >= 0 ? "pos" : "neg") : undefined,
      info: t("Revenus du mois moins dépenses du mois. Les mouvements entre tes comptes et les versements d'épargne ne comptent pas."),
      value: totals ? money(totals.revenus - totals.depenses, true) : "…",
      source: totals ? t("revenus {montant}", { montant: money(totals.revenus, true) }) : undefined,
      to: "/mois",
    },
    revenus: {
      label: kpiLabel("revenus"),
      info: t("Ce que tu as reçu ce mois-ci dans tes catégories de revenus. Les mouvements entre tes comptes ne comptent pas."),
      value: totals ? money(totals.revenus, true) : "…",
      source: totals ? t("dépenses {montant}", { montant: money(totals.depenses, true) }) : undefined,
      to: "/mois",
    },
    epargne: {
      label: kpiLabel("epargne"),
      info: t("Ce que tu as versé ce mois-ci vers ton épargne et tes placements : les opérations de tes catégories d'épargne."),
      value: totals ? money(totals.epargne, true) : "…",
      source: totals && totals.revenus > 0 ? t("{n} % des revenus du mois", { n: Math.round((totals.epargne / totals.revenus) * 100) }) : undefined,
      to: "/mois",
    },
    dettes: {
      label: kpiLabel("dettes"),
      info: t("Capital qu'il te reste à rembourser sur tes crédits, pour ta part."),
      value: w ? money(w.debts, true) : "…",
      source: w ? tn("{n} crédit, ta part", "{n} crédits, ta part", w.loans.length) : undefined,
      to: "/patrimoine",
    },
  };
  const shownKpis = layout.kpis.filter((id) => kpis[id]);
  const toAdd = missingCards(layout).length + missingKpis(layout).length;

  const addCard = (id: DashCardId) => {
    change((d) => ({ ...d, cards: [...d.cards, cardOf(id)] }));
    // La carte vient de se poser à la fin : on l'amène à l'écran.
    requestAnimationFrame(() => cardZone.current?.querySelector(`[data-card="${id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  return (
    <div className="space-y-4">
      <header className="flex items-end justify-between gap-3 pb-2">
        <div>
          <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.03em]">{t("Bonjour {nom}", { nom: me.data?.user?.name ?? "" })}</h1>
          <div className="text-[15px] text-muted">
            {greeting && <span className="font-medium text-accent">{greeting} · </span>}
            {demo ? t("Données fictives (mode démo)") : t("Banques synchronisées {quand}", { quand: timeAgo(s?.lastSync?.finished_at ?? s?.lastSync?.started_at) })}
            {s?.lastSync?.status === "error" && <span className="text-neg"> · {t("erreur")}</span>}
          </div>
        </div>
        {!editing && (
          <button type="button" onClick={() => setDraft(saved)} title={t("Modifier le tableau de bord")} aria-label={t("Modifier le tableau de bord")} className="press ml-auto grid size-10 place-items-center rounded-full bg-card text-ink shadow-[0_1px_2px_rgb(20_20_19/0.1)]">
            <LayoutDashboard size={16} />
          </button>
        )}
        <button type="button" onClick={refresh} disabled={sync.isPending} className={cn("press flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-ink shadow-[0_1px_2px_rgb(20_20_19/0.1)]", editing && "ml-auto")}>
          <RefreshCw size={16} className={cn(sync.isPending && "animate-spin")} /> {t("Synchroniser")}
        </button>
      </header>
      {editing ? <EditBar onTemplates={() => setDrawer("modeles")} onAdd={() => setDrawer("ajout")} addCount={toAdd} onCancel={cancel} onDone={done} /> : <Welcome />}

      {/* Chiffres clés : ceux que le membre a gardés, dans son ordre. */}
      {shownKpis.length > 0 && (
        <div ref={kpiZone} className={cn("grid grid-cols-2 gap-4", KPI_COLS[shownKpis.length])}>
          {shownKpis.map((id, i) => (
            <div key={id} ref={kpiSort.register(id)} className={cn("relative min-w-0", kpiSort.dragging === id && "opacity-40")}>
              <div className="h-full" inert={editing}>
                <Kpi {...kpis[id]!} />
              </div>
              {editing && (
                <EditFrame
                  id={id}
                  label={kpiLabel(id)}
                  sort={kpiSort}
                  first={i === 0}
                  last={i === shownKpis.length - 1}
                  onNudge={(d) => change((l) => ({ ...l, kpis: moveItem(l.kpis, l.kpis.indexOf(id), l.kpis.indexOf(shownKpis[i + d])) }))}
                  onRemove={() => change((l) => ({ ...l, kpis: l.kpis.filter((k) => k !== id) }))}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div ref={cardZone} className="grid grid-cols-12 gap-4">
        {layout.cards.map((c, i) => (
          <div key={c.id} ref={cardSort.register(c.id)} data-card={c.id} className={cn(SPAN[c.w], "relative min-w-0", !editing && "has-[>.dash-body:empty]:hidden", cardSort.dragging === c.id && "opacity-40")}>
            <div className="dash-body h-full empty:hidden" inert={editing}>
              {blocks[c.id]}
            </div>
            {editing && (
              <>
                <EmptySlot label={labelOf(c.id)} />
                <EditFrame
                  id={c.id}
                  label={labelOf(c.id)}
                  sort={cardSort}
                  first={i === 0}
                  last={i === layout.cards.length - 1}
                  onNudge={(d) => change((l) => ({ ...l, cards: moveItem(l.cards, i, i + d) }))}
                  onRemove={() => change((l) => ({ ...l, cards: l.cards.filter((x) => x.id !== c.id) }))}
                >
                  <WidthPicker id={c.id} value={c.w} onChange={(wd) => change((l) => ({ ...l, cards: l.cards.map((x) => (x.id === c.id ? { ...x, w: wd } : x)) }))} />
                </EditFrame>
              </>
            )}
          </div>
        ))}
      </div>
      {!layout.cards.length && !shownKpis.length && (
        <Card className="p-8 text-center">
          <div className="font-semibold">{t("Ton tableau de bord est vide.")}</div>
          <div className="mt-1 text-sm text-muted">{editing ? t("Ajoute une carte, ou pars d'un modèle.") : t("Ajoute des cartes ou pars d'un modèle pour le remplir.")}</div>
          {!editing && (
            <button type="button" onClick={() => setDraft(saved)} className="press mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-card">
              <LayoutDashboard size={16} /> {t("Modifier le tableau de bord")}
            </button>
          )}
        </Card>
      )}
      {draft && drawer === "ajout" && <AddDrawer layout={draft} onAddKpi={(id) => change((l) => ({ ...l, kpis: [...l.kpis, id] }))} onAddCard={addCard} onClose={() => setDrawer(null)} />}
      {draft && drawer === "modeles" && (
        <TemplatesDrawer
          layout={draft}
          onApply={(id) => {
            change(() => templateLayout(id));
            setDrawer(null);
          }}
          onClose={() => setDrawer(null)}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, delta, deltaLabel, invert, source, to, info, tone }: { label: string; value: string; delta?: number | null; deltaLabel?: string; invert?: boolean; source?: string; to: string; info?: string; tone?: "pos" | "neg" }) {
  const good = delta == null ? null : invert ? delta <= 0 : delta >= 0;
  return (
    <Link to={to} className="press card @container block h-full p-4 transition-shadow 2xl:p-5 hover:shadow-[0_1px_1px_rgb(20_20_19/0.04),0_16px_32px_-18px_rgb(20_20_19/0.28)]">
      <div className="flex items-center gap-1.5 text-[14px] text-muted @[150px]:text-[15px]">
        <span className="min-w-0 truncate">{label}</span>
        {info && <InfoTip text={info} />}
      </div>
      <div className={cn("figure mt-1.5 text-[21px] @[140px]:text-[25px] @[180px]:text-[30px]", !isDiscreet() && tone === "pos" && "text-pos", !isDiscreet() && tone === "neg" && "text-neg")}>{value}</div>
      {delta != null && (
        <div className="mt-2">
          <span className={cn("chip tnum text-[12.5px]", good ? "chip-pos" : "chip-neg")}>
            {delta >= 0 ? "+" : ""}
            {money(delta, true)}
          </span>
          <span className="ml-1.5 text-[12.5px] text-muted">{deltaLabel}</span>
        </div>
      )}
      {source && <div className="mt-1.5 truncate text-[12.5px] text-muted">{source}</div>}
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
    <Card className="h-full p-5">
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
          <div className="flex h-10 w-full gap-1 overflow-hidden rounded-xl">
            {parts.map((p) => (
              <button
                key={p.nature}
                type="button"
                onClick={() => openDrill(NATURE_LABELS[p.nature], { month, nature: p.nature, debits: true })}
                className="h-full min-w-0 transition-[filter] hover:brightness-110"
                style={{ width: `${(p.total / total) * 100}%`, background: natureColor(p.nature) }}
                title={t("{nom} : {montant}", { nom: NATURE_LABELS[p.nature], montant: money(p.total) })}
                aria-label={t("{nom} : {montant}", { nom: NATURE_LABELS[p.nature], montant: money(p.total) })}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-[13px]">
            {parts.map((p) => (
              <span key={p.nature} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: natureColor(p.nature) }} />
                <span className="text-muted">{NATURE_LABELS[p.nature]}</span>
                <span className="tnum font-semibold">{money(p.total, true)}</span>
                <span className="tnum text-muted">{Math.round((p.total / total) * 100)} %</span>
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
