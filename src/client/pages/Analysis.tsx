import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { AlertTriangle, MousePointerClick, Table2 } from "lucide-react";
import { Card, ErrorBox, PageHeader, Spinner, Tabs } from "../components/ui.tsx";
import { Stat, StatGrid } from "../components/blocks.tsx";
import { openDrill } from "../components/DrillDrawer.tsx";
import { kMoney, money, monthShort, periodLabel } from "../format.ts";
import { cn } from "../cn.ts";
import { AxisTick, SELECTED_BAND } from "../components/StackedBars.tsx";
import { useMedia } from "../useMedia.ts";
import { usePeriod } from "../shell.ts";
import { useFlows, useMerchants, useMonthDebits, useNatureTrend, useYearDebits, type Flows } from "../api-analysis.ts";
import { addMonths, isYearPeriod, monthsOfPeriod, trendEnd } from "../../lib/periods.ts";
import { NATURE_LABELS, SPEND_NATURES } from "../../lib/nature.ts";
import { Month } from "./Month.tsx";
import { CompareView } from "./Compare.tsx";
import { natureColor } from "../charts.ts";
import { BrandLogo } from "../components/Logo.tsx";
import { Breakdown } from "../components/Breakdown.tsx";
import { TimelineTab } from "../components/MonthTimeline.tsx";
import { CalendarTab } from "../components/MonthCalendar.tsx";
import { useMonth } from "../api.ts";
import { monthTotals } from "../../lib/month.ts";
import { locale, t, td, tk } from "../../lib/i18n.ts";

/*
 * Analyse (ordinateur) : vue d'ensemble du mois, flux (d'où vient l'argent, par quel moyen il part,
 * vers quels postes), frise (les paiements au fil des jours), prélèvements (calendrier, attendus, manqués), marchands. Chaque marque est
 * cliquable et ouvre les opérations correspondantes. Sur l'iPhone, l'écran « Mois » reste tel quel.
 */

type Tab = "synthese" | "calendrier" | "repartition" | "flux" | "frise" | "marchands" | "comparer";
const TABS: { value: Tab; label: string }[] = [
  { value: "synthese", label: t("Vue d'ensemble") },
  { value: "calendrier", label: t("Calendrier") },
  { value: "repartition", label: t("Répartition") },
  { value: "flux", label: t("Flux") },
  { value: "frise", label: t("Frise") },
  { value: "marchands", label: t("Marchands") },
  { value: "comparer", label: t("Comparer") },
];

const k = (n: number) => (Math.abs(n) >= 1000 ? kMoney(n, 1) : money(n, true));
const thisMonth = () => new Date().toLocaleDateString("sv-SE").slice(0, 7);

export function Analysis() {
  const desktop = useMedia("(min-width: 768px)");
  const [params, setParams] = useSearchParams();
  // La période : un mois, ou une année entière (chaque onglet se lit alors mois par mois).
  const [period] = usePeriod();
  // « prelevements » : ancien onglet, rangé dans le calendrier (un lien gardé y mène encore).
  const asked = params.get("onglet");
  const tab: Tab = asked === "prelevements" ? "calendrier" : (asked as Tab) || "synthese";
  if (!desktop) return <Month />;
  const setTab = (v: Tab) => {
    const next = new URLSearchParams(params);
    if (v === "synthese") next.delete("onglet");
    else next.set("onglet", v);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader title={t("Analyse")} subtitle={isYearPeriod(period) ? t("Année {annee}", { annee: period }) : periodLabel(period)} />
      <Tabs value={tab} options={TABS} onChange={setTab} />
      {tab === "synthese" && <Month bare />}
      {/* Un mois : la grille, puis ses prélèvements ; une année : les prélèvements mois par mois. */}
      {tab === "calendrier" &&
        (isYearPeriod(period) ? (
          <YearDebitsTab year={period} />
        ) : (
          <>
            <CalendarTab period={period} />
            <DebitsLists month={period} />
          </>
        ))}
      {tab === "repartition" && <BreakdownTab period={period} />}
      {tab === "flux" && <FlowsTab period={period} />}
      {tab === "frise" && <TimelineTab period={period} />}
      {tab === "marchands" && <MerchantsTab period={period} />}
      {tab === "comparer" && <CompareView />}
    </>
  );
}

