import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, ErrorBox, Spinner } from "./ui.tsx";
import { openDrill } from "./DrillDrawer.tsx";
import { DateBasisSwitch } from "./DateBasisSwitch.tsx";
import { money, monthLabel } from "../format.ts";
import { cn } from "../cn.ts";
import { monthOfPeriod, usePeriod } from "../shell.ts";
import { useFlows, useTimeline, type Expected, type Timeline } from "../api-analysis.ts";
import { useGoals } from "../api-situation.ts";
import { addMonths } from "../../lib/periods.ts";
import type { TimelinePoint } from "../../lib/timeline.ts";
import { locale, t, td, tn } from "../../lib/i18n.ts";

/*
 * Calendrier du mois (Analyse → Calendrier, et écran Mois du téléphone) : le mois posé sur une grille. Ce qui
 * compte porte une étiquette — une entrée en vert pâle, une charge (prélèvement, virement) en rouge pâle,
 * l'épargne en plein, ce qui est encore attendu en pointillé ; les petits achats du jour ne font qu'un total
 * discret. Sur ordinateur, en tête : ce qui est entré, ce qui est sorti, ce qui a été mis de côté, le premier
 * objectif d'épargne et les sorties semaine par semaine ; un clic sur un jour ouvre ses opérations. Sur le
 * téléphone, les cases sont trop étroites pour une étiquette : un trait de couleur par mouvement, et le jour
 * touché se lit sous la grille.
 */

