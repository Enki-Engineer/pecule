import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Plus, X } from "lucide-react";
import type { Asset, Wealth, WealthCategory } from "../api.ts";
import { BankBadge, Card, PageHeader, ProgressBar, Segmented } from "../components/ui.tsx";
import { Stat, StatGrid } from "../components/blocks.tsx";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { CATEGORY, ORDER } from "../wealth.ts";
import { BrandLogo } from "../components/Logo.tsx";
import { dateFr, kMoney, money, pct } from "../format.ts";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";
import { historyRangeStart, historyRangeUseful, type HistoryRange } from "../../lib/wealth.ts";

/*
 * Patrimoine (ordinateur) : chiffres clés, évolution (net ou empilée par poche, un clic sur une date
 * affiche sa répartition et l'écart avec aujourd'hui), répartition cliquable qui filtre le tableau
 * des actifs, puis les crédits. L'iPhone garde l'écran en liste.
 */

export type Mode = "net" | "poches";
export type Range = HistoryRange;
export type Point = { date: string; t: number; net: number; parts: Partial<Record<WealthCategory, number>> | null } & Partial<Record<WealthCategory, number>>;

const DAY = 86_400_000;
/** Durées proposées au-dessus de la courbe (règles dans src/lib/wealth.ts) ; « Tout » vient après. */
const RANGE_LABELS: Record<Exclude<Range, "tout">, string> = { "1m": t("1 mois"), "3m": t("3 mois"), "6m": t("6 mois") };
const keur = (v: number) => kMoney(v);
const dayOf = (s: string) => s.slice(0, 10);
const tOf = (d: string) => Date.parse(`${d}T12:00:00Z`);

/** Points de la courbe : instantanés quotidiens, avec la répartition par poche quand elle existe. */
export function historyPoints(w: Wealth): Point[] {
  return w.history.map((h) => {
    const date = dayOf(h.date);
    return { date, t: tOf(date), net: Number(h.net), parts: h.breakdown, ...(h.breakdown ?? {}) };
  });
}

