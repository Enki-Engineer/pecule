import { useMemo, useState } from "react";
import { BadgeEuro, Building2, ChevronDown, ChevronRight, CircleHelp, Gift, Tag, TrendingUp, Undo2, type LucideIcon } from "lucide-react";
import { Card, Segmented } from "./ui.tsx";
import { Donut } from "./Donut.tsx";
import { Tile, categoryIcon } from "./Logo.tsx";
import { openDrill } from "./DrillDrawer.tsx";
import { cn } from "../cn.ts";
import { money, periodLabel } from "../format.ts";
import { useMedia } from "../useMedia.ts";
import type { MonthStats } from "../api.ts";
import { arcsOf, incomeParts, spendingParts, type Part } from "../../lib/breakdown.ts";
import { monthTotals } from "../../lib/month.ts";
import { t, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Répartition du mois en anneau (comme la vue « Analyse » de Bankin') : dépenses par poste ou
 * revenus par catégorie, avec la liste des parts à côté (sous l'anneau sur iPhone). Un poste s'ouvre
 * sur ses catégories ; une part ou une catégorie ouvre ses opérations (tiroir de forage).
 */

export type BreakdownKind = "depenses" | "revenus";

const OTHER = "#9aa5b4";
export const HATCH = "repeating-linear-gradient(45deg, var(--color-muted) 0 2px, var(--color-line) 2px 5px)";
export const colorOf = (slot: number | null) => (slot ? `var(--series-${slot})` : OTHER);

function incomeIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/salaire/.test(n)) return BadgeEuro;
  if (/invest|dividende|intérêt/.test(n)) return TrendingUp;
  if (/rembours/.test(n)) return Undo2;
  if (/cadeau|don/.test(n)) return Gift;
  if (/vente/.test(n)) return Tag;
  if (/sci\b|loyer|locati|immobili/.test(n)) return Building2;
  return CircleHelp;
}
export const iconOf = (kind: BreakdownKind, p: { label: string; unclassified: boolean }) => (p.unclassified ? CircleHelp : kind === "revenus" ? incomeIcon(p.label) : categoryIcon(p.label));

export const share = (v: number, total: number) => {
  if (v <= 0 || total <= 0) return null;
  const pct = (v / total) * 100;
  return pct < 1 ? "< 1 %" : `${Math.round(pct)} %`;
};
const ops = (n: number) => tn("{n} opération", "{n} opérations", n);

export function openPart(kind: BreakdownKind, month: string, p: Part) {
  const sub = periodLabel(month);
  if (p.unclassified) openDrill(td(p.label), kind === "depenses" ? { month, uncategorized: true, debits: true } : { month, uncategorized: true, credits: true }, sub);
  else if (p.poste) openDrill(td(p.label), { month, poste: p.poste }, sub);
  else if (p.category) openDrill(td(p.label), { month, category: p.category }, sub);
}

/** Une part dans la liste ; un poste se déplie sur ses catégories. */
function PartRow({ kind, month, part, total, active, open, onActive, onToggle }: { kind: BreakdownKind; month: string; part: Part; total: number; active: boolean; open: boolean; onActive: (arc: string | null) => void; onToggle: () => void }) {
  const Icon = iconOf(kind, part);
  const expandable = part.items.length > 1;
  const pct = share(part.total, total);
  return (
    <li>
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        onMouseEnter={() => onActive(part.arc)}
        onMouseLeave={() => onActive(null)}
        onClick={() => (expandable ? onToggle() : openPart(kind, month, part))}
        className={cn("press flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors", active && "bg-bg")}
      >
        <span aria-hidden className="size-2.5 shrink-0 rounded-sm" style={{ background: part.unclassified ? HATCH : colorOf(part.slot) }} />
        <Tile size="sm" tone={part.unclassified ? "warn" : "neutral"}>
          <Icon size={15} strokeWidth={2} />
        </Tile>
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-[14px] font-medium", part.unclassified && "text-warn")}>{td(part.label)}</span>
          <span className="block truncate text-[12px] text-muted">
            {pct ? `${pct} · ` : ""}
            {ops(part.count)}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tnum block text-[14px] font-semibold">{money(part.total)}</span>
          <span className="tnum block text-[11px] text-muted">{part.prev ? t("mois préc. {montant}", { montant: money(part.prev, true) }) : t("rien le mois préc.")}</span>
        </span>
        {expandable ? <ChevronDown size={16} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} /> : <ChevronRight size={16} className="shrink-0 text-muted" />}
      </button>
      {expandable && open && (
        <div className="mb-1 ml-[22px] border-l border-line pl-3">
          {part.items.map((c) => (
            <button
              key={c.id ?? "none"}
              type="button"
              onClick={() => openDrill(td(c.name), c.id ? { month, category: c.id } : { month, uncategorized: true, debits: true }, periodLabel(month))}
              className="press flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-[13px]"
            >
              <span className="min-w-0 truncate">
                {td(c.name)} <span className="text-[12px] text-muted">· {c.count}</span>
              </span>
              <span className="tnum shrink-0">{money(c.total)}</span>
            </button>
          ))}
          <button type="button" onClick={() => openPart(kind, month, part)} className="press w-full rounded-md px-2 py-1.5 text-left text-[12.5px] font-medium text-accent">
            {t("Toutes les opérations du poste")}
          </button>
        </div>
      )}
    </li>
  );
}