/* ---------- Répartition ---------- */

/** Deux anneaux côte à côte : d'où vient l'argent de la période (par catégorie), où il part (par poste). */
function BreakdownTab({ period }: { period: string }) {
  const year = isYearPeriod(period);
  const { data, isLoading, error, isPlaceholderData } = useMonth(period);
  const tot = data ? monthTotals(data.categories) : null;
  return (
    <>
      {error && <ErrorBox error={error} />}
      {isLoading || !data || !tot ? (
        <Spinner />
      ) : (
        <div className={cn("transition-opacity duration-200", isPlaceholderData && "opacity-50")}>
          <StatGrid>
            <Stat label={t("Revenus")} value={money(tot.revenus, true)} hint={year ? t("entrées de l'année, hors mouvements internes") : t("entrées du mois, hors mouvements internes")} />
            <Stat label={t("Dépenses")} value={money(tot.depenses, true)} hint={t("nettes des remboursements")} />
            <Stat label={t("Épargne")} value={money(tot.epargne, true)} hint={t("versements vers l'épargne")} />
            <Stat label={year ? t("Solde de l'année") : t("Solde du mois")} value={money(tot.revenus - tot.depenses, true)} tone={tot.revenus - tot.depenses >= 0 ? "pos" : "neg"} hint={t("revenus − dépenses")} />
          </StatGrid>
          <div className="grid grid-cols-12 items-start gap-4">
            {(["depenses", "revenus"] as const).map((kind) => (
              <Card key={kind} className="col-span-12 p-5 xl:col-span-6">
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="text-[14px] font-semibold">{kind === "depenses" ? t("Dépenses par poste") : t("Revenus par catégorie")}</h2>
                  <span className="text-[12px] text-muted">{kind === "depenses" ? t("Un poste se déplie sur ses catégories · clic sur l'anneau : les opérations") : t("Clic : les opérations")}</span>
                </div>
                <Breakdown kind={kind} data={data} />
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ---------- Flux ---------- */

type SNode = { name: string; kind: "income" | "hub" | "nature" | "poste" | "saving" | "balance" | "deficit"; nature?: string; poste?: string; category?: string | null; value?: number };

/** Revenus → mois → natures (+ épargne, reste) → postes. Le déficit éventuel entre à gauche. Les noms des revenus et des postes restent ceux des données (clés) : `nodeLabel` les traduit à l'affichage. */
function buildSankey(f: Flows, year: boolean) {
  const nodes: SNode[] = [];
  const links: { source: number; target: number; value: number }[] = [];
  const add = (n: SNode) => nodes.push(n) - 1;
  const incomes = [...f.incomes];
  const top = incomes.slice(0, 5);
  const rest = incomes.slice(5).reduce((s, i) => s + i.total, 0);
  const hubIdx = () => nodes.findIndex((n) => n.kind === "hub");
  const leftNodes: [SNode, number][] = top.map((i) => [{ name: i.id ? i.name : tk("Revenus non classés"), kind: "income", category: i.id }, i.total]);
  if (rest > 0) leftNodes.push([{ name: tk("Autres revenus"), kind: "income" }, rest]);
  if (f.totals.refunds > 0) leftNodes.push([{ name: tk("Remboursements"), kind: "income" }, f.totals.refunds]);
  if (f.totals.balance < 0) leftNodes.push([{ name: t("Pris sur le solde ou l'épargne"), kind: "deficit" }, -f.totals.balance]);
  const leftIdx = leftNodes.map(([n, v]) => [add({ ...n, value: v }), v] as const);
  add({ name: year ? t("Cette année") : t("Ce mois-ci"), kind: "hub" });
  for (const [i, v] of leftIdx) links.push({ source: i, target: hubIdx(), value: v });
  const byNature = new Map<string, number>();
  for (const x of f.flows) if (SPEND_NATURES.includes(x.nature as (typeof SPEND_NATURES)[number])) byNature.set(x.nature, (byNature.get(x.nature) ?? 0) + x.total);
  const natureIdx = new Map<string, number>();
  for (const n of SPEND_NATURES) {
    const v = byNature.get(n);
    if (!v) continue;
    natureIdx.set(n, add({ name: NATURE_LABELS[n], kind: "nature", nature: n, value: v }));
    links.push({ source: hubIdx(), target: natureIdx.get(n)!, value: v });
  }
  if (f.totals.savings > 0) links.push({ source: hubIdx(), target: add({ name: t("Épargne"), kind: "saving", value: f.totals.savings }), value: f.totals.savings });
  if (f.totals.balance > 0) links.push({ source: hubIdx(), target: add({ name: year ? t("Reste de l'année") : t("Reste du mois"), kind: "balance", value: f.totals.balance }), value: f.totals.balance });
  // Postes : les 9 plus gros, le reste regroupé.
  const posteTotals = new Map<string, number>();
  for (const x of f.flows) if (natureIdx.has(x.nature)) posteTotals.set(x.poste, (posteTotals.get(x.poste) ?? 0) + x.total);
  const ranked = [...posteTotals.entries()].sort((a, b) => b[1] - a[1]);
  const kept = new Set(ranked.slice(0, 9).map(([p]) => p));
  const posteIdx = new Map<string, number>();
  const posteOf = (p: string) => (kept.has(p) ? p : tk("Autres postes"));
  for (const [p] of ranked) {
    const key = posteOf(p);
    if (!posteIdx.has(key)) posteIdx.set(key, add({ name: key, kind: "poste", poste: kept.has(p) ? p : undefined }));
  }
  const agg = new Map<string, number>();
  for (const x of f.flows) {
    if (!natureIdx.has(x.nature)) continue;
    const key = `${x.nature}|${posteOf(x.poste)}`;
    agg.set(key, (agg.get(key) ?? 0) + x.total);
  }
  for (const [key, v] of agg) {
    const [n, p] = key.split("|");
    links.push({ source: natureIdx.get(n)!, target: posteIdx.get(p)!, value: v });
  }
  for (const [p, i] of posteIdx) nodes[i].value = [...agg.entries()].filter(([key]) => key.endsWith(`|${p}`)).reduce((s, [, v]) => s + v, 0);
  return { nodes, links };
}

/** Nom affiché d'un bloc : revenus et postes portent le nom de la donnée, traduit ici ; les autres sont déjà écrits dans la langue. */
const nodeLabel = (n: SNode) => (n.kind === "income" || n.kind === "poste" ? td(n.name) : n.name);

const monthTick = (m: string) => monthShort(m);

function FlowsTab({ period }: { period: string }) {
  const year = isYearPeriod(period);
  const now = thisMonth();
  const flows = useFlows(period);
  // Sorties par nature : les douze mois de l'année, ou douze mois glissants qui suivent le mois choisi quand il en sort.
  const [end, setEnd] = useState(() => (year ? now : trendEnd(now, period, now)));
  const nextEnd = year ? end : trendEnd(end, period, now);
  if (nextEnd !== end) setEnd(nextEnd);
  const span = year ? monthsOfPeriod(period) : [addMonths(nextEnd, -11), nextEnd];
  const trend = useNatureTrend(span[0], span[span.length - 1]);
  const [, setPeriod] = usePeriod();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [table, setTable] = useState(false);
  const data = useMemo(() => (flows.data ? buildSankey(flows.data, year) : null), [flows.data, year]);
  const f = flows.data;
  const sub = periodLabel(period);
  const drillNode = (n: SNode) => {
    if (n.kind === "nature") openDrill(NATURE_LABELS[n.nature as keyof typeof NATURE_LABELS], { month: period, nature: n.nature, debits: true }, sub);
    else if (n.kind === "poste" && n.poste) openDrill(td(n.poste), { month: period, poste: n.poste, debits: true }, sub);
    else if (n.kind === "income" && n.category) openDrill(td(n.name), { month: period, category: n.category }, sub);
  };
  return (
    <>
      {flows.error && <ErrorBox error={flows.error} />}
      {f && (
        <StatGrid>
          <Stat label={t("Entrées")} value={money(f.totals.income, true)} hint={f.totals.refunds ? t("+ {montant} de remboursements", { montant: money(f.totals.refunds, true) }) : year ? t("revenus de l'année") : t("revenus du mois")} />
          <Stat label={t("Sorties")} value={money(f.totals.grossSpend, true)} hint={t("dépenses nettes {montant}", { montant: money(f.totals.netSpend, true) })} />
          <Stat label={t("Épargne")} value={money(f.totals.savings, true)} hint={t("versements vers l'épargne")} />
          <Stat label={year ? t("Reste de l'année") : t("Reste du mois")} value={money(f.totals.balance, true)} tone={f.totals.balance >= 0 ? "pos" : "neg"} hint={t("entrées − sorties − épargne")} />
        </StatGrid>
      )}
      <Card className="mb-5 p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold">{t("Où part l'argent")}</h2>
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <MousePointerClick size={13} className="shrink-0 text-accent" />
            {t("Les blocs et les flux marqués d'un › s'ouvrent au clic · mouvements internes exclus")}
          </span>
        </div>
        {!data ? (
          <Spinner />
        ) : data.links.length < 2 ? (
          <div className="py-16 text-center text-sm text-muted">{year ? t("Aucun mouvement cette année-là.") : t("Pas encore de mouvements ce mois-ci.")}</div>
        ) : (
          <div className="h-[460px]">
            <ResponsiveContainer>
              <Sankey
                data={data}
                sort={false}
                nodePadding={18}
                nodeWidth={10}
                iterations={64}
                margin={{ top: 12, right: 190, bottom: 12, left: 190 }}
                link={(p) => <FlowLink {...(p as unknown as FlowLinkProps)} month={period} />}
                node={(p) => <FlowNode x={p.x} y={p.y} width={p.width} height={p.height} payload={p.payload as unknown as SNode} onClick={drillNode} />}
              >
                <Tooltip content={<FlowTooltip />} />
              </Sankey>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold">{year ? t("Sorties par nature, {annee}", { annee: period }) : t("Sorties par nature, 12 mois")}</h2>
          <div className="flex flex-wrap items-center gap-1.5">
            {SPEND_NATURES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setHidden((h) => (h.has(n) ? new Set([...h].filter((x) => x !== n)) : new Set([...h, n])))}
                className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]", hidden.has(n) ? "text-muted line-through opacity-60" : "text-ink hover:bg-bg")}
                aria-pressed={!hidden.has(n)}
              >
                <span className="size-2.5 rounded-sm" style={{ background: natureColor(n) }} />
                {NATURE_LABELS[n]}
              </button>
            ))}
            <button type="button" onClick={() => setTable((v) => !v)} className="ml-1 flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-bg" aria-pressed={table}>
              <Table2 size={13} /> {table ? t("Graphique") : t("Tableau")}
            </button>
          </div>
        </div>
        {!trend.data ? (
          <Spinner />
        ) : table ? (
          <NatureTable months={trend.data.months} />
        ) : (
          <div className="h-[300px]">
            <ResponsiveContainer>
              <BarChart data={trend.data.months} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="var(--color-line)" />
                <XAxis dataKey="month" tick={<AxisTick selected={year ? null : period} format={monthTick} />} tickFormatter={monthTick} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => k(v)} tickLine={false} axisLine={false} width={56} />
                <Tooltip content={<NatureTooltip />} cursor={{ fill: "var(--color-bg)" }} />
                {/* Le mois de la période (celui du diagramme au-dessus) est marqué : un clic sur un segment le change. */}
                {!year && trend.data.months.some((r) => r.month === period) && <ReferenceArea x1={period} x2={period} {...SELECTED_BAND} />}
                {SPEND_NATURES.filter((n) => !hidden.has(n)).map((n, i, arr) => (
                  <Bar
                    key={n}
                    dataKey={n}
                    stackId="a"
                    fill={natureColor(n)}
                    stroke="var(--color-card)"
                    strokeWidth={1}
                    radius={i === arr.length - 1 ? [4, 4, 0, 0] : 0}
                    cursor="pointer"
                    onClick={(d: { payload?: { month?: string } }) => {
                      const m = d.payload?.month;
                      if (!m) return;
                      setPeriod(m);
                      openDrill(NATURE_LABELS[n], { month: m, nature: n, debits: true }, periodLabel(m));
                    }}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-[12px] text-muted">{t("Clic sur un segment : le mois devient la période et ses opérations s'affichent.")}</p>
      </Card>
    </>
  );
}

/** Ce qui s'ouvre au clic dans le diagramme : une nature, un poste nommé, un revenu classé ; un flux d'une nature vers un poste nommé. */
const nodeClickable = (n: SNode) => n.kind === "nature" || (n.kind === "poste" && !!n.poste) || (n.kind === "income" && !!n.category);
const linkClickable = (source: SNode, target: SNode) => source.kind === "nature" && target.kind === "poste" && !!target.poste;

/**
 * Bloc du diagramme. Un bloc cliquable se reconnaît sans le survoler : son nom finit par un chevron de la couleur
 * d'accent, et un halo bat deux fois à l'arrivée du diagramme. Au survol (ou au clavier), le halo reste et le nom se souligne.
 */
function FlowNode({ x, y, width, height, payload, onClick }: { x: number; y: number; width: number; height: number; payload: SNode & { value?: number }; onClick: (n: SNode) => void }) {
  const [hover, setHover] = useState(false);
  const left = payload.kind === "income" || payload.kind === "deficit";
  const right = payload.kind === "poste" || payload.kind === "saving" || payload.kind === "balance";
  const fill =
    payload.kind === "nature"
      ? natureColor(payload.nature!)
      : payload.kind === "hub"
        ? "var(--color-ink)"
        : payload.kind === "saving"
          ? "var(--series-6)"
          : payload.kind === "deficit"
            ? "var(--color-neg)"
            : "var(--color-muted)";
  const clickable = nodeClickable(payload);
  const active = clickable && hover;
  // Un nom long déborderait de la marge : il est coupé ici, et entier dans l'info-bulle.
  const name = nodeLabel(payload);
  const h = Math.max(height, 2);
  const tx = left ? x - 8 : x + width + 8;
  return (
    <g
      onClick={() => clickable && onClick(payload)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      onKeyDown={(e) => {
        if (clickable && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick(payload);
        }
      }}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? t("{nom} : voir les opérations", { nom: nodeLabel(payload) }) : undefined}
      style={{ cursor: clickable ? "pointer" : "default", outline: "none" }}
    >
      {clickable && <rect className="flow-hint" x={x} y={y} width={width} height={h} rx={2} fill={fill} style={{ pointerEvents: "none" }} />}
      {active && <rect x={x - 4} y={y - 4} width={width + 8} height={h + 8} rx={5} fill={fill} fillOpacity={0.28} />}
      <rect x={x} y={y} width={width} height={h} rx={2} fill={fill} />
      {payload.kind !== "hub" && (
        <text x={tx} y={y + height / 2} dy="0.35em" textAnchor={left ? "end" : "start"} fontSize={12} fill="var(--color-ink)">
          <tspan fontWeight={600}>{k(payload.value ?? 0)}</tspan>
          <tspan> </tspan>
          <tspan fill={active ? "var(--color-ink)" : "var(--color-muted)"} textDecoration={active ? "underline" : undefined}>
            {name.length > 24 ? `${name.slice(0, 23).trimEnd()}…` : name}
          </tspan>
          {clickable && (
            <tspan fill="var(--color-accent)" fontWeight={700} dx={3}>
              ›
            </tspan>
          )}
        </text>
      )}
      {payload.kind === "hub" && !right && (
        <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fill="var(--color-muted)">
          {nodeLabel(payload)}
        </text>
      )}
    </g>
  );
}

type FlowLinkProps = {
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
  sourceControlX: number;
  targetControlX: number;
  linkWidth: number;
  payload: { source: SNode; target: SNode; value: number };
};

function FlowLink(props: FlowLinkProps & { month: string }) {
  return <FlowLinkPath {...props} />;
}

function FlowLinkPath(props: {
  sourceX: number;
  targetX: number;
  sourceY: number;
  targetY: number;
  sourceControlX: number;
  targetControlX: number;
  linkWidth: number;
  payload: { source: SNode; target: SNode; value: number };
  month: string;
}) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload, month } = props;
  const [hover, setHover] = useState(false);
  const nature = payload.source.kind === "nature" ? payload.source.nature : payload.target.kind === "nature" ? payload.target.nature : undefined;
  const color = nature ? natureColor(nature) : payload.target.kind === "saving" ? "var(--series-6)" : "var(--color-muted)";
  const clickable = linkClickable(payload.source, payload.target);
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(linkWidth, 1)}
      // Un flux cliquable s'éclaire franchement au survol ; les autres à peine (ils ne mènent nulle part).
      strokeOpacity={hover ? (clickable ? 0.62 : nature ? 0.36 : 0.24) : nature ? 0.3 : 0.18}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() =>
        clickable &&
        openDrill(`${NATURE_LABELS[nature as keyof typeof NATURE_LABELS]} · ${td(payload.target.poste)}`, { month, nature, poste: payload.target.poste, debits: true }, periodLabel(month))
      }
      style={{ cursor: clickable ? "pointer" : "default", transition: "stroke-opacity 120ms" }}
    />
  );
}

function FlowTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { source?: SNode; target?: SNode; value?: number; name?: string; payload?: SNode };
  const label = p.source && p.target ? `${nodeLabel(p.source)} → ${nodeLabel(p.target)}` : p.payload ? nodeLabel(p.payload) : (p.name ?? "");
  const clickable = p.source && p.target ? linkClickable(p.source, p.target) : p.payload ? nodeClickable(p.payload) : false;
  return (
    <div className="chart-tip">
      <div className="text-[14px] font-semibold tnum">{money(Number(payload[0].value ?? p.value ?? 0))}</div>
      <div className="text-muted">{label}</div>
      {clickable && (
        <div className="mt-1 flex items-center gap-1 border-t border-line pt-1 font-medium text-accent">
          <MousePointerClick size={12} /> {t("Clic : voir les opérations")}
        </div>
      )}
    </div>
  );
}

function NatureTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
  return (
    <div className="min-w-48 chart-tip">
      <div className="mb-1 font-medium capitalize text-muted">{new Date(`${label}-15T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" })}</div>
      {[...payload].reverse().map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded" style={{ background: p.color }} />
            {NATURE_LABELS[p.dataKey as keyof typeof NATURE_LABELS]}
          </span>
          <span className="tnum font-semibold">{money(Number(p.value), true)}</span>
        </div>
      ))}
      <div className="mt-1 flex justify-between border-t border-line pt-1">
        <span className="text-muted">{t("Total")}</span>
        <span className="tnum font-semibold">{money(total, true)}</span>
      </div>
    </div>
  );
}

function NatureTable({ months }: { months: Record<string, number | string>[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-muted">
            <th className="py-1.5 text-left font-medium">{t("Mois")}</th>
            {SPEND_NATURES.map((n) => (
              <th key={n} className="py-1.5 text-right font-medium">
                {NATURE_LABELS[n]}
              </th>
            ))}
            <th className="py-1.5 text-right font-medium">{t("Total")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {months.map((m) => (
            <tr key={String(m.month)}>
              <td className="py-1.5 capitalize">{new Date(`${m.month}-15T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" })}</td>
              {SPEND_NATURES.map((n) => (
                <td key={n} className="tnum py-1.5 text-right">
                  {m[n] ? money(Number(m[n]), true) : "—"}
                </td>
              ))}
              <td className="tnum py-1.5 text-right font-semibold">{money(SPEND_NATURES.reduce((s, n) => s + Number(m[n] ?? 0), 0), true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Prélèvements ---------- */

/**
 * Prélèvements du mois, sous le calendrier : ce qui est encore attendu (ou, pour un mois passé, ce qui a manqué)
 * et ce qui est passé. La grille au-dessus les situe dans le mois ; ici, la liste se lit ligne à ligne.
 */
function DebitsLists({ month }: { month: string }) {
  const d = useMonthDebits(month);
  const data = d.data;
  const total = (data?.debits ?? []).reduce((s, x) => s + x.amount, 0);
  const pending = data ? (data.expected.length ? data.expected : data.missed) : [];
  return (
    <>
      {d.error && <ErrorBox error={d.error} />}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="font-semibold">{t("Prélèvements passés ce mois-ci")}</h2>
            <span className="tnum text-[14px] font-semibold">{money(total)}</span>
          </div>
          {!data ? (
            <Spinner />
          ) : (
            <div className="divide-y divide-line">
              {data.debits.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => openDrill(t("Prélèvements du {date}", { date: new Date(`${x.date.slice(0, 10)}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "long" }) }), { month, nature: "prelevement", debits: true, day: x.date.slice(0, 10) })}
                  className="flex w-full items-center gap-3 py-1.5 text-left text-[13.5px] hover:bg-bg/70"
                >
                  <span className="tnum w-7 shrink-0 text-muted">{x.day}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {x.name}
                    {x.category && <span className="text-muted"> · {td(x.category)}</span>}
                  </span>
                  <span className="tnum shrink-0 font-medium">{money(x.amount)}</span>
                </button>
              ))}
              {!data.debits.length && <div className="py-4 text-center text-[13px] text-muted">{t("Aucun prélèvement.")}</div>}
            </div>
          )}
        </Card>
        {pending.length > 0 && (
          <Card className="p-5">
            <h2 className="mb-2 font-semibold">{data!.missed.length ? t("Prélèvements habituels absents ce mois-là") : t("Prélèvements attendus")}</h2>
            <div className="divide-y divide-line">
              {pending.map((x, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-[13.5px]">
                  <span className="min-w-0 truncate">
                    {"late" in x && (x as { late: boolean }).late ? <AlertTriangle size={12} className="mr-1 inline text-warn" /> : null}
                    {x.name}
                    <span className="text-muted"> · {t("vers le {jour}", { jour: x.day })}</span>
                  </span>
                  <span className="tnum shrink-0 font-medium">{money(x.amount)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

/**
 * Prélèvements d'une année : une ligne par créancier, une colonne par mois. On y lit d'un coup ce qui passe chaque
 * mois, ce qui a changé de montant et ce qui a manqué ; l'intensité d'une case suit son montant dans sa ligne.
 */
function YearDebitsTab({ year }: { year: string }) {
  const d = useYearDebits(year);
  const data = d.data && "series" in d.data ? d.data : null;
  const months = monthsOfPeriod(year);
  const total = data?.totals.reduce((s, v) => s + v, 0) ?? 0;
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{t("Prélèvements de {annee}, mois par mois", { annee: year })}</h2>
        <span className="tnum text-[13px] font-semibold">{money(total)}</span>
      </div>
      {d.error && <ErrorBox error={d.error} />}
      {!data ? (
        <Spinner />
      ) : !data.series.length ? (
        <div className="py-10 text-center text-sm text-muted">{t("Aucun prélèvement.")}</div>
      ) : (
        <div className={cn("overflow-x-auto transition-opacity duration-200", d.isPlaceholderData && "opacity-50")}>
          <table className="w-full min-w-[980px] border-separate border-spacing-y-0.5 text-[12.5px]">
            <thead>
              <tr className="text-muted">
                <th className="py-1.5 text-left font-medium">{t("Créancier")}</th>
                {months.map((m) => (
                  <th key={m} className="w-[62px] py-1.5 text-right font-medium capitalize">
                    {monthShort(m)}
                  </th>
                ))}
                <th className="w-[84px] py-1.5 text-right font-medium">{t("Total")}</th>
              </tr>
            </thead>
            <tbody>
              {data.series.map((x) => {
                const top = Math.max(1, ...x.byMonth);
                return (
                  <tr key={x.name}>
                    <td className="max-w-0 truncate py-1 pr-3" style={{ width: "24%" }} title={x.name}>
                      <span className="font-medium">{x.name}</span>
                      {x.category && <span className="text-muted"> · {td(x.category)}</span>}
                    </td>
                    {x.byMonth.map((v, i) => (
                      <td key={i} className="p-0 text-right">
                        {v > 0 ? (
                          <button
                            type="button"
                            onClick={() => openDrill(x.name, { month: months[i], nature: "prelevement", debits: true }, periodLabel(months[i]))}
                            className="tnum w-full rounded px-1.5 py-1 text-right hover:ring-2 hover:ring-accent"
                            style={{ background: `color-mix(in oklab, var(--series-2) ${Math.round(10 + (v / top) * 26)}%, var(--color-card))` }}
                            title={`${x.name} · ${periodLabel(months[i])} · ${money(v)}`}
                          >
                            {k(v)}
                          </button>
                        ) : (
                          <span className="block px-1.5 py-1 text-muted/50">·</span>
                        )}
                      </td>
                    ))}
                    <td className="tnum py-1 pl-2 text-right font-semibold">{money(x.total, true)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="text-muted">
                <td className="border-t border-line py-1.5 font-medium">{t("Total")}</td>
                {data.totals.map((v, i) => (
                  <td key={i} className="tnum border-t border-line px-1.5 py-1.5 text-right font-medium text-ink">
                    {v > 0 ? k(v) : "·"}
                  </td>
                ))}
                <td className="tnum border-t border-line py-1.5 pl-2 text-right font-semibold text-ink">{money(total, true)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 text-[12px] text-muted">{t("Une case vide : rien n'est passé ce mois-là. Clic sur un montant : les prélèvements du mois.")}</p>
        </div>
      )}
    </Card>
  );
}

/* ---------- Marchands ---------- */

function MerchantsTab({ period }: { period: string }) {
  const year = isYearPeriod(period);
  const m = useMerchants(period);
  const list = (m.data?.merchants ?? []).slice(0, 25);
  const max = Math.max(1, ...list.map((x) => Math.max(x.total, x.previous)));
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">{t("Achats carte par marchand")}</h2>
        <span className="flex items-center gap-3 text-[12px] text-muted">
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: natureColor("carte") }} /> {year ? period : t("ce mois-ci")}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-0.5 bg-ink" /> {year ? t("année précédente") : t("mois précédent")}
          </span>
        </span>
      </div>
      {m.error && <ErrorBox error={m.error} />}
      {!m.data ? (
        <Spinner />
      ) : !list.length ? (
        <div className="py-10 text-center text-sm text-muted">{year ? t("Aucun achat carte cette année-là.") : t("Aucun achat carte ce mois-ci.")}</div>
      ) : (
        <div className="space-y-1">
          {list.map((x) => {
            const delta = x.total - x.previous;
            return (
              <button
                key={x.name}
                type="button"
                onClick={() => openDrill(x.name, { month: period, nature: "carte", merchant: x.name, debits: true }, periodLabel(period))}
                className="grid w-full grid-cols-[230px_minmax(0,1fr)_90px_80px] items-center gap-3 rounded-md px-2 py-1 text-left text-[13px] hover:bg-bg"
              >
                <span className="flex min-w-0 items-center gap-2" title={x.name}>
                  <BrandLogo texts={[x.name]} size="sm" tone="neutral" />
                  <span className="truncate font-medium">{x.name}</span>
                  <span className="shrink-0 text-[11px] text-muted">×{x.count}</span>
                </span>
                <span className="relative h-4">
                  <span className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${(x.total / max) * 100}%`, background: natureColor("carte") }} />
                  {x.previous > 0 && <span className="absolute inset-y-[-2px] w-0.5 bg-ink" style={{ left: `${(x.previous / max) * 100}%` }} title={year ? t("Année précédente : {montant}", { montant: money(x.previous) }) : t("Mois précédent : {montant}", { montant: money(x.previous) })} />}
                </span>
                <span className="tnum text-right font-semibold">{money(x.total)}</span>
                <span className={cn("tnum text-right text-[12px]", delta > 0 ? "text-neg" : delta < 0 ? "text-pos" : "text-muted")}>
                  {x.previous ? `${delta > 0 ? "+" : ""}${money(delta, true)}` : t("nouveau")}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