export function WealthDesktop({ w, onEdit, onAdd }: { w: Wealth; onEdit: (a: Asset) => void; onAdd: () => void }) {
  const [mode, setMode] = useState<Mode>("poches");
  const [range, setRange] = useState<Range>("tout");
  const [selected, setSelected] = useState<string | null>(null);
  // La répartition ne signale un changement qu'après le choix d'une date (pas à l'ouverture de l'écran).
  const [dated, setDated] = useState(false);
  const selectDate = (d: string | null) => {
    setSelected(d);
    setDated(true);
  };
  const [filter, setFilter] = useState<WealthCategory | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const points = useMemo<Point[]>(() => historyPoints(w), [w]);

  // Une durée ne sert que si l'historique remonte plus loin qu'elle : sinon elle montrerait la même chose que
  // « Tout ». Elle est alors grisée (avec la date où l'historique commence), et la courbe retombe sur « Tout ».
  const first = (mode === "net" ? points : points.filter((p) => p.parts))[0];
  const usable = (r: Range) => historyRangeUseful(r, first?.t);
  const shownRange: Range = usable(range) ? range : "tout";
  const since = first ? t("L'historique commence le {date}", { date: dateFr(first.date) }) : undefined;

  const monthAgo = [...points].reverse().find((p) => p.t <= Date.now() - 30 * DAY);
  const selectedPoint = points.find((p) => p.date === selected) ?? null;
  const liquid = w.byCategory.comptes + w.byCategory.epargne;
  const monthly = w.loans.reduce((s, l) => s + (l.summary.currentMonthly ?? 0) * l.share, 0);

  const pick = (k: WealthCategory | null) => {
    setFilter(k);
    if (k) tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <PageHeader
        title={t("Patrimoine")}
        subtitle={t("Ta part · {date} · biens communs comptés pour ta part", { date: dateFr(w.date) })}
        right={
          <button type="button" onClick={onAdd} className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110">
            <Plus size={15} /> {t("Ajouter un placement")}
          </button>
        }
      />
      <StatGrid>
        <Stat
          label={t("Patrimoine net")}
          info={t("Ce que tu possèdes (comptes, épargne, biens, crypto) moins ce que tu dois encore. Les biens et les crédits communs comptent pour ta part.")}
          value={money(w.net, true)}
          hint={monthAgo ? <Delta value={w.net - monthAgo.net} suffix={t("sur 30 jours")} /> : undefined}
        />
        <Stat label={t("Actifs bruts")} info={t("Tout ce que tu possèdes, avant de retirer ce que tu dois encore.")} value={money(w.gross, true)} hint={t("dont immobilier {part}", { part: pct((w.byCategory.immobilier / w.gross) * 100, 0) })} />
        <Stat label={t("Crédits restants")} info={t("Capital qu'il te reste à rembourser sur tes crédits, pour ta part.")} value={money(w.debts, true)} hint={monthly ? t("{montant} de mensualités (ta part)", { montant: money(monthly, true) }) : undefined} />
        <Stat label={t("Disponible")} info={t("Comptes courants et épargne : ce qui se mobilise sans vendre un bien ni un placement.")} value={money(liquid, true)} hint={t("comptes et épargne")} />
      </StatGrid>

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 p-5 xl:col-span-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">{t("Évolution")}</h2>
              <p className="text-[12px] text-muted">{t("Clique sur une date pour voir sa répartition.")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Segmented<Mode>
                value={mode}
                onChange={setMode}
                options={[
                  { value: "poches", label: t("Par poche") },
                  { value: "net", label: t("Net") },
                ]}
              />
              <Segmented<Range>
                value={shownRange}
                onChange={setRange}
                options={[
                  ...(["1m", "3m", "6m"] as const).map((r) => ({ value: r, label: RANGE_LABELS[r], disabled: !usable(r), title: usable(r) ? undefined : since })),
                  { value: "tout", label: t("Tout") },
                ]}
              />
            </div>
          </div>
          <EvolutionChart points={points} mode={mode} range={shownRange} selected={selected} onSelect={selectDate} />
        </Card>

        <Card key={selected ?? "aujourd'hui"} className={cn("col-span-12 p-5 xl:col-span-4", dated && "sel-swap")}>
          <Composition w={w} at={selectedPoint} onClear={() => selectDate(null)} filter={filter} onPick={pick} />
        </Card>

        <div ref={tableRef} className="col-span-12 scroll-mt-16">
          <AssetsTable w={w} filter={filter} onFilter={setFilter} onEdit={onEdit} />
        </div>

        {w.loans.length > 0 && (
          <div className="col-span-12">
            <LoansTable w={w} />
          </div>
        )}
      </div>
      <p className="mt-4 text-[12px] leading-relaxed text-muted">
        {t("Crypto et PEA suivent les cours du marché ; les autres valeurs se mettent à jour à la main (clique sur la ligne). Un instantané est enregistré chaque jour.")}
      </p>
    </>
  );
}

function Delta({ value, suffix }: { value: number; suffix: string }) {
  return (
    <span className={cn("tnum", value >= 0 ? "text-pos" : "text-neg")}>
      {value >= 0 ? "+" : ""}
      {money(value, true)} <span className="text-muted">{suffix}</span>
    </span>
  );
}

/* ---------- Évolution ---------- */

export function EvolutionChart({
  points,
  mode,
  range,
  selected,
  onSelect,
  height = 288,
}: {
  points: Point[];
  mode: Mode;
  range: Range;
  selected: string | null;
  onSelect: (d: string | null) => void;
  height?: number;
}) {
  const [hidden, setHidden] = useState<Set<WealthCategory>>(new Set());
  const cutoff = historyRangeStart(range);
  const data = points.filter((p) => p.t >= cutoff && (mode === "net" || p.parts));
  const present = ORDER.filter((k) => data.some((p) => (p[k] ?? 0) > 0));
  const visible = present.filter((k) => !hidden.has(k));
  const ticks = monthTicks(data);
  const short = data.length > 1 && (data[data.length - 1].t - data[0].t) / DAY <= 75;
  const sel = data.find((p) => p.date === selected);

  if (data.length < 2)
    return <div className="grid h-72 place-items-center text-sm text-muted">{t("Pas encore assez d'instantanés sur cette période.")}</div>;

  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer>
          <AreaChart
            data={data}
            margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
            onClick={(s) => {
              const p = data[Number(s?.activeIndex)];
              if (p) onSelect(p.date === selected ? null : p.date);
            }}
            style={{ cursor: "pointer" }}
          >
            <defs>
              <linearGradient id="wnet" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              ticks={ticks}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted)" }}
              tickFormatter={(v: number) => new Date(v).toLocaleDateString(locale(), short ? { day: "numeric", month: "short", timeZone: "UTC" } : { month: "short", timeZone: "UTC" })}
            />
            <YAxis
              width={64}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted)" }}
              tickFormatter={keur}
              domain={mode === "net" ? ["dataMin - 10000", "dataMax + 10000"] : [0, "auto"]}
            />
            <Tooltip content={<EvolutionTip mode={mode} />} cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }} />
            {mode === "net" ? (
              <Area type="monotone" dataKey="net" stroke="var(--color-accent)" fill="url(#wnet)" strokeWidth={2} isAnimationActive={false} activeDot={{ r: 4 }} />
            ) : (
              visible.map((k) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId="poches"
                  stroke="var(--color-card)"
                  strokeWidth={1}
                  fill={CATEGORY[k].color}
                  fillOpacity={0.85}
                  isAnimationActive={false}
                  activeDot={false}
                />
              ))
            )}
            {sel && <ReferenceLine x={sel.t} stroke="var(--color-ink)" strokeWidth={1.5} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {mode === "poches" && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
          {present.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={!hidden.has(k)}
              onClick={() => setHidden((h) => (h.has(k) ? new Set([...h].filter((x) => x !== k)) : new Set([...h, k])))}
              className={cn("flex items-center gap-1.5 rounded px-1 hover:bg-bg", hidden.has(k) && "opacity-40")}
            >
              <span className="size-2.5 rounded-sm" style={{ background: CATEGORY[k].color }} />
              {CATEGORY[k].label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** Graduations : chaque lundi sur une période courte, au début des mois (un sur deux ou trois) sinon. */
function monthTicks(data: Point[]): number[] {
  if (data.length < 2) return [];
  const first = data[0].t;
  const last = data[data.length - 1].t;
  const days = (last - first) / DAY;
  const out: number[] = [];
  if (days <= 75) {
    const d = new Date(first);
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    for (; d.getTime() <= last; d.setUTCDate(d.getUTCDate() + (days > 40 ? 14 : 7))) out.push(d.getTime());
    return out;
  }
  const step = days > 540 ? 3 : days > 240 ? 2 : 1;
  const d = new Date(first);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  for (; d.getTime() <= last; d.setUTCMonth(d.getUTCMonth() + step)) out.push(d.getTime());
  return out;
}

function EvolutionTip({ active, payload, mode }: Partial<TooltipContentProps<number, string>> & { mode: Mode }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  return (
    <div className="min-w-52 chart-tip">
      <div className="mb-1 font-medium text-muted">{dateFr(p.date)}</div>
      {mode === "poches" &&
        [...payload].reverse().map((x) => {
          const k = x.dataKey as WealthCategory;
          return (
            <div key={k} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm" style={{ background: CATEGORY[k].color }} />
                {CATEGORY[k].label}
              </span>
              <span className="tnum">{money(Number(x.value ?? 0), true)}</span>
            </div>
          );
        })}
      <div className={cn("flex justify-between gap-4 font-semibold", mode === "poches" && "mt-1 border-t border-line pt-1")}>
        <span>{t("Patrimoine net")}</span>
        <span className="tnum">{money(p.net, true)}</span>
      </div>
    </div>
  );
}

/* ---------- Répartition ---------- */

export function Composition({
  w,
  at,
  onClear,
  filter,
  onPick,
}: {
  w: Wealth;
  at: Point | null;
  onClear: () => void;
  filter: WealthCategory | null;
  onPick: (k: WealthCategory | null) => void;
}) {
  const rows = ORDER.map((k) => ({ k, now: w.byCategory[k], then: at?.parts ? (at.parts[k] ?? 0) : null })).filter((r) => r.now > 0 || (r.then ?? 0) > 0);
  const total = rows.reduce((s, r) => s + Math.max(0, r.now), 0);
  const ranked = [...rows].sort((a, b) => b.now - a.now);
  const max = Math.max(1, ...ranked.map((r) => r.now));
  return (
    <>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{t("Répartition")}</h2>
        {at ? (
          <button type="button" onClick={onClear} className="flex items-center gap-1 text-[12px] text-accent hover:underline">
            {t("Écart depuis le")} <span className="tnum rounded-md bg-accent-soft px-1.5 py-0.5 font-medium text-ink">{dateFr(at.date)}</span> <X size={12} />
          </button>
        ) : (
          <span className="text-[12px] text-muted">{t("actifs bruts {montant}", { montant: money(total, true) })}</span>
        )}
      </div>
      {/* Barre segmentée : part de chaque poche dans les actifs. */}
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded">
        {ranked
          .filter((r) => r.now > 0)
          .map((r) => (
            <button
              key={r.k}
              type="button"
              title={t("{poche} : {montant}", { poche: CATEGORY[r.k].label, montant: money(r.now, true) })}
              onClick={() => onPick(filter === r.k ? null : r.k)}
              className={cn("h-full transition-opacity", filter && filter !== r.k && "opacity-30")}
              style={{ width: `${(r.now / total) * 100}%`, background: CATEGORY[r.k].color }}
            />
          ))}
      </div>
      <div className="mt-4 space-y-1">
        {ranked.map((r) => {
          const delta = r.then != null ? r.now - r.then : null;
          return (
            <button
              key={r.k}
              type="button"
              onClick={() => onPick(filter === r.k ? null : r.k)}
              aria-pressed={filter === r.k}
              className={cn("block w-full rounded-md px-2 py-1.5 text-left hover:bg-bg", filter === r.k && "bg-accent-soft")}
            >
              <div className="flex items-center gap-2 text-[13px]">
                <span className="size-2.5 shrink-0 rounded-sm" style={{ background: CATEGORY[r.k].color }} />
                <span className="flex-1">{CATEGORY[r.k].label}</span>
                {delta != null ? (
                  <span className={cn("tnum text-[12px]", Math.abs(delta) < 1 ? "text-muted" : delta > 0 ? "text-pos" : "text-neg")}>
                    {delta > 0 ? "+" : ""}
                    {money(delta, true)}
                  </span>
                ) : (
                  <span className="tnum text-[12px] text-muted">{pct((Math.max(0, r.now) / total) * 100, 0)}</span>
                )}
                <span className="tnum w-24 text-right font-medium">{money(r.now, true)}</span>
              </div>
              <div className="ml-[18px] mt-1 h-1 overflow-hidden rounded-full bg-bg">
                <div className="h-full rounded-full" style={{ width: `${(Math.max(0, r.now) / max) * 100}%`, background: CATEGORY[r.k].color }} />
              </div>
            </button>
          );
        })}
      </div>
      {at && !at.parts && <p className="mt-3 text-[12px] text-muted">{t("Ce relevé ne détaille pas les poches (repris de Notion).")}</p>}
      {at && (
        <div className="mt-3 flex justify-between border-t border-line pt-2 text-[13px]">
          <span className="text-muted">{t("Patrimoine net depuis le {date}", { date: dateFr(at.date) })}</span>
          <Delta value={w.net - at.net} suffix="" />
        </div>
      )}
    </>
  );
}

/* ---------- Actifs ---------- */

type Line = {
  key: string;
  name: string;
  sub: string | null;
  category: WealthCategory;
  institution: string | null;
  valuation: string;
  invested: number | null;
  value: number;
  share: number;
  part: number;
  asset?: Asset;
  to?: string;
};

function AssetsTable({ w, filter, onFilter, onEdit }: { w: Wealth; filter: WealthCategory | null; onFilter: (k: WealthCategory | null) => void; onEdit: (a: Asset) => void }) {
  const navigate = useNavigate();
  const lines = useMemo<Line[]>(() => {
    const out: Line[] = [
      ...w.accounts.map((a) => ({
        key: `c:${a.id}`,
        name: a.display_name ?? a.name,
        sub: a.share < 1 ? t("Compte commun") : null,
        category: "comptes" as const,
        institution: a.institution,
        valuation: t("Solde bancaire"),
        invested: null,
        value: a.balance,
        share: a.share,
        part: a.balance * a.share,
        to: `/operations?compte=${encodeURIComponent(a.id)}`,
      })),
      ...w.assets.map((a) => ({
        key: `a:${a.id}`,
        name: a.name,
        sub: a.valuation === "cotation" && a.quantity != null && a.price != null ? t("{quantite} parts × {cours}", { quantite: a.quantity.toLocaleString(locale()), cours: money(a.price) }) : a.liquidity,
        category: a.category,
        institution: a.institution,
        valuation:
          a.valuation === "cotation"
            ? a.valueDate
              ? t("Cours du {date}", { date: dateFr(a.valueDate) })
              : t("Cours")
            : a.valuation === "versements"
              ? a.valueDate
                ? t("Dernier versement du {date}", { date: dateFr(a.valueDate) })
                : t("Dernier versement")
              : a.valueDate
                ? t("Saisie au {date}", { date: dateFr(a.valueDate) })
                : t("Saisie"),
        invested: a.invested,
        value: a.value,
        share: a.share,
        part: a.shareValue,
        asset: a,
      })),
    ];
    if (w.crypto.total > 0)
      out.push({
        key: "crypto",
        name: t("Portefeuilles crypto"),
        sub: tn("{n} crypto", "{n} cryptos", new Set(w.crypto.positions.map((p) => p.symbol.toUpperCase())).size),
        category: "crypto",
        institution: "CoinStats · blockchain",
        valuation: w.crypto.pricesAt ? t("Cours du {date}", { date: dateFr(w.crypto.pricesAt) }) : t("Cours du marché"),
        invested: null,
        value: w.crypto.total,
        share: 1,
        part: w.byCategory.crypto,
        to: "/patrimoine/crypto",
      });
    return out;
  }, [w]);
  const rows = filter ? lines.filter((l) => l.category === filter) : lines;
  const total = rows.reduce((s, l) => s + l.part, 0);
  const counts = new Map<WealthCategory, number>();
  for (const l of lines) counts.set(l.category, (counts.get(l.category) ?? 0) + 1);

  const columns: Column<Line>[] = [
    {
      key: "name",
      header: t("Actif"),
      sort: (l) => l.name,
      cell: (l) => (
        <div className="flex min-w-0 items-center gap-2.5 py-1">
          <span className="relative shrink-0">
            {l.category === "crypto" ? (
              <BrandLogo texts={["CoinStats"]} size="sm" tone="neutral" />
            ) : (
              <BrandLogo texts={[l.institution, l.name]} size="sm" tone="neutral" initials={l.name.replace(/^\p{Extended_Pictographic}\s*/u, "").slice(0, 2).toUpperCase()} />
            )}
            <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card" style={{ background: CATEGORY[l.category].color }} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium">{l.name}</div>
            {l.sub && <div className="truncate text-[12px] text-muted">{l.sub}</div>}
          </div>
        </div>
      ),
    },
    { key: "cat", header: t("Poche##patrimoine"), sort: (l) => ORDER.indexOf(l.category), cell: (l) => <span className="text-muted">{CATEGORY[l.category].label}</span>, width: "120px", hideBelow: "2xl" },
    {
      key: "inst",
      header: t("Établissement"),
      sort: (l) => l.institution ?? "",
      cell: (l) => (
        <span className="block max-w-[200px] truncate text-muted" title={l.institution ?? undefined}>
          {l.institution ?? "—"}
        </span>
      ),
      hideBelow: "lg",
    },
    { key: "val", header: t("Valorisation"), cell: (l) => <span className="text-[12px] text-muted">{l.valuation}</span>, hideBelow: "2xl", className: "whitespace-nowrap" },
    { key: "inv", header: t("Investi"), align: "right", sort: (l) => l.invested, cell: (l) => (l.invested != null ? money(l.invested, true) : <span className="text-muted">—</span>), hideBelow: "xl" },
    {
      key: "pv",
      header: t("Plus-value"),
      align: "right",
      className: "whitespace-nowrap",
      sort: (l) => (l.invested != null ? l.value - l.invested : null),
      hideBelow: "lg",
      cell: (l) => {
        if (l.invested == null || !l.invested) return <span className="text-muted">—</span>;
        const d = l.value - l.invested;
        return (
          <span className={cn(d > 0.5 ? "text-pos" : d < -0.5 ? "text-neg" : "text-muted")}>
            {d > 0 ? "+" : ""}
            {money(d, true)} <span className="text-[11px]">({pct((d / l.invested) * 100, 0)})</span>
          </span>
        );
      },
    },
    { key: "value", header: t("Valeur"), align: "right", sort: (l) => l.value, cell: (l) => money(l.value, true) },
    {
      key: "part",
      header: t("Ta part"),
      align: "right",
      className: "whitespace-nowrap",
      sort: (l) => l.part,
      cell: (l) => (
        <span className="font-semibold">
          {money(l.part, true)}
          {l.share < 1 && <span className="ml-1 text-[11px] font-normal text-muted">{pct(l.share * 100, 0)}</span>}
        </span>
      ),
    },
    {
      key: "weight",
      header: t("Poids"),
      align: "right",
      width: "110px",
      sort: (l) => l.part,
      cell: (l) => (
        <div className="flex items-center justify-end gap-2">
          <div className="h-1 w-12 overflow-hidden rounded-full bg-bg">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (l.part / w.gross) * 100))}%`, background: CATEGORY[l.category].color }} />
          </div>
          <span className="w-9 text-[12px] text-muted">{pct((l.part / w.gross) * 100, 0)}</span>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <h2 className="mr-2 font-semibold">{t("Actifs")}</h2>
        <Chip active={!filter} onClick={() => onFilter(null)} label={t("Tous")} count={lines.length} />
        {ORDER.filter((k) => counts.get(k)).map((k) => (
          <Chip key={k} active={filter === k} onClick={() => onFilter(filter === k ? null : k)} label={CATEGORY[k].label} count={counts.get(k)!} color={CATEGORY[k].color} />
        ))}
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(l) => l.key}
        initialSort={{ key: "part", dir: "desc" }}
        onRowClick={(l) => (l.asset ? onEdit(l.asset) : l.to && navigate(l.to, { viewTransition: true }))}
        footer={
          <>
            <td className="h-10 px-3 text-muted">
              {tn("{n} ligne", "{n} lignes", rows.length)}
              {filter ? ` · ${CATEGORY[filter].label}` : ""}
            </td>
            <td className="hidden 2xl:table-cell" />
            <td className="hidden lg:table-cell" />
            <td className="hidden 2xl:table-cell" />
            <td className="hidden xl:table-cell" />
            <td className="hidden lg:table-cell" />
            <td />
            <td className="tnum px-3 text-right font-semibold">{money(total, true)}</td>
            <td className="tnum px-3 text-right text-[12px] text-muted">{pct((total / w.gross) * 100, 0)}</td>
          </>
        }
      />
    </>
  );
}

function Chip({ active, onClick, label, count, color }: { active: boolean; onClick: () => void; label: string; count: number; color?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px]",
        active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink",
      )}
    >
      {color && <span className="size-2 rounded-sm" style={{ background: color }} />}
      {label}
      <span className="tnum opacity-70">{count}</span>
    </button>
  );
}

/* ---------- Crédits ---------- */

type LoanLine = Wealth["loans"][number];

function LoansTable({ w }: { w: Wealth }) {
  const navigate = useNavigate();
  const columns: Column<LoanLine>[] = [
    {
      key: "name",
      header: t("Crédit"),
      sort: (l) => l.name,
      cell: (l) => (
        <div className="flex min-w-0 items-center gap-2.5 py-1">
          <BankBadge bank={l.bank} />
          <div className="min-w-0">
            <div className="truncate font-medium">{l.name}</div>
            <div className="truncate text-[12px] text-muted">{l.property}</div>
          </div>
        </div>
      ),
    },
    {
      key: "progress",
      header: t("Remboursé"),
      sort: (l) => l.summary.progress,
      width: "200px",
      cell: (l) => (
        <div className="flex items-center gap-2">
          <ProgressBar value={l.summary.progress} className="h-1.5 flex-1" />
          <span className="tnum w-10 text-right text-[12px] text-muted">{pct(l.summary.progress * 100, 0)}</span>
        </div>
      ),
    },
    { key: "monthly", header: t("Mensualité"), align: "right", sort: (l) => l.summary.currentMonthly, cell: (l) => (l.summary.currentMonthly ? money(l.summary.currentMonthly) : "—"), hideBelow: "lg" },
    { key: "left", header: t("Échéances restantes"), align: "right", sort: (l) => l.summary.remainingPayments, cell: (l) => l.summary.remainingPayments, hideBelow: "xl" },
    { key: "end", header: t("Fin"), sort: (l) => l.end_date, cell: (l) => <span className="text-muted">{dateFr(l.end_date)}</span> },
    { key: "remaining", header: t("Restant dû"), align: "right", sort: (l) => l.summary.remaining, cell: (l) => money(l.summary.remaining, true), hideBelow: "lg" },
    {
      key: "share",
      header: t("Ta part"),
      align: "right",
      className: "whitespace-nowrap",
      sort: (l) => l.shareRemaining,
      cell: (l) => (
        <span className="font-semibold">
          {money(l.shareRemaining, true)}
          {l.share < 1 && <span className="ml-1 text-[11px] font-normal text-muted">{pct(l.share * 100, 0)}</span>}
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="font-semibold">{t("Crédits")}</h2>
        <span className="text-[12px] text-muted">{t("Clique sur un crédit pour son tableau d'amortissement")}</span>
      </div>
      <DataTable
        rows={w.loans}
        columns={columns}
        rowKey={(l) => l.id}
        initialSort={{ key: "share", dir: "desc" }}
        onRowClick={(l) => navigate(`/credits/${l.id}`, { viewTransition: true })}
        footer={
          <>
            <td className="h-10 px-3 text-muted" colSpan={2}>
              {tn("{n} crédit", "{n} crédits", w.loans.length)}
            </td>
            <td className="hidden lg:table-cell" />
            <td className="hidden xl:table-cell" />
            <td />
            <td className="hidden lg:table-cell" />
            <td className="tnum px-3 text-right font-semibold">{money(w.debts, true)}</td>
          </>
        }
      />
    </>
  );
}
