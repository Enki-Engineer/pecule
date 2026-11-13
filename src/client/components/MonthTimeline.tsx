import { useEffect, useMemo, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import { Card, ErrorBox, Spinner } from "./ui.tsx";
import { Stat, StatGrid } from "./blocks.tsx";
import { openDrill, type DrillFilters } from "./DrillDrawer.tsx";
import { kMoney, money } from "../format.ts";
import { cn } from "../cn.ts";
import { natureColor } from "../charts.ts";
import { useFlows, useTimeline, type Expected, type Timeline } from "../api-analysis.ts";
import { NATURE_LABELS } from "../../lib/nature.ts";
import { bubbleRadius, cumulativeNet, laneOf, LANES, niceTicks, stackOffsets, type Lane, type TimelinePoint } from "../../lib/timeline.ts";
import { locale, t, td, tn } from "../../lib/i18n.ts";

/*
 * Analyse → Frise (ordinateur) : les paiements du mois posés sur le calendrier. Un couloir par sens et par moyen de
 * paiement (entrées, prélèvements, carte, virements, espèces, frais, épargne), une bulle par opération dont l'aire dit
 * le montant, et dessous, sur le même axe des jours, le reste du mois qui monte et descend. Pour le mois en cours,
 * les prélèvements habituels pas encore passés sont en pointillé, et le reste est prolongé jusqu'à eux.
 * Survol d'un jour : son détail ; clic : ses opérations (tiroir). Le bouton « Tableau » donne la même chose en liste.
 */

const GUTTER = 138;
const RIGHT = 18;
const TOP = 26;
const AXIS = 30;
const CUM_HEAD = 30;
const CUM_H = 150;
/** Au-delà, les plus petits paiements d'un même jour et d'un même couloir sont réunis en une bulle « + n autres ». */
const MAX_PER_DAY = 7;
const LANE_MIN = 46;
const LANE_MAX = 128;

const laneLabel = (l: Lane) => (l === "entrees" ? NATURE_LABELS.entree : l === "epargne" ? t("Épargne") : NATURE_LABELS[l]);
const laneColor = (l: Lane) => (l === "entrees" ? "var(--color-pos)" : l === "epargne" ? "var(--series-6)" : natureColor(l));
const k = (n: number) => (Math.abs(n) >= 10_000 ? kMoney(n, 0) : Math.abs(n) >= 1000 ? kMoney(n, 1) : money(n, true));
const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
const dayDate = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`;
const longDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Largeur d'un élément, suivie quand la fenêtre ou le panneau de l'assistant changent. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

export function TimelineTab({ month }: { month: string }) {
  const tl = useTimeline(month);
  const flows = useFlows(month);
  const [table, setTable] = useState(false);
  const data = tl.data;
  const f = flows.data;
  const busiest = useMemo(() => {
    const out = new Map<number, number>();
    for (const p of data?.points ?? []) if (p.amount < 0 && p.kind === "depense") out.set(p.day, (out.get(p.day) ?? 0) - p.amount);
    return [...out.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  }, [data]);
  const upcoming = (data?.upcoming ?? []).reduce((s, x) => s + x.amount, 0);
  const payments = (data?.points ?? []).filter((p) => p.amount < 0 && p.kind === "depense").length;
  return (
    <>
      {tl.error && <ErrorBox error={tl.error} />}
      {f && data && (
        <StatGrid>
          <Stat label={t("Entrées")} value={money(f.totals.income, true)} hint={f.totals.refunds ? t("+ {montant} de remboursements", { montant: money(f.totals.refunds, true) }) : t("revenus du mois")} />
          <Stat label={t("Sorties")} value={money(f.totals.grossSpend, true)} hint={tn("{n} paiement", "{n} paiements", payments)} />
          <Stat
            label={t("Jour le plus chargé")}
            value={busiest ? money(busiest[1], true) : "—"}
            hint={busiest ? <span className="capitalize">{longDay(dayDate(month, busiest[0]))}</span> : t("aucune sortie ce mois-ci")}
          />
          {data.today != null ? (
            <Stat label={t("Encore attendu")} value={money(upcoming, true)} hint={data.upcoming.length ? tn("{n} prélèvement habituel d'ici la fin du mois", "{n} prélèvements habituels d'ici la fin du mois", data.upcoming.length) : t("aucun prélèvement habituel en vue")} />
          ) : (
            <Stat label={t("Reste du mois")} value={money(f.totals.balance, true)} tone={f.totals.balance >= 0 ? "pos" : "neg"} hint={t("entrées − sorties − épargne")} />
          )}
        </StatGrid>
      )}
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="text-[14px] font-semibold">{t("Les paiements au fil du mois")}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
            {!table && (
              <>
                <span className="flex items-center gap-1.5">
                  <svg width="30" height="16" aria-hidden>
                    <circle cx="6" cy="8" r="3.5" fill="var(--color-muted)" />
                    <circle cx="21" cy="8" r="7.5" fill="var(--color-muted)" />
                  </svg>
                  {t("la taille suit le montant")}
                </span>
                {!!data?.upcoming.length && (
                  <span className="flex items-center gap-1.5">
                    <svg width="16" height="16" aria-hidden>
                      <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeDasharray="3 2.5" />
                    </svg>
                    {t("prélèvement attendu")}
                  </span>
                )}
              </>
            )}
            <button type="button" onClick={() => setTable((v) => !v)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-bg" aria-pressed={table}>
              <Table2 size={13} /> {table ? t("Graphique") : t("Tableau")}
            </button>
          </div>
        </div>
        {!data ? (
          <Spinner />
        ) : !data.points.length && !data.upcoming.length ? (
          <div className="py-16 text-center text-sm text-muted">{t("Pas encore de mouvements ce mois-ci.")}</div>
        ) : table ? (
          <TimelineTable data={data} month={month} />
        ) : (
          <div className={cn("transition-opacity duration-200", tl.isPlaceholderData && "opacity-50")}>
            <Frise data={data} month={month} />
            <p className="mt-2 text-[12px] text-muted">{t("Survole un jour pour son détail · clic sur un jour ou sur une bulle : ses opérations · mouvements internes exclus")}</p>
          </div>
        )}
      </Card>
    </>
  );
}

/** Une bulle : une opération, ou le regroupement des plus petites d'un jour chargé (`more` = combien, `p.amount` = leur somme). */
type Placed = { key: string; p: TimelinePoint; more?: number; lane: Lane; r: number; cx: number; cy: number };

/** Ouvre les opérations d'un jour ; d'une bulle, celles de son couloir ce jour-là. */
function drillDay(month: string, day: number, lane?: Lane, nature?: string) {
  const date = dayDate(month, day);
  const filters: DrillFilters = { month, day: date };
  if (lane === "entrees") filters.credits = true;
  else if (lane && lane !== "epargne") Object.assign(filters, { nature, debits: true });
  const title = lane ? `${laneLabel(lane)} · ${new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "long" })}` : t("Opérations du {date}", { date: new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "long" }) });
  openDrill(title, filters);
}

function Frise({ data, month }: { data: Timeline; month: string }) {
  const [ref, measured] = useWidth();
  const [hover, setHover] = useState<{ day: number; id?: string } | null>(null);
  const width = Math.max(measured, 640);
  const [y0, m0] = month.split("-").map(Number);
  const days = new Date(y0, m0, 0).getDate();
  const colW = (width - GUTTER - RIGHT) / days;
  const xOf = (day: number) => GUTTER + (day - 0.5) * colW;
  const isWeekend = (day: number) => [0, 6].includes(new Date(y0, m0 - 1, day).getDay());
  const upTo = data.today ?? days;

  const layout = useMemo(() => {
    // Rayon plafonné par la largeur d'un jour : deux grosses bulles voisines ne se recouvrent pas trop.
    const rMax = Math.max(9, Math.min(20, colW * 0.62));
    const byLane = new Map<Lane, Map<number, TimelinePoint[]>>();
    for (const p of data.points) {
      const l = laneOf(p);
      const perDay = byLane.get(l) ?? new Map<number, TimelinePoint[]>();
      perDay.set(p.day, [...(perDay.get(p.day) ?? []), p]);
      byLane.set(l, perDay);
    }
    if (data.upcoming.length && !byLane.has("prelevement")) byLane.set("prelevement", new Map());
    // Un jour chargé (relevé d'une carte à débit différé…) : les plus gros paiements, puis une bulle pour le reste.
    type Item = { key: string; p: TimelinePoint; more?: number };
    const itemsOf = (lane: Lane, day: number, list: TimelinePoint[]): Item[] => {
      const sorted = [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      if (sorted.length <= MAX_PER_DAY) return sorted.map((p) => ({ key: `${p.id}:${p.kind}`, p }));
      const rest = sorted.slice(MAX_PER_DAY - 1);
      const sum = rest.reduce((t, p) => t + p.amount, 0);
      return [...sorted.slice(0, MAX_PER_DAY - 1).map((p) => ({ key: `${p.id}:${p.kind}`, p })), { key: `+${lane}:${day}`, p: { ...rest[0], id: `+${lane}:${day}`, amount: sum }, more: rest.length }];
    };
    const groups = LANES.filter((l) => byLane.has(l)).map((lane) => ({ lane, days: [...byLane.get(lane)!.entries()].map(([day, list]) => ({ day, count: list.length, total: list.reduce((t, p) => t + p.amount, 0), items: itemsOf(lane, day, list) })) }));
    const largest = Math.max(1, ...groups.flatMap((g) => g.days.flatMap((d) => d.items.map((i) => Math.abs(i.p.amount)))), ...data.upcoming.map((x) => x.amount));
    let y = TOP;
    const lanes: { lane: Lane; top: number; height: number; total: number; count: number }[] = [];
    const placed: Placed[] = [];
    const ghosts: { x: Expected; r: number; cx: number; cy: number }[] = [];
    for (const { lane, days: laneDays } of groups) {
      const stacks = laneDays.map((d) => {
        const items = [...d.items].sort((a, b) => Math.abs(b.p.amount) - Math.abs(a.p.amount));
        const radii = items.map((i) => bubbleRadius(i.p.amount, largest, rMax));
        return { day: d.day, items, radii, ...stackOffsets(radii) };
      });
      const expected = lane === "prelevement" ? data.upcoming.filter((x) => x.day <= days) : [];
      const extent = Math.max(0, ...stacks.map((s) => s.extent), ...expected.map((x) => bubbleRadius(x.amount, largest, rMax)));
      const height = Math.min(LANE_MAX, Math.max(LANE_MIN, extent * 2 + 18));
      // Une pile plus haute que le couloir est resserrée (les bulles se recouvrent un peu).
      const room = (height - 10) / 2;
      const cy = y + height / 2;
      for (const s of stacks) {
        const squeeze = s.extent > room ? room / s.extent : 1;
        s.items.forEach((it, i) => placed.push({ ...it, lane, r: s.radii[i], cx: xOf(s.day), cy: cy + s.offsets[i] * squeeze }));
      }
      // Attendus : décalés si une opération occupe déjà le centre de ce jour.
      for (const x of expected) {
        const r = bubbleRadius(x.amount, largest, rMax);
        const taken = stacks.find((s) => s.day === x.day);
        ghosts.push({ x, r, cx: xOf(x.day), cy: taken ? Math.min(cy + room - r, cy + taken.extent + r + 2) : cy });
      }
      lanes.push({ lane, top: y, height, total: laneDays.reduce((t, d) => t + d.total, 0), count: laneDays.reduce((t, d) => t + d.count, 0) });
      y += height;
    }
    return { lanes, placed, ghosts, lanesBottom: y };
  }, [data, colW, days]);

  const cum = useMemo(() => cumulativeNet(data.points, days, upTo), [data, days, upTo]);
  // Prolongement (mois en cours) : le reste après les prélèvements attendus, jour après jour.
  const projection = useMemo(() => {
    if (data.today == null || !data.upcoming.length) return null;
    let v = cum[upTo - 1] ?? 0;
    const out: { day: number; value: number }[] = [{ day: upTo, value: v }];
    for (let d = upTo; d <= days; d++) {
      const due = data.upcoming.filter((x) => Math.min(x.day, days) === d).reduce((s, x) => s + x.amount, 0);
      if (d > upTo || due) {
        v -= due;
        out.push({ day: d, value: v });
      }
    }
    return out;
  }, [data, cum, upTo, days]);

  const axisY = layout.lanesBottom;
  const cumTop = axisY + AXIS + CUM_HEAD;
  const cumBottom = cumTop + CUM_H;
  const height = cumBottom + 10;
  const values = [...cum.filter((v): v is number => v != null), ...(projection ?? []).map((p) => p.value)];
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = Math.min(0, ...values, ...ticks);
  const hi = Math.max(0, ...values, ...ticks);
  const yOf = (v: number) => cumBottom - 8 - ((v - lo) / (hi - lo || 1)) * (CUM_H - 22);
  const edge = (day: number) => GUTTER + day * colW;

  // Courbe en escalier : le reste change le jour de l'opération et tient jusqu'à la suivante.
  let line = `M${GUTTER},${yOf(0)}`;
  for (let d = 1; d <= upTo; d++) line += ` V${yOf(cum[d - 1] ?? 0)} H${edge(d)}`;
  const area = `${line} V${yOf(0)} H${GUTTER} Z`;
  const last = cum[upTo - 1] ?? 0;
  let dashed = "";
  if (projection) {
    dashed = `M${edge(upTo)},${yOf(last)}`;
    for (let d = upTo + 1; d <= days; d++) {
      const v = projection.findLast((p) => p.day <= d)?.value ?? last;
      dashed += ` V${yOf(v)} H${edge(d)}`;
    }
  }
  const projected = projection?.at(-1)?.value ?? null;

  // Étiquettes : seulement les plus grosses bulles, jamais deux trop proches dans un couloir ; du côté libre (pas par-dessus
  // une autre bulle ni un prélèvement attendu), et aucune si les deux côtés sont pris.
  const labels = useMemo(() => {
    const out: (Placed & { end: boolean; value: string; name: string })[] = [];
    const busy = (b: Placed, from: number, to: number) =>
      layout.placed.some((o) => o !== b && o.cx !== b.cx && o.cx + o.r > from && o.cx - o.r < to && Math.abs(o.cy - b.cy) < o.r + 9) || layout.ghosts.some((g) => g.cx + g.r > from && g.cx - g.r < to && Math.abs(g.cy - b.cy) < g.r + 9);
    for (const b of [...layout.placed].sort((a, c) => c.r - a.r)) {
      if (b.r < 8 || out.length >= 9) break;
      if (out.some((o) => o.lane === b.lane && Math.abs(o.cx - b.cx) < 130)) continue;
      const value = k(Math.abs(b.p.amount));
      const name = b.more ? tn("+ {n} autre", "+ {n} autres", b.more) : clip(b.p.name, 20);
      // Largeur estimée du texte (11,5 px) : assez pour savoir s'il tient à droite ou à gauche de la bulle.
      const span = b.r + 10 + (value.length + name.length + 1) * 6.4;
      const right = b.cx + span < width - RIGHT && !busy(b, b.cx + b.r, b.cx + span);
      const left = b.cx - span > GUTTER && !busy(b, b.cx - span, b.cx - b.r);
      if (right || left) out.push({ ...b, end: !right, value, name });
    }
    return out;
  }, [layout, width]);

  const h = hover;
  const dayOps = h ? data.points.filter((p) => p.day === h.day).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)) : [];
  const dayGhosts = h ? layout.ghosts.filter((g) => g.x.day === h.day) : [];
  const flip = h ? h.day > days * 0.58 : false;

  return (
    <div ref={ref} className="relative select-none">
      <svg width={width} height={height} role="img" aria-label={t("Frise des paiements du mois : une bulle par opération, par jour et par moyen de paiement")} className="block">
        {/* Week-ends : bande discrète sur toute la hauteur. */}
        {Array.from({ length: days }, (_, i) => i + 1)
          .filter(isWeekend)
          .map((d) => (
            <rect key={`w${d}`} x={edge(d - 1)} y={TOP} width={colW} height={cumBottom - TOP} fill="var(--color-bg)" fillOpacity={0.7} />
          ))}
        {h && <rect x={edge(h.day - 1)} y={TOP} width={colW} height={cumBottom - TOP} fill="var(--color-accent-soft)" />}

        {/* Couloirs */}
        {layout.lanes.map((l) => (
          <g key={l.lane}>
            <line x1={0} x2={width} y1={l.top} y2={l.top} stroke="var(--color-line)" />
            <circle cx={7} cy={l.top + l.height / 2 - 8} r={4.5} fill={laneColor(l.lane)} />
            <text x={18} y={l.top + l.height / 2 - 8} dy="0.35em" fontSize={12.5} fontWeight={600} fill="var(--color-ink)">
              {laneLabel(l.lane)}
            </text>
            <text x={18} y={l.top + l.height / 2 + 9} dy="0.35em" fontSize={11.5} fill="var(--color-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {l.count ? `${money(Math.abs(l.total), true)} · ${l.count}` : t("à venir")}
            </text>
          </g>
        ))}
        <line x1={0} x2={width} y1={axisY} y2={axisY} stroke="var(--color-line)" />

        {/* Aujourd'hui */}
        {data.today != null && (
          <g>
            <line x1={edge(data.today)} x2={edge(data.today)} y1={TOP - 6} y2={cumBottom} stroke="var(--color-accent)" strokeWidth={1.5} />
            <text x={edge(data.today)} y={TOP - 12} textAnchor={data.today > days - 3 ? "end" : "middle"} fontSize={11} fontWeight={600} fill="var(--color-accent)">
              {t("aujourd'hui")}
            </text>
          </g>
        )}

        {/* Axe des jours */}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <text key={`d${d}`} x={xOf(d)} y={axisY + 18} textAnchor="middle" fontSize={11} fontWeight={h?.day === d || data.today === d ? 700 : 400} fill={h?.day === d || data.today === d ? "var(--color-ink)" : "var(--color-muted)"} style={{ fontVariantNumeric: "tabular-nums" }}>
            {colW >= 22 || d === 1 || d % 5 === 0 || d === days ? d : ""}
          </text>
        ))}

        {/* Reste du mois, cumulé */}
        <line x1={0} x2={width} y1={axisY + AXIS} y2={axisY + AXIS} stroke="var(--color-line)" />
        <text x={18} y={axisY + AXIS + 19} fontSize={12.5} fill="var(--color-muted)">
          <tspan fontWeight={600} fill="var(--color-ink)">
            {t("Reste du mois")}
          </tspan>
          <tspan dx={8}>{t("entrées − sorties, cumulé")}</tspan>
        </text>
        {ticks.map((v) => (
          <g key={`t${v}`}>
            <line x1={GUTTER} x2={width - RIGHT} y1={yOf(v)} y2={yOf(v)} stroke="var(--color-line)" strokeWidth={v === 0 ? 1.5 : 1} />
            <text x={GUTTER - 8} y={yOf(v)} dy="0.35em" textAnchor="end" fontSize={11} fill="var(--color-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {k(v)}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--color-accent)" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {dashed && <path d={dashed} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.7} />}
        <circle cx={edge(upTo)} cy={yOf(last)} r={5} fill="var(--color-accent)" stroke="var(--color-card)" strokeWidth={2} />
        <text
          x={upTo > days - 4 ? edge(upTo) - 10 : edge(upTo) + 10}
          // En fin de mois, l'étiquette passe à gauche du point : au-dessus du tracé, pas dessus.
          y={yOf(last) + (upTo > days - 4 ? (yOf(last) - cumTop > 24 ? -13 : 15) : projected != null && projected < last ? -9 : 0)}
          dy="0.35em"
          textAnchor={upTo > days - 4 ? "end" : "start"}
          fontSize={12}
          fontWeight={700}
          fill="var(--color-ink)"
          stroke="var(--color-card)"
          strokeWidth={3}
          paintOrder="stroke"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {money(last, true)}
        </text>
        {projected != null && upTo <= days - 4 && (
          <text x={width - RIGHT - 4} y={yOf(projected) + 14} textAnchor="end" fontSize={11} fill="var(--color-muted)" stroke="var(--color-card)" strokeWidth={3} paintOrder="stroke">
            {t("≈ {montant} après les prélèvements attendus", { montant: money(projected, true) })}
          </text>
        )}

        {/* Zones de survol : un jour entier (sous les bulles, qui gardent leur propre clic). */}
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <rect key={`h${d}`} x={edge(d - 1)} y={TOP} width={colW} height={cumBottom - TOP} fill="transparent" style={{ cursor: "pointer" }} onMouseEnter={() => setHover({ day: d })} onMouseLeave={() => setHover(null)} onClick={() => drillDay(month, d)} />
        ))}

        {/* Prélèvements attendus */}
        {layout.ghosts.map((g, i) => (
          <circle key={`g${i}`} cx={g.cx} cy={g.cy} r={Math.max(g.r - 1, 3.5)} fill="var(--color-card)" stroke={laneColor("prelevement")} strokeWidth={1.5} strokeDasharray="3 2.5" style={{ pointerEvents: "none" }} />
        ))}

        {/* Opérations */}
        {layout.placed.map((b) => {
          const on = h?.id === b.p.id;
          const dim = h != null && h.day !== b.p.day;
          return (
            <g key={b.key} style={{ cursor: "pointer" }} onMouseEnter={() => setHover({ day: b.p.day, id: b.p.id })} onMouseLeave={() => setHover(null)} onClick={() => drillDay(month, b.p.day, b.lane, b.more ? undefined : b.p.nature)}>
              {/* Cible de clic plus large que la bulle. */}
              <circle cx={b.cx} cy={b.cy} r={Math.max(b.r + 3, 11)} fill="transparent" />
              {b.more ? (
                // Regroupement : même teinte, en voile cerclé, pour ne pas le prendre pour un seul paiement.
                <>
                  <circle cx={b.cx} cy={b.cy} r={b.r} fill="var(--color-card)" stroke="var(--color-card)" strokeWidth={2} />
                  <circle cx={b.cx} cy={b.cy} r={b.r - 0.75} fill={laneColor(b.lane)} fillOpacity={dim ? 0.1 : 0.24} stroke={on ? "var(--color-ink)" : laneColor(b.lane)} strokeOpacity={dim && !on ? 0.4 : 1} strokeWidth={1.5} />
                </>
              ) : (
                <circle cx={b.cx} cy={b.cy} r={b.r} fill={laneColor(b.lane)} fillOpacity={dim ? 0.35 : 0.92} stroke={on ? "var(--color-ink)" : "var(--color-card)"} strokeWidth={2} style={{ transition: "fill-opacity 120ms" }} />
              )}
            </g>
          );
        })}
        {labels.map((b) => {
          const end = b.end;
          return (
            <text
              key={`l${b.key}`}
              x={end ? b.cx - b.r - 6 : b.cx + b.r + 6}
              y={b.cy}
              dy="0.35em"
              textAnchor={end ? "end" : "start"}
              fontSize={11.5}
              fill="var(--color-ink)"
              stroke="var(--color-card)"
              strokeWidth={3}
              paintOrder="stroke"
              opacity={h != null && h.day !== b.p.day ? 0.4 : 1}
              style={{ pointerEvents: "none" }}
            >
              <tspan fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}>
                {b.value}
              </tspan>
              <tspan fill="var(--color-muted)"> {b.name}</tspan>
            </text>
          );
        })}
      </svg>

      {h && (dayOps.length > 0 || dayGhosts.length > 0 || h.day <= upTo) && (
        <div className="pointer-events-none absolute top-1 z-10 w-72 rounded-md border border-line bg-card px-3 py-2 text-[12px] shadow-md" style={flip ? { right: width - edge(h.day - 1) + 10 } : { left: edge(h.day) + 10 }}>
          <div className="mb-1 font-medium capitalize text-muted">{longDay(dayDate(month, h.day))}</div>
          {dayOps.slice(0, 8).map((p) => (
            <div key={`${p.id}:${p.kind}`} className={cn("flex items-center justify-between gap-3 rounded px-1 py-0.5", h.id === p.id && "bg-bg")}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: laneColor(laneOf(p)) }} />
                <span className="truncate">{p.name}</span>
              </span>
              <span className="tnum shrink-0 font-semibold">{signed(p.amount)}</span>
            </div>
          ))}
          {dayOps.length > 8 && <div className="px-1 text-muted">{tn("+ {n} autre", "+ {n} autres", dayOps.length - 8)}</div>}
          {dayGhosts.map((g, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-1 py-0.5 text-muted">
              <span className="truncate">{t("attendu : {nom}", { nom: g.x.name })}</span>
              <span className="tnum shrink-0">≈ {money(-g.x.amount)}</span>
            </div>
          ))}
          {!dayOps.length && !dayGhosts.length && <div className="px-1 text-muted">{t("Aucun paiement ce jour-là.")}</div>}
          {h.day <= upTo && (
            <div className="mt-1 flex justify-between border-t border-line px-1 pt-1">
              <span className="text-muted">{t("Reste du mois, ce soir-là")}</span>
              <span className="tnum font-semibold">{money(cum[h.day - 1] ?? 0, true)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** La frise en tableau : jour après jour, chaque opération avec sa catégorie, son moyen de paiement et son montant. */
function TimelineTable({ data, month }: { data: Timeline; month: string }) {
  const byDay = new Map<number, TimelinePoint[]>();
  for (const p of data.points) byDay.set(p.day, [...(byDay.get(p.day) ?? []), p]);
  const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line text-left text-[12px] text-muted">
            <th className="py-1.5 font-medium">{t("Opération")}</th>
            <th className="py-1.5 font-medium">{t("Catégorie")}</th>
            <th className="py-1.5 font-medium">{t("Moyen")}</th>
            <th className="py-1.5 text-right font-medium">{t("Montant")}</th>
          </tr>
        </thead>
        {days.map(([day, list]) => (
          <tbody key={day} className="divide-y divide-line">
            <tr className="cursor-pointer hover:bg-bg" onClick={() => drillDay(month, day)}>
              <th colSpan={3} className="pb-1 pt-3 text-left text-[12px] font-semibold capitalize">
                {longDay(dayDate(month, day))}
              </th>
              <td className="tnum pb-1 pt-3 text-right text-[12px] font-semibold text-muted">{signed(list.reduce((s, p) => s + p.amount, 0))}</td>
            </tr>
            {list
              .sort((a, b) => a.amount - b.amount)
              .map((p) => {
                const lane = laneOf(p);
                return (
                  <tr key={`${p.id}:${p.kind}`}>
                    <td className="max-w-0 truncate py-1.5 pr-3" style={{ width: "44%" }}>
                      {p.name}
                    </td>
                    <td className="py-1.5 pr-3 text-muted">{p.category ? td(p.category) : t("À classer")}</td>
                    <td className="py-1.5 pr-3 text-muted">
                      <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: laneColor(lane) }} />
                      {laneLabel(lane)}
                    </td>
                    <td className={cn("tnum py-1.5 text-right font-medium", p.amount > 0 && "text-pos")}>{signed(p.amount)}</td>
                  </tr>
                );
              })}
          </tbody>
        ))}
        {data.upcoming.length > 0 && (
          <tbody className="divide-y divide-line">
            <tr>
              <th colSpan={4} className="pb-1 pt-3 text-left text-[12px] font-semibold">
                {t("Prélèvements attendus d'ici la fin du mois")}
              </th>
            </tr>
            {data.upcoming.map((x, i) => (
              <tr key={i} className="text-muted">
                <td className="py-1.5 pr-3">{x.name}</td>
                <td className="py-1.5 pr-3">{x.category ? td(x.category) : "—"}</td>
                <td className="py-1.5 pr-3">{t("vers le {jour}", { jour: x.day })}</td>
                <td className="tnum py-1.5 text-right">≈ {money(-x.amount)}</td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
