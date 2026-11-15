import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, PiggyBank } from "lucide-react";
import { Card, InfoTip, Segmented } from "./ui.tsx";
import { Donut } from "./Donut.tsx";
import { Tile } from "./Logo.tsx";
import { openDrill } from "./DrillDrawer.tsx";
import { colorOf, HATCH, iconOf, openPart, share } from "./Breakdown.tsx";
import { cn } from "../cn.ts";
import { money, periodLabel } from "../format.ts";
import { isDiscreet } from "../discret.ts";
import { monthQuery, type MonthStats } from "../api.ts";
import { useEnvelopes, type Envelope } from "../api-situation.ts";
import { arcsOf, averageRows, incomeParts, savingsParts, spendingParts, type Arc, type BreakdownRow, type Part } from "../../lib/breakdown.ts";
import { monthTotals } from "../../lib/month.ts";
import { addMonths, isYearPeriod } from "../../lib/periods.ts";
import { t, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Répartition (Analyse, ordinateur). En tête : le solde de la période et ses trois jauges, puis trois anneaux —
 * revenus, dépenses, épargne. Dessous, une seule liste à pleine largeur : celle de l'anneau choisi, chaque part
 * avec sa barre (son poids face à la plus grosse), sa part en %, son montant et l'écart à la période de référence
 * (mois précédent, moyenne des trois derniers mois ou même mois de l'an dernier, au choix) ; un poste se déplie
 * sur ses catégories. Un trait sur la barre d'un poste marque le plafond de son enveloppe (Budget). Survoler une
 * ligne fait ressortir sa part dans l'anneau, et inversement ; un clic sur un autre anneau change de liste. Sur
 * le téléphone, l'écran Mois garde un anneau à la fois (`BreakdownSwitch`).
 */

type BoardKind = "revenus" | "depenses" | "epargne";
const KINDS: BoardKind[] = ["revenus", "depenses", "epargne"];
/** Période à laquelle on compare : la précédente, la moyenne des trois mois d'avant, le même mois un an plus tôt. */
type Reference = "precedent" | "moyenne" | "an";
const REFERENCE_KEY = "pecule.repartition.reference";
const readReference = (): Reference => {
  const v = localStorage.getItem(REFERENCE_KEY);
  return v === "moyenne" || v === "an" ? v : "precedent";
};

const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n, true)}`;
type Side = { parts: Part[]; arcs: Arc[]; total: number; ring: number };

const iconFor = (kind: BoardKind, p: { label: string; unclassified: boolean }) => (kind === "epargne" ? PiggyBank : iconOf(kind, p));
/** Opérations d'une part : l'épargne se lit par catégorie, comme un revenu. */
const openOf = (kind: BoardKind, month: string, p: Part) => openPart(kind === "depenses" ? "depenses" : "revenus", month, p);

export function BreakdownBoard({ data, current }: { data: MonthStats; /** Période en cours : la comparer à une période entière n'aurait pas de sens, l'écart reste une simple indication. */ current: boolean }) {
  const month = data.month;
  const year = isYearPeriod(month);
  const [kind, setKind] = useState<BoardKind>("depenses");
  const [active, setActive] = useState<{ kind: BoardKind; arc: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Reference>(readReference);
  // Une année entière ne se compare qu'à la précédente.
  const reference: Reference = year ? "precedent" : chosen;
  const pickReference = (r: Reference) => {
    localStorage.setItem(REFERENCE_KEY, r);
    setChosen(r);
  };
  // Mois de référence à lire en plus : les trois précédents (moyenne) ou le même mois un an plus tôt.
  const wanted = reference === "moyenne" ? [1, 2, 3].map((n) => addMonths(month, -n)) : reference === "an" ? [addMonths(month, -12)] : [];
  const extra = useQueries({ queries: wanted.map((m) => ({ ...monthQuery(m), staleTime: 5 * 60_000 })) });
  const loaded = extra.every((q) => q.data);
  // `useQueries` rend un nouveau tableau à chaque rendu : on suit l'heure d'arrivée de chaque mois, pas le tableau.
  const stamp = extra.map((q) => q.dataUpdatedAt).join("|");
  const previous: BreakdownRow[] | null = useMemo(() => {
    if (reference === "precedent") return data.previous;
    if (!loaded) return null;
    const months = extra.map((q) => q.data!.categories);
    return reference === "moyenne" ? averageRows(months) : (months[0] ?? []);
    // `extra` est lu au moment du calcul ; `stamp` dit quand il a changé.
  }, [reference, data, loaded, stamp]);

  const envelopes = useEnvelopes().data?.envelopes;
  const totals = monthTotals(data.categories);
  const sides = useMemo((): Record<BoardKind, Side> => {
    const before = previous ?? [];
    const side = (parts: Part[], others: string, total: number): Side => {
      const arcs = arcsOf(parts, others);
      return { parts, arcs, total, ring: arcs.reduce((s, a) => s + a.value, 0) };
    };
    const tot = monthTotals(data.categories);
    return {
      revenus: side(incomeParts(data.categories, before), tk("Autres revenus"), tot.revenus),
      depenses: side(spendingParts(data.categories, before, data.colored), tk("Autres postes"), tot.depenses),
      epargne: side(savingsParts(data.categories, before), tk("Autres supports"), tot.epargne),
    };
  }, [data, previous]);
  const balance = totals.revenus - totals.depenses;
  const scale = Math.max(totals.revenus, totals.depenses, totals.epargne, 1);
  const select = (k: BoardKind) => {
    setKind(k);
    setOpen(null);
  };
  // Clic sur une part : sur l'anneau choisi, ses opérations ; sur un autre, sa liste s'affiche (et le poste s'y déplie).
  const pick = (k: BoardKind, arc: string) => {
    const of = sides[k].parts.filter((p) => p.arc === arc && p.total > 0);
    if (k !== kind) {
      setKind(k);
      setOpen(of.length === 1 && of[0].items.length > 1 ? `${k}:${of[0].key}` : null);
    } else if (of.length === 1) openOf(k, month, of[0]);
  };
  const side = sides[kind];
  // Plafond d'une enveloppe : sur les dépenses d'un mois seulement (une enveloppe est mensuelle).
  const caps = kind === "depenses" && !year ? (envelopes ?? []) : [];
  const capOf = (scope: Envelope["scope"], ref: string | null | undefined) => (ref ? caps.find((e) => e.scope === scope && e.ref === ref) : undefined);
  // Échelle des barres : la plus grosse part, ou le plus haut plafond affiché s'il la dépasse (son trait doit tenir).
  const max = Math.max(1, ...side.parts.map((p) => Math.max(p.total, capOf("poste", p.poste)?.monthly ?? 0)));
  const HINTS: Record<BoardKind, string> = {
    revenus: t("Clic : les opérations"),
    depenses: t("Un poste se déplie sur ses catégories · clic sur l'anneau : les opérations"),
    epargne: t("Clic : les opérations"),
  };
  const EMPTY: Record<BoardKind, string> = { revenus: t("Aucun revenu ce mois-ci."), depenses: t("Aucune dépense ce mois-ci."), epargne: t("Aucun versement d'épargne ce mois-ci.") };
  return (
    <>
      <Card className="p-6 lg:p-8">
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
          <div>
            <div className="flex items-center gap-1.5 text-[17px] text-muted">
              {year ? t("Solde de l'année") : t("Solde du mois")}
              <InfoTip text={t("Revenus moins dépenses. L'épargne n'en est pas retirée : c'est ce qui reste avant de mettre de côté.")} />
            </div>
            <div className={cn("figure mt-1 text-[42px]", !isDiscreet() && (balance >= 0 ? "text-pos" : "text-neg"))}>{signed(balance)}</div>
            {totals.revenus > 0 && totals.epargne > 0 && <div className="mt-2 text-[13.5px] text-muted">{t("{part} des revenus mis de côté", { part: share(totals.epargne, totals.revenus) ?? "" })}</div>}
          </div>
          <div className="w-full max-w-md space-y-3">
            <Gauge label={t("Revenus")} info={t("Ce qui est classé en revenu sur la période ; une entrée sans catégorie compte aussi. Les mouvements entre tes comptes n'en font pas partie.")} value={totals.revenus} scale={scale} color="var(--color-pos)" />
            <Gauge label={t("Dépenses")} info={t("Ce qui est classé en dépense, remboursements déduits ; une sortie sans catégorie compte aussi. Ni l'épargne ni les mouvements entre tes comptes.")} value={totals.depenses} scale={scale} color="var(--color-ink)" />
            <Gauge label={t("Épargne")} info={t("Ce qui est classé en épargne : les versements vers un livret, une assurance-vie, un plan d'épargne.")} value={totals.epargne} scale={scale} color="var(--color-pos)" hatched />
          </div>
        </div>
        <div className="mt-8 grid gap-x-6 gap-y-8 sm:grid-cols-3">
          {KINDS.map((k) => (
            <Ring key={k} kind={k} side={sides[k]} month={month} selected={kind === k} active={active?.kind === k ? active.arc : null} onActive={(arc) => setActive(arc ? { kind: k, arc } : null)} onSelect={() => select(k)} onPick={(arc) => pick(k, arc)} />
          ))}
        </div>
      </Card>

      <Card className="@container mt-4 p-5 lg:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Segmented<BoardKind>
            value={kind}
            onChange={select}
            options={[
              { value: "revenus", label: t("Revenus par catégorie") },
              { value: "depenses", label: t("Dépenses par poste") },
              { value: "epargne", label: t("Épargne par support") },
            ]}
          />
          {year ? (
            <span className="text-[12.5px] text-muted">{HINTS[kind]}</span>
          ) : (
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
              {t("Comparer à")}
              <select value={chosen} onChange={(e) => pickReference(e.target.value as Reference)} className="rounded-lg bg-bg py-1 pl-2.5 text-[12.5px] text-ink ring-1 ring-line">
                <option value="precedent">{t("le mois précédent")}</option>
                <option value="moyenne">{t("la moyenne des 3 derniers mois")}</option>
                <option value="an">{t("le même mois, l'an dernier")}</option>
              </select>
            </label>
          )}
        </div>
        {side.parts.length ? (
          <ul>
            {side.parts.map((p) => (
              <BoardRow
                key={p.key}
                kind={kind}
                month={month}
                part={p}
                total={side.ring}
                max={max}
                current={current}
                reference={previous ? reference : null}
                cap={capOf("poste", p.poste)}
                capOf={(id) => capOf("categorie", id)}
                active={active?.kind === kind && active.arc === p.arc}
                open={open === `${kind}:${p.key}`}
                onActive={(arc) => setActive(arc ? { kind, arc } : null)}
                onToggle={() => setOpen(open === `${kind}:${p.key}` ? null : `${kind}:${p.key}`)}
              />
            ))}
          </ul>
        ) : (
          <div className="py-8 text-center text-sm text-muted">{EMPTY[kind]}</div>
        )}
        {!year && <div className="mt-3 text-[12.5px] text-muted">{HINTS[kind]}{caps.length > 0 && ` · ${t("le trait sur une barre : le plafond de son enveloppe")}`}</div>}
      </Card>
    </>
  );
}

/** Un anneau et son titre ; ceux dont la liste n'est pas affichée s'effacent un peu et se choisissent d'un clic. */
function Ring({ kind, side, month, selected, active, onActive, onSelect, onPick }: { kind: BoardKind; side: Side; month: string; selected: boolean; active: string | null; onActive: (arc: string | null) => void; onSelect: () => void; onPick: (arc: string) => void }) {
  const shown = side.arcs.find((a) => a.key === active);
  const n = side.parts.filter((p) => p.total > 0).length;
  const noun = kind === "depenses" ? t("Dépenses") : kind === "revenus" ? t("Revenus") : t("Épargne");
  const count = kind === "depenses" ? tn("{n} poste", "{n} postes", n) : kind === "revenus" ? tn("{n} source", "{n} sources", n) : tn("{n} support", "{n} supports", n);
  const p = { mois: periodLabel(month), montant: money(side.total, true) };
  const summary = kind === "depenses" ? t("Dépenses de {mois} : {montant}.", p) : kind === "revenus" ? t("Revenus de {mois} : {montant}.", p) : t("Épargne de {mois} : {montant}.", p);
  return (
    <div className={cn("mx-auto w-full max-w-[230px] transition-opacity duration-200", !selected && "opacity-65 hover:opacity-100")}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="mx-auto mb-4 block">
        <span className={cn("rounded-full px-3.5 py-1.5 text-[14px] font-semibold transition-colors", selected ? "bg-ink text-card" : "bg-line/60 text-muted")}>{noun}</span>
      </button>
      <Donut
        arcs={side.arcs.map((a) => ({ key: a.key, label: td(a.label), value: a.value, color: colorOf(a.slot), hatched: a.unclassified, icon: a.key === "autres" ? undefined : iconFor(kind, a) }))}
        active={active}
        onActive={onActive}
        onPick={onPick}
        label={`${summary} ${side.arcs.map((a) => `${td(a.label)} ${share(a.value, side.ring) ?? ""}`).join(", ")}`}
      >
        {shown ? (
          <>
            <div className="line-clamp-2 text-[12.5px] leading-tight text-muted">{td(shown.label)}</div>
            <div className="figure mt-1 text-[22px]">{money(shown.value, true)}</div>
            <div className="tnum mt-0.5 text-[12.5px] text-muted">{share(shown.value, side.ring)}</div>
          </>
        ) : (
          <>
            <div className="figure text-[26px]">{money(side.total, true)}</div>
            <div className="mt-1 text-[13px] text-muted">{count}</div>
          </>
        )}
      </Donut>
    </div>
  );
}

/** Jauge de l'en-tête : un total de la période face au plus grand des trois. */
function Gauge({ label, info, value, scale, color, hatched }: { label: string; info: string; value: number; scale: number; color: string; hatched?: boolean }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(2.5rem,1fr)_auto] items-center gap-3 text-[14px]">
      <span className="flex items-center gap-1.5 text-muted">
        {label}
        <InfoTip text={info} />
      </span>
      <span className="h-2.5 overflow-hidden rounded-full bg-line/70">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.max(value > 0 ? 3 : 0, (Math.max(0, value) / scale) * 100)}%`, background: hatched ? `repeating-linear-gradient(135deg, ${color} 0 4px, color-mix(in srgb, ${color} 55%, transparent) 4px 7px)` : color }}
        />
      </span>
      <span className="tnum min-w-[4.25rem] text-right font-semibold">{money(value, true)}</span>
    </div>
  );
}

