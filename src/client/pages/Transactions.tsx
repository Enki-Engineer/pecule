import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, Eye, Search, Tags, X, Sparkles, Paperclip, ShieldCheck, PanelRight, CheckSquare, Store, Tag, CalendarDays, Shapes, Copy, MessageSquare } from "lucide-react";
import { ContextMenu, useContextMenu } from "../components/ContextMenu.tsx";
import { TxLogo } from "../components/Logo.tsx";
import { undoToast } from "../undo.ts";
import { SwipeTxRow } from "../components/SwipeTxRow.tsx";
import { NameDebit } from "../components/NameDebit.tsx";
import { AddOperationButton, DeleteManualOperation } from "../components/ManualEntry.tsx";
import { HoverPreview } from "../components/HoverPreview.tsx";
import { openInvoiceViewer } from "../components/InvoiceViewer.tsx";
import { NATURE_LABELS, natureOf, merchantName, type Nature } from "../../lib/nature.ts";
import { natureColor } from "../charts.ts";
import { askAssistant } from "../assistantBus.ts";
import { useQueryClient } from "@tanstack/react-query";
import { useMedia } from "../useMedia.ts";
import { cn } from "../cn.ts";
import { Link } from "react-router";
import clsx from "clsx";
import { toast } from "sonner";
import { api, transactionListQuery, useAccounts, useCategories, useSuggestions, useTransactionDetails, useUpdateTransaction, type Category, type Transaction, type TxFilters } from "../api.ts";
import { AddInvoiceButton, FileIcon } from "./Invoices.tsx";
import { Amount, Card, Empty, ErrorBox, PageHeader, Sheet, Spinner, TxAmount } from "../components/ui.tsx";
import { OpsTabs, useListSearch, useTabParams, useTabState } from "../components/OpsSection.tsx";
import { dateFr, dateShort, dayLabel, money, moneyIn, monthLabel, periodLabel } from "../format.ts";
import { txDateHint, txSubline } from "../txInfo.ts";
import { Equivalence } from "../components/Equivalence.tsx";
import { txTitle } from "../../lib/labels.ts";
import { useAssistantEntity } from "../assistantContext.ts";
import { t as tr, td, tk, tn } from "../../lib/i18n.ts";


