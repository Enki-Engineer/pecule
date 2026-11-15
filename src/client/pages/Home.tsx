import { loadChunk } from "../reload.ts";
import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, CalendarClock, RefreshCw, ChevronRight, SlidersHorizontal, Tags } from "lucide-react";
import { toast } from "sonner";
import clsx from "clsx";
import { useAccounts, useAgenda, useBalanceSeries, useDemo, useSummary, useSync, type Account } from "../api.ts";
import { Amount, BankBadge, Card, ErrorBox, PageHeader, Sheet, Sparkline, Spinner } from "../components/ui.tsx";
import { money, moneyIn, timeAgo, dateFr } from "../format.ts";
import { groupByOwner, OWNER_ORDER, ownerLabel } from "../../lib/labels.ts";
import { CardOutstandingSection, useOutstandingTotal } from "../components/CardOutstanding.tsx";
import { Welcome } from "../components/Welcome.tsx";
import { useSeasonGreeting } from "../theme.ts";
import { FunCard } from "../components/FunCard.tsx";
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

  const groups = groupByOwner(visible, OWNER_ORDER);

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
  const [layout, saveLayout] = useHomeLayout();
  const [customizing, setCustomizing] = useState(false);
  const delta = s ? s.spentThisMonth - s.spentPrevMonthSameDay : 0;

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

      <div className="mb-4 empty:hidden">
        <Welcome />
      </div>
      {accounts.error && <ErrorBox error={accounts.error} />}
      {accounts.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          {layout.order
            .filter((id) => !layout.hidden.includes(id))
            .map((id) => (
              <Fragment key={id}>
                {id === "disponible" ? (
                  <>
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
                  <div className={clsx("tnum mt-1 text-xs", trend3m >= 0 ? "text-pos" : "text-neg")}>
                    {t("{montant} sur 3 mois", { montant: (trend3m >= 0 ? "+" : "") + money(trend3m, true) })}
                  </div>
                )}
              </>
            )}
          </Card>
                  </>
                ) : id === "depense" ? (
                  <>
          {s && (
            <Link to="/mois" className="block">
              <Card className="press p-5">
                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted">{t("Dépensé ce mois-ci")}</div>
                  <ChevronRight size={18} className="text-muted" />
                </div>
                <div className="tnum mt-1 text-2xl font-bold">{money(s.spentThisMonth)}</div>
                <div className={clsx("mt-0.5 text-sm", delta > 0 ? "text-neg" : "text-pos")}>
                  {t("{montant} par rapport au mois dernier à la même date", { montant: (delta > 0 ? "+" : "") + money(delta) })}
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
          )}
                  </>
                ) : id === "aclasser" ? (
                  <>
          {s && s.uncategorized > 0 && (
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
          )}
                  </>
                ) : id === "amusant" ? (
                  <FunCard />
                ) : id === "resume" ? (
                  <WeeklySummaryCard />
                ) : id === "enveloppes" ? (
                  <EnvelopesCard />
                ) : id === "objectifs" ? (
                  <GoalsCard />
                ) : id === "echeances" ? (
                  <UpcomingCard />
                ) : (
                  <>
          {groups.map((g) => (
            <section key={g.owner}>
              <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted">{ownerLabel(g.owner)}</h2>
              <Card className="divide-y divide-line">
                {g.list.map((a) => (
                  <AccountRow key={a.id} account={a} />
                ))}
              </Card>
            </section>
          ))}
          <CardOutstandingSection />
                  </>
                )}
              </Fragment>
            ))}
          <button type="button" onClick={() => setCustomizing(true)} className="press mx-auto flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium text-muted">
            <SlidersHorizontal size={14} /> {t("Personnaliser l'accueil")}
          </button>
          {customizing && <HomeCustomizer layout={layout} onChange={saveLayout} onClose={() => setCustomizing(false)} />}
        </div>
      )}
    </>
  );
}

