import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { kMoney, money, unitMoney } from "../format.ts";
import { locale } from "../../lib/i18n.ts";

/*
 * Graphique demandé par l'assistant (outil show_chart) : barres, barres empilées, barres
 * horizontales ou courbe ; couleurs de la palette des graphiques, légende dès deux séries.
 * Chargé à la demande (recharts reste hors du paquet principal).
 */

export type ChatChartSpec = {
  type: "bar" | "stacked_bar" | "line" | "horizontal_bar";
  title: string;
  unit?: "eur" | "pct" | "count";
  labels: string[];
  series: { name: string; values: (number | null)[] }[];
  note?: string;
};

const color = (i: number) => (i < 8 ? `var(--series-${i + 1})` : "#9aa5b4");

/** « 2026-03 » → « mars 26 » ; le reste tel quel. */
const tick = (v: string) => (/^\d{4}-\d{2}$/.test(v) ? new Date(`${v}-15T12:00:00`).toLocaleDateString(locale(), { month: "short", year: "2-digit" }) : v);

export default function ChatChart({ chart }: { chart: ChatChartSpec }) {
  const fmt = (v: number) => (chart.unit === "pct" ? `${v.toLocaleString(locale(), { maximumFractionDigits: 1 })} %` : chart.unit === "count" ? v.toLocaleString(locale()) : money(v, Math.abs(v) >= 100));
  const axis = (v: number) =>
    chart.unit === "eur" || !chart.unit
      ? Math.abs(v) >= 1000
        ? kMoney(v, Math.abs(v) >= 10_000 ? 0 : 1)
        : unitMoney(v)
      : fmt(v);
  // Largeur des libellés des barres horizontales : d'après le plus long (≈ 6 px par caractère).
  const labelWidth = Math.min(180, Math.max(60, Math.max(...chart.labels.map((l) => l.length)) * 6 + 8));
  const data = chart.labels.map((label, i) => ({ label, ...Object.fromEntries(chart.series.map((s, j) => [`s${j}`, s.values[i]])) }));
  const horizontal = chart.type === "horizontal_bar";
  const height = horizontal ? Math.max(140, chart.labels.length * 28 + 30) : 200;
  const common = { data, margin: { left: 0, right: 8, top: 6, bottom: 0 } };
  const tip = (
    <Tooltip
      cursor={{ fill: "var(--color-bg)" }}
      formatter={(v, name) => [fmt(Number(v)), chart.series[Number(String(name).slice(1))]?.name ?? String(name)]}
      labelFormatter={(l) => tick(String(l))}
    />
  );
  return (
    <figure className="card w-full p-3">
      <figcaption className="mb-2 text-[13px] font-semibold">{chart.title}</figcaption>
      <div style={{ height }}>
        <ResponsiveContainer>
          {chart.type === "line" ? (
            <LineChart {...common}>
              <CartesianGrid vertical={false} stroke="var(--color-line)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickFormatter={tick} interval="preserveStartEnd" minTickGap={6} />
              <YAxis width={48} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickFormatter={axis} />
              {tip}
              {chart.series.map((_s, j) => (
                <Line key={j} dataKey={`s${j}`} name={`s${j}`} stroke={color(j)} strokeWidth={2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              ))}
            </LineChart>
          ) : (
            <BarChart {...common} layout={horizontal ? "vertical" : "horizontal"} barCategoryGap="20%">
              <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--color-line)" />
              {horizontal ? (
                <>
                  <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickFormatter={axis} />
                  <YAxis type="category" dataKey="label" width={labelWidth} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted)" }} />
                </>
              ) : (
                <>
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickFormatter={tick} interval="preserveStartEnd" minTickGap={4} />
                  <YAxis width={48} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--color-muted)" }} tickFormatter={axis} />
                </>
              )}
              {tip}
              {chart.series.map((_s, j) => (
                <Bar
                  key={j}
                  dataKey={`s${j}`}
                  name={`s${j}`}
                  fill={color(j)}
                  stackId={chart.type === "stacked_bar" ? "s" : undefined}
                  stroke="var(--color-card)"
                  strokeWidth={chart.type === "stacked_bar" ? 1 : 0}
                  radius={chart.type === "stacked_bar" ? 0 : horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
      {chart.series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {chart.series.map((s, j) => (
            <span key={j} className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: color(j) }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      {chart.note && <p className="mt-1.5 text-[11px] text-muted">{chart.note}</p>}
    </figure>
  );
}
