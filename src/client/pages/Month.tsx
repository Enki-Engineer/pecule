import { MobileCalendar } from "../components/MonthCalendar.tsx";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { AxisTick, SELECTED_BAND } from "../components/StackedBars.tsx";
import { useMedia } from "../useMedia.ts";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { monthQuery, useMonth, useTrend, type MonthStats } from "../api.ts";
import { useForecast, type ForecastMonth } from "../api-analysis.ts";
import { Card, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { currentMonth, money, monthLabel, monthShort, periodLabel } from "../format.ts";
import { cumulative, monthTotals } from "../../lib/month.ts";
import { isYearPeriod, periodHasMonth, shiftPeriod, trendEnd, trendMonths } from "../../lib/periods.ts";
import { useAssistantEntity } from "../assistantContext.ts";
import { usePeriod } from "../shell.ts";
import { BreakdownSwitch } from "../components/Breakdown.tsx";
import { openDrill } from "../components/DrillDrawer.tsx";
import { MobileTimeline } from "../components/MonthTimeline.tsx";
import { locale, t, td, tk } from "../../lib/i18n.ts";

type Row = MonthStats["categories"][number];

/**
 * Écran Mois (iPhone) ; `bare` : contenu seul, dans l'onglet « Vue d'ensemble » de l'Analyse (ordinateur). La période
 * est un mois ou une année entière : le cumul avance alors mois par mois, et tout se compare à l'année d'avant.
 */
export function Month({ bare = false }: { bare?: boolean }) {
  // Période partagée avec la barre supérieure (ordinateur) et conservée d'un écran à l'autre.
  const [p, setP] = usePeriod();
  const year = isYearPeriod(p);
  const now = currentMonth();
  const { data, isLoading, error, isPlaceholderData } = useMonth(p);
  // Périodes voisines préchargées : flèches et barres du graphique répondent tout de suite.
  const qc = useQueryClient();
  useEffect(() => {
    const last = year ? now.slice(0, 4) : now;
    for (const n of [shiftPeriod(p, -1), shiftPeriod(p, 1)]) if (n <= last) void qc.prefetchQuery({ ...monthQuery(n), staleTime: 60_000 });
  }, [p, year, now, qc]);
  useAssistantEntity(year ? { type: "annee", id: p, label: t("Année {annee}", { annee: p }) } : { type: "mois", id: p, label: t("Mois de {mois}", { mois: monthLabel(p) }) });
  const [open, setOpen] = useState<string | null>(null);

  const tot = data ? monthTotals(data.categories) : null;
  const tp = data ? monthTotals(data.previous) : null;

  const postes = useMemo(() => {
    if (!data) return [];
    const prevByPoste = new Map<string, number>();
    for (const r of data.previous.filter((r) => r.kind === "depense")) {
      const k = r.poste ?? tk("À classer");
      prevByPoste.set(k, (prevByPoste.get(k) ?? 0) - r.total);
    }
    const map = new Map<string, { poste: string; total: number; items: Row[] }>();
    for (const r of data.categories.filter((r) => r.kind === "depense")) {
      const k = r.poste ?? tk("À classer");
      const g = map.get(k) ?? { poste: k, total: 0, items: [] };
      g.total -= r.total;
      g.items.push(r);
      map.set(k, g);
    }
    return [...map.values()].map((g) => ({ ...g, prev: prevByPoste.get(g.poste) ?? 0 })).sort((a, b) => b.total - a.total);
  }, [data]);

  const max = Math.max(1, ...postes.map((x) => x.total));
  // Période en cours : le mois d'aujourd'hui, ou l'année qui le contient.
  const isCurrent = periodHasMonth(p, now);
  // Le cumul avance d'un rang à la fois : un jour pour un mois, un mois pour une année.
  const steps = year ? 12 : new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)), 0).getDate();
  const rank = year ? Number(now.slice(5, 7)) : Number(new Date().toLocaleDateString("sv-SE").slice(8, 10));
  const chart = useMemo(() => {
    if (!data) return [];
    const cur = cumulative(data.daily, steps);
    const prev = cumulative(data.dailyPrev, year ? 12 : 31);
    return cur.map((v, i) => ({ day: i + 1, mois: isCurrent && i + 1 > rank ? null : v, precedent: prev[i] ?? prev.at(-1) }));
  }, [data, steps, year, isCurrent, rank]);
  const prevSameRank = useMemo(() => (data ? (cumulative(data.dailyPrev, year ? 12 : 31)[Math.min(rank, year ? 12 : 31) - 1] ?? 0) : 0), [data, rank, year]);
  const stepName = (d: number) => (year ? monthLabel(`${p}-${String(d).padStart(2, "0")}`).split(" ")[0] : t("Jour {n}", { n: String(d) }));

  return (
    <>
      {!bare && <PageHeader title={t("Mois")} />}
      <div className="mb-4 flex items-center justify-between md:hidden">
        <button type="button" onClick={() => setP(shiftPeriod(p, -1))} className="press card grid size-10 place-items-center" aria-label={year ? t("Année précédente") : t("Mois précédent")}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-lg font-semibold">{periodLabel(p)}</div>
        <button type="button" onClick={() => setP(shiftPeriod(p, 1))} disabled={isCurrent} className="press card grid size-10 place-items-center disabled:opacity-30" aria-label={year ? t("Année suivante") : t("Mois suivant")}>
          <ChevronRight size={20} />
        </button>
      </div>

      {error && <ErrorBox error={error} />}
      {isLoading || !data || !tot || !tp ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <MonthTrend period={p} onSelect={setP} />
          <div className={clsx("space-y-4 transition-opacity duration-200", isPlaceholderData && "opacity-50")}>
          <div className="grid grid-cols-3 gap-3">
            {/* Période en cours : pas d'écart sur les revenus (ils tombent en une fois, la comparaison n'a pas de sens avant la fin). */}
            <Tile label={t("Revenus")} value={tot.revenus} prev={isCurrent ? 0 : tp.revenus} good="up" />
            {/* Période en cours : comparaison à la période précédente au même point, comme sur l'accueil. */}
            <Tile label={t("Dépenses")} value={tot.depenses} prev={isCurrent ? prevSameRank : tp.depenses} good="down" />
            <Tile label={year ? t("Solde de l'année") : t("Solde du mois")} value={tot.revenus - tot.depenses} prev={isCurrent ? 0 : tp.revenus - tp.depenses} good="up" />
          </div>
          <div className="-mt-2 px-1 text-xs text-muted">
            {year
              ? isCurrent
                ? t("Écarts : dépenses comparées à l'année précédente au même mois")
                : t("Écarts par rapport à l'année précédente")
              : isCurrent
                ? t("Écarts : dépenses comparées au mois précédent à la même date")
                : t("Écarts par rapport au mois précédent")}
            {tot.epargne !== 0 && (
              <>
                {" · "}{t("versé en épargne :")} <span className="tnum font-medium text-ink">{money(tot.epargne, true)}</span>
              </>
            )}
          </div>

          {/* iPhone : répartition en anneau (dépenses ou revenus), chaque poste se déplie sur ses catégories ; puis la frise. */}
          {!bare && <BreakdownSwitch data={data} />}
          {!bare && !year && <MobileCalendar month={p} onStep={(d) => (d < 0 || !isCurrent) && setP(shiftPeriod(p, d))} />}
          {!bare && <MobileTimeline period={p} />}

          {/* Grand écran : le cumul de la période à gauche, les postes à droite. */}
          <div className="space-y-4 xl:grid xl:grid-cols-12 xl:items-start xl:gap-4 xl:space-y-0">
          <Card className="p-4 xl:sticky xl:top-[68px] xl:col-span-7">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">{t("Dépenses cumulées")}</span>
              <span className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-accent" /> {year ? p : monthLabel(p).split(" ")[0]}</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted/50" /> {year ? t("année précédente") : t("mois précédent")}</span>
              </span>
            </div>
            <div className="h-44 xl:h-80">
              <ResponsiveContainer>
                <AreaChart data={chart} margin={{ left: -8, right: year ? 16 : 4, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} interval={year ? 0 : 6} tickFormatter={(d: number) => (year ? monthShort(`${p}-${String(d).padStart(2, "0")}`) : String(d))} />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `${(v / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} k`} />
                  <Tooltip
                    formatter={(v, name) => [money(Number(v), true), name === "mois" ? (year ? p : t("Ce mois")) : year ? t("Année précédente") : t("Mois précédent")]}
                    labelFormatter={(d) => stepName(Number(d))}
                  />
                  <Line type="monotone" dataKey="precedent" stroke="var(--color-muted)" strokeOpacity={0.5} strokeDasharray="4 4" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="mois" stroke="var(--color-accent)" fill="url(#g)" strokeWidth={2.5} connectNulls={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {bare && (
          <Card className="divide-y divide-line xl:col-span-5">
            {postes.map((x) => (
              <div key={x.poste}>
                <button type="button" onClick={() => setOpen(open === x.poste ? null : x.poste)} className="press w-full px-4 py-3.5 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <span className={clsx("font-medium", x.poste === tk("À classer") && "text-warn")}>{td(x.poste)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="tnum font-semibold">{money(x.total)}</span>
                      <ChevronDown size={16} className={clsx("text-muted transition-transform", open === x.poste && "rotate-180")} />
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(x.total / max) * 100}%` }} />
                  </div>
                  <div className="tnum mt-1 text-xs text-muted">{year ? t("Année précédente : {montant}", { montant: money(x.prev) }) : t("Mois précédent : {montant}", { montant: money(x.prev) })}</div>
                </button>
                {open === x.poste && (
                  <div className="bg-bg/60 px-4 py-2">
                    {x.items
                      .sort((a, b) => a.total - b.total)
                      .map((c) => (
                        // Les opérations de la catégorie s'ouvrent dans le tiroir, sans quitter l'écran.
                        <button
                          key={c.id ?? "none"}
                          type="button"
                          onClick={() => openDrill(td(c.name ?? tk("Sans catégorie")), c.id ? { month: p, category: c.id } : { month: p, uncategorized: true, debits: true }, periodLabel(p))}
                          className="press flex w-full items-center justify-between py-2 text-left text-[15px]"
                        >
                          <span>{td(c.name ?? tk("Sans catégorie"))} <span className="text-xs text-muted">· {c.count}</span></span>
                          <span className="tnum">{money(-c.total)}</span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </Card>
          )}
          </div>
          </div>
        </div>
      )}
    </>
  );
}

function Tile({ label, value, prev, good }: { label: string; value: number; prev: number; good: "up" | "down" }) {
  const diff = value - prev;
  const positive = good === "up" ? diff >= 0 : diff <= 0;
  return (
    <Card className="p-3.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="tnum mt-0.5 text-[17px] font-bold">{money(value, true)}</div>
      {prev !== 0 && (
        <div className={clsx("tnum text-[11px]", positive ? "text-pos" : "text-neg")}>
          {diff >= 0 ? "+" : ""}
          {money(diff, true)}
        </div>
      )}
    </Card>
  );
}

type TrendRow = { month: string; revenus: number; depenses: number; revenusPrevus: number; depensesPrevues: number; forecast?: ForecastMonth };

/** Étiquette d'un mois sur l'axe : son nom court, avec l'année en janvier (c'est là qu'elle change). */
const trendTick = (m: string) => (m.endsWith("-01") ? `${monthShort(m)} ${m.slice(2, 4)}` : monthShort(m));

/**
 * Revenus et dépenses mois par mois. Pour un mois : douze mois glissants, qui suivent le mois choisi quand il sort de
 * la fenêtre ; quand ils touchent le présent, les trois mois suivants s'ajoutent en prévision (ce qui est déjà écrit
 * en plein, ce qui est attendu d'après les récurrences en pointillé). Pour une année : ses douze mois. Toucher une
 * barre ouvre le mois.
 */
function MonthTrend({ period, onSelect }: { period: string; onSelect: (m: string) => void }) {
  const now = currentMonth();
  const year = isYearPeriod(period);
  // iPhone : les étiquettes se touchent presque, le gras ferait déborder celle du mois choisi sur ses voisines.
  const wide = useMedia("(min-width: 768px)");
  // Fin de la fenêtre : gardée d'un rendu à l'autre, elle ne glisse que si le mois choisi en sort.
  const [end, setEnd] = useState(() => (year ? now : trendEnd(now, period, now)));
  const nextEnd = year ? end : trendEnd(end, period, now);
  if (nextEnd !== end) setEnd(nextEnd);
  const { months, forecast } = useMemo(() => trendMonths(period, nextEnd, now), [period, nextEnd, now]);
  const trend = useTrend(months[0], months[months.length - 1]);
  const live = months.includes(now);
  const fc = useForecast(live);
  const rows = useMemo<TrendRow[]>(
    () =>
      months.map((m) => {
        const r = trend.data?.months.find((x) => x.month === m);
        const f = m >= now ? fc.data?.months.find((x) => x.month === m) : undefined;
        return { month: m, revenus: Math.round(Number(r?.revenus ?? 0)), depenses: Math.round(Number(r?.depenses ?? 0)), revenusPrevus: Math.round(f?.expected.revenus ?? 0), depensesPrevues: Math.round(f?.expected.depenses ?? 0), forecast: f };
      }),
    [months, trend.data, fc.data, now],
  );
  if (!trend.data && !trend.isPlaceholderData) return null;
  const planned = rows.some((r) => r.revenusPrevus || r.depensesPrevues);
  const selected = !year && months.includes(period) ? period : null;
  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-semibold">
          {year ? t("{annee}, mois par mois", { annee: period }) : t("Douze mois glissants")}
          {/* La fenêtre, en clair : elle glisse avec le mois choisi. */}
          {!year && (
            <span className="font-normal text-muted">
              {" · "}
              {monthLabel(months[0])} → {monthLabel(months[11])}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-pos" /> {t("revenus")}</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-ink" /> {t("dépenses")}</span>
          {planned && (
            <span className="flex items-center gap-1">
              <svg width="12" height="10" aria-hidden>
                <rect x="1" y="1" width="10" height="8" rx="2" fill="var(--color-muted)" fillOpacity="0.15" stroke="var(--color-muted)" strokeDasharray="3 2" />
              </svg>
              {t("attendu (ce qui revient chaque mois)")}
            </span>
          )}
        </span>
      </div>
      <div className={clsx("h-40 transition-opacity duration-200", trend.isPlaceholderData && "opacity-60")}>
        <ResponsiveContainer>
          <BarChart
            data={rows}
            margin={{ left: -8, right: 0, top: 4, bottom: 0 }}
            barGap={1}
            onClick={(e) => {
              const m = (e as { activeLabel?: string } | null)?.activeLabel;
              // Un mois à venir ne s'ouvre pas : il n'a pas encore d'opérations à montrer.
              if (m && m <= now) onSelect(m);
            }}
          >
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="month" tickLine={false} axisLine={false} interval={wide ? 0 : 1} tick={<AxisTick selected={selected} weight={wide ? 700 : 400} format={trendTick} />} />
            <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${(v / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} k`} />
            <Tooltip cursor={{ fill: "var(--color-bg)" }} content={<TrendTip now={now} />} />
            {/* Les mois à venir sur un fond à part : ce sont des prévisions. */}
            {forecast.length > 0 && <ReferenceArea x1={forecast[0]} x2={forecast[forecast.length - 1]} fill="var(--color-bg)" fillOpacity={0.9} stroke="none" ifOverflow="visible" />}
            {selected && <ReferenceArea x1={selected} x2={selected} {...SELECTED_BAND} />}
            <Bar dataKey="revenus" stackId="r" fill="var(--color-pos)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="revenusPrevus" stackId="r" fill="var(--color-pos)" fillOpacity={0.16} stroke="var(--color-pos)" strokeDasharray="3 2" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="depenses" stackId="d" fill="var(--color-ink)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="depensesPrevues" stackId="d" fill="var(--color-ink)" fillOpacity={0.16} stroke="var(--color-ink)" strokeDasharray="3 2" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-center text-[11px] text-muted">
        {t("Choisis un mois pour l'afficher")} · {periodLabel(period)}
      </div>
      <Link to="/comparer" className="press mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-accent-soft py-2 text-[14px] font-semibold text-accent md:hidden">
        {t("Comparer avec une autre période")}
      </Link>
    </Card>
  );
}

/** Info-bulle d'un mois : ce qui est écrit, ce qui est attendu, et pour un mois à venir les principales récurrences. */
function TrendTip({ active, payload, now }: Partial<TooltipContentProps<number, string>> & { now: string }) {
  const row = active ? (payload?.[0]?.payload as TrendRow | undefined) : undefined;
  if (!row) return null;
  const line = (label: string, known: number, expected: number, color: string) => (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 rounded" style={{ background: color }} />
        {label}
      </span>
      <span className="tnum font-semibold">
        {money(known, true)}
        {expected > 0 && <span className="font-normal text-muted"> {t("+ {montant} attendus", { montant: money(expected, true) })}</span>}
      </span>
    </div>
  );
  return (
    <div className="min-w-52 max-w-72 chart-tip">
      <div className="mb-1 font-medium text-muted">
        {monthLabel(row.month)}
        {row.month > now ? ` · ${t("prévision")}` : row.month === now ? ` · ${t("en cours")}` : ""}
      </div>
      {line(t("Revenus"), row.revenus, row.revenusPrevus, "var(--color-pos)")}
      {line(t("Dépenses"), row.depenses, row.depensesPrevues, "var(--color-ink)")}
      {!!row.forecast?.items.length && (
        <div className="mt-1 border-t border-line pt-1">
          {row.forecast.items.slice(0, 6).map((x, i) => (
            <div key={i} className="flex justify-between gap-3 text-muted">
              <span className="truncate">{x.name}</span>
              <span className="tnum shrink-0">{money(x.amount, true)}</span>
            </div>
          ))}
          {row.forecast.count > 6 && <div className="text-muted">{t("et {n} autres", { n: row.forecast.count - 6 })}</div>}
        </div>
      )}
    </div>
  );
}
