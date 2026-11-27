import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { transactionMonthsQuery, type Account, type Category, type TxFilters } from "../api.ts";
import { BankBadge, Sheet } from "./ui.tsx";
import { NATURE_ICONS } from "../natureIcons.ts";
import { colorOf } from "../charts.ts";
import { cn } from "../cn.ts";
import { currentMonth, monthName, periodLabel } from "../format.ts";
import { NATURE_LABELS, type Nature } from "../../lib/nature.ts";
import { transferLabel } from "../../lib/transfers.ts";
import { groupByPoste, searchGroups, wholePoste } from "../../lib/category-groups.ts";
import { pillOrder, yearBounds, yearGrid, type FilterKey } from "../../lib/ops-filters.ts";
import { posteSlot } from "../../lib/tx-groups.ts";
import { t as tr, td, tn } from "../../lib/i18n.ts";

/*
 * Téléphone : la barre des filtres de l'écran Opérations. Une rangée de pastilles sur une seule ligne, qui défile au
 * doigt. Une pastille au repos ouvre son choix dans une feuille ; celle qui filtre écrit sa valeur et passe en tête —
 * toucher la valeur rouvre le choix, la croix la retire.
 */

/** Ce qu'un choix change dans l'adresse de l'écran : paramètre → valeur, null pour le retirer. */
type Patch = Record<string, string | null>;
type Choice = Exclude<FilterKey, "a_classer">;