/** Écart d'une part à la période de référence : une étiquette de couleur, ou une simple indication pendant la période en cours. */
function Compare({ kind, part, current, year, reference }: { kind: BoardKind; part: Part; current: boolean; year: boolean; /** null : la référence se charge encore. */ reference: Reference | null }) {
  if (!reference) return <span className="text-[12.5px] text-muted">…</span>;
  const m = { montant: money(part.prev, true) };
  const before = year ? t("année préc. {montant}", m) : reference === "moyenne" ? t("moy. 3 mois {montant}", m) : reference === "an" ? t("il y a un an {montant}", m) : t("mois préc. {montant}", m);
  const nothing = year ? t("rien l'année préc.") : reference === "moyenne" ? t("rien sur 3 mois") : reference === "an" ? t("rien il y a un an") : t("rien le mois préc.");
  if (!part.prev) return <span className="text-[12.5px] text-muted">{nothing}</span>;
  if (current) return <span className="tnum text-[12.5px] text-muted">{before}</span>;
  const diff = Math.round((part.total - part.prev) * 100) / 100;
  if (Math.abs(diff) < 1)
    return (
      <span className="chip tnum text-[12.5px]" data-tip={before}>
        =
      </span>
    );
  // Dépenser moins est favorable ; gagner ou épargner moins ne l'est pas.
  const good = kind === "depenses" ? diff < 0 : diff > 0;
  return (
    <span className={cn("chip tnum text-[12.5px]", good ? "chip-pos" : "chip-neg")} data-tip={before}>
      {signed(diff)}
    </span>
  );
}

