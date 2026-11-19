import { loadChunk } from "../reload.ts";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { CalendarClock, LayoutTemplate, RefreshCw, ChevronRight, SlidersHorizontal, Tags } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";
import { useAccounts, useAgenda, useBalanceSeries, useDemo, useSummary, useSync, useWealth } from "../api.ts";
import { Amount, Card, ErrorBox, PageHeader, Sparkline, Spinner } from "../components/ui.tsx";
import { money, timeAgo, dateFr } from "../format.ts";
import { useOutstandingTotal } from "../components/CardOutstanding.tsx";
import { AccountsCard } from "../components/AccountsCard.tsx";
import { Welcome } from "../components/Welcome.tsx";
import { useSeasonGreeting } from "../theme.ts";
import { FunCard } from "../components/FunCard.tsx";
import { WeekAhead } from "../components/MonthCalendar.tsx";
import { useCardLayout } from "../components/CardLayout.tsx";
import { AddDrawer, EditBar, EditFrame, EmptySlot, TemplatesDrawer } from "../components/DashEdit.tsx";
import { useSessionDraft } from "../api-dashboard.ts";
import { useDragSort } from "../dragSort.ts";
import { moveItem } from "../../lib/dashboard.ts";
import { cleanCardLayout, hideCard, reorderShown, showCard, shownCards, type CardLayout } from "../../lib/card-layout.ts";
import { HOME_CARDS, HOME_IDS, HOME_QUIET, HOME_TEMPLATES, homeDefault, homeTemplate, homeTemplateOf, type HomeCardId } from "../../lib/home-layout.ts";
import { netBefore } from "../../lib/wealth.ts";
import { EnvelopesCard, GoalsCard } from "../components/Planning.tsx";
import { WeeklySummaryCard } from "../components/WeeklySummary.tsx";
import { t, td, tn } from "../../lib/i18n.ts";

// Tableau de bord ordinateur (graphiques) chargé seulement sur grand écran.
const Dashboard = lazy(() => loadChunk(() => import("./Dashboard.tsx")).then((m) => ({ default: m.Dashboard })));

function useDesktop() {
  const [desk, setDesk] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesk(mq.matches);
    mq.addEventListener("change", on);
    return () => {
      mq.removeEventListener("change", on);
    };
  }, []);
  return desk;
}

export function Home() {
  const desktop = useDesktop();
  if (desktop)
    return (
      <Suspense fallback={<Spinner />}>
        <Dashboard />
      </Suspense>
    );
  return <MobileHome />;
}

