import { Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { kMoney, money, unitMoney } from "../format.ts";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Barres empilées (ordinateur) : séries de couleur fixe (palette des graphiques), légende dès deux
 * séries, info-bulle avec le détail et le total, clic sur une barre (forage, document, fiche).
 * `selected` (valeur de l'axe) marque la barre choisie : bande de la couleur d'accent derrière elle,
 * étiquette en gras, autres barres estompées — la même teinte que la ligne choisie d'un tableau. La bande
 * passe au-dessus du voile de survol (couche 250) : elle reste visible juste après le clic.
 * `selectedSeries` marque une série choisie (poche d'une projection) : les autres s'estompent, dans
 * les barres comme dans la légende. `AxisTick` et `SELECTED_BAND` servent aux graphiques écrits à la main.
 */

export type BarSeries = { key: string; label: string; color: string };

/** Opacité des barres qui ne sont pas choisies. */
export const DIM = 0.38;
/** Bande derrière l'élément choisi d'un graphique (à poser sur un `ReferenceArea`, avec `x1` = `x2` = sa valeur). */
export const SELECTED_BAND = { fill: "var(--color-accent-soft)", fillOpacity: 1, stroke: "none", ifOverflow: "visible", zIndex: 250 } as const;

const keur = (v: number) => (Math.abs(v) >= 1000 ? kMoney(v) : unitMoney(v));

export function StackedBars<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 220,
  onBarClick,
  selected,
  selectedSeries,
  xFormatter,
  labelFormatter,
  totalLabel = t("Total"),
  extra,
}: {
  data: T[];
  xKey: keyof T & string;
  series: BarSeries[];
  height?: number;
  onBarClick?: (row: T, seriesKey: string) => void;
  /** Barre choisie (valeur de `xKey`) : mise en avant, les autres sont estompées. */
  selected?: string | null;
  /** Série choisie (clé) : les autres séries sont estompées. */
  selectedSeries?: string | null;
  xFormatter?: (v: string) => string;
  labelFormatter?: (row: T) => string;
  totalLabel?: string;
  /** Ligne supplémentaire de l'info-bulle (taux moyen, bulletins…). */
  extra?: (row: T) => string | null;
}) {
  const has = selected != null && data.some((row) => String(row[xKey]) === selected);
  const hasSeries = selectedSeries != null && series.some((s) => s.key === selectedSeries);
  return (
    <>
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: 4, right: 4, top: 6, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis
              dataKey={xKey as string}
              tickLine={false}
              axisLine={false}
              tick={has ? <AxisTick selected={selected} format={xFormatter} /> : { fontSize: 11, fill: "var(--color-muted)" }}
              tickFormatter={xFormatter ? (v) => xFormatter(String(v)) : undefined}
              interval="preserveStartEnd"
              minTickGap={8}
            />
            <YAxis width={56} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickFormatter={keur} />
            <Tooltip
              cursor={{ fill: "var(--color-bg)" }}
              content={<Tip<T> series={series} rowLabel={labelFormatter} totalLabel={totalLabel} rowExtra={extra} xKey={xKey} />}
            />
            {has && <ReferenceArea x1={selected!} x2={selected!} {...SELECTED_BAND} />}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="s"
                fill={s.color}
                fillOpacity={hasSeries && s.key !== selectedSeries ? DIM : 1}
                style={{ transition: "fill-opacity 200ms ease-out" }}
                stroke="var(--color-card)"
                strokeWidth={1}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
                cursor={onBarClick ? "pointer" : undefined}
                onClick={onBarClick ? (d: { payload?: T }) => d.payload && onBarClick(d.payload, s.key) : undefined}
              >
                {has && data.map((row) => <Cell key={String(row[xKey])} fillOpacity={String(row[xKey]) === selected && !(hasSeries && s.key !== selectedSeries) ? 1 : DIM} style={{ transition: "fill-opacity 200ms ease-out" }} />)}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {series.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-x-4 text-[12px]">
          {series.map((s) => (
            <span key={s.key} className={cn("flex items-center gap-1.5 transition-opacity", hasSeries && (s.key === selectedSeries ? "font-semibold" : "opacity-45"))}>
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Étiquette de l'axe : celle de l'élément choisi est en gras, à l'encre. Garder `tickFormatter` sur l'axe
 * (Recharts s'en sert pour mesurer les étiquettes). `every` : axe serré, une étiquette sur n — celle de
 * l'élément choisi est toujours écrite et ses voisines lui laissent la place (axe en `interval={0}`).
 */
export function AxisTick({
  x,
  y,
  payload,
  index = 0,
  selected,
  selectedIndex = -1,
  every = 1,
  weight = 700,
  format,
}: {
  x?: number;
  y?: number;
  payload?: { value: unknown };
  index?: number;
  selected?: string | null;
  selectedIndex?: number;
  every?: number;
  weight?: number;
  format?: (v: string) => string;
}) {
  const v = String(payload?.value ?? "");
  const on = v === selected;
  if (every > 1 && !on && (index % every !== 0 || (selectedIndex >= 0 && Math.abs(index - selectedIndex) < every))) return null;
  return (
    <text x={x} y={y} dy={12} textAnchor="middle" fontSize={11} fontWeight={on ? weight : 400} fill={on ? "var(--color-ink)" : "var(--color-muted)"}>
      {format ? format(v) : v}
    </text>
  );
}

function Tip<T extends Record<string, unknown>>({
  active,
  payload,
  series,
  rowLabel,
  totalLabel,
  rowExtra,
  xKey,
}: Partial<TooltipContentProps<number, string>> & { series: BarSeries[]; rowLabel?: (row: T) => string; totalLabel: string; rowExtra?: (row: T) => string | null; xKey: string }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload as T;
  const total = series.reduce((s, x) => s + (Number(row[x.key]) || 0), 0);
  const more = rowExtra?.(row);
  return (
    <div className="min-w-44 chart-tip">
      <div className="mb-1 font-medium text-muted">{rowLabel ? rowLabel(row) : String(row[xKey])}</div>
      {series.length > 1 &&
        [...series].reverse().map((s) => (
          <div key={s.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tnum">{money(Number(row[s.key]) || 0, true)}</span>
          </div>
        ))}
      <div className={series.length > 1 ? "mt-1 flex justify-between gap-4 border-t border-line pt-1 font-semibold" : "flex justify-between gap-4 font-semibold"}>
        <span>{series.length > 1 ? totalLabel : series[0].label}</span>
        <span className="tnum">{money(total, true)}</span>
      </div>
      {more && <div className="mt-0.5 text-muted">{more}</div>}
    </div>
  );
}