/** Barre d'une part, face à l'échelle de la liste ; le trait marque le plafond de son enveloppe, s'il y en a une. */
function Bar({ value, max, color, cap, thin = false }: { value: number; max: number; color: string; cap?: Envelope; thin?: boolean }) {
  const over = cap ? value > cap.monthly : false;
  return (
    <span className="relative hidden @3xl:block">
      <span className={cn("block overflow-hidden rounded-full bg-line/60", thin ? "h-1.5" : "h-2.5")}>
        <span className={cn("block h-full rounded-full transition-[width] duration-300", thin && "opacity-60")} style={{ width: `${Math.max(value > 0 ? 1.5 : 0, (Math.max(0, value) / max) * 100)}%`, background: color }} />
      </span>
      {cap && cap.monthly > 0 && (
        <span
          data-tip={
            over
              ? t("Enveloppe : {plafond} par mois — dépassée de {ecart}", { plafond: money(cap.monthly, true), ecart: money(value - cap.monthly, true) })
              : t("Enveloppe : {plafond} par mois — reste {reste}", { plafond: money(cap.monthly, true), reste: money(cap.monthly - value, true) })
          }
          className={cn("absolute top-1/2 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card", thin ? "h-3" : "h-4", over ? "bg-neg" : "bg-ink")}
          style={{ left: `${Math.min(100, (cap.monthly / max) * 100)}%` }}
        />
      )}
    </span>
  );
}