/** En dessous, une charge reste dans le total des petits achats du jour. */
const CHIP_MIN = 30;
const MAX_CHIPS = 3;
const pad = (n: number) => String(n).padStart(2, "0");
const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n, true)}`;
const longDay = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
// Le 1er janvier 2024 est un lundi : sept initiales dans la langue du membre, lundi d'abord.
const weekdays = () => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale(), { weekday: "narrow" }).toUpperCase());

type Tone = "pos" | "neg" | "solid" | "attendu";
type Chip = { key: string; name: string; amount: number; tone: Tone; tip: string };
type Cell = { chips: Chip[]; small: number; count: number };

const TONE: Record<Tone, string> = { pos: "chip-pos", neg: "chip-neg", solid: "chip-solid", attendu: "chip-dashed" };
/** Trait d'une case du téléphone : même code de couleur que les étiquettes. */
const MARK: Record<Tone, string> = { pos: "bg-pos", neg: "bg-neg", solid: "bg-pos", attendu: "bg-muted/45" };

/** Étiquette, ou simple part du total du jour : les entrées, l'épargne et les charges régulières ressortent. */
function chipOf(p: TimelinePoint): Chip | null {
  const tip = `${p.name} · ${signed(p.amount)}${p.category ? ` · ${td(p.category)}` : ""}`;
  if (p.kind === "epargne") return { key: p.id, name: p.name, amount: p.amount, tone: "solid", tip };
  if (p.kind === "revenu" || p.amount > 0) return { key: p.id, name: p.name, amount: p.amount, tone: "pos", tip };
  if ((p.nature === "prelevement" || p.nature === "virement") && -p.amount >= CHIP_MIN) return { key: p.id, name: p.name, amount: p.amount, tone: "neg", tip };
  return null;
}

const expectedChip = (x: Expected, i: number): Chip => ({ key: `a${i}`, name: x.name, amount: x.amount, tone: "attendu", tip: t("Attendu : {nom} · {montant}", { nom: x.name, montant: signed(x.amount) }) });

/** Les mouvements du mois rangés par jour. */
function cellsOf(data: Timeline | undefined): Map<number, Cell> {
  const map = new Map<number, Cell>();
  const at = (d: number) => map.get(d) ?? map.set(d, { chips: [], small: 0, count: 0 }).get(d)!;
  for (const p of data?.points ?? []) {
    const cell = at(p.slot);
    const chip = chipOf(p);
    cell.count++;
    if (chip) cell.chips.push(chip);
    else cell.small += p.amount;
  }
  (data?.upcoming ?? []).forEach((x, i) => at(x.slot).chips.push(expectedChip(x, i)));
  for (const c of map.values()) c.chips.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return map;
}

function useCalendar(month: string) {
  const tl = useTimeline(month);
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y, m, 0).getDate();
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  // Le rang d'aujourd'hui ne vaut que pour le mois chargé (pendant un changement de mois, l'ancien reste affiché).
  const loaded = tl.data?.period === month ? tl.data : undefined;
  const today = loaded?.today ?? null;
  const byDay = useMemo(() => cellsOf(loaded), [loaded]);
  return { tl, loaded, days, lead, today, byDay };
}

function ChipLabel({ chip, className }: { chip: Chip; className?: string }) {
  return (
    <div data-tip={chip.tip} className={cn("chip w-full min-w-0 justify-between", TONE[chip.tone], className)}>
      <span className="truncate">{chip.name}</span>
      <span className="tnum shrink-0">{signed(chip.amount)}</span>
    </div>
  );
}

function Legend() {
  return (
    <>
      <span className="chip chip-pos text-[12px]">{t("Entrée##argent")}</span>
      <span className="chip chip-neg text-[12px]">{t("Charge")}</span>
      <span className="chip chip-solid text-[12px]">{t("Épargne")}</span>
      <span className="chip chip-dashed text-[12px]">{t("Attendu")}</span>
    </>
  );
}

/* ---------- Ordinateur ---------- */

export function CalendarTab({ period }: { period: string }) {
  const month = monthOfPeriod(period);
  const [, setPeriod] = usePeriod();
  const { tl, loaded, days, lead, today, byDay } = useCalendar(month);
  const flows = useFlows(month);
  const goals = useGoals();

  // Sorties semaine par semaine (lundi → dimanche) : la semaine en cours ressort.
  const weeks = useMemo(() => {
    const out: { label: string; total: number; current: boolean }[] = [];
    for (let start = 1 - lead; start <= days; start += 7) {
      const from = Math.max(1, start);
      const to = Math.min(days, start + 6);
      let total = 0;
      for (const p of loaded?.points ?? []) if (p.kind === "depense" && p.amount < 0 && p.slot >= from && p.slot <= to) total -= p.amount;
      out.push({ label: from === to ? String(from) : `${from}–${to}`, total, current: today != null && today >= from && today <= to });
    }
    return out;
  }, [loaded, lead, days, today]);
  const weekMax = Math.max(1, ...weeks.map((w) => w.total));

  if (tl.error) return <ErrorBox error={tl.error} />;
  if (!tl.data) return <Spinner />;
  const f = flows.data?.month === month ? flows.data.totals : undefined;
  const goal = goals.data?.goals[0];
  const step = (d: number) => setPeriod(addMonths(month, d));
  const open = (date: string) => openDrill(longDay(date), { month, day: date });
  const round = "grid size-11 place-items-center rounded-full bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-bg";

  return (
    <Card className={cn("p-6 transition-opacity duration-200 lg:p-8", !loaded && "opacity-50")}>
      <div className="grid gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.62fr)]">
        <div>
          <div className="text-[19px] text-muted">{t("Calendrier du mois")}</div>
          <div className="mt-0.5 flex items-center gap-6">
            <h2 className="text-[40px] font-semibold leading-none tracking-[-0.03em]">{monthLabel(month)}</h2>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => step(-1)} className={round} title={t("Mois précédent (⌥←)")} aria-label={t("Mois précédent")}>
                <ChevronLeft size={18} />
              </button>
              <button type="button" onClick={() => step(1)} className={round} title={t("Mois suivant (⌥→)")} aria-label={t("Mois suivant")}>
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div className="mt-7 flex flex-wrap gap-x-14 gap-y-4">
            <div>
              <div className="text-[17px] text-muted">{t("Entrées")}</div>
              <div className="figure mt-1 text-[38px] text-pos">{f ? signed(f.income) : "…"}</div>
            </div>
            <div>
              <div className="text-[17px] text-muted">{t("Sorties")}</div>
              <div className="figure mt-1 text-[38px] text-neg">{f ? signed(-f.netSpend) : "…"}</div>
            </div>
            <div>
              <div className="text-[17px] text-muted">{t("Mis de côté")}</div>
              <div className="figure chip chip-solid mt-0.5 rounded-xl px-3 py-1 text-[38px]">{f ? signed(f.savings) : "…"}</div>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          {goal && (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <div className="truncate text-[17px] text-muted">
                  {goal.emoji ? `${goal.emoji} ` : ""}
                  {goal.name}
                </div>
                <div className="tnum shrink-0 text-[19px] font-semibold">{t("{actuel} sur {cible}", { actuel: money(goal.current, true), cible: money(goal.target, true) })}</div>
              </div>
              <div className="mt-2 h-3.5 overflow-hidden rounded-full bg-line/80">
                <div className="h-full rounded-full bg-pos" style={{ width: `${Math.min(100, Math.max(2, goal.pct))}%` }} />
              </div>
              {goal.monthlyNeeded != null && goal.remaining > 0 && (
                <div className="mt-2 text-[14px] text-muted">{t("Il reste {reste} · {parMois} par mois pour y arriver", { reste: money(goal.remaining, true), parMois: money(goal.monthlyNeeded, true) })}</div>
              )}
            </>
          )}
          <div className={cn("text-[14px] text-muted", goal && "mt-4")}>{t("Sorties par semaine")}</div>
          <div className="mt-2 flex items-end gap-3">
            {weeks.map((w) => (
              <div key={w.label} className="group flex min-w-0 flex-1 flex-col items-center" data-tip={t("Du {jours} : {montant} de sorties", { jours: w.label, montant: money(w.total, true) })}>
                <div className={cn("tnum mb-1 h-4 text-[12.5px] font-semibold", w.current ? "text-ink" : "text-transparent group-hover:text-muted")}>{money(w.total, true)}</div>
                <div className="flex h-16 w-full items-end overflow-hidden rounded-[10px] bg-line/60">
                  <div className={cn("w-full rounded-[10px]", w.current ? "bg-accent" : "bg-muted/35")} style={{ height: `${Math.max(w.total ? 8 : 0, (w.total / weekMax) * 100)}%` }} />
                </div>
                <div className={cn("mt-1.5 text-[12.5px]", w.current ? "font-semibold text-ink" : "text-muted")}>{w.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-7 border-t border-line">
        {weekdays().map((d, i) => (
          <div key={i} className="py-2 text-center text-[15px] text-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`l${i}`} className="border-t border-line" />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const day = i + 1;
          const date = `${month}-${pad(day)}`;
          const cell = byDay.get(day);
          const chips = cell?.chips ?? [];
          const future = today != null && day > today;
          const body = (
            <>
              <div className="flex items-center justify-between px-1">
                <span className={cn("tnum text-[17px]", day === today ? "-ml-1.5 grid size-7 place-items-center rounded-full bg-ink text-[15px] font-semibold text-card" : future ? "text-muted" : "text-ink")}>{day}</span>
                {cell && cell.small !== 0 && (
                  <span className="tnum text-[13px] text-muted" data-tip={t("Petits achats du jour : {montant}", { montant: money(cell.small) })}>
                    {signed(cell.small)}
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1">
                {chips.slice(0, MAX_CHIPS).map((c) => (
                  <ChipLabel key={c.key} chip={c} className="text-[13px]" />
                ))}
                {chips.length > MAX_CHIPS && <div className="px-1.5 text-[12px] text-muted">{tn("+ {n} autre", "+ {n} autres", chips.length - MAX_CHIPS)}</div>}
              </div>
            </>
          );
          // En colonne, calé en haut : un bouton centre son contenu de lui-même.
          const frame = "flex min-h-[92px] w-full flex-col justify-start border-t border-line px-1.5 pb-2 pt-2 text-left";
          // Un jour sans opération écrite (vide, ou seulement des attendus) n'ouvre rien.
          return cell?.count ? (
            <button key={day} type="button" onClick={() => open(date)} aria-label={longDay(date)} className={cn(frame, "transition-colors hover:bg-bg/70")}>
              {body}
            </button>
          ) : (
            <div key={day} className={frame}>
              {body}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
        <Legend />
        <span className="mr-auto">{t("En gris à droite du jour : ses petits achats · clic sur un jour : ses opérations")}</span>
        <DateBasisSwitch />
      </div>
    </Card>
  );
}

/* ---------- Téléphone ---------- */

export function MobileCalendar({ month }: { month: string }) {
  const { tl, loaded, days, lead, today, byDay } = useCalendar(month);
  const [picked, setPicked] = useState<{ month: string; day: number } | null>(null);
  if (!tl.data || (!tl.data.points.length && !tl.data.upcoming.length)) return null;
  // Jour lu sous la grille : celui qu'on a touché, sinon aujourd'hui, sinon le dernier jour qui a quelque chose.
  const fallback = today ?? Math.max(1, ...byDay.keys());
  const day = picked?.month === month ? picked.day : fallback;
  const date = `${month}-${pad(day)}`;
  const cell = byDay.get(day);
  return (
    <Card className={cn("p-4 transition-opacity duration-200", !loaded && "opacity-50")}>
      <div className="mb-2 text-sm font-semibold">{t("Le calendrier du mois")}</div>
      <div className="grid grid-cols-7">
        {weekdays().map((d, i) => (
          <div key={i} className="pb-1 text-center text-[12px] text-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`l${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const d = i + 1;
          const c = byDay.get(d);
          const marks = c?.chips.slice(0, 3) ?? [];
          return (
            <button
              key={d}
              type="button"
              onClick={() => setPicked({ month, day: d })}
              aria-pressed={d === day}
              aria-label={longDay(`${month}-${pad(d)}`)}
              className={cn("flex h-[52px] flex-col items-center rounded-xl pt-1 transition-colors", d === day && "bg-bg")}
            >
              <span className={cn("tnum grid size-7 place-items-center rounded-full text-[15px]", d === today ? "bg-ink font-semibold text-card" : today != null && d > today ? "text-muted" : "text-ink")}>{d}</span>
              <span className="mt-1 flex h-1.5 items-center gap-0.5">
                {marks.map((m) => (
                  <span key={m.key} className={cn("h-1.5 w-2.5 rounded-full", MARK[m.tone])} />
                ))}
                {!marks.length && c && c.small !== 0 && <span className="size-1 rounded-full bg-muted/45" />}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <div className="text-[15px] font-semibold first-letter:uppercase">{longDay(date)}</div>
          {cell?.count ? (
            <button type="button" onClick={() => openDrill(longDay(date), { month, day: date })} className="shrink-0 text-[13px] font-medium text-accent">
              {tn("Voir l'opération", "Voir les {n} opérations", cell.count)}
            </button>
          ) : null}
        </div>
        {cell ? (
          <div className="mt-2 space-y-1.5">
            {cell.chips.map((c) => (
              <ChipLabel key={c.key} chip={c} className="px-2.5 py-1.5 text-[14px]" />
            ))}
            {cell.small !== 0 && (
              <div className="flex justify-between px-2.5 text-[14px] text-muted">
                <span>{t("Petits achats")}</span>
                <span className="tnum">{signed(cell.small)}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-1.5 text-[14px] text-muted">{t("Rien ce jour-là.")}</div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Legend />
      </div>
    </Card>
  );
}
