import { useEffect, useMemo, useRef, useState } from "react";
import { Table2 } from "lucide-react";
import { Card, ErrorBox, Spinner } from "./ui.tsx";
import { Stat, StatGrid } from "./blocks.tsx";
import { openDrill, type DrillFilters } from "./DrillDrawer.tsx";
import { DateBasisSwitch } from "./DateBasisSwitch.tsx";
import { dateFr, kMoney, money, monthLabel, monthShort } from "../format.ts";
import { cn } from "../cn.ts";
import { natureColor } from "../charts.ts";
import { useFlows, useTimeline, type Expected, type Timeline } from "../api-analysis.ts";
import { NATURE_LABELS, SPEND_NATURES } from "../../lib/nature.ts";
import { isYearPeriod } from "../../lib/periods.ts";
import { bubbleRadius, cumulativeNet, laneOf, LANES, niceTicks, stackOffsets, type Lane, type TimelinePoint } from "../../lib/timeline.ts";
import { locale, t, td, tn } from "../../lib/i18n.ts";

/*
 * Frise (Analyse → Frise, et écran Mois du téléphone) : les paiements d'une période posés sur le calendrier. Un
 * couloir par sens et par moyen de paiement (entrées, prélèvements, carte, virements, espèces, frais, épargne), une
 * bulle par opération dont l'aire dit le montant, et dessous, sur le même axe, le reste de la période qui monte et
 * descend. Pour un mois, un rang = un jour ; pour une année, un rang = un mois. Pour la période en cours, ce qui est
 * attendu d'après les récurrences est en pointillé, et le reste est prolongé jusque-là. Un achat par carte pas
 * encore prélevé est cerclé. Survol d'un rang : son détail ; clic : ses opérations (tiroir). Le bouton « Tableau »
 * donne la même chose en liste.
 */

const RIGHT = 18;
const TOP = 26;
const AXIS = 30;
const CUM_HEAD = 30;
const LANE_MIN = 46;
const LANE_MAX = 128;

const laneLabel = (l: Lane) => (l === "entrees" ? NATURE_LABELS.entree : l === "epargne" ? t("Épargne") : NATURE_LABELS[l]);
const laneColor = (l: Lane) => (l === "entrees" ? "var(--color-pos)" : l === "epargne" ? "var(--series-6)" : natureColor(l));
const k = (n: number) => (Math.abs(n) >= 10_000 ? kMoney(n, 0) : Math.abs(n) >= 1000 ? kMoney(n, 1) : money(n, true));
const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
const pad = (n: number) => String(n).padStart(2, "0");
const longDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
const shortDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { day: "numeric", month: "long" });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Couloir d'une récurrence attendue : ce qui entre, sinon son moyen de paiement. */
const expectedLane = (e: Expected): Lane => (e.amount > 0 ? "entrees" : (SPEND_NATURES as readonly string[]).includes(e.nature) ? (e.nature as Lane) : "prelevement");

/** Un rang de la frise : un jour d'un mois (« 2026-11 », 5) ou un mois d'une année (« 2026 », 3). */
const slotName = (period: string, slot: number) => (isYearPeriod(period) ? monthLabel(`${period}-${pad(slot)}`) : longDay(`${period}-${pad(slot)}`));

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