export function Transactions() {
  const [params, setParams] = useTabParams();
  const account = params.get("compte") ?? undefined;
  const category = params.get("categorie") ?? undefined;
  const poste = params.get("poste") ?? undefined;
  const month = params.get("mois") ?? undefined;
  const nature = params.get("nature") ?? undefined;
  const uncategorized = params.get("a_classer") === "1";
  const [search, setSearch, debounced] = useListSearch(params.get("q") ?? "");

  const accounts = useAccounts();
  const categories = useCategories();
  const [selected, setSelected] = useState<Transaction | null>(null);

  const filters: TxFilters = { account, category, poste, month, nature, uncategorized, q: debounced };
  // Filtres, recherche : la liste reste affichée pendant le chargement de la suivante (pas de squelette).
  const list = useInfiniteQuery({ ...transactionListQuery(filters), placeholderData: keepPreviousData });

  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.transactions) ?? [], [list.data]);
  // Opération choisie dans la recherche ⌘K : on l'ouvre dès qu'elle apparaît dans la liste.
  const openTx = (useTabState() as { openTx?: string } | null)?.openTx;
  const sought = useRef<string | null>(null);
  useEffect(() => {
    if (!openTx || list.isLoading || list.isPlaceholderData) return;
    const done = (t: Transaction | null) => {
      if (t) setSelected(t);
      sought.current = null;
      window.history.replaceState({ ...window.history.state, usr: null }, "");
      // La ligne est amenée au milieu de l'écran : on voit où l'on est dans la liste.
      if (t) requestAnimationFrame(() => document.querySelector(`[data-tx="${CSS.escape(t.id)}"]`)?.scrollIntoView({ block: "center" }));
    };
    const t = rows.find((r) => r.id === openTx);
    if (t) return done(t);
    // Pas encore dans les lignes chargées : on charge la suite (quelques pages au plus)…
    if (list.hasNextPage && rows.length < 480) {
      if (!list.isFetchingNextPage) void list.fetchNextPage();
      return;
    }
    // … sinon (compte hors stats, filtre qui l'écarte) on ouvre quand même sa fiche.
    if (sought.current === openTx) return;
    sought.current = openTx;
    api<{ transactions: Transaction[] }>(`/transactions?id=${encodeURIComponent(openTx)}&limit=1`).then(
      (r) => done(r.transactions[0] ?? null),
      () => done(null),
    );
  }, [openTx, rows, list.isLoading, list.isPlaceholderData, list.hasNextPage, list.isFetchingNextPage, list.fetchNextPage]);
  const byDay = useMemo(() => {
    const groups: { day: string; items: Transaction[] }[] = [];
    for (const t of rows) {
      const last = groups.at(-1);
      if (last?.day === t.date) last.items.push(t);
      else groups.push({ day: t.date, items: [t] });
    }
    return groups;
  }, [rows]);

  const chips: { key: string; label: string }[] = [];
  if (account) chips.push({ key: "compte", label: accounts.data?.accounts.find((a) => a.id === account)?.display_name ?? accounts.data?.accounts.find((a) => a.id === account)?.name ?? tr("Compte") });
  if (category) chips.push({ key: "categorie", label: td(categories.data?.categories.find((c) => c.id === category)?.name) ?? category });
  if (poste) chips.push({ key: "poste", label: td(poste) });
  if (month) chips.push({ key: "mois", label: periodLabel(month) });
  if (nature) chips.push({ key: "nature", label: NATURE_LABELS[nature as Nature] ?? nature });
  if (uncategorized) chips.push({ key: "a_classer", label: tr("À classer") });

  const removeChip = (key: string) => {
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next, { replace: true });
  };
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const desktop = useMedia("(min-width: 1024px)");
  if (desktop)
    return (
      <DesktopOperations
        rows={rows}
        list={list}
        search={search}
        setSearch={setSearch}
        params={{ account, category, month, nature, uncategorized }}
        setParam={setParam}
        accounts={accounts.data?.accounts ?? []}
        categories={categories.data?.categories ?? []}
        selected={selected}
        setSelected={setSelected}
      />
    );

  return (
    <>
      <PageHeader
        title={tr("Opérations")}
        right={
          <div className="flex items-center gap-2">
            <AddOperationButton />
            <TriageButton />
          </div>
        }
      />
      <OpsTabs current="operations" />
      <div className="sticky top-[calc(44px+env(safe-area-inset-top))] z-20 -mx-4 bg-bg/90 px-4 pb-3 pt-1 backdrop-blur-xl md:-mx-8 md:px-8">
        <label className="card flex items-center gap-2 px-4 py-3">
          <Search size={18} className="text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr("Rechercher un libellé, une note…")}
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted"
            enterKeyHint="search"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label={tr("Effacer")}>
              <X size={18} className="text-muted" />
            </button>
          )}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {!uncategorized && (
            <button type="button" onClick={() => setParams(new URLSearchParams({ ...Object.fromEntries(params), a_classer: "1" }), { replace: true })} className="press rounded-full bg-card px-3 py-1.5 text-sm text-muted ring-1 ring-line">
              {tr("À classer")}
            </button>
          )}
          {chips.map((c) => (
            <button key={c.key} type="button" onClick={() => removeChip(c.key)} className="press flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white">
              {c.label}
              <X size={14} />
            </button>
          ))}
        </div>
      </div>

      {list.error && <ErrorBox error={list.error} />}
      {list.isLoading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <Empty>{tr("Aucune opération.")}</Empty>
      ) : (
        <div className={clsx("space-y-4 transition-opacity duration-200", list.isPlaceholderData && "opacity-50")}>
          {byDay.map((g) => (
            <section key={g.day}>
              <h2 className="mb-1.5 px-1 text-sm font-semibold first-letter:uppercase text-muted">{dayLabel(g.day)}</h2>
              <Card className="divide-y divide-line overflow-hidden">
                {g.items.map((t) => (
                  <div key={t.id} data-tx={t.id}>
                    <SwipeTxRow t={t} onOpen={() => setSelected(t)} onSearch={setSearch}>
                      <TxRow t={t} onClick={() => setSelected(t)} />
                    </SwipeTxRow>
                  </div>
                ))}
              </Card>
            </section>
          ))}
          {list.hasNextPage && (
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="press card w-full py-3 font-medium text-accent">
              {list.isFetchingNextPage ? tr("Chargement…") : tr("Afficher plus")}
            </button>
          )}
        </div>
      )}

      <TransactionSheet t={selected} categories={categories.data?.categories ?? []} onClose={() => setSelected(null)} />
    </>
  );
}

