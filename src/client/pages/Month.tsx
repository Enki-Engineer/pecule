import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { AxisTick, SELECTED_BAND } from "../components/StackedBars.tsx";
import { useMedia } from "../useMedia.ts";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { monthQuery, useMonth, useTrend, type MonthStats } from "../api.ts";
import { Card, ErrorBox, PageHeader, Spinner } from "../components/ui.tsx";
import { currentMonth, money, monthLabel, monthShort, shiftMonth } from "../format.ts";
import { cumulative, monthTotals } from "../../lib/month.ts";
import { useAssistantEntity } from "../assistantContext.ts";
import { usePeriod } from "../shell.ts";
import { BreakdownSwitch } from "../components/Breakdown.tsx";
import { openDrill } from "../components/DrillDrawer.tsx";
import { locale, t, td, tk } from "../../lib/i18n.ts";

type Row = MonthStats["categories"][number];

/** Écran Mois (iPhone) ; `bare` : contenu seul, dans l'onglet « Vue d'ensemble » de l'Analyse (ordinateur). */
export function Month({ bare = false }: { bare?: boolean }) {
  // Mois partagé avec la barre supérieure (ordinateur) et conservé d'un écran à l'autre.
  const [m, setM] = usePeriod();
  const { data, isLoading, error, isPlaceholderData } = useMonth(m);
  // Mois voisins préchargés : flèches et barres du graphique répondent tout de suite.
  const qc = useQueryClient();
  useEffect(() => {
    for (const n of [shiftMonth(m, -1), shiftMonth(m, 1)]) if (n <= currentMonth()) void qc.prefetchQuery({ ...monthQuery(n), staleTime: 60_000 });
  }, [m, qc]);
  useAssistantEntity({ type: "mois", id: m, label: t("Mois de {mois}", { mois: monthLabel(m) }) });
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

  const max = Math.max(1, ...postes.map((p) => p.total));
  const isCurrent = m === currentMonth();
  const daysInMonth = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
  const today = Number(new Date().toLocaleDateString("sv-SE").slice(8, 10));
  const chart = useMemo(() => {
    if (!data) return [];
    const cur = cumulative(data.daily, daysInMonth);
    const prev = cumulative(data.dailyPrev, 31);
    return cur.map((v, i) => ({ day: i + 1, mois: isCurrent && i + 1 > today ? null : v, precedent: prev[i] ?? prev.at(-1) }));
  }, [data, daysInMonth, isCurrent, today]);
  const prevSameDay = useMemo(() => (data ? (cumulative(data.dailyPrev, 31)[Math.min(today, 31) - 1] ?? 0) : 0), [data, today]);

  return (
    <>
      {!bare && <PageHeader title={t("Mois")} />}
      <div className="mb-4 flex items-center justify-between md:hidden">
        <button type="button" onClick={() => setM(shiftMonth(m, -1))} className="press card grid size-10 place-items-center" aria-label={t("Mois précédent")}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-lg font-semibold">{monthLabel(m)}</div>
        <button type="button" onClick={() => setM(shiftMonth(m, 1))} disabled={isCurrent} className="press card grid size-10 place-items-center disabled:opacity-30" aria-label={t("Mois suivant")}>
          <ChevronRight size={20} />
        </button>
      </div>

      {error && <ErrorBox error={error} />}
      {isLoading || !data || !tot || !tp ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <YearTrend selected={m} onSelect={setM} />
          <div className={clsx("space-y-4 transition-opacity duration-200", isPlaceholderData && "opacity-50")}>
          <div className="grid grid-cols-3 gap-3">
            {/* Mois en cours : pas d'écart sur les revenus (ils tombent en une fois, la comparaison n'a pas de sens avant la fin du mois). */}
            <Tile label={t("Revenus")} value={tot.revenus} prev={isCurrent ? 0 : tp.revenus} good="up" />
            {/* Mois en cours : comparaison au mois précédent à la même date, comme sur l'accueil. */}
            <Tile label={t("Dépenses")} value={tot.depenses} prev={isCurrent ? prevSameDay : tp.depenses} good="down" />
            <Tile label={t("Solde du mois")} value={tot.revenus - tot.depenses} prev={isCurrent ? 0 : tp.revenus - tp.depenses} good="up" />
          </div>
          <div className="-mt-2 px-1 text-xs text-muted">
            {isCurrent ? t("Écarts : dépenses comparées au mois précédent à la même date") : t("Écarts par rapport au mois précédent")}
            {tot.epargne !== 0 && (
              <>
                {" · "}{t("versé en épargne :")} <span className="tnum font-medium text-ink">{money(tot.epargne, true)}</span>
              </>
            )}
          </div>

          {/* iPhone : répartition en anneau (dépenses ou revenus), chaque poste se déplie sur ses catégories. */}
          {!bare && <BreakdownSwitch data={data} />}

          {/* Grand écran : le cumul du mois à gauche, les postes à droite. */}
          <div className="space-y-4 xl:grid xl:grid-cols-12 xl:items-start xl:gap-4 xl:space-y-0">
          <Card className="p-4 xl:sticky xl:top-[68px] xl:col-span-7">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">{t("Dépenses cumulées")}</span>
              <span className="flex items-center gap-3 text-xs text-muted">
                <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-accent" /> {monthLabel(m).split(" ")[0]}</span>
                <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-muted/50" /> {t("mois précédent")}</span>
              </span>
            </div>
            <div className="h-44 xl:h-80">
              <ResponsiveContainer>
                <AreaChart data={chart} margin={{ left: -8, right: 4, top: 6, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--color-line)" />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} interval={6} />
                  <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => `${(v / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} k`} />
                  <Tooltip
                    formatter={(v, name) => [money(Number(v), true), name === "mois" ? t("Ce mois") : t("Mois précédent")]}
                    labelFormatter={(d) => t("Jour {n}", { n: String(d) })}
                    contentStyle={{ background: "var(--color-card)", border: "none", borderRadius: 12 }}
                  />
                  <Line type="monotone" dataKey="precedent" stroke="var(--color-muted)" strokeOpacity={0.5} strokeDasharray="4 4" dot={false} strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="mois" stroke="var(--color-accent)" fill="url(#g)" strokeWidth={2.5} connectNulls={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {bare && (
          <Card className="divide-y divide-line xl:col-span-5">
            {postes.map((p) => (
              <div key={p.poste}>
                <button type="button" onClick={() => setOpen(open === p.poste ? null : p.poste)} className="press w-full px-4 py-3.5 text-left">
                  <div className="flex items-center justify-between gap-3">
                    <span className={clsx("font-medium", p.poste === tk("À classer") && "text-warn")}>{td(p.poste)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="tnum font-semibold">{money(p.total)}</span>
                      <ChevronDown size={16} className={clsx("text-muted transition-transform", open === p.poste && "rotate-180")} />
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-accent-soft">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(p.total / max) * 100}%` }} />
                  </div>
                  <div className="tnum mt-1 text-xs text-muted">{t("Mois précédent : {montant}", { montant: money(p.prev) })}</div>
                </button>
                {open === p.poste && (
                  <div className="bg-bg/60 px-4 py-2">
                    {p.items
                      .sort((a, b) => a.total - b.total)
                      .map((c) => (
                        // Les opérations de la catégorie s'ouvrent dans le tiroir, sans quitter l'écran.
                        <button
                          key={c.id ?? "none"}
                          type="button"
                          onClick={() => openDrill(td(c.name ?? tk("Sans catégorie")), c.id ? { month: m, category: c.id } : { month: m, uncategorized: true, debits: true }, monthLabel(m))}
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

/** Revenus et dépenses des 12 derniers mois ; toucher une barre ouvre le mois. */
function YearTrend({ selected, onSelect }: { selected: string; onSelect: (m: string) => void }) {
  const { data } = useTrend();
  // iPhone : douze étiquettes se touchent presque, le gras ferait déborder celle du mois choisi sur ses voisines.
  const wide = useMedia("(min-width: 768px)");
  const rows = (data?.months ?? []).map((r) => ({
    month: r.month,
    label: monthShort(r.month),
    revenus: Math.round(Number(r.revenus)),
    depenses: Math.round(Number(r.depenses)),
  }));
  if (rows.length < 2) return null;
  // Mois affiché : bande d'accent derrière ses barres et étiquette en gras (les autres mois restent lisibles : c'est une tendance).
  const sel = rows.find((r) => r.month === selected)?.label ?? null;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-semibold">{t("12 derniers mois")}</span>
        <span className="flex items-center gap-3 text-xs text-muted">
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-pos" /> {t("revenus")}</span>
          <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-accent" /> {t("dépenses")}</span>
        </span>
      </div>
      <div className="h-40">
        <ResponsiveContainer>
          <BarChart
            data={rows}
            margin={{ left: -8, right: 0, top: 4, bottom: 0 }}
            barGap={1}
            onClick={(e) => {
              const m = (e as { activeLabel?: string } | null)?.activeLabel;
              const row = rows.find((r) => r.label === m);
              if (row) onSelect(row.month);
            }}
          >
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} tick={<AxisTick selected={sel} weight={wide ? 700 : 400} />} />
            <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => `${(v / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} k`} />
            <Tooltip
              cursor={{ fill: "var(--color-bg)" }}
              formatter={(v, name) => [money(Number(v), true), name === "revenus" ? t("Revenus") : t("Dépenses")]}
              labelFormatter={(l) => {
                const row = rows.find((r) => r.label === l);
                return row ? monthLabel(row.month) : String(l);
              }}
              contentStyle={{ background: "var(--color-card)", border: "none", borderRadius: 12 }}
            />
            {sel && <ReferenceArea x1={sel} x2={sel} {...SELECTED_BAND} />}
            <Bar dataKey="revenus" fill="var(--color-pos)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="depenses" fill="var(--color-accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 text-center text-[11px] text-muted">{t("Choisis un mois pour l'afficher")} · {monthLabel(selected)}</div>
      <Link to="/comparer" className="press mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-accent-soft py-2 text-[14px] font-semibold text-accent md:hidden">
        {t("Comparer avec une autre période")}
      </Link>
    </Card>
  );
}