export function OpsFilterBar({
  filters,
  accounts,
  categories,
  colored,
  onChange,
}: {
  filters: TxFilters;
  accounts: Account[];
  categories: Category[];
  /** Postes qui ont une couleur, dans l'ordre de l'anneau des dépenses. */
  colored: string[] | undefined;
  onChange: (patch: Patch) => void;
}) {
  const { account, category, poste, month, nature, uncategorized } = filters;
  const [open, setOpen] = useState<Choice | null>(null);
  const row = useRef<HTMLDivElement>(null);

  const acc = accounts.find((a) => a.id === account);
  // Ce que chaque filtre écrit sur sa pastille ; null : il ne filtre pas.
  const values: Record<FilterKey, string | null> = {
    a_classer: uncategorized ? tr("À classer") : null,
    // Arrivée d'une répartition sur « Apports de … » ou « Versements à … » : le filtre porte ce nom, pas son identifiant.
    categorie: category ? (transferLabel(category, tr) ?? td(categories.find((c) => c.id === category)?.name) ?? category) : poste ? td(poste) : null,
    compte: account ? (acc?.display_name ?? acc?.name ?? tr("Compte")) : null,
    nature: nature ? (NATURE_LABELS[nature as Nature] ?? nature) : null,
    mois: month ? periodLabel(month) : null,
  };
  const names: Record<FilterKey, string> = { a_classer: tr("À classer"), categorie: tr("Catégorie"), compte: tr("Compte"), nature: tr("Nature"), mois: tr("Mois") };
  const cleared: Record<FilterKey, Patch> = { a_classer: { a_classer: null }, categorie: { categorie: null, poste: null }, compte: { compte: null }, nature: { nature: null }, mois: { mois: null } };
  const order = pillOrder({ a_classer: !!values.a_classer, categorie: !!values.categorie, compte: !!values.compte, nature: !!values.nature, mois: !!values.mois });

  // Un filtre posé ou retiré : la rangée revient à son début, là où sont les filtres en cours.
  const orderKey = order.join();
  useEffect(() => {
    row.current?.scrollTo({ left: 0 });
  }, [orderKey]);

  const pick = (patch: Patch) => {
    onChange(patch);
    setOpen(null);
  };

  return (
    <>
      <div ref={row} role="group" aria-label={tr("Filtres")} className="-mx-4 mt-1.5 flex gap-2 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] md:-mx-8 md:px-8 [&::-webkit-scrollbar]:hidden">
        {order.map((k) =>
          k === "a_classer" ? (
            <Pill key={k} name={names[k]} value={values[k]} onTap={() => onChange({ a_classer: uncategorized ? null : "1" })} onClear={() => onChange(cleared[k])} />
          ) : (
            <Pill key={k} name={names[k]} value={values[k]} choice onTap={() => setOpen(k)} onClear={() => onChange(cleared[k])} />
          ),
        )}
      </div>
      {open === "categorie" && <CategorySheet category={category} poste={poste} categories={categories} colored={colored} onPick={pick} onClose={() => setOpen(null)} />}
      {open === "compte" && <AccountSheet account={account} accounts={accounts} onPick={pick} onClose={() => setOpen(null)} />}
      {open === "nature" && <NatureSheet nature={nature} onPick={pick} onClose={() => setOpen(null)} />}
      {open === "mois" && <MonthSheet filters={filters} onPick={pick} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Une pastille de la barre. Au repos : son nom (et un chevron si elle ouvre un choix). Qui filtre : sa valeur, et la croix qui la retire. */
function Pill({ name, value, choice = false, onTap, onClear }: { name: string; value: string | null; choice?: boolean; onTap: () => void; onClear: () => void }) {
  if (value == null)
    return (
      <button type="button" onClick={onTap} aria-haspopup={choice ? "dialog" : undefined} aria-pressed={choice ? undefined : false} className="press flex shrink-0 items-center gap-1 rounded-full bg-card py-1.5 pl-3 pr-2.5 text-sm text-muted ring-1 ring-line">
        {name}
        {choice ? <ChevronDown size={14} aria-hidden /> : <span className="w-0.5" />}
      </button>
    );
  return (
    <span className="flex shrink-0 items-center rounded-full bg-accent text-sm font-medium text-white">
      <button type="button" onClick={onTap} aria-haspopup={choice ? "dialog" : undefined} aria-pressed={choice ? undefined : true} aria-label={choice ? `${name} : ${value}` : undefined} className="press max-w-48 truncate rounded-l-full py-1.5 pl-3 pr-1">
        {value}
      </button>
      <button type="button" onClick={onClear} aria-label={tr("Retirer le filtre « {nom} »", { nom: value })} className="press rounded-r-full py-1.5 pl-1 pr-2.5">
        <X size={14} aria-hidden />
      </button>
    </span>
  );
}

/** Une ligne d'une liste de choix : ce qui est retenu porte une coche. */
function ChoiceRow({ icon, label, hint, selected, onClick }: { icon?: ReactNode; label: string; hint?: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
      {icon && <span className={cn("flex shrink-0", selected ? "text-accent" : "text-muted")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[15px]", selected && "font-semibold")}>{label}</span>
        {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
      </span>
      {selected && <Check size={18} className="shrink-0 text-accent" aria-hidden />}
    </button>
  );
}

/** Catégories rangées sous leur poste, comme dans la fiche d'une opération ; un poste entier se choisit par son titre. */
function CategorySheet({ category, poste, categories, colored, onPick, onClose }: { category?: string; poste?: string; categories: Category[]; colored: string[] | undefined; onPick: (patch: Patch) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const all = useMemo(() => groupByPoste(categories), [categories]);
  // Les postes qui se filtrent en entier se décident sur la liste complète, pas sur ce que la recherche en garde.
  const whole = useMemo(() => new Set(all.filter(wholePoste).map((g) => g.poste)), [all]);
  const groups = useMemo(() => searchGroups(all, query, (name) => td(name)), [all, query]);
  const transfer = transferLabel(category, tr);
  // Rouverte sur un filtre en cours : la feuille s'ouvre à sa hauteur, sans avoir à le chercher dans la liste.
  const current = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <Sheet open onClose={onClose} title={tr("Catégorie")}>
      <label className="card mb-3 flex items-center gap-2 px-4 py-2.5">
        <Search size={16} className="text-muted" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr("Chercher une catégorie…")} className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted md:text-[14px]" enterKeyHint="search" />
        {query && (
          <button type="button" onClick={() => setQuery("")} aria-label={tr("Effacer")}>
            <X size={16} className="text-muted" />
          </button>
        )}
      </label>

      {!query && (
        <div className="card mb-4 overflow-hidden">
          <ChoiceRow label={tr("Toutes les catégories")} selected={!category && !poste} onClick={() => onPick({ categorie: null, poste: null })} />
          {/* Un apport ou un versement n'est pas une catégorie du référentiel : le filtre en cours se lit ici. */}
          {transfer && <ChoiceRow label={transfer} selected onClick={onClose} />}
        </div>
      )}

      <div className="space-y-4">
        {groups.map((g) => {
          const expense = g.list[0].kind === "depense" && g.list[0].poste === g.poste;
          const wholeOn = !category && poste === g.poste;
          return (
            <section key={g.poste}>
              <div className="mb-1.5 flex min-h-7 items-center gap-2 px-1">
                {expense && <span className="size-2 shrink-0 rounded-sm" style={{ background: colorOf(posteSlot(colored, { category_poste: g.poste, category_kind: "depense" })) }} aria-hidden />}
                <h3 className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-muted">{td(g.poste)}</h3>
                {whole.has(g.poste) && (
                  <button
                    ref={wholeOn ? current : undefined}
                    type="button"
                    onClick={() => onPick({ categorie: null, poste: g.poste })}
                    aria-pressed={wholeOn}
                    aria-label={tr("Tout le poste « {nom} »", { nom: td(g.poste) })}
                    className={cn("press -my-1 flex shrink-0 items-center gap-0.5 rounded-full py-1.5 pl-2.5 pr-1.5 text-[12.5px] font-medium", wholeOn ? "bg-accent text-white" : "text-accent")}
                  >
                    {tr("Tout le poste")}
                    {wholeOn ? <Check size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.list.map((c) => (
                  <button
                    key={c.id}
                    ref={category === c.id ? current : undefined}
                    type="button"
                    onClick={() => onPick({ categorie: c.id, poste: null })}
                    aria-pressed={category === c.id}
                    className={cn("press rounded-full px-3 py-2 text-sm font-medium", category === c.id ? "bg-accent text-white" : "bg-card ring-1 ring-line")}
                  >
                    {td(c.name)}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
        {groups.length === 0 && <div className="px-1 text-sm text-muted">{tr("Aucune catégorie ne correspond.")}</div>}
      </div>
    </Sheet>
  );
}

function AccountSheet({ account, accounts, onPick, onClose }: { account?: string; accounts: Account[]; onPick: (patch: Patch) => void; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={tr("Compte")}>
      <div className="card divide-y divide-line overflow-hidden">
        <ChoiceRow label={tr("Tous les comptes")} selected={!account} onClick={() => onPick({ compte: null })} />
        {accounts
          .filter((a) => !a.hidden || a.id === account)
          .map((a) => (
            <ChoiceRow
              key={a.id}
              icon={<BankBadge bank={a.institution} size="sm" />}
              label={a.display_name ?? a.name}
              // Un compte sorti des statistiques n'apparaît dans la liste que filtrée sur lui : le dire là où on le choisit.
              hint={[a.institution, a.excluded ? tr("hors statistiques") : null].filter(Boolean).join(" · ") || undefined}
              selected={a.id === account}
              onClick={() => onPick({ compte: a.id })}
            />
          ))}
      </div>
    </Sheet>
  );
}

function NatureSheet({ nature, onPick, onClose }: { nature?: string; onPick: (patch: Patch) => void; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={tr("Nature")}>
      <div className="card divide-y divide-line overflow-hidden">
        <ChoiceRow label={tr("Toutes les natures")} selected={!nature} onClick={() => onPick({ nature: null })} />
        {(Object.keys(NATURE_LABELS) as Nature[]).map((n) => {
          const Icon = NATURE_ICONS[n];
          return <ChoiceRow key={n} icon={<Icon size={17} aria-hidden />} label={NATURE_LABELS[n]} selected={nature === n} onClick={() => onPick({ nature: n })} />;
        })}
      </div>
    </Sheet>
  );
}

/**
 * Un mois, ou une année entière. Chaque mois dit combien d'opérations il garde avec les autres filtres en cours :
 * on voit où chercher, et un mois vide ne se choisit pas.
 */
function MonthSheet({ filters, onPick, onClose }: { filters: TxFilters; onPick: (patch: Patch) => void; onClose: () => void }) {
  const month = filters.month;
  const now = currentMonth();
  // La même lecture que le bilan par mois de la liste, sans le filtre du mois : sans lui, c'est celle que l'écran a déjà.
  const all = useQuery({ ...transactionMonthsQuery({ ...filters, month: undefined }), placeholderData: keepPreviousData });
  const counts = useMemo(() => (all.data ? new Map(all.data.months.map((m) => [m.month, m.count])) : null), [all.data]);
  const bounds = yearBounds(all.data?.months.map((m) => m.month) ?? [], now, month);
  const [year, setYear] = useState(Number((month ?? now).slice(0, 4)));
  const grid = yearGrid(year, counts, now);
  const yearCount = counts ? grid.reduce((s, m) => s + (m.count ?? 0), 0) : null;
  const yearOn = month === String(year);
  // Sur un fond d'accent, un nombre hérite de la couleur du texte : en thème sombre, c'est l'élément coloré qui la décide.
  const step = "press card grid size-10 place-items-center disabled:opacity-30";

  return (
    <Sheet open onClose={onClose} title={tr("Mois")}>
      <div className="card mb-4 overflow-hidden">
        <ChoiceRow label={tr("Tous les mois")} selected={!month} onClick={() => onPick({ mois: null })} />
      </div>

      <div className="mb-3 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setYear(year - 1)} disabled={year <= bounds.min} aria-label={tr("Année précédente")} className={step}>
          <ChevronLeft size={18} aria-hidden />
        </button>
        <div className="tnum text-[17px] font-semibold" aria-live="polite">
          {year}
        </div>
        <button type="button" onClick={() => setYear(year + 1)} disabled={year >= bounds.max} aria-label={tr("Année suivante")} className={step}>
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onPick({ mois: String(year) })}
        disabled={yearCount === 0 && !yearOn}
        aria-pressed={yearOn}
        className={cn("press mb-2 flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left text-[15px] font-medium disabled:opacity-40", yearOn ? "bg-accent text-white" : "bg-card ring-1 ring-line")}
      >
        {tr("Toute l'année {annee}", { annee: year })}
        {yearCount != null && <span className={cn("tnum text-xs font-normal", !yearOn && "text-muted")}>{tn("{n} opération", "{n} opérations", yearCount)}</span>}
      </button>

      <div className={cn("grid grid-cols-3 gap-2 transition-opacity duration-200", all.isPlaceholderData && "opacity-60")}>
        {grid.map((m) => {
          const on = month === m.month;
          return (
            <button
              key={m.month}
              type="button"
              onClick={() => onPick({ mois: m.month })}
              disabled={m.empty && !on}
              aria-pressed={on}
              className={cn("press flex min-h-14 flex-col items-center justify-center rounded-xl px-1 py-2 disabled:opacity-40", on ? "bg-accent text-white" : "bg-card ring-1 ring-line")}
            >
              <span className="max-w-full truncate text-[15px] font-medium">{monthName(m.month)}</span>
              {m.count != null && m.count > 0 && <span className={cn("tnum text-xs", !on && "text-muted")}>{m.count}</span>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