function TxRow({ t, onClick }: { t: Transaction; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
      <TxLogo t={t} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{txTitle(t)}</div>
        {txSubline(t) && <div className="truncate text-xs text-muted">{txSubline(t)}</div>}
        <div className="flex items-center gap-1 truncate text-xs text-muted">
          {t.split_count ? (
            <span>{tr("Ventilée · {n} catégories", { n: t.split_count })}</span>
          ) : t.category_name ? (
            <span className={clsx(t.category_source === "auto" && "italic")}>{td(t.category_name)}</span>
          ) : (
            <span className="font-medium text-warn">{tr("À classer")}</span>
          )}
          <span>·</span>
          <span className="truncate">{t.account_name}</span>
          {t.status === "pending" && <span>· {tr("en attente")}</span>}
          {!!t.invoice_count && <Paperclip size={12} className="shrink-0 text-accent" aria-label={tr("Facture jointe")} />}
        </div>
      </div>
      <TxAmount tx={t} className="text-[15px] font-semibold" />
    </button>
  );
}

/** Fiche d'une opération ouverte hors de l'écran Opérations (tiroir de forage) : on la lit et on la classe sans changer d'écran. */
export function OperationSheet({ t, onClose }: { t: Transaction; onClose: () => void }) {
  const categories = useCategories();
  return <TransactionSheet t={t} categories={categories.data?.categories ?? []} onClose={onClose} />;
}