/**
 * Anneau et liste des parts d'un côté du mois (dépenses ou revenus). La liste passe à côté de l'anneau
 * quand la place le permet : d'après la largeur de la carte (requête de conteneur), ou d'après celle de
 * l'écran avec `byScreen` (voir BreakdownSwitch).
 */
export function Breakdown({ kind, data, byScreen = false }: { kind: BreakdownKind; data: MonthStats; byScreen?: boolean }) {
  const month = data.month;
  const hover = useMedia("(hover: hover)");
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const parts = useMemo(() => (kind === "depenses" ? spendingParts(data.categories, data.previous, data.colored) : incomeParts(data.categories, data.previous)), [kind, data]);
  const arcs = useMemo(() => arcsOf(parts, kind === "depenses" ? tk("Autres postes") : tk("Autres revenus")), [parts, kind]);
  const totals = monthTotals(data.categories);
  const total = kind === "depenses" ? totals.depenses : totals.revenus;
  const ring = arcs.reduce((s, a) => s + a.value, 0);
  const shown = arcs.find((a) => a.key === active);
  const noun = kind === "depenses" ? t("Dépenses") : t("Revenus");
  const summary = kind === "depenses" ? t("Dépenses de {mois} : {montant}.", { mois: periodLabel(month), montant: money(total, true) }) : t("Revenus de {mois} : {montant}.", { mois: periodLabel(month), montant: money(total, true) });

  const pick = (arc: string) => {
    const of = parts.filter((p) => p.arc === arc && p.total > 0);
    if (hover) {
      // Souris : un clic ouvre les opérations de la part (« Autres » : ses postes sont dans la liste).
      if (of.length === 1) openPart(kind, month, of[0]);
    } else {
      // Doigt : la part touchée reste choisie et se déplie dans la liste.
      setActive((a) => (a === arc ? null : arc));
      if (of.length === 1 && of[0].items.length > 1) setOpen(of[0].key);
    }
  };

  return (
    <div className={byScreen ? undefined : "@container"}>
      <div className={cn("flex flex-col items-center gap-4", byScreen ? "min-[576px]:flex-row min-[576px]:items-start min-[576px]:gap-6" : "@lg:flex-row @lg:items-start @lg:gap-6")}>
        <div className={cn("w-[min(240px,72%)] shrink-0", byScreen ? "min-[576px]:w-[230px]" : "@lg:w-[230px]")}>
          <Donut
            arcs={arcs.map((a) => ({ key: a.key, label: td(a.label), value: a.value, color: colorOf(a.slot), hatched: a.unclassified, icon: a.key === "autres" ? undefined : iconOf(kind, a) }))}
            active={active}
            onActive={(k) => hover && setActive(k)}
            onPick={pick}
            label={`${summary} ${arcs.map((a) => `${td(a.label)} ${share(a.value, ring) ?? ""}`).join(", ")}`}
          >
            {shown ? (
              <>
                <div className="line-clamp-2 text-[12px] leading-tight text-muted">{td(shown.label)}</div>
                <div className="tnum mt-0.5 text-[19px] font-bold leading-tight">{money(shown.value, true)}</div>
                <div className="tnum text-[12px] text-muted">{share(shown.value, ring)}</div>
              </>
            ) : (
              <>
                <div className="tnum text-[22px] font-bold leading-tight">{money(total, true)}</div>
                <div className="text-[12.5px] text-muted">{noun}</div>
              </>
            )}
          </Donut>
        </div>
        {parts.length ? (
          <ul className="w-full min-w-0 flex-1">
            {parts.map((p) => (
              <PartRow key={p.key} kind={kind} month={month} part={p} total={ring} active={active === p.arc} open={open === p.key} onActive={(k) => hover && setActive(k)} onToggle={() => setOpen(open === p.key ? null : p.key)} />
            ))}
          </ul>
        ) : (
          <div className="w-full flex-1 self-center py-6 text-center text-sm text-muted">{kind === "depenses" ? t("Aucune dépense ce mois-ci.") : t("Aucun revenu ce mois-ci.")}</div>
        )}
      </div>
    </div>
  );
}

const KINDS: { value: BreakdownKind; label: string }[] = [
  { value: "depenses", label: t("Dépenses") },
  { value: "revenus", label: t("Revenus") },
];

/**
 * iPhone : un seul anneau à la fois, bascule Dépenses | Revenus. La mise en page suit ici la largeur de
 * l'écran (576 px = carte de 512 px) et non une requête de conteneur : quand la bascule remplace le
 * contenu d'un conteneur, Safari mesure un instant la page sans ses nouveaux éléments, la trouve plus
 * courte et remonte le défilement — la page sautait vers le haut à chaque bascule.
 */
export function BreakdownSwitch({ data }: { data: MonthStats }) {
  const [kind, setKind] = useState<BreakdownKind>("depenses");
  return (
    <Card className="p-4">
      <div className="mb-4">
        <Segmented value={kind} options={KINDS} onChange={setKind} />
      </div>
      <Breakdown key={kind} kind={kind} data={data} byScreen />
    </Card>
  );
}