function AccountRow({ account: a }: { account: Account }) {
  return (
    <Link to={`/operations?compte=${encodeURIComponent(a.id)}`} className="press flex items-center gap-3 px-4 py-3.5">
      <BankBadge bank={a.institution} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{a.display_name ?? a.name}</div>
        <div className="text-xs text-muted">
          {a.kind === "carte" ? t("Carte à débit différé") : (a.institution ?? "")}
          {/* Compte dans une autre devise que celle du foyer : son solde tel que la banque l'écrit. */}
          {a.balance_original != null && <span className="tnum"> · {moneyIn(a.balance_original, a.currency)}</span>}
        </div>
      </div>
      <Amount value={a.balance} colored={false} className={clsx("font-semibold", (a.balance ?? 0) < 0 && "text-neg")} />
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

/* ---------- Accueil personnalisable (mémorisé sur l'appareil) ---------- */

const HOME_CARDS = [
  { id: "disponible", label: t("Disponible sur les comptes") },
  { id: "depense", label: t("Dépensé ce mois-ci") },
  { id: "aclasser", label: t("Opérations à classer") },
  { id: "amusant", label: t("Le chiffre du moment") },
  { id: "resume", label: t("Résumé de la semaine") },
  { id: "enveloppes", label: t("Enveloppes du mois") },
  { id: "objectifs", label: t("Objectifs d'épargne") },
  { id: "echeances", label: t("Prochaines échéances") },
  { id: "comptes", label: t("Comptes") },
] as const;
type HomeCardId = (typeof HOME_CARDS)[number]["id"];
type HomeLayout = { order: HomeCardId[]; hidden: HomeCardId[] };
const LAYOUT_KEY = "pecule.home.layout";

function useHomeLayout(): [HomeLayout, (l: HomeLayout) => void] {
  const [layout, setLayout] = useState<HomeLayout>(() => {
    const all = HOME_CARDS.map((c) => c.id);
    try {
      const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as HomeLayout | null;
      if (saved) {
        // Nouvelles cartes ajoutées depuis : à la fin, visibles.
        const order = [...saved.order.filter((id) => all.includes(id)), ...all.filter((id) => !saved.order.includes(id))];
        return { order, hidden: saved.hidden.filter((id) => all.includes(id)) };
      }
    } catch {
      /* réglage illisible : ordre par défaut */
    }
    return { order: all, hidden: [] };
  });
  return [
    layout,
    (l) => {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(l));
      setLayout(l);
    },
  ];
}

function HomeCustomizer({ layout, onChange, onClose }: { layout: HomeLayout; onChange: (l: HomeLayout) => void; onClose: () => void }) {
  const move = (i: number, d: -1 | 1) => {
    const order = [...layout.order];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ ...layout, order });
  };
  const toggle = (id: HomeCardId) => onChange({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] });
  return (
    <Sheet open onClose={onClose} title={t("Personnaliser l'accueil")}>
      <Card className="divide-y divide-line">
        {layout.order.map((id, i) => (
          <div key={id} className="flex items-center gap-3 px-4 py-2.5">
            <input type="checkbox" checked={!layout.hidden.includes(id)} onChange={() => toggle(id)} aria-label={t("Afficher")} className="size-5 accent-[var(--color-accent)]" />
            <span className={clsx("flex-1 text-[15px]", layout.hidden.includes(id) && "text-muted line-through")}>{HOME_CARDS.find((c) => c.id === id)?.label}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("Monter")} className="press grid size-8 place-items-center rounded-lg text-muted disabled:opacity-30">
              <ArrowUp size={17} />
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === layout.order.length - 1} aria-label={t("Descendre")} className="press grid size-8 place-items-center rounded-lg text-muted disabled:opacity-30">
              <ArrowDown size={17} />
            </button>
          </div>
        ))}
      </Card>
      <button type="button" onClick={() => onChange({ order: HOME_CARDS.map((c) => c.id), hidden: [] })} className="mt-3 w-full py-2 text-sm text-muted">
        {t("Revenir à l'ordre d'origine")}
      </button>
    </Sheet>
  );
}