function TransactionSheet({ t, categories, onClose, panel = false }: { t: Transaction | null; categories: Category[]; onClose: () => void; panel?: boolean }) {
  const update = useUpdateTransaction();
  // Une règle ne se crée que sur demande explicite : la case reste décochée à chaque ouverture.
  const [remember, setRemember] = useState(false);
  const [note, setNote] = useState("");
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const suggestions = useSuggestions(t?.id);
  useAssistantEntity(t ? { type: "operation", id: t.id, label: tr("Opération du {date} · {titre} · {montant}", { date: dateFr(t.date), titre: txTitle(t), montant: money(t.amount) }) } : null);
  useEffect(() => {
    setNote(t?.note ?? "");
    setRemember(false);
    setFilter("");
    setShowAll(false);
  }, [t]);

  const groups = useMemo(() => {
    const norm = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const f = norm(filter.trim());
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      // La recherche lit le nom d'origine et le nom affiché (traduit).
      if (f && !norm(`${c.name} ${td(c.name)} ${c.poste ?? ""} ${td(c.poste) ?? ""} ${c.group_name ?? ""} ${td(c.group_name) ?? ""} ${c.id}`).includes(f)) continue;
      const key = c.poste ?? c.group_name ?? tk("Autres");
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [categories, filter]);

  if (!t) return null;

  async function choose(categoryId: string) {
    if (!t) return;
    try {
      const r = await update.mutateAsync({ id: t.id, categoryId, remember, note: note !== (t.note ?? "") ? note : undefined });
      const nom = td(categories.find((c) => c.id === categoryId)?.name) ?? categoryId;
      undoToast(remember ? tr("Classée dans « {nom} » · règle créée", { nom }) : tr("Classée dans « {nom} »", { nom }), r.undoId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("Enregistrement impossible"));
    }
  }

  const content = (
    <>
      <Card className="mb-3 p-4">
        <div className="text-[15px] font-semibold">{txTitle(t)}</div>
        {/* Libellé de la banque, ligne par ligne : son intitulé, puis ce que le créancier a écrit et ses références. */}
        {t.bank_label && t.bank_label.toLowerCase() !== t.label.toLowerCase() && (
          <div className="mt-0.5 whitespace-pre-line break-words text-xs text-muted" title={tr("Libellé de la banque")}>
            {t.bank_label}
          </div>
        )}
        <div className="mt-0.5 text-xs text-muted">{t.label}</div>
        <div className="mt-3 flex items-end justify-between">
          <div className="text-sm text-muted">
            {dateFr(t.date)} · {t.account_name}
            {txDateHint(t) && <div className="text-xs">{txDateHint(t)}</div>}
          </div>
          <TxAmount tx={t} className="text-xl font-bold" />
        </div>
        {Number(t.amount) < 0 && t.category_kind !== "interne" && <Equivalence amount={Number(t.amount)} className="mt-1 text-right" />}
        <div className="mt-3 flex items-center gap-2 text-sm">
          <span className="text-muted">{tr("Catégorie :")}</span>
          {t.split_count ? (
            <span className="font-medium">{tr("Ventilée · {n} catégories", { n: t.split_count })}</span>
          ) : t.category_name ? (
            <span className={clsx("rounded-full bg-accent-soft px-2.5 py-0.5 font-medium text-accent", t.category_source === "auto" && "italic")}>{td(t.category_name)}</span>
          ) : (
            <span className="font-medium text-warn">{tr("À classer")}</span>
          )}
        </div>
        {t.category_source === "auto" && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted">
            <Sparkles size={13} /> {tr("Catégorie devinée d'après une opération semblable")}
          </div>
        )}
      </Card>

      {/* Suggestions : la façon la plus rapide de classer (règle, facture, même libellé, même marchand). */}
      {(suggestions.data?.suggestions.length ?? 0) > 0 && (
        <div className="mb-3">
          <div className="mb-1.5 px-1 text-[12.5px] font-medium text-muted">{tr("Suggestions")}</div>
          {/* grid-cols-1 : sans lui la colonne prend la largeur du texte le plus long et déborde de la feuille sur iPhone. */}
          <div className="grid grid-cols-1 gap-2">
            {suggestions.data!.suggestions.map((sg, i) => (
              <button
                key={sg.categoryId}
                type="button"
                disabled={update.isPending}
                onClick={() => choose(sg.categoryId)}
                className={clsx("press card flex w-full items-center justify-between gap-3 px-4 py-3 text-left", i === 0 && "ring-2 ring-accent/40")}
              >
                <span className="min-w-0 flex-1 overflow-hidden">
                  <span className="block truncate text-[15px] font-semibold">{td(sg.name)}</span>
                  <span className="block truncate text-xs text-muted">
                    {sg.poste ? `${td(sg.poste)} · ` : ""}
                    {sg.reason}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-semibold text-accent">{tr("Classer")}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="card mb-3 flex items-center gap-2 px-4 py-2.5">
        <Search size={16} className="text-muted" />
        <input
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            if (e.target.value) setShowAll(true);
          }}
          placeholder={tr("Chercher une catégorie…")}
          className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted md:text-[14px]"
        />
      </label>

      <label className="mb-3 flex items-center gap-2 px-1 text-sm">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        {tr("Créer une règle : toujours classer ce libellé ainsi")}
      </label>

      {!showAll && !filter && (
        <button type="button" onClick={() => setShowAll(true)} className="press card mb-3 flex w-full items-center justify-between px-4 py-3 text-[15px]">
          {tr("Toutes les catégories")}
          <ChevronDown size={18} className="text-muted" />
        </button>
      )}

      <div className={clsx("space-y-3", !showAll && !filter && "hidden")}>
        {groups.map(([poste, list]) => (
          <div key={poste}>
            <div className="mb-1.5 px-1 text-[12.5px] font-medium text-muted">{td(poste)}</div>
            <div className="flex flex-wrap gap-2">
              {list.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={update.isPending}
                  onClick={() => choose(c.id)}
                  className={clsx(
                    "press rounded-full px-3 py-2 text-sm font-medium",
                    t.category_id === c.id ? "bg-accent text-white" : "bg-card ring-1 ring-line",
                  )}
                >
                  {td(c.name)}
                </button>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <div className="px-1 text-sm text-muted">{tr("Aucune catégorie ne correspond.")}</div>}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (t.note ?? "") && update.mutate({ id: t.id, note })}
        placeholder={tr("Ajouter une note…")}
        rows={2}
        className="card mb-3 mt-3 w-full resize-none px-4 py-3 text-[15px] outline-none placeholder:text-muted"
      />

      <NameDebit t={t} />

      <TxInvoices t={t} />

      {t.category_id && (
        <button type="button" onClick={() => update.mutate({ id: t.id, categoryId: null }, { onSuccess: onClose })} className="mt-4 w-full py-2 text-sm text-muted">
          {tr("Retirer la catégorie ({montant} redeviendra « à classer »)", { montant: money(t.amount) })}
        </button>
      )}
      <DeleteManualOperation tx={t} onDone={onClose} />
    </>
  );
  return panel ? (
    <div className="px-1">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{tr("Opération")}</h2>
        <button type="button" onClick={onClose} aria-label={tr("Fermer")} className="press grid size-8 place-items-center rounded-lg text-muted hover:bg-line/50">
          <X size={18} />
        </button>
      </div>
      {content}
    </div>
  ) : (
    <Sheet open={!!t} onClose={onClose} title={tr("Opération")}>
      {content}
    </Sheet>
  );
}

/** Factures jointes, articles achetés et ventilation d'une opération. */
function TxInvoices({ t }: { t: Transaction }) {
  const details = useTransactionDetails(t.id);
  const d = details.data;
  const today = new Date().toLocaleDateString("sv-SE");
  return (
    <section className="mb-3">
      {d?.splits.length ? (
        <Card className="mb-2 divide-y divide-line">
          <div className="px-4 pt-3 pb-2 text-[12.5px] font-medium text-muted">{tr("Ventilation")}</div>
          {d.splits.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <div className="text-[14px] font-medium">{td(s.category_name ?? tk("Sans catégorie"))}</div>
                {s.label && <div className="line-clamp-2 text-xs text-muted">{s.label}</div>}
              </div>
              <Amount value={s.amount} className="text-sm font-semibold" />
            </div>
          ))}
        </Card>
      ) : null}
      {d?.invoices.map((inv) => (
        <Card key={inv.id} className="mb-2">
          <Link to={`/factures?id=${inv.id}`} className="press flex items-center gap-3 px-4 py-3">
            <FileIcon mime={inv.file_mime} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{inv.title}</div>
              <div className="flex items-center gap-1 truncate text-xs text-muted">
                {inv.merchant}
                {inv.invoice_date && ` · ${dateFr(inv.invoice_date)}`}
                {inv.warranty_until && inv.warranty_until >= today && <ShieldCheck size={12} className="shrink-0 text-pos" />}
              </div>
            </div>
            {inv.total != null && <span className="tnum text-sm font-semibold">{moneyIn(inv.total, inv.currency)}</span>}
          </Link>
          {inv.file_mime && (
            <button type="button" onClick={() => openInvoiceViewer({ invoiceId: inv.id })} className="flex w-full items-center justify-center gap-1.5 border-t border-line py-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
              <Eye size={14} /> {tr("Voir et télécharger la facture")}
            </button>
          )}
          {d.items.filter((i) => i.invoice_id === inv.id).length > 0 && (
            <ul className="space-y-1 border-t border-line px-4 py-2.5 text-xs text-muted">
              {d.items
                .filter((i) => i.invoice_id === inv.id)
                .map((i) => (
                  <li key={i.id} className="flex justify-between gap-3">
                    <span className="line-clamp-1">{i.label}</span>
                    <span className="tnum whitespace-nowrap">{td(i.category_name) ?? ""}</span>
                  </li>
                ))}
            </ul>
          )}
        </Card>
      ))}
      <div className="flex justify-end">
        <AddInvoiceButton transactionId={t.id} label={d?.invoices.length ? tr("Autre facture") : tr("Joindre une facture")} />
      </div>
    </section>
  );
}

/* ---------- Ordinateur : tableau, filtres, fiche à droite, classement en lot ---------- */

type DesktopProps = {
  rows: Transaction[];
  list: { hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown; isLoading: boolean; isPlaceholderData: boolean; error: unknown };
  search: string;
  setSearch: (v: string) => void;
  params: { account?: string; category?: string; month?: string; nature?: string; uncategorized: boolean };
  setParam: (key: string, value: string | null) => void;
  accounts: { id: string; name: string; display_name: string | null; hidden: 0 | 1 }[];
  categories: Category[];
  selected: Transaction | null;
  setSelected: (t: Transaction | null) => void;
};

/**
 * Largeur d'un élément, suivie en direct (le panneau assistant peut s'ouvrir à côté). Mesurée avant la première image
 * (pas de tableau étroit puis large), et sans état pour l'élément lui-même : l'écran masqué puis réaffiché
 * (OpsSection) retrouve sa largeur sans rendre le tableau à nouveau.
 */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth((w) => w || el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

function DesktopOperations({ rows, list, search, setSearch, params, setParam, accounts, categories, selected, setSelected }: DesktopProps) {
  const qc = useQueryClient();
  const [ref, width] = useWidth();
  // Fiche à droite seulement s'il reste au moins ~680 px au tableau ; sinon elle s'ouvre en fenêtre.
  const sidePanel = width >= 1100;
  const wideTable = width - (selected && sidePanel ? 424 : 0) >= 900;
  const cols = wideTable ? "grid-cols-[28px_64px_minmax(0,1fr)_118px_170px_190px_110px_20px]" : "grid-cols-[28px_56px_minmax(0,1fr)_170px_110px_20px]";
  const ctx = useContextMenu();
  const [sort, setSort] = useState<{ key: "date" | "amount"; dir: 1 | -1 }>({ key: "date", dir: -1 });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) =>
        sort.key === "amount" ? (a.amount - b.amount) * sort.dir : (a.date.localeCompare(b.date) || a.id.localeCompare(b.id)) * sort.dir,
      ),
    [rows, sort],
  );

  // Clavier : ↑/↓ pour parcourir, Échap pour fermer la fiche, x pour cocher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // ⌘K (recherche), ⌘J (assistant)… ne sont pas des raccourcis du tableau.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const i = selected ? sorted.findIndex((r) => r.id === selected.id) : -1;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setSelected(sorted[Math.min(i + 1, sorted.length - 1)] ?? null);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setSelected(sorted[Math.max(i - 1, 0)] ?? null);
      } else if (e.key === "Escape") setSelected(null);
      else if (e.key === "x" && selected) toggle(selected.id, false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  function toggle(id: string, shift: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (shift && lastChecked) {
        const a = sorted.findIndex((r) => r.id === lastChecked);
        const b = sorted.findIndex((r) => r.id === id);
        for (const r of sorted.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(r.id);
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setLastChecked(id);
  }

  async function applyBulk() {
    if (!bulkCategory) return;
    try {
      const r = await api<{ updated: number; undoId?: string }>("/transactions/bulk-category", { method: "POST", json: { ids: [...checked], categoryId: bulkCategory } });
      undoToast(tn("{n} opération classée", "{n} opérations classées", r.updated), r.undoId);
      setChecked(new Set());
      setBulkCategory("");
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("Classement impossible"));
    }
  }

  const rowMenu = (t: Transaction) => {
    const n = natureOf(t.label, Number(t.amount));
    const who = merchantName(t.label, t.merchant);
    return [
      { label: tr("Ouvrir la fiche"), icon: <PanelRight size={14} />, hint: tr("Entrée##touche"), onSelect: () => setSelected(t) },
      { label: checked.has(t.id) ? tr("Décocher") : tr("Cocher"), icon: <CheckSquare size={14} />, hint: "x", onSelect: () => toggle(t.id, false) },
      "separator" as const,
      { label: tr("Opérations « {nom} »", { nom: who.length > 28 ? `${who.slice(0, 28)}…` : who }), icon: <Store size={14} />, onSelect: () => setSearch(who) },
      { label: tr("Catégorie : {nom}", { nom: td(t.category_name) ?? "—" }), icon: <Tag size={14} />, disabled: !t.category_id, onSelect: () => t.category_id && setParam("categorie", t.category_id) },
      { label: tr("Nature : {nom}", { nom: NATURE_LABELS[n] }), icon: <Shapes size={14} />, onSelect: () => setParam("nature", n) },
      { label: tr("Mois : {mois}", { mois: monthLabel(t.date.slice(0, 7)) }), icon: <CalendarDays size={14} />, onSelect: () => setParam("mois", t.date.slice(0, 7)) },
      "separator" as const,
      { label: tr("Demander à l'assistant"), icon: <MessageSquare size={14} />, onSelect: () => askAssistant(tr("Que peux-tu me dire sur l'opération « {titre} » du {date} ({montant}) ?", { titre: txTitle(t), date: dateFr(t.date), montant: money(Number(t.amount)) })) },
      { label: tr("Copier le libellé"), icon: <Copy size={14} />, onSelect: () => navigator.clipboard.writeText(t.label).then(() => toast.success(tr("Libellé copié"))) },
    ];
  };

  const head = (key: "date" | "amount", label: string, className = "") => (
    <button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : -1 }))} className={cn("flex items-center gap-1 hover:text-ink", className)}>
      {label}
      {sort.key === key && (sort.dir === -1 ? <ArrowDown size={13} /> : <ArrowUp size={13} />)}
    </button>
  );

  const allChecked = sorted.length > 0 && sorted.every((r) => checked.has(r.id));
  return (
    <div ref={ref} className={cn("grid gap-6", selected && sidePanel ? "grid-cols-[minmax(0,1fr)_400px]" : "grid-cols-1")}>
      <div className="min-w-0">
        <PageHeader title={tr("Opérations")} subtitle={`${tn("{n} opération", "{n} opérations", rows.length, { n: `${rows.length}${list.hasNextPage ? "+" : ""}` })} · ${tr("↑↓ pour parcourir, x pour cocher")}`}
          right={
            <div className="flex items-center gap-2">
              <AddOperationButton />
              <TriageButton />
            </div>
          }
        />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="card flex min-w-64 flex-1 items-center gap-2 px-3 py-1.5">
            <Search size={15} className="text-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tr("Libellé, marchand, note…")} className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted" />
            {search && (
              <button type="button" onClick={() => setSearch("")} aria-label={tr("Effacer")}>
                <X size={16} className="text-muted" />
              </button>
            )}
          </label>
          <select value={params.account ?? ""} onChange={(e) => setParam("compte", e.target.value || null)} aria-label={tr("Compte")} className="card max-w-56 px-2.5 py-1.5 text-[13px]">
            <option value="">{tr("Tous les comptes")}</option>
            {accounts
              .filter((a) => !a.hidden || a.id === params.account)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name ?? a.name}
                </option>
              ))}
          </select>
          <select value={params.category ?? ""} onChange={(e) => setParam("categorie", e.target.value || null)} aria-label={tr("Catégorie")} className="card max-w-56 px-2.5 py-1.5 text-[13px]">
            <option value="">{tr("Toutes les catégories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {td(c.name)}
              </option>
            ))}
          </select>
          <select value={params.nature ?? ""} onChange={(e) => setParam("nature", e.target.value || null)} className="card max-w-48 px-2.5 py-1.5 text-[13px]" aria-label={tr("Nature")}>
            <option value="">{tr("Toutes les natures")}</option>
            {(Object.keys(NATURE_LABELS) as Nature[]).map((n) => (
              <option key={n} value={n}>
                {NATURE_LABELS[n]}
              </option>
            ))}
          </select>
          <input type="month" value={params.month ?? ""} onChange={(e) => setParam("mois", e.target.value || null)} placeholder={tr("Mois (AAAA-MM)")} className="card px-2.5 py-1.5 text-[13px] placeholder:text-muted" aria-label={tr("Mois")} />
          <button
            type="button"
            onClick={() => setParam("a_classer", params.uncategorized ? null : "1")}
            className={cn("rounded-full px-3 py-1.5 text-[13px] leading-normal", params.uncategorized ? "bg-accent-soft font-medium text-accent shadow-[inset_0_0_0_1px_var(--color-accent)]" : "bg-card text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink")}
          >
            {tr("À classer")}
          </button>
        </div>

        {!list.hasNextPage && rows.length > 0 && <Totals rows={rows} />}

        {checked.size > 0 && (
          <div className="card sticky top-[60px] z-20 mb-3 flex items-center gap-3 border border-accent/30 px-4 py-2.5">
            <span className="text-sm font-medium">{tn("{n} sélectionnée", "{n} sélectionnées", checked.size)}</span>
            <select value={bulkCategory} onChange={(e) => setBulkCategory(e.target.value)} aria-label={tr("Classer la sélection dans")} className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm">
              <option value="">{tr("Classer dans…")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.poste ? `${td(c.poste)} › ` : ""}
                  {td(c.name)}
                </option>
              ))}
            </select>
            <button type="button" disabled={!bulkCategory} onClick={applyBulk} className="press rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">
              {tr("Classer")}
            </button>
            <button type="button" onClick={() => setChecked(new Set())} className="ml-auto text-sm text-muted hover:text-ink">
              {tr("Tout désélectionner")}
            </button>
          </div>
        )}

        {list.error ? <ErrorBox error={list.error} /> : null}
        <Card>
          <div className={cn("sticky top-[52px] z-10 grid items-center gap-3 rounded-t-[inherit] border-b border-line bg-card px-4 py-2 text-[12.5px] font-medium text-muted", cols)}>
            <input
              type="checkbox"
              aria-label={tr("Tout sélectionner")}
              checked={allChecked}
              onChange={() => setChecked(allChecked ? new Set() : new Set(sorted.map((r) => r.id)))}
              className="size-4 accent-[var(--color-accent)]"
            />
            {head("date", tr("Date"))}
            <span>{tr("Libellé")}</span>
            {wideTable && <span>{tr("Nature")}</span>}
            {wideTable && <span>{tr("Compte")}</span>}
            <span>{tr("Catégorie")}</span>
            {head("amount", tr("Montant"), "justify-end")}
            <span />
          </div>
          {list.isLoading ? (
            <Spinner />
          ) : sorted.length === 0 ? (
            <Empty>{tr("Aucune opération.")}</Empty>
          ) : (
            <div className={cn("divide-y divide-line transition-opacity duration-200", list.isPlaceholderData && "opacity-50")}>
              {sorted.map((t) => (
                <div
                  key={t.id}
                  data-tx={t.id}
                  onClick={() => setSelected(t)}
                  onContextMenu={(e) => ctx.open(e, rowMenu(t))}
                  className={cn(
                    "grid cursor-pointer items-center gap-3 px-4 py-2 text-[13px] hover:bg-bg",
                    cols,
                    selected?.id === t.id && "bg-accent-soft hover:bg-accent-soft",
                  )}
                >
                  <input
                    type="checkbox"
                    aria-label={tr("Sélectionner")}
                    checked={checked.has(t.id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => toggle(t.id, (e.nativeEvent as MouseEvent).shiftKey)}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  <span className="tnum text-muted">{dateShort(t.date)}</span>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <TxLogo t={t} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{txTitle(t)}</span>
                      {txSubline(t) && <span className="block truncate text-xs text-muted">{txSubline(t)}</span>}
                    </span>
                  </span>
                  {wideTable && <NatureBadge n={natureOf(t.label, Number(t.amount))} />}
                  {wideTable && <span className="truncate text-muted">{t.account_name}</span>}
                  <span className={cn("truncate", !t.category_name && !t.split_count && "font-medium text-warn", t.category_source === "auto" && "italic")}>
                    {t.split_count ? tr("Ventilée · {n}", { n: t.split_count }) : td(t.category_name ?? tk("À classer"))}
                  </span>
                  <TxAmount tx={t} className="text-right font-semibold" />
                  {t.invoice_count ? (
                    <HoverPreview target={{ kind: "operation", t }}>
                      <button
                        type="button"
                        title={tr("Voir la facture")}
                        aria-label={tr("Voir la facture")}
                        onClick={(e) => {
                          e.stopPropagation();
                          openInvoiceViewer({ transactionId: t.id, title: txTitle(t) });
                        }}
                        className="grid size-7 place-items-center rounded-md text-accent hover:bg-accent-soft"
                      >
                        <Paperclip size={14} />
                      </button>
                    </HoverPreview>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
        {list.hasNextPage && (
          <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="press card mt-3 w-full py-3 font-medium text-accent">
            {list.isFetchingNextPage ? tr("Chargement…") : tr("Afficher plus")}
          </button>
        )}
      </div>

      <ContextMenu menu={ctx.menu} onClose={ctx.close} />
      {selected &&
        (sidePanel ? (
          <aside className="sticky top-4 max-h-[calc(100vh-2rem)] self-start overflow-y-auto">
            <TransactionSheet t={selected} categories={categories} onClose={() => setSelected(null)} panel />
          </aside>
        ) : (
          <TransactionSheet t={selected} categories={categories} onClose={() => setSelected(null)} />
        ))}
    </div>
  );
}

const NATURE_SHORT: Record<Nature, string> = {
  carte: tr("Carte"),
  prelevement: tr("Prélèvement"),
  virement: tr("Virement"),
  retrait: tr("Espèces"),
  frais: tr("Frais"),
  interne: tr("Interne"),
  remboursement: tr("Remboursement"),
  entree: tr("Entrée##nature"),
};

function NatureBadge({ n }: { n: Nature }) {
  const spend = n === "carte" || n === "prelevement" || n === "virement" || n === "retrait" || n === "frais";
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted">
      <span className="size-2 shrink-0 rounded-sm" style={{ background: spend ? natureColor(n) : "var(--color-line)" }} />
      <span className="truncate">{NATURE_SHORT[n]}</span>
    </span>
  );
}

/** Totaux des opérations affichées (quand toute la liste est chargée). */
function Totals({ rows }: { rows: Transaction[] }) {
  const counted = rows.filter((t) => t.status !== "duplicate");
  const inflow = counted.filter((t) => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
  const outflow = counted.filter((t) => Number(t.amount) < 0).reduce((s, t) => s + Number(t.amount), 0);
  return (
    <div className="mb-2 flex flex-wrap gap-x-5 px-1 text-[12px] text-muted">
      <span>
        {tr("Entrées")} <span className="tnum font-medium text-pos">{money(inflow, true)}</span>
      </span>
      <span>
        {tr("Sorties")} <span className="tnum font-medium text-ink">{money(outflow, true)}</span>
      </span>
      <span>
        {tr("Solde")} <span className={cn("tnum font-medium", inflow + outflow >= 0 ? "text-pos" : "text-neg")}>{money(inflow + outflow, true)}</span>
      </span>
      <span className="ml-auto">{tr("Clic droit sur une ligne : filtrer, demander à l'assistant…")}</span>
    </div>
  );
}

/** Accès au mode tri (opérations à classer une à une), avec leur nombre. */
function TriageButton() {
  const counts = useQuery({ queryKey: ["nav-counts"], queryFn: () => api<{ uncategorized: number }>("/nav-counts"), staleTime: 60_000 });
  const n = counts.data?.uncategorized ?? 0;
  if (!n) return null;
  return (
    <Link to="/tri" className="press flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[14px] font-semibold text-white md:h-auto md:rounded-md md:py-1.5 md:text-[13px] md:font-medium">
      <Tags size={15} /> {tr("Trier##à classer")} <span className="badge-on-accent rounded bg-white px-1.5 text-[12px] font-semibold tabular-nums">{n}</span>
    </Link>
  );
}
