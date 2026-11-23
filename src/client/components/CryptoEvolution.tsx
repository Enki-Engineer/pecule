import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { Card, InfoTip } from "./ui.tsx";
import { cn } from "../cn.ts";
import { dateFr, kAxis, money, pct } from "../format.ts";
import { locale, t } from "../../lib/i18n.ts";
import { HISTORY_RANGES, historyRangeStart, historyRangeUseful, type HistoryRange } from "../../lib/wealth.ts";

/*
 * Évolution de la valeur des cryptos, en bas de l'écran Crypto : un point par jour (les instantanés du patrimoine),
 * le dernier étant la valeur à l'instant. Mêmes durées que la courbe du patrimoine.
 */

type Point = { date: string; t: number; value: number };
const DAY = 86_400_000;
const RANGE_LABELS: Record<HistoryRange, string> = { "1m": t("1 mois"), "3m": t("3 mois"), "6m": t("6 mois"), tout: t("Tout") };
const RANGES = [...(Object.keys(HISTORY_RANGES) as HistoryRange[]), "tout"] as const;

/** Graduations : chaque lundi (ou un sur deux) sur une période courte, le début des mois sinon. */
function ticksOf(data: Point[]): number[] {
  const first = data[0].t;
  const last = data[data.length - 1].t;
  const days = (last - first) / DAY;
  const out: number[] = [];
  const d = new Date(first);
  if (days <= 75) {
    d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
    for (; d.getTime() <= last; d.setUTCDate(d.getUTCDate() + (days > 40 ? 14 : 7))) out.push(d.getTime());
    return out;
  }
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + 1);
  for (; d.getTime() <= last; d.setUTCMonth(d.getUTCMonth() + (days > 540 ? 3 : days > 240 ? 2 : 1))) out.push(d.getTime());
  return out;
}

function Tip({ active, payload }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  return (
    <div className="chart-tip">
      <div className="font-medium text-muted">{dateFr(p.date)}</div>
      <div className="tnum font-semibold">{money(p.value, true)}</div>
    </div>
  );
}

export function CryptoEvolution({ history }: { history: { date: string; value: number }[] }) {
  const [range, setRange] = useState<HistoryRange>("tout");
  const points: Point[] = history.map((h) => ({ ...h, t: Date.parse(`${h.date}T12:00:00Z`) }));
  // Deux points au moins pour une courbe : le premier jour, il n'y a encore rien à tracer.
  if (points.length < 2) return null;
  const ranges = RANGES.filter((r) => historyRangeUseful(r, points[0].t));
  const shown = ranges.includes(range) ? range : "tout";
  const data = points.filter((p) => p.t >= historyRangeStart(shown));
  const first = data[0];
  const last = data[data.length - 1];
  const delta = last.value - first.value;
  const values = data.map((p) => p.value);
  const pad = Math.max((Math.max(...values) - Math.min(...values)) * 0.12, Math.max(...values) * 0.01, 1);
  const short = (last.t - first.t) / DAY <= 75;
  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-1.5 font-semibold">
          {t("Évolution")}
          <InfoTip text={t("La valeur de tes cryptos relevée chaque jour ; le dernier point est la valeur à l'instant. Un portefeuille ajouté ou retiré fait bouger la courbe comme un achat ou une vente.")} />
        </h2>
        {ranges.length > 1 && (
          <div className="flex gap-1 text-[12px]">
            {ranges.map((r) => (
              <button key={r} type="button" aria-pressed={shown === r} onClick={() => setRange(r)} className={cn("press rounded-md px-2 py-1", shown === r ? "bg-accent-soft font-medium text-ink" : "text-muted hover:bg-bg")}>
                {RANGE_LABELS[r]}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="tnum mb-2 text-sm text-muted">
        <span className={cn("font-medium", delta >= 0 ? "text-pos" : "text-neg")}>
          {delta >= 0 ? "+" : ""}
          {money(delta, true)}
          {first.value > 0 && ` (${delta >= 0 ? "+" : ""}${pct((delta / first.value) * 100, 1)})`}
        </span>{" "}
        {t("depuis le {date}", { date: dateFr(first.date) })}
      </div>
      <div className="h-44">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
            <defs>
              <linearGradient id="crypto-evolution" x1="0" y1="0" x2="0" y2="1">
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
              ticks={ticksOf(data)}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted)" }}
              tickFormatter={(v: number) => new Date(v).toLocaleDateString(locale(), short ? { day: "numeric", month: "short", timeZone: "UTC" } : { month: "short", timeZone: "UTC" })}
            />
            <YAxis
              width={52}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted)" }}
              tickFormatter={(v: number) => kAxis(v, Math.max(...values) < 20_000 ? 1 : 0)}
              domain={[Math.max(0, Math.min(...values) - pad), Math.max(...values) + pad]}
            />
            <Tooltip content={<Tip />} cursor={{ stroke: "var(--color-muted)", strokeDasharray: "3 3" }} />
            <Area type="monotone" dataKey="value" stroke="var(--color-accent)" fill="url(#crypto-evolution)" strokeWidth={2} isAnimationActive={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