function MobileHome() {
  const demo = useDemo();
  const accounts = useAccounts();
  const summary = useSummary();
  const sync = useSync();
  const series = useBalanceSeries(90);
  const outstanding = useOutstandingTotal();
  const balances = series.data?.series.map((p) => p.balance) ?? [];
  const trend3m = balances.length >= 2 ? balances[balances.length - 1] - balances[0] : null;

  // Les cartes sans encours connu (Finta ne le fournit pas toujours) n'apportent rien à l'accueil.
  const visible = useMemo(() => (accounts.data?.accounts ?? []).filter((a) => !a.hidden && !(a.kind === "carte" && a.balance == null)), [accounts.data]);
  const cash = visible.filter((a) => a.kind !== "carte" && !a.excluded).reduce((s, a) => s + (a.balance ?? 0), 0);
  const cards = visible.filter((a) => a.kind === "carte" && !a.excluded).reduce((s, a) => s + (a.balance ?? 0), 0);

  async function refresh() {
    try {
      const r = await sync.mutateAsync();
      toast.success(r.inserted ? tn("{n} nouvelle opération", "{n} nouvelles opérations", r.inserted) : t("Tout est à jour"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Synchronisation impossible"));
    }
  }

  const s = summary.data;
  const greeting = useSeasonGreeting();
  const [layout, saveLayout] = useCardLayout<HomeCardId>(LAYOUT_KEY, cleanHomeLayout, homeDefault);
  // Mode construction : on arrange un brouillon ; « Terminé » l'enregistre sur l'appareil, « Annuler » l'oublie.
  const [draft, setDraft] = useSessionDraft<CardLayout<HomeCardId>>("pecule.home.draft", cleanHomeLayout);
  const [drawer, setDrawer] = useState<"ajout" | "modeles" | null>(null);
  const editing = draft !== null;
  const current = draft ?? layout;
  const shown = useMemo(() => shownCards(current), [current]);
  const zone = useRef<HTMLDivElement>(null);
  const sort = useDragSort({
    ids: shown,
    signature: shown.join("|"),
    zone,
    onReorder: (ids) => setDraft((d) => d && reorderShown(d, ids as HomeCardId[])),
  });
  /** Change le brouillon ; les blocs glissent vers leur nouvelle place. */
  const change = (next: (d: CardLayout<HomeCardId>) => CardLayout<HomeCardId>) => {
    sort.snapshot();
    setDraft((d) => d && next(d));
  };
  const done = () => {
    if (draft) saveLayout(draft);
    setDraft(null);
    setDrawer(null);
  };
  const cancel = () => {
    sort.snapshot();
    setDraft(null);
    setDrawer(null);
  };
  const labelOf = (id: HomeCardId) => t(HOME_CARDS.find((c) => c.id === id)!.label);
  const delta = s ? s.spentThisMonth - s.spentPrevMonthSameDay : 0;

  // Les blocs de l'accueil, par identifiant : l'ordre et ceux qu'on voit viennent du réglage de l'appareil.
  const blocks: Record<HomeCardId, ReactNode> = {
    disponible: (
      <Card className="p-5">
        <div className="text-sm text-muted">{t("Disponible sur les comptes")}</div>
        <div className="tnum mt-1 text-[34px] font-bold tracking-tight">{money(cash)}</div>
        {outstanding ? (
          // Encours lu chez la banque : ce qui sortira au prochain relevé, quand, et ce qu'il restera.
          <div className="mt-1 text-sm text-muted">
            {t("Encours cartes à débit différé :")} <span className="tnum font-medium text-ink">{money(outstanding.total)}</span>
            <div className="text-xs">
              {outstanding.debitDate ? `${t("prélevé le {date}", { date: dateFr(outstanding.debitDate) })} · ` : ""}
              {t("il restera {montant}", { montant: money(cash + outstanding.total, true) })}
            </div>
          </div>
        ) : (
          cards !== 0 && (
            <div className="mt-1 text-sm text-muted">
              {t("Encours cartes à débit différé :")} <span className="tnum font-medium text-ink">{money(cards)}</span>
            </div>
          )
        )}
        {balances.length >= 2 && (
          <>
            <Sparkline values={balances} className="mt-3" />
            {trend3m != null && (
              <div className="mt-2">
                <span className={clsx("chip tnum text-[13px]", trend3m >= 0 ? "chip-pos" : "chip-neg")}>{t("{montant} sur 3 mois", { montant: (trend3m >= 0 ? "+" : "") + money(trend3m, true) })}</span>
              </div>
            )}
          </>
        )}
      </Card>
    ),
    depense: s && (
      <Link to="/mois" className="block">
        <Card className="press p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted">{t("Dépensé ce mois-ci")}</div>
            <ChevronRight size={18} className="text-muted" />
          </div>
          <div className="figure mt-1 text-[26px]">{money(s.spentThisMonth)}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className={clsx("chip tnum text-[13px]", delta > 0 ? "chip-neg" : "chip-pos")}>{(delta > 0 ? "+" : "") + money(delta, true)}</span>
            <span className="text-[13px] text-muted">{t("vs même date du mois dernier")}</span>
          </div>
          {s.topCategories.length > 0 && (
            <div className="mt-4 space-y-2">
              {s.topCategories.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-[15px]">
                  <span className="truncate">{td(c.name)}</span>
                  <span className="tnum font-medium">{money(c.total)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Link>
    ),
    aclasser: s && s.uncategorized > 0 && (
      <Link to="/tri">
        <Card className="press flex items-center gap-3 p-4">
          <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent">
            <Tags size={19} />
          </span>
          <div className="flex-1">
            <div className="font-semibold">{tn("{n} opération à classer", "{n} opérations à classer", s.uncategorized)}</div>
            <div className="text-sm text-muted">{t("Sans catégorie, elles faussent les totaux")}</div>
          </div>
          <ChevronRight size={18} className="text-muted" />
        </Card>
      </Link>
    ),
    semaine: <WeekAhead compact />,
    amusant: <FunCard />,
    resume: <WeeklySummaryCard />,
    enveloppes: <EnvelopesCard />,
    objectifs: <GoalsCard />,
    echeances: <UpcomingCard />,
    // Les comptes comme sur l'appli d'une banque : chaque compte avec ses cartes à débit différé, puis l'épargne,
    // les placements et les crédits.
    comptes: <AccountsCard sections />,
    // Les mêmes comptes en quelques lignes : un total par groupe et une barre, sans la liste.
    apercu: <AccountsCard summary />,
    patrimoine: <WealthCard />,
  };

  return (
    <>
      <PageHeader
        title="Pécule"
        subtitle={
          <>
            {greeting && <span className="font-medium text-accent">{greeting} · </span>}
            {demo ? t("Données fictives (mode démo)") : t("Synchronisé {quand}", { quand: timeAgo(s?.lastSync?.finished_at ?? s?.lastSync?.started_at) })}
            {s?.lastSync?.status === "error" && <span className="text-neg"> · {t("erreur")}</span>}
          </>
        }
        right={
          <button type="button" onClick={refresh} disabled={sync.isPending} className="press grid size-10 place-items-center rounded-full bg-card text-accent ring-1 ring-line" aria-label={t("Synchroniser")}>
            <RefreshCw size={18} className={clsx(sync.isPending && "animate-spin")} />
          </button>
        }
      />

      {editing ? (
        <>
          <EditBar compact onAdd={() => setDrawer("ajout")} addCount={current.hidden.length} onCancel={cancel} onDone={done} />
          <p className="mt-3 px-1 text-[13px] text-muted">{t("Appuie longuement sur un bloc pour le déplacer, ou sers-toi de sa poignée et de ses flèches. La croix le retire.")}</p>
          <button type="button" onClick={() => setDrawer("modeles")} className="press mb-6 mt-3 flex w-full items-center justify-center gap-2 rounded-full bg-card px-4 py-2.5 text-sm font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]">
            <LayoutTemplate size={16} /> {t("Partir d'un modèle")}
          </button>
        </>
      ) : (
        <div className="mb-4 empty:hidden">
          <Welcome />
        </div>
      )}
      {accounts.error && <ErrorBox error={accounts.error} />}
      {accounts.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div ref={zone} className={clsx(editing ? "space-y-6" : "space-y-4")}>
            {shown.map((id, i) => (
              <div key={id} ref={sort.register(id)} data-card={id} className={clsx("relative", !editing && "has-[>.dash-body:empty]:hidden", sort.dragging === id && "opacity-40")}>
                <div className="dash-body space-y-4 empty:hidden" inert={editing}>
                  {blocks[id]}
                </div>
                {editing && (
                  <>
                    <EmptySlot label={labelOf(id)} />
                    <EditFrame
                      id={id}
                      label={labelOf(id)}
                      sort={sort}
                      vertical
                      first={i === 0}
                      last={i === shown.length - 1}
                      onNudge={(d) => change((l) => reorderShown(l, moveItem(shown, i, i + d)))}
                      onRemove={() => change((l) => hideCard(l, id))}
                    />
                  </>
                )}
              </div>
            ))}
          </div>
          {!editing && (
            <button type="button" onClick={() => setDraft(layout)} className="press mx-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium text-muted">
              <SlidersHorizontal size={14} /> {t("Personnaliser l'accueil")}
            </button>
          )}
          {draft && drawer === "modeles" && (
            <TemplatesDrawer
              items={HOME_TEMPLATES.map((m) => ({ id: m.id, label: t(m.label), hint: t(m.hint), rows: m.cards.map(() => [12]) }))}
              current={homeTemplateOf(draft)}
              onApply={(id) => {
                change(() => homeTemplate(id));
                setDrawer(null);
              }}
              onClose={() => setDrawer(null)}
            />
          )}
          {draft && drawer === "ajout" && (
            <AddDrawer
              title={t("Ajouter à l'accueil")}
              cards={draft.order.filter((id) => draft.hidden.includes(id)).map((id) => ({ id, label: labelOf(id) }))}
              onAddCard={(id) => change((l) => showCard(l, id))}
              onClose={() => setDrawer(null)}
            />
          )}
        </div>
      )}
    </>
  );
}

/** Patrimoine net : ce qu'il vaut, ce qu'il a pris ou perdu en trente jours, sa courbe et ce qui reste dû. */
function WealthCard() {
  const w = useWealth().data;
  if (!w) return null;
  const before = netBefore(w.history, 30);
  const delta = before == null ? null : w.net - before;
  const values = w.history.map((h) => Number(h.net));
  return (
    <Link to="/patrimoine" className="block">
      <Card className="press p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted">{t("Patrimoine net")}</div>
          <ChevronRight size={18} className="text-muted" />
        </div>
        <div className="figure mt-1 text-[26px]">{money(w.net, true)}</div>
        {delta != null && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className={clsx("chip tnum text-[13px]", delta >= 0 ? "chip-pos" : "chip-neg")}>{(delta >= 0 ? "+" : "") + money(delta, true)}</span>
            <span className="text-[13px] text-muted">{t("sur 30 jours")}</span>
          </div>
        )}
        {values.length >= 2 && <Sparkline values={values} className="mt-3" />}
        {w.debts > 0 && (
          <div className="mt-3 flex items-center justify-between text-[15px]">
            <span className="text-muted">{t("Dettes restantes")}</span>
            <span className="tnum font-medium">{money(w.debts, true)}</span>
          </div>
        )}
      </Card>
    </Link>
  );
}


/** Accueil iPhone : les 3 prochaines échéances (et les tâches en retard), vers l'échéancier. */
function UpcomingCard() {
  const agenda = useAgenda(45);
  const entries = agenda.data?.entries ?? [];
  const overdue = entries.filter((e) => e.overdue).length;
  const next = entries.filter((e) => e.date && !e.overdue).slice(0, 3);
  if (!overdue && !next.length) return null;
  return (
    <Link to="/echeancier">
      <Card className="press p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-2 font-semibold">
            <CalendarClock size={18} className="text-accent" /> {t("Prochaines échéances")}
          </span>
          <ChevronRight size={18} className="text-muted" />
        </div>
        {overdue > 0 && <div className="mb-1 text-sm font-medium text-neg">{tn("{n} tâche en retard", "{n} tâches en retard", overdue)}</div>}
        <div className="space-y-1">
          {next.map((e) => (
            <div key={e.key} className="flex items-center gap-3 text-sm">
              <span className="tnum w-11 shrink-0 text-xs text-muted">{e.date!.slice(8, 10)}/{e.date!.slice(5, 7)}</span>
              <span className="min-w-0 flex-1 truncate">{e.title}</span>
              {e.amount != null && <Amount value={e.amount} className="text-sm font-medium" />}
            </div>
          ))}
        </div>
      </Card>
    </Link>
  );
}

/* ---------- Accueil à la carte (mémorisé sur l'appareil ; blocs et modèles : src/lib/home-layout.ts) ---------- */

const LAYOUT_KEY = "pecule.home.layout";
const cleanHomeLayout = cleanCardLayout<HomeCardId>(HOME_IDS, HOME_QUIET);