const GRID = "grid w-full items-center gap-x-4 grid-cols-[minmax(0,1fr)_auto_1.25rem] @3xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_3.25rem_7rem_9rem_1.25rem]";

/** Une part de la liste : icône et nom, barre, part en %, montant, écart ; un poste se déplie sur ses catégories. */
function BoardRow({
  kind,
  month,
  part,
  total,
  max,
  current,
  reference,
  cap,
  capOf,
  active,
  open,
  onActive,
  onToggle,
}: {
  kind: BoardKind;
  month: string;
  part: Part;
  total: number;
  max: number;
  current: boolean;
  reference: Reference | null;
  cap?: Envelope;
  capOf: (categoryId: string | null) => Envelope | undefined;
  active: boolean;
  open: boolean;
  onActive: (arc: string | null) => void;
  onToggle: () => void;
}) {
  const Icon = iconFor(kind, part);
  const expandable = part.items.length > 1;
  const color = part.unclassified ? HATCH : colorOf(part.slot);
  const year = isYearPeriod(month);
  return (
    <li className="border-t border-line first:border-t-0">
      <button
        type="button"
        aria-expanded={expandable ? open : undefined}
        onMouseEnter={() => onActive(part.arc)}
        onMouseLeave={() => onActive(null)}
        onClick={() => (expandable ? onToggle() : openOf(kind, month, part))}
        className={cn(GRID, "-mx-2 w-[calc(100%+1rem)] rounded-xl px-2 py-2.5 text-left transition-colors", active && "bg-bg")}
      >
        <span className="flex min-w-0 items-center gap-3">
          <Tile size="sm" tone={part.unclassified ? "warn" : "neutral"}>
            <Icon size={15} strokeWidth={2} />
          </Tile>
          <span className="min-w-0">
            <span className={cn("block truncate text-[15px] font-medium", part.unclassified && "text-warn")}>{td(part.label)}</span>
            <span className="block truncate text-[12.5px] text-muted">{tn("{n} opération", "{n} opérations", part.count)}</span>
            {/* Liste étroite (panneau de l'assistant ouvert) : la barre n'a plus sa colonne, un filet sous le nom la remplace. */}
            <span className="mt-1 block h-1 w-40 max-w-full overflow-hidden rounded-full bg-line/60 @3xl:hidden">
              <span className="block h-full rounded-full" style={{ width: `${Math.max(part.total > 0 ? 2 : 0, (Math.max(0, part.total) / max) * 100)}%`, background: color }} />
            </span>
          </span>
        </span>
        <Bar value={part.total} max={max} color={color} cap={cap} />
        <span className="tnum hidden text-right text-[13px] text-muted @3xl:block">{share(part.total, total) ?? "—"}</span>
        <span className="tnum text-right text-[15px] font-semibold">{money(part.total)}</span>
        <span className="hidden justify-self-end @3xl:block">
          <Compare kind={kind} part={part} current={current} year={year} reference={reference} />
        </span>
        {expandable ? <ChevronDown size={16} className={cn("text-muted transition-transform", open && "rotate-180")} /> : <ChevronRight size={16} className="text-muted" />}
      </button>
      {expandable && open && (
        <div className="sel-in mb-3 ml-[2.75rem]">
          {part.items.map((c) => (
            <button
              key={c.id ?? "none"}
              type="button"
              onClick={() => openDrill(td(c.name), c.id ? { month, category: c.id } : { month, uncategorized: true, debits: true }, periodLabel(month))}
              className={cn(GRID, "rounded-lg py-1.5 text-left hover:bg-bg/70 @3xl:grid-cols-[minmax(0,14.25rem)_minmax(0,1fr)_3.25rem_7rem_9rem_1.25rem]")}
            >
              <span className="min-w-0 truncate text-[13.5px]">
                {td(c.name)} <span className="text-[12.5px] text-muted">· {c.count}</span>
              </span>
              <Bar value={c.total} max={max} color={color} cap={capOf(c.id)} thin />
              <span className="tnum hidden text-right text-[12.5px] text-muted @3xl:block">{share(c.total, part.total) ?? "—"}</span>
              <span className="tnum text-right text-[13.5px]">{money(c.total)}</span>
              <span className="hidden @3xl:block" />
              <ChevronRight size={14} className="text-muted/60" />
            </button>
          ))}
          <button type="button" onClick={() => openOf(kind, month, part)} className="mt-1 rounded-md py-1 text-left text-[13px] font-medium text-accent">
            {t("Toutes les opérations du poste")}
          </button>
        </div>
      )}
    </li>
  );
}