export function TimelineTab({ period }: { period: string }) {
  const year = isYearPeriod(period);
  const tl = useTimeline(period);
  const flows = useFlows(period);
  const [table, setTable] = useState(false);
  const data = tl.data;
  const f = flows.data;
  const busiest = useMemo(() => {
    const out = new Map<number, number>();
    for (const p of data?.points ?? []) if (p.amount < 0 && p.kind === "depense") out.set(p.slot, (out.get(p.slot) ?? 0) - p.amount);
    return [...out.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  }, [data]);
  const due = (data?.upcoming ?? []).filter((x) => x.amount < 0);
  const dueTotal = Math.abs(due.reduce((s, x) => s + x.amount, 0));
  const late = (data?.overdue ?? []).filter((x) => x.amount < 0).length;
  const payments = (data?.points ?? []).filter((p) => p.amount < 0 && p.kind === "depense").length;
  const waiting = (data?.points ?? []).some((p) => p.pending);
  return (
    <>
      {tl.error && <ErrorBox error={tl.error} />}
      {f && data && (
        <StatGrid>
          <Stat label={t("Entrées")} value={money(f.totals.income, true)} hint={f.totals.refunds ? t("+ {montant} de remboursements", { montant: money(f.totals.refunds, true) }) : year ? t("revenus de l'année") : t("revenus du mois")} />
          <Stat label={t("Sorties")} value={money(f.totals.grossSpend, true)} hint={tn("{n} paiement", "{n} paiements", payments)} />
          <Stat
            label={year ? t("Mois le plus chargé") : t("Jour le plus chargé")}
            value={busiest ? money(busiest[1], true) : "—"}
            hint={busiest ? <span className="capitalize">{slotName(period, busiest[0])}</span> : year ? t("aucune sortie cette année-là") : t("aucune sortie ce mois-ci")}
          />
          {data.today != null ? (
            <Stat
              label={t("Encore attendu")}
              value={money(dueTotal, true)}
              hint={
                due.length
                  ? year
                    ? tn("{n} paiement habituel d'ici trois mois", "{n} paiements habituels d'ici trois mois", due.length)
                    : tn("{n} paiement habituel d'ici la fin du mois", "{n} paiements habituels d'ici la fin du mois", due.length)
                  : late
                    ? tn("{n} paiement habituel n'est pas encore passé ce mois-ci", "{n} paiements habituels ne sont pas encore passés ce mois-ci", late)
                    : t("aucun paiement habituel en vue")
              }
            />
          ) : (
            <Stat label={year ? t("Reste de l'année") : t("Reste du mois")} value={money(f.totals.balance, true)} tone={f.totals.balance >= 0 ? "pos" : "neg"} hint={t("entrées − sorties − épargne")} />
          )}
        </StatGrid>
      )}
      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="text-[14px] font-semibold">{year ? t("Les paiements au fil de l'année") : t("Les paiements au fil du mois")}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
            {!table && <Legend upcoming={!!data?.upcoming.length} waiting={waiting} />}
            <DateBasisSwitch />
            <button type="button" onClick={() => setTable((v) => !v)} className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted hover:bg-bg" aria-pressed={table}>
              <Table2 size={13} /> {table ? t("Graphique") : t("Tableau")}
            </button>
          </div>
        </div>
        {!data ? (
          <Spinner />
        ) : !data.points.length && !data.upcoming.length ? (
          <div className="py-16 text-center text-sm text-muted">{year ? t("Aucun mouvement cette année-là.") : t("Pas encore de mouvements ce mois-ci.")}</div>
        ) : table ? (
          <TimelineTable data={data} period={period} />
        ) : (
          <div className={cn("transition-opacity duration-200", tl.isPlaceholderData && "opacity-50")}>
            <Frise data={data} period={period} />
            <p className="mt-2 text-[12px] text-muted">
              {year ? t("Survole un mois pour son détail · clic sur un mois ou sur une bulle : ses opérations · mouvements internes exclus") : t("Survole un jour pour son détail · clic sur un jour ou sur une bulle : ses opérations · mouvements internes exclus")}
            </p>
          </div>
        )}
      </Card>
    </>
  );
}

/** Frise du téléphone : la même, resserrée, sous la répartition de l'écran Mois ; toucher un jour ouvre ses opérations. */
export function MobileTimeline({ period }: { period: string }) {
  const year = isYearPeriod(period);
  const tl = useTimeline(period);
  const data = tl.data;
  if (!data || (!data.points.length && !data.upcoming.length)) return null;
  return (
    <Card className="p-4">
      <div className="mb-1 text-sm font-semibold">{year ? t("Les paiements au fil de l'année") : t("Les paiements au fil du mois")}</div>
      <div className={cn("transition-opacity duration-200", tl.isPlaceholderData && "opacity-50")}>
        <Frise data={data} period={period} compact />
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-muted">{year ? t("La taille suit le montant · touche un mois pour ses opérations") : t("La taille suit le montant · touche un jour pour ses opérations")}</p>
        <DateBasisSwitch />
      </div>
    </Card>
  );
}

function Legend({ upcoming, waiting }: { upcoming: boolean; waiting: boolean }) {
  return (
    <>
      <span className="flex items-center gap-1.5">
        <svg width="30" height="16" aria-hidden>
          <circle cx="6" cy="8" r="3.5" fill="var(--color-muted)" />
          <circle cx="21" cy="8" r="7.5" fill="var(--color-muted)" />
        </svg>
        {t("la taille suit le montant")}
      </span>
      {waiting && (
        <span className="flex items-center gap-1.5">
          <svg width="16" height="16" aria-hidden>
            <circle cx="8" cy="8" r="5.5" fill="none" stroke="var(--color-muted)" strokeWidth="2" />
          </svg>
          {t("pas encore prélevé")}
        </span>
      )}
      {upcoming && (
        <span className="flex items-center gap-1.5">
          <svg width="16" height="16" aria-hidden>
            <circle cx="8" cy="8" r="6" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeDasharray="3 2.5" />
          </svg>
          {t("attendu")}
        </span>
      )}
    </>
  );
}

/** Une bulle : une opération, ou le regroupement des plus petites d'un rang chargé (`more` = combien, `p.amount` = leur somme). */
type Placed = { key: string; p: TimelinePoint; more?: number; lane: Lane; r: number; cx: number; cy: number };

/** Ouvre les opérations d'un rang (un jour, ou un mois de l'année) ; d'une bulle, celles de son couloir. */
function drillSlot(period: string, slot: number, lane?: Lane, nature?: string) {
  const year = isYearPeriod(period);
  const filters: DrillFilters = year ? { month: `${period}-${pad(slot)}` } : { month: period, day: `${period}-${pad(slot)}` };
  if (lane === "entrees") filters.credits = true;
  else if (lane && lane !== "epargne") Object.assign(filters, { nature, debits: true });
  const when = year ? monthLabel(`${period}-${pad(slot)}`) : shortDay(`${period}-${pad(slot)}`);
  openDrill(lane ? `${laneLabel(lane)} · ${when}` : year ? when : t("Opérations du {date}", { date: when }), filters);
}

function Frise({ data, period, compact = false }: { data: Timeline; period: string; compact?: boolean }) {
  const [ref, measured] = useWidth();
  const [hover, setHover] = useState<{ slot: number; id?: string } | null>(null);
  const year = isYearPeriod(period);
  const width = Math.max(measured, compact ? 300 : 640);
  const gutter = compact ? 0 : 138;
  const cumH = compact ? 96 : 150;
  /** Au-delà, les plus petits paiements d'un même rang et d'un même couloir sont réunis en une bulle « + n autres ». */
  const perSlot = compact ? 4 : 7;
  const [y0, m0] = period.split("-").map(Number);
  const slots = year ? 12 : new Date(y0, m0, 0).getDate();
  const colW = (width - gutter - RIGHT) / slots;
  const xOf = (slot: number) => gutter + (slot - 0.5) * colW;
  const edge = (slot: number) => gutter + slot * colW;
  const isWeekend = (day: number) => !year && [0, 6].includes(new Date(y0, m0 - 1, day).getDay());
  const upTo = data.today ?? slots;
  // Trait d'aujourd'hui : à la fin du jour pour un mois ; pour une année, là où l'on en est dans le mois en cours.
  const todayX = useMemo(() => {
    if (data.today == null) return null;
    if (!year) return edge(data.today);
    const d = new Date();
    return edge(data.today - 1) + colW * (d.getDate() / new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate());
  }, [data.today, year, colW, gutter]);

  const layout = useMemo(() => {
    // Rayon plafonné par la largeur d'un rang : deux grosses bulles voisines ne se recouvrent pas trop.
    const rMax = Math.max(compact ? 7 : 9, Math.min(compact ? 15 : 20, colW * (compact ? 0.95 : 0.62)));
    const byLane = new Map<Lane, Map<number, TimelinePoint[]>>();
    for (const p of data.points) {
      const l = laneOf(p);
      const perRank = byLane.get(l) ?? new Map<number, TimelinePoint[]>();
      perRank.set(p.slot, [...(perRank.get(p.slot) ?? []), p]);
      byLane.set(l, perRank);
    }
    for (const e of data.upcoming) if (!byLane.has(expectedLane(e))) byLane.set(expectedLane(e), new Map());
    // Un rang chargé (relevé d'une carte à débit différé, mois entier d'une année) : les plus gros paiements, puis une bulle pour le reste.
    type Item = { key: string; p: TimelinePoint; more?: number };
    const itemsOf = (lane: Lane, slot: number, list: TimelinePoint[]): Item[] => {
      const sorted = [...list].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      if (sorted.length <= perSlot) return sorted.map((p) => ({ key: `${p.id}:${p.kind}`, p }));
      const rest = sorted.slice(perSlot - 1);
      const sum = rest.reduce((s, p) => s + p.amount, 0);
      return [...sorted.slice(0, perSlot - 1).map((p) => ({ key: `${p.id}:${p.kind}`, p })), { key: `+${lane}:${slot}`, p: { ...rest[0], id: `+${lane}:${slot}`, amount: sum, pending: false }, more: rest.length }];
    };
    const groups = LANES.filter((l) => byLane.has(l)).map((lane) => ({
      lane,
      ranks: [...byLane.get(lane)!.entries()].map(([slot, list]) => ({ slot, count: list.length, total: list.reduce((s, p) => s + p.amount, 0), items: itemsOf(lane, slot, list) })),
    }));
    const largest = Math.max(1, ...groups.flatMap((g) => g.ranks.flatMap((d) => d.items.map((i) => Math.abs(i.p.amount)))), ...data.upcoming.map((x) => Math.abs(x.amount)));
    let y = TOP;
    const lanes: { lane: Lane; top: number; height: number; total: number; count: number }[] = [];
    const placed: Placed[] = [];
    const ghosts: { x: Expected; lane: Lane; r: number; cx: number; cy: number }[] = [];
    for (const { lane, ranks } of groups) {
      const stacks = ranks.map((d) => {
        const items = [...d.items].sort((a, b) => Math.abs(b.p.amount) - Math.abs(a.p.amount));
        const radii = items.map((i) => bubbleRadius(i.p.amount, largest, rMax));
        return { slot: d.slot, items, radii, ...stackOffsets(radii) };
      });
      const expected = data.upcoming.filter((x) => expectedLane(x) === lane && x.slot <= slots);
      const extent = Math.max(0, ...stacks.map((s) => s.extent), ...expected.map((x) => bubbleRadius(x.amount, largest, rMax)));
      // Téléphone : le nom du couloir est écrit au-dessus des bulles, il lui faut sa ligne.
      const head = compact ? 16 : 0;
      const height = Math.min(LANE_MAX, Math.max(compact ? 38 : LANE_MIN, extent * 2 + 18)) + head;
      // Une pile plus haute que le couloir est resserrée (les bulles se recouvrent un peu).
      const room = (height - head - 10) / 2;
      const cy = y + head + (height - head) / 2;
      for (const s of stacks) {
        const squeeze = s.extent > room ? room / s.extent : 1;
        s.items.forEach((it, i) => placed.push({ ...it, lane, r: s.radii[i], cx: xOf(s.slot), cy: cy + s.offsets[i] * squeeze }));
      }
      // Attendus : décalés si une opération occupe déjà le centre de ce rang.
      for (const x of expected) {
        const r = bubbleRadius(x.amount, largest, rMax);
        const taken = stacks.find((s) => s.slot === x.slot);
        ghosts.push({ x, lane, r, cx: xOf(x.slot), cy: taken ? Math.min(cy + room - r, cy + taken.extent + r + 2) : cy });
      }
      lanes.push({ lane, top: y, height, total: ranks.reduce((s, d) => s + d.total, 0), count: ranks.reduce((s, d) => s + d.count, 0) });
      y += height;
    }
    return { lanes, placed, ghosts, lanesBottom: y };
  }, [data, colW, slots, compact, gutter]);

  const cum = useMemo(() => cumulativeNet(data.points, slots, upTo), [data, slots, upTo]);
  // Prolongement (période en cours) : le reste après ce qui est attendu, rang après rang.
  const projection = useMemo(() => {
    if (data.today == null || !data.upcoming.length) return null;
    let v = cum[upTo - 1] ?? 0;
    const out: { slot: number; value: number }[] = [{ slot: upTo, value: v }];
    for (let d = upTo; d <= slots; d++) {
      const coming = data.upcoming.filter((x) => Math.min(x.slot, slots) === d).reduce((s, x) => s + x.amount, 0);
      if (d > upTo || coming) {
        v += coming;
        out.push({ slot: d, value: v });
      }
    }
    return out;
  }, [data, cum, upTo, slots]);

  const axisY = layout.lanesBottom;
  const cumTop = axisY + AXIS + CUM_HEAD;
  const cumBottom = cumTop + cumH;
  const height = cumBottom + 10;
  const values = [...cum.filter((v): v is number => v != null), ...(projection ?? []).map((p) => p.value)];
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), compact ? 2 : 4);
  const lo = Math.min(0, ...values, ...ticks);
  const hi = Math.max(0, ...values, ...ticks);
  const yOf = (v: number) => cumBottom - 8 - ((v - lo) / (hi - lo || 1)) * (cumH - 22);

  // Courbe en escalier : le reste change au rang de l'opération et tient jusqu'à la suivante.
  let line = `M${gutter},${yOf(0)}`;
  for (let d = 1; d <= upTo; d++) line += ` V${yOf(cum[d - 1] ?? 0)} H${d === upTo && todayX != null ? todayX : edge(d)}`;
  const lineEnd = todayX ?? edge(upTo);
  const area = `${line} V${yOf(0)} H${gutter} Z`;
  const last = cum[upTo - 1] ?? 0;
  let dashed = "";
  if (projection) {
    dashed = `M${lineEnd},${yOf(last)}`;
    const atToday = projection.find((p) => p.slot === upTo && p !== projection[0]);
    if (atToday) dashed += ` V${yOf(atToday.value)}`;
    if (lineEnd < edge(upTo)) dashed += ` H${edge(upTo)}`;
    for (let d = upTo + 1; d <= slots; d++) {
      const v = projection.findLast((p) => p.slot <= d)?.value ?? last;
      dashed += ` V${yOf(v)} H${edge(d)}`;
    }
  }
  const projected = projection?.at(-1)?.value ?? null;
  // L'étiquette du reste projeté se pose du côté d'où le tracé n'arrive pas : au-dessus du palier s'il monte pour
  // l'atteindre (une paie attendue en fin de mois), en dessous s'il descend. Sinon le pointillé la traverserait.
  const lastMove = projection?.findLastIndex((p, i, all) => i > 0 && p.value !== all[i - 1].value) ?? -1;
  const projectedAbove = projection != null && projected != null && lastMove > 0 && projected > projection[lastMove - 1].value && yOf(projected) - 8 >= cumTop + 4;
  const nearEnd = lineEnd > width - RIGHT - 110;

  // Étiquettes : seulement les plus grosses bulles, jamais deux trop proches dans un couloir ; du côté libre (pas par-dessus
  // une autre bulle ni une récurrence attendue), et aucune si les deux côtés sont pris.
  const labels = useMemo(() => {
    const out: (Placed & { end: boolean; value: string; name: string })[] = [];
    if (compact) return out;
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
      const left = b.cx - span > gutter && !busy(b, b.cx - span, b.cx - b.r);
      if (right || left) out.push({ ...b, end: !right, value, name });
    }
    return out;
  }, [layout, width, compact, gutter]);

  const h = hover;
  const slotOps = h ? data.points.filter((p) => p.slot === h.slot).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)) : [];
  const slotGhosts = h ? layout.ghosts.filter((g) => g.x.slot === h.slot) : [];
  const flip = h ? h.slot > slots * 0.58 : false;
  const every = year ? 1 : colW >= 22 ? 1 : 5;
  const slotTick = (d: number) => (year ? monthShort(`${period}-${pad(d)}`) : d === 1 || d % every === 0 || d === slots ? String(d) : "");

  return (
    <div ref={ref} className="relative select-none">
      <svg width={width} height={height} role="img" aria-label={year ? t("Frise des paiements de l'année : une bulle par opération, par mois et par moyen de paiement") : t("Frise des paiements du mois : une bulle par opération, par jour et par moyen de paiement")} className="block">
        {/* Week-ends (mois) : bande discrète sur toute la hauteur. */}
        {Array.from({ length: slots }, (_, i) => i + 1)
          .filter(isWeekend)
          .map((d) => (
            <rect key={`w${d}`} x={edge(d - 1)} y={TOP} width={colW} height={cumBottom - TOP} fill="var(--color-bg)" fillOpacity={0.7} />
          ))}
        {/* Année : un filet entre les mois. */}
        {year && Array.from({ length: slots - 1 }, (_, i) => <line key={`m${i}`} x1={edge(i + 1)} x2={edge(i + 1)} y1={TOP} y2={cumBottom} stroke="var(--color-line)" strokeOpacity={0.6} />)}
        {h && <rect x={edge(h.slot - 1)} y={TOP} width={colW} height={cumBottom - TOP} fill="var(--color-accent-soft)" />}

        {/* Couloirs */}
        {layout.lanes.map((l) => (
          <g key={l.lane}>
            <line x1={0} x2={width} y1={l.top} y2={l.top} stroke="var(--color-line)" />
            {compact ? (
              <>
                <circle cx={5} cy={l.top + 10} r={3.5} fill={laneColor(l.lane)} />
                <text x={13} y={l.top + 10} dy="0.35em" fontSize={11} fill="var(--color-muted)">
                  <tspan fontWeight={600} fill="var(--color-ink)">
                    {laneLabel(l.lane)}
                  </tspan>
                  <tspan dx={6}>{l.count ? money(Math.abs(l.total), true) : t("à venir")}</tspan>
                </text>
              </>
            ) : (
              <>
                <circle cx={7} cy={l.top + l.height / 2 - 8} r={4.5} fill={laneColor(l.lane)} />
                <text x={18} y={l.top + l.height / 2 - 8} dy="0.35em" fontSize={12.5} fontWeight={600} fill="var(--color-ink)">
                  {laneLabel(l.lane)}
                </text>
                <text x={18} y={l.top + l.height / 2 + 9} dy="0.35em" fontSize={11.5} fill="var(--color-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {l.count ? `${money(Math.abs(l.total), true)} · ${l.count}` : t("à venir")}
                </text>
              </>
            )}
          </g>
        ))}
        <line x1={0} x2={width} y1={axisY} y2={axisY} stroke="var(--color-line)" />

        {/* Aujourd'hui */}
        {todayX != null && (
          <g>
            <line x1={todayX} x2={todayX} y1={TOP - 6} y2={cumBottom} stroke="var(--color-accent)" strokeWidth={1.5} />
            <text x={todayX} y={TOP - 12} textAnchor={todayX > width - 60 ? "end" : todayX < gutter + 40 ? "start" : "middle"} fontSize={11} fontWeight={600} fill="var(--color-accent)">
              {t("aujourd'hui")}
            </text>
          </g>
        )}

        {/* Axe des rangs */}
        {Array.from({ length: slots }, (_, i) => i + 1).map((d) => {
          const strong = h?.slot === d || data.today === d;
          return (
            <text key={`d${d}`} x={xOf(d)} y={axisY + 18} textAnchor="middle" fontSize={compact ? 10 : 11} fontWeight={strong ? 700 : 400} fill={strong ? "var(--color-ink)" : "var(--color-muted)"} style={{ fontVariantNumeric: "tabular-nums" }}>
              {compact && year ? slotTick(d).slice(0, 1).toUpperCase() : slotTick(d)}
            </text>
          );
        })}

        {/* Reste de la période, cumulé */}
        <line x1={0} x2={width} y1={axisY + AXIS} y2={axisY + AXIS} stroke="var(--color-line)" />
        <text x={compact ? 4 : 18} y={axisY + AXIS + 19} fontSize={compact ? 11.5 : 12.5} fill="var(--color-muted)">
          <tspan fontWeight={600} fill="var(--color-ink)">
            {year ? t("Reste de l'année") : t("Reste du mois")}
          </tspan>
          <tspan dx={8}>{t("entrées − sorties, cumulé")}</tspan>
        </text>
        {ticks.map((v) => (
          <g key={`t${v}`}>
            <line x1={gutter} x2={width - RIGHT} y1={yOf(v)} y2={yOf(v)} stroke="var(--color-line)" strokeWidth={v === 0 ? 1.5 : 1} />
            <text x={compact ? width - RIGHT + 2 : gutter - 8} y={yOf(v)} dy={compact ? "-0.3em" : "0.35em"} textAnchor="end" fontSize={compact ? 10 : 11} fill="var(--color-muted)" style={{ fontVariantNumeric: "tabular-nums" }}>
              {k(v)}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--color-accent)" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {dashed && <path d={dashed} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="5 4" strokeOpacity={0.7} />}
        <circle cx={lineEnd} cy={yOf(last)} r={5} fill="var(--color-accent)" stroke="var(--color-card)" strokeWidth={2} />
        <text
          x={nearEnd ? lineEnd - 10 : lineEnd + 10}
          // Près du bord droit, l'étiquette passe à gauche du point : au-dessus du tracé, pas dessus.
          y={yOf(last) + (nearEnd ? (yOf(last) - cumTop > 24 ? -13 : 15) : projected != null && projected < last ? -9 : 0)}
          dy="0.35em"
          textAnchor={nearEnd ? "end" : "start"}
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
        {projected != null && !nearEnd && !compact && (
          <text x={width - RIGHT - 4} y={yOf(projected) + (projectedAbove ? -8 : 14)} textAnchor="end" fontSize={11} fill="var(--color-muted)" stroke="var(--color-card)" strokeWidth={3} paintOrder="stroke">
            {t("≈ {montant} une fois passé ce qui est attendu", { montant: money(projected, true) })}
          </text>
        )}

        {/* Zones de survol : un rang entier (sous les bulles, qui gardent leur propre clic). */}
        {Array.from({ length: slots }, (_, i) => i + 1).map((d) => (
          <rect key={`h${d}`} x={edge(d - 1)} y={TOP} width={colW} height={cumBottom - TOP} fill="transparent" style={{ cursor: "pointer" }} onMouseEnter={() => !compact && setHover({ slot: d })} onMouseLeave={() => setHover(null)} onClick={() => drillSlot(period, d)} />
        ))}

        {/* Récurrences attendues */}
        {layout.ghosts.map((g, i) => (
          <circle key={`g${i}`} cx={g.cx} cy={g.cy} r={Math.max(g.r - 1, 3.5)} fill="var(--color-card)" stroke={laneColor(g.lane)} strokeWidth={1.5} strokeDasharray="3 2.5" style={{ pointerEvents: "none" }} />
        ))}

        {/* Opérations */}
        {layout.placed.map((b) => {
          const on = h?.id === b.p.id;
          const dim = h != null && h.slot !== b.p.slot;
          const color = laneColor(b.lane);
          return (
            <g key={b.key} style={{ cursor: "pointer" }} onMouseEnter={() => !compact && setHover({ slot: b.p.slot, id: b.p.id })} onMouseLeave={() => setHover(null)} onClick={() => (compact ? drillSlot(period, b.p.slot) : drillSlot(period, b.p.slot, b.lane, b.more ? undefined : b.p.nature))}>
              {/* Cible de clic plus large que la bulle. */}
              <circle cx={b.cx} cy={b.cy} r={Math.max(b.r + 3, 11)} fill="transparent" />
              {b.more || b.p.pending ? (
                // Achat pas encore prélevé : un anneau, le centre vide. Regroupement de petits paiements : un voile cerclé.
                <>
                  <circle cx={b.cx} cy={b.cy} r={b.r} fill="var(--color-card)" stroke="var(--color-card)" strokeWidth={2} />
                  <circle cx={b.cx} cy={b.cy} r={Math.max(b.r - 0.75, 2.5)} fill={color} fillOpacity={b.more ? (dim ? 0.1 : 0.24) : 0} stroke={on ? "var(--color-ink)" : color} strokeOpacity={dim && !on ? 0.4 : 1} strokeWidth={b.more ? 1.5 : 2} />
                </>
              ) : (
                <circle cx={b.cx} cy={b.cy} r={b.r} fill={color} fillOpacity={dim ? 0.35 : 0.92} stroke={on ? "var(--color-ink)" : "var(--color-card)"} strokeWidth={2} style={{ transition: "fill-opacity 120ms" }} />
              )}
            </g>
          );
        })}
        {labels.map((b) => (
          <text
            key={`l${b.key}`}
            x={b.end ? b.cx - b.r - 6 : b.cx + b.r + 6}
            y={b.cy}
            dy="0.35em"
            textAnchor={b.end ? "end" : "start"}
            fontSize={11.5}
            fill="var(--color-ink)"
            stroke="var(--color-card)"
            strokeWidth={3}
            paintOrder="stroke"
            opacity={h != null && h.slot !== b.p.slot ? 0.4 : 1}
            style={{ pointerEvents: "none" }}
          >
            <tspan fontWeight={600} style={{ fontVariantNumeric: "tabular-nums" }}>
              {b.value}
            </tspan>
            <tspan fill="var(--color-muted)"> {b.name}</tspan>
          </text>
        ))}
      </svg>

      {h && (slotOps.length > 0 || slotGhosts.length > 0 || h.slot <= upTo) && (
        <div className="pointer-events-none absolute top-1 z-10 w-72 rounded-md border border-line bg-card px-3 py-2 text-[12px] shadow-md" style={flip ? { right: width - edge(h.slot - 1) + 10 } : { left: edge(h.slot) + 10 }}>
          <div className="mb-1 font-medium capitalize text-muted">{slotName(period, h.slot)}</div>
          {slotOps.slice(0, 8).map((p) => (
            <div key={`${p.id}:${p.kind}`} className={cn("flex items-center justify-between gap-3 rounded px-1 py-0.5", h.id === p.id && "bg-bg")}>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-0.5 w-3 shrink-0 rounded" style={{ background: laneColor(laneOf(p)) }} />
                <span className="truncate">
                  {p.name}
                  {p.pending && p.booked ? <span className="text-muted"> · {t("prélevé le {date}", { date: dateFr(p.booked) })}</span> : null}
                </span>
              </span>
              <span className="tnum shrink-0 font-semibold">{signed(p.amount)}</span>
            </div>
          ))}
          {slotOps.length > 8 && <div className="px-1 text-muted">{tn("+ {n} autre", "+ {n} autres", slotOps.length - 8)}</div>}
          {slotGhosts.map((g, i) => (
            <div key={i} className="flex items-center justify-between gap-3 px-1 py-0.5 text-muted">
              <span className="truncate">{t("attendu : {nom}", { nom: g.x.name })}</span>
              <span className="tnum shrink-0">≈ {signed(g.x.amount)}</span>
            </div>
          ))}
          {!slotOps.length && !slotGhosts.length && <div className="px-1 text-muted">{year ? t("Aucun paiement ce mois-là.") : t("Aucun paiement ce jour-là.")}</div>}
          {h.slot <= upTo && (
            <div className="mt-1 flex justify-between border-t border-line px-1 pt-1">
              <span className="text-muted">{year ? t("Reste de l'année, à la fin du mois") : t("Reste du mois, ce soir-là")}</span>
              <span className="tnum font-semibold">{money(cum[h.slot - 1] ?? 0, true)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** La frise en tableau : rang après rang (jour ou mois), chaque opération avec sa catégorie, son moyen de paiement et son montant. */
function TimelineTable({ data, period }: { data: Timeline; period: string }) {
  const year = isYearPeriod(period);
  const bySlot = new Map<number, TimelinePoint[]>();
  for (const p of data.points) bySlot.set(p.slot, [...(bySlot.get(p.slot) ?? []), p]);
  const groups = [...bySlot.entries()].sort((a, b) => a[0] - b[0]);
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
        {groups.map(([slot, list]) => (
          <tbody key={slot} className="divide-y divide-line">
            <tr className="cursor-pointer hover:bg-bg" onClick={() => drillSlot(period, slot)}>
              <th colSpan={3} className="pb-1 pt-3 text-left text-[12px] font-semibold capitalize">
                {slotName(period, slot)}
              </th>
              <td className="tnum pb-1 pt-3 text-right text-[12px] font-semibold text-muted">{signed(list.reduce((s, p) => s + p.amount, 0))}</td>
            </tr>
            {[...list]
              .sort((a, b) => a.amount - b.amount)
              .map((p) => {
                const lane = laneOf(p);
                return (
                  <tr key={`${p.id}:${p.kind}`}>
                    <td className="max-w-0 truncate py-1.5 pr-3" style={{ width: "44%" }}>
                      {year && <span className="tnum mr-2 text-muted">{p.date.slice(8, 10)}</span>}
                      {p.name}
                      {p.pending && p.booked ? <span className="text-muted"> · {t("prélevé le {date}", { date: dateFr(p.booked) })}</span> : null}
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
                {year ? t("Attendu d'ici trois mois (ce qui revient chaque mois)") : t("Attendu d'ici la fin du mois (ce qui revient chaque mois)")}
              </th>
            </tr>
            {data.upcoming.map((x, i) => (
              <tr key={i} className="text-muted">
                <td className="py-1.5 pr-3">{x.name}</td>
                <td className="py-1.5 pr-3">{x.category ? td(x.category) : "—"}</td>
                <td className="py-1.5 pr-3">{year ? monthLabel(`${period}-${pad(x.slot)}`) : t("vers le {jour}", { jour: x.slot })}</td>
                <td className="tnum py-1.5 text-right">≈ {signed(x.amount)}</td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
