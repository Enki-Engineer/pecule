import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, ReferenceArea, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { AlertTriangle, Table2 } from "lucide-react";
import { Card, ErrorBox, PageHeader, Spinner, Tabs } from "../components/ui.tsx";
import { Stat, StatGrid } from "../components/blocks.tsx";
import { openDrill } from "../components/DrillDrawer.tsx";
import { kMoney, money } from "../format.ts";
import { cn } from "../cn.ts";
import { AxisTick, SELECTED_BAND } from "../components/StackedBars.tsx";
import { useMedia } from "../useMedia.ts";
import { usePeriod } from "../shell.ts";
import { useFlows, useMerchants, useMonthDebits, useNatureTrend, type Flows } from "../api-analysis.ts";
import { NATURE_LABELS, SPEND_NATURES } from "../../lib/nature.ts";
import { Month } from "./Month.tsx";
import { CompareView } from "./Compare.tsx";
import { natureColor } from "../charts.ts";
import { BrandLogo } from "../components/Logo.tsx";
import { Breakdown } from "../components/Breakdown.tsx";
import { useMonth } from "../api.ts";
import { monthTotals } from "../../lib/month.ts";
import { locale, t, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Analyse (ordinateur) : vue d'ensemble du mois, flux (d'où vient l'argent, par quel moyen il part,
 * vers quels postes), prélèvements (calendrier, attendus, manqués), marchands. Chaque marque est
 * cliquable et ouvre les opérations correspondantes. Sur l'iPhone, l'écran « Mois » reste tel quel.
 */

type Tab = "synthese" | "repartition" | "flux" | "prelevements" | "marchands" | "comparer";
const TABS: { value: Tab; label: string }[] = [
  { value: "synthese", label: t("Vue d'ensemble") },
  { value: "repartition", label: t("Répartition") },
  { value: "flux", label: t("Flux") },
  { value: "prelevements", label: t("Prélèvements") },
  { value: "marchands", label: t("Marchands") },
  { value: "comparer", label: t("Comparer") },
];

const monthLabel = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" });
const k = (n: number) => (Math.abs(n) >= 1000 ? kMoney(n, 1) : money(n, true));

export function Analysis() {
  const desktop = useMedia("(min-width: 768px)");
  const [params, setParams] = useSearchParams();
  const [month] = usePeriod();
  const tab = (params.get("onglet") as Tab) || "synthese";
  if (!desktop) return <Month />;
  const setTab = (v: Tab) => {
    const next = new URLSearchParams(params);
    if (v === "synthese") next.delete("onglet");
    else next.set("onglet", v);
    setParams(next, { replace: true });
  };
  return (
    <>
      <PageHeader title={t("Analyse")} subtitle={<span className="capitalize">{monthLabel(month)}</span>} />
      <Tabs value={tab} options={TABS} onChange={setTab} />
      {tab === "synthese" && <Month bare />}
      {tab === "repartition" && <BreakdownTab month={month} />}
      {tab === "flux" && <FlowsTab month={month} />}
      {tab === "prelevements" && <DebitsTab month={month} />}
      {tab === "marchands" && <MerchantsTab month={month} />}
      {tab === "comparer" && <CompareView />}
    </>
  );
}

/* ---------- Répartition ---------- */

/** Deux anneaux côte à côte : d'où vient l'argent du mois (par catégorie), où il part (par poste). */
function BreakdownTab({ month }: { month: string }) {
  const { data, isLoading, error, isPlaceholderData } = useMonth(month);
  const tot = data ? monthTotals(data.categories) : null;
  return (
    <>
      {error && <ErrorBox error={error} />}
      {isLoading || !data || !tot ? (
        <Spinner />
      ) : (
        <div className={cn("transition-opacity duration-200", isPlaceholderData && "opacity-50")}>
          <StatGrid>
            <Stat label={t("Revenus")} value={money(tot.revenus, true)} hint={t("entrées du mois, hors mouvements internes")} />
            <Stat label={t("Dépenses")} value={money(tot.depenses, true)} hint={t("nettes des remboursements")} />
            <Stat label={t("Épargne")} value={money(tot.epargne, true)} hint={t("versements vers l'épargne")} />
            <Stat label={t("Solde du mois")} value={money(tot.revenus - tot.depenses, true)} tone={tot.revenus - tot.depenses >= 0 ? "pos" : "neg"} hint={t("revenus − dépenses")} />
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
function buildSankey(f: Flows) {
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
  add({ name: t("Ce mois-ci"), kind: "hub" });
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
  if (f.totals.balance > 0) links.push({ source: hubIdx(), target: add({ name: t("Reste du mois"), kind: "balance", value: f.totals.balance }), value: f.totals.balance });
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

const monthTick = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale(), { month: "short" });

function FlowsTab({ month }: { month: string }) {
  const flows = useFlows(month);
  const trend = useNatureTrend();
  const [, setMonth] = usePeriod();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [table, setTable] = useState(false);
  const data = useMemo(() => (flows.data ? buildSankey(flows.data) : null), [flows.data]);
  const f = flows.data;
  const drillNode = (n: SNode) => {
    if (n.kind === "nature") openDrill(NATURE_LABELS[n.nature as keyof typeof NATURE_LABELS], { month, nature: n.nature, debits: true }, monthLabel(month));
    else if (n.kind === "poste" && n.poste) openDrill(td(n.poste), { month, poste: n.poste, debits: true }, monthLabel(month));
    else if (n.kind === "income" && n.category) openDrill(td(n.name), { month, category: n.category }, monthLabel(month));
  };
  return (
    <>
      {flows.error && <ErrorBox error={flows.error} />}
      {f && (
        <StatGrid>
          <Stat label={t("Entrées")} value={money(f.totals.income, true)} hint={f.totals.refunds ? t("+ {montant} de remboursements", { montant: money(f.totals.refunds, true) }) : t("revenus du mois")} />
          <Stat label={t("Sorties")} value={money(f.totals.grossSpend, true)} hint={t("dépenses nettes {montant}", { montant: money(f.totals.netSpend, true) })} />
          <Stat label={t("Épargne")} value={money(f.totals.savings, true)} hint={t("versements vers l'épargne")} />
          <Stat label={t("Reste du mois")} value={money(f.totals.balance, true)} tone={f.totals.balance >= 0 ? "pos" : "neg"} hint={t("entrées − sorties − épargne")} />
        </StatGrid>
      )}
      <Card className="mb-5 p-5">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold">{t("Où part l'argent")}</h2>
          <span className="text-[12px] text-muted">{t("Clique sur un bloc ou un flux pour voir les opérations · mouvements internes exclus")}</span>
        </div>
        {!data ? (
          <Spinner />
        ) : data.links.length < 2 ? (
          <div className="py-16 text-center text-sm text-muted">{t("Pas encore de mouvements ce mois-ci.")}</div>
        ) : (
          <div className="h-[460px]">
            <ResponsiveContainer>
              <Sankey
                data={data}
                sort={false}
                nodePadding={18}
                nodeWidth={10}
                iterations={64}
                margin={{ top: 12, right: 170, bottom: 12, left: 170 }}
                link={(p) => <FlowLink {...(p as unknown as FlowLinkProps)} month={month} />}
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
          <h2 className="text-[14px] font-semibold">{t("Sorties par nature, 12 mois")}</h2>
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
                <XAxis dataKey="month" tick={<AxisTick selected={month} format={monthTick} />} tickFormatter={monthTick} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v: number) => k(v)} tickLine={false} axisLine={false} width={56} />
                <Tooltip content={<NatureTooltip />} cursor={{ fill: "var(--color-bg)" }} />
                {/* Le mois de la période (celui du diagramme au-dessus) est marqué : un clic sur un segment le change. */}
                {trend.data.months.some((r) => r.month === month) && <ReferenceArea x1={month} x2={month} {...SELECTED_BAND} />}
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
                      setMonth(m);
                      openDrill(NATURE_LABELS[n], { month: m, nature: n, debits: true }, monthLabel(m));
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

function FlowNode({ x, y, width, height, payload, onClick }: { x: number; y: number; width: number; height: number; payload: SNode & { value?: number }; onClick: (n: SNode) => void }) {
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
  const clickable = payload.kind === "nature" || (payload.kind === "poste" && !!payload.poste) || (payload.kind === "income" && !!payload.category);
  const tx = left ? x - 8 : x + width + 8;
  return (
    <g onClick={() => clickable && onClick(payload)} style={{ cursor: clickable ? "pointer" : "default" }}>
      <rect x={x} y={y} width={width} height={Math.max(height, 2)} rx={2} fill={fill} />
      {payload.kind !== "hub" && (
        <text x={tx} y={y + height / 2} dy="0.35em" textAnchor={left ? "end" : "start"} fontSize={12} fill="var(--color-ink)">
          <tspan fontWeight={600}>{k(payload.value ?? 0)}</tspan>
          <tspan fill="var(--color-muted)"> {nodeLabel(payload)}</tspan>
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
  const clickable = payload.source.kind === "nature" && payload.target.kind === "poste" && !!payload.target.poste;
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeWidth={Math.max(linkWidth, 1)}
      strokeOpacity={hover ? 0.55 : nature ? 0.3 : 0.18}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() =>
        clickable &&
        openDrill(`${NATURE_LABELS[nature as keyof typeof NATURE_LABELS]} · ${td(payload.target.poste)}`, { month, nature, poste: payload.target.poste, debits: true }, monthLabel(month))
      }
      style={{ cursor: clickable ? "pointer" : "default", transition: "stroke-opacity 120ms" }}
    />
  );
}

function FlowTooltip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as { source?: SNode; target?: SNode; value?: number; name?: string; payload?: SNode };
  const label = p.source && p.target ? `${nodeLabel(p.source)} → ${nodeLabel(p.target)}` : p.payload ? nodeLabel(p.payload) : (p.name ?? "");
  return (
    <div className="rounded-md border border-line bg-card px-3 py-2 text-[12px] shadow-md">
      <div className="text-[14px] font-semibold tnum">{money(Number(payload[0].value ?? p.value ?? 0))}</div>
      <div className="text-muted">{label}</div>
    </div>
  );
}

function NatureTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0);
  return (
    <div className="min-w-48 rounded-md border border-line bg-card px-3 py-2 text-[12px] shadow-md">
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

function DebitsTab({ month }: { month: string }) {
  const d = useMonthDebits(month);
  const data = d.data;
  const days = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const count = new Date(y, m, 0).getDate();
    const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    const byDay = new Map<number, { total: number; n: number }>();
    for (const x of data?.debits ?? []) {
      const c = byDay.get(x.day) ?? { total: 0, n: 0 };
      byDay.set(x.day, { total: c.total + x.amount, n: c.n + 1 });
    }
    const max = Math.max(1, ...[...byDay.values()].map((v) => v.total));
    return { count, firstDow, byDay, max };
  }, [data, month]);
  const total = (data?.debits ?? []).reduce((s, x) => s + x.amount, 0);
  return (
    <>
      {d.error && <ErrorBox error={d.error} />}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[14px] font-semibold">{t("Calendrier des prélèvements")}</h2>
            <span className="tnum text-[13px] font-semibold">{money(total)}</span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-muted">
            {[t("lun"), t("mar"), t("mer"), t("jeu"), t("ven"), t("sam"), t("dim")].map((x) => (
              <div key={x}>{x}</div>
            ))}
            {Array.from({ length: days.firstDow }, (_, i) => (
              <div key={`e${i}`} />
            ))}
            {Array.from({ length: days.count }, (_, i) => {
              const day = i + 1;
              const v = days.byDay.get(day);
              const date = `${month}-${String(day).padStart(2, "0")}`;
              return (
                <button
                  key={day}
                  type="button"
                  disabled={!v}
                  onClick={() => openDrill(t("Prélèvements du {date}", { date: new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "long" }) }), { month, nature: "prelevement", debits: true, day: date })}
                  className={cn("flex h-14 flex-col items-start justify-between rounded-md p-1.5 text-left", v ? "cursor-pointer hover:ring-2 hover:ring-accent" : "bg-bg")}
                  style={v ? { background: `color-mix(in oklab, var(--series-2) ${Math.round(18 + (v.total / days.max) * 62)}%, var(--color-card))` } : undefined}
                  title={v ? tn("{n} prélèvement · {montant}", "{n} prélèvements · {montant}", v.n, { montant: money(v.total) }) : undefined}
                >
                  <span className={cn("text-[11px]", v && v.total / days.max > 0.5 ? "text-white" : "text-muted")}>{day}</span>
                  {v && <span className={cn("tnum text-[11px] font-semibold", v.total / days.max > 0.5 ? "text-white" : "text-ink")}>{k(v.total)}</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[12px] text-muted">{t("Intensité = montant prélevé ce jour-là. Clic : les opérations du jour.")}</p>
        </Card>

        <div className="space-y-5">
          {data && (data.expected.length > 0 || data.missed.length > 0) && (
            <Card className="p-5">
              <h2 className="mb-2 text-[14px] font-semibold">{data.missed.length ? t("Prélèvements habituels absents ce mois-là") : t("Prélèvements attendus")}</h2>
              <div className="divide-y divide-line">
                {(data.expected.length ? data.expected : data.missed).map((x, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
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
          <Card className="p-5">
            <h2 className="mb-2 text-[14px] font-semibold">{t("Passés ce mois-ci")}</h2>
            {!data ? (
              <Spinner />
            ) : (
              <div className="divide-y divide-line">
                {data.debits.map((x) => (
                  <div key={x.id} className="flex items-center gap-3 py-1.5 text-[13px]">
                    <span className="tnum w-8 shrink-0 text-muted">{x.day}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {x.name}
                      {x.category && <span className="text-muted"> · {td(x.category)}</span>}
                    </span>
                    <span className="tnum shrink-0 font-medium">{money(x.amount)}</span>
                  </div>
                ))}
                {!data.debits.length && <div className="py-4 text-center text-[13px] text-muted">{t("Aucun prélèvement.")}</div>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/* ---------- Marchands ---------- */

function MerchantsTab({ month }: { month: string }) {
  const m = useMerchants(month);
  const list = (m.data?.merchants ?? []).slice(0, 25);
  const max = Math.max(1, ...list.map((x) => Math.max(x.total, x.previous)));
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">{t("Achats carte par marchand")}</h2>
        <span className="flex items-center gap-3 text-[12px] text-muted">
          <span className="flex items-center gap-1">
            <span className="size-2.5 rounded-sm" style={{ background: natureColor("carte") }} /> {t("ce mois-ci")}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-0.5 bg-ink" /> {t("mois précédent")}
          </span>
        </span>
      </div>
      {m.error && <ErrorBox error={m.error} />}
      {!m.data ? (
        <Spinner />
      ) : !list.length ? (
        <div className="py-10 text-center text-sm text-muted">{t("Aucun achat carte ce mois-ci.")}</div>
      ) : (
        <div className="space-y-1">
          {list.map((x) => {
            const delta = x.total - x.previous;
            return (
              <button
                key={x.name}
                type="button"
                onClick={() => openDrill(x.name, { month, nature: "carte", merchant: x.name, debits: true }, monthLabel(month))}
                className="grid w-full grid-cols-[230px_minmax(0,1fr)_90px_80px] items-center gap-3 rounded-md px-2 py-1 text-left text-[13px] hover:bg-bg"
              >
                <span className="flex min-w-0 items-center gap-2" title={x.name}>
                  <BrandLogo texts={[x.name]} size="sm" tone="neutral" />
                  <span className="truncate font-medium">{x.name}</span>
                  <span className="shrink-0 text-[11px] text-muted">×{x.count}</span>
                </span>
                <span className="relative h-4">
                  <span className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${(x.total / max) * 100}%`, background: natureColor("carte") }} />
                  {x.previous > 0 && <span className="absolute inset-y-[-2px] w-0.5 bg-ink" style={{ left: `${(x.previous / max) * 100}%` }} title={t("Mois précédent : {montant}", { montant: money(x.previous) })} />}
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
