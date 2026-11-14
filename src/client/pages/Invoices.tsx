import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Image, Link2, Package, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import {
  api,
  invoiceListQuery,
  invalidateInvoices,
  uploadInvoice,
  useCategories,
  useInvoice,
  useMe,
  type Category,
  type InvoiceItem,
  type InvoiceSummary,
  type LinkedTransaction,
} from "../api.ts";
import { Amount, Card, Empty, ErrorBox, Field, PageHeader, Sheet, Spinner } from "../components/ui.tsx";
import { OpsTabs, useListSearch, useTabParams } from "../components/OpsSection.tsx";
import { dateFr, moneyIn, moneySymbol } from "../format.ts";
import { displayLabel } from "../../lib/labels.ts";
import { DataTable, type Column } from "../components/DataTable.tsx";
import { ContextMenu, useContextMenu } from "../components/ContextMenu.tsx";
import { BrandLogo } from "../components/Logo.tsx";
import { FileDown, MessageSquare, PanelRight, Store } from "lucide-react";
import { askAssistant } from "../assistantBus.ts";
import { useMedia } from "../useMedia.ts";
import { FilePreview } from "../components/FilePreview.tsx";
import { useAssistantEntity } from "../assistantContext.ts";
import { t, td, tk, tn } from "../../lib/i18n.ts";

const today = () => new Date().toLocaleDateString("sv-SE");

const FILTERS = [
  { key: "a_rapprocher", label: t("À rapprocher") },
  { key: "garantie", label: t("Sous garantie") },
  { key: "sans_fichier", label: t("Sans fichier") },
] as const;

export const SOURCE_LABELS: Record<string, string> = {
  dossier: t("Dossier Factures"),
  amazon: "Amazon",
  cdiscount: "Cdiscount",
  site: t("Site marchand"),
  mail: t("Reçue par mail"),
  appli: t("Ajoutée dans Pécule"),
};

/** Colonnes du tableau des factures (ordinateur). */
const INVOICE_COLUMNS: Column<InvoiceSummary>[] = [
  { key: "date", header: t("Date"), width: "96px", sort: (i) => i.invoice_date, cell: (i) => <span className="tnum text-muted">{i.invoice_date ? dateFr(i.invoice_date) : "—"}</span> },
  {
    key: "merchant",
    header: t("Marchand"),
    width: "170px",
    sort: (i) => i.merchant,
    cell: (i) => (
      <span className="flex min-w-0 items-center gap-2">
        <BrandLogo texts={[i.merchant]} size="sm" tone="neutral" />
        <span className="truncate font-medium">{i.merchant}</span>
      </span>
    ),
  },
  {
    key: "title",
    header: t("Article"),
    sort: (i) => i.title,
    cell: (i) => (
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate">{i.title}</span>
        {i.item_count > 1 && <span className="shrink-0 rounded bg-bg px-1 text-[11px] text-muted">{tn("{n} article", "{n} articles", i.item_count)}</span>}
      </span>
    ),
    className: "max-w-0 w-full",
  },
  {
    key: "payment",
    header: t("Paiement"),
    width: "150px",
    hideBelow: "xl",
    className: "whitespace-nowrap",
    sort: (i) => (i.tx_count ? 2 : i.no_match ? 1 : 0),
    cell: (i) =>
      i.tx_count ? (
        <span className="inline-flex items-center gap-1 text-pos">
          <Link2 size={12} /> {t("relié")}
        </span>
      ) : i.no_match ? (
        <span className="text-muted">{t("sans opération")}</span>
      ) : (
        <span className="text-warn">{t("à rapprocher")}</span>
      ),
  },
  {
    key: "warranty",
    header: t("Garantie"),
    width: "120px",
    hideBelow: "lg",
    sort: (i) => i.warranty_until,
    cell: (i) =>
      i.warranty_until ? (
        <span className={clsx("inline-flex items-center gap-1", i.warranty_until >= today() ? "text-pos" : "text-muted")}>
          <ShieldCheck size={12} /> {dateFr(i.warranty_until)}
        </span>
      ) : (
        <span className="text-muted">—</span>
      ),
  },
  { key: "total", header: t("Total"), width: "110px", align: "right", sort: (i) => (i.total == null ? null : Number(i.total)), cell: (i) => <span className="font-semibold">{i.total != null ? moneyIn(i.total, i.currency) : "—"}</span> },
];

export function Invoices() {
  const desktop = useMedia("(min-width: 1024px)");
  const [params, setParams] = useTabParams();
  const filtre = params.get("filtre") ?? undefined;
  const openId = params.get("id") ? Number(params.get("id")) : null;
  const [search, setSearch, debounced] = useListSearch(params.get("q") ?? "");
  const ctx = useContextMenu();

  // Filtres, recherche : la liste reste affichée pendant le chargement de la suivante (pas de squelette).
  const list = useInfiniteQuery({ ...invoiceListQuery(filtre, debounced), placeholderData: keepPreviousData });
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.invoices) ?? [], [list.data]);
  const byYear = useMemo(() => {
    const groups: { year: string; items: InvoiceSummary[] }[] = [];
    for (const i of rows) {
      const year = i.invoice_date?.slice(0, 4) ?? t("Sans date");
      const last = groups.at(-1);
      if (last?.year === year) last.items.push(i);
      else groups.push({ year, items: [i] });
    }
    return groups;
  }, [rows]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value == null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title={t("Factures")} right={<AddInvoiceButton onAdded={(id) => setParam("id", String(id))} />} />
      <OpsTabs current="factures" />
      <div className="sticky top-[calc(44px+env(safe-area-inset-top))] z-20 -mx-4 bg-bg/90 px-4 pb-3 pt-1 backdrop-blur-xl md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        <label className="card flex items-center gap-2 px-4 py-3 md:px-3 md:py-1.5">
          <Search size={18} className="text-muted md:size-[15px]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("Marchand, article, n° de commande…")}
            className="w-full bg-transparent text-[16px] outline-none placeholder:text-muted md:text-[13px]"
            enterKeyHint="search"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")} aria-label={t("Effacer")}>
              <X size={18} className="text-muted" />
            </button>
          )}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setParam("filtre", filtre === f.key ? null : f.key)}
              className={clsx("press flex items-center gap-1 rounded-full px-3 py-1.5 text-sm shadow-sm md:rounded-md md:border md:px-2.5 md:py-1 md:text-[12.5px] md:shadow-none", filtre === f.key ? "bg-accent font-medium text-white md:border-accent md:bg-accent-soft md:text-accent" : "bg-card text-muted ring-1 ring-line md:border-line md:ring-0 md:hover:text-ink")}
            >
              {f.label}
              {filtre === f.key && <X size={14} />}
            </button>
          ))}
        </div>
      </div>

      {list.error && <ErrorBox error={list.error} />}
      {list.isLoading ? (
        <Spinner />
      ) : desktop ? (
        <>
          <DataTable
            rows={rows}
            columns={INVOICE_COLUMNS}
            rowKey={(i) => String(i.id)}
            selectedKey={openId != null ? String(openId) : null}
            onRowClick={(i) => setParam("id", String(i.id))}
            onContextMenu={(i, e) =>
              ctx.open(e, [
                { label: t("Ouvrir la fiche"), icon: <PanelRight size={14} />, onSelect: () => setParam("id", String(i.id)) },
                { label: t("Ouvrir le fichier"), icon: <FileDown size={14} />, disabled: !i.file_mime, onSelect: () => window.open(`/api/invoices/${i.id}/file`, "_blank", "noopener") },
                "separator",
                { label: t("Factures {marchand}", { marchand: i.merchant }), icon: <Store size={14} />, onSelect: () => setSearch(i.merchant) },
                { label: t("Demander à l'assistant"), icon: <MessageSquare size={14} />, onSelect: () => askAssistant(i.invoice_date ? t("Que peux-tu me dire sur la facture « {titre} » de {marchand} du {date} ?", { titre: i.title, marchand: i.merchant, date: dateFr(i.invoice_date) }) : t("Que peux-tu me dire sur la facture « {titre} » de {marchand} ?", { titre: i.title, marchand: i.merchant })) },
              ])
            }
            initialSort={{ key: "date", dir: "desc" }}
            empty={t("Aucune facture.")}
          />
          <ContextMenu menu={ctx.menu} onClose={ctx.close} />
          {list.hasNextPage && (
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="mt-3 w-full rounded-md py-2 text-[13px] font-medium text-accent hover:bg-accent-soft">
              {list.isFetchingNextPage ? t("Chargement…") : t("Afficher plus")}
            </button>
          )}
        </>
      ) : rows.length === 0 ? (
        <Empty>{t("Aucune facture.")}</Empty>
      ) : (
        <div className="space-y-4">
          {byYear.map((g) => (
            <section key={g.year}>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">{g.year}</h2>
              <Card className="divide-y divide-line">
                {g.items.map((i) => (
                  <InvoiceRow key={i.id} i={i} onClick={() => setParam("id", String(i.id))} />
                ))}
              </Card>
            </section>
          ))}
          {list.hasNextPage && (
            <button type="button" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage} className="press card w-full py-3 font-medium text-accent">
              {list.isFetchingNextPage ? t("Chargement…") : t("Afficher plus")}
            </button>
          )}
        </div>
      )}

      {openId != null && <InvoiceSheet id={openId} onClose={() => setParam("id", null)} />}
    </>
  );
}

export function FileIcon({ mime, size = 18 }: { mime: string | null; size?: number }) {
  const Icon = !mime ? Package : mime.startsWith("image/") ? Image : FileText;
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
      <Icon size={size} />
    </span>
  );
}

function InvoiceRow({ i, onClick }: { i: InvoiceSummary; onClick: () => void }) {
  const underWarranty = i.warranty_until && i.warranty_until >= today();
  return (
    <button type="button" onClick={onClick} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
      <BrandLogo texts={[i.merchant]} size="lg" tone="neutral" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{i.title}</div>
        <div className="flex items-center gap-1 truncate text-xs text-muted">
          <span>{i.merchant}</span>
          {i.invoice_date && <span>· {dateFr(i.invoice_date)}</span>}
          {i.tx_count > 0 && <Link2 size={12} className="shrink-0 text-accent" aria-label={t("Reliée à une opération")} />}
          {underWarranty && <ShieldCheck size={12} className="shrink-0 text-pos" aria-label={t("Sous garantie")} />}
        </div>
      </div>
      {i.total != null && <span className="tnum whitespace-nowrap text-[15px] font-semibold">{moneyIn(i.total, i.currency)}</span>}
    </button>
  );
}

/** Bouton « Ajouter » : PDF ou photo (appareil photo sur iPhone), lu par Claude puis rapproché. */
export function AddInvoiceButton({ onAdded, transactionId, label = t("Ajouter") }: { onAdded?: (id: number) => void; transactionId?: string; label?: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  async function send(file: File) {
    setBusy(true);
    try {
      const r = await uploadInvoice(file, transactionId);
      await invalidateInvoices(qc);
      toast.success(r.created ? (r.read ? t("Facture ajoutée et lue") : t("Facture ajoutée (à compléter)")) : t("Facture déjà connue"));
      onAdded?.(r.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Envoi impossible"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  return (
    <>
      <input ref={input} type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => e.target.files?.[0] && send(e.target.files[0])} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="press flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-[14px] font-semibold text-white shadow-[0_1px_2px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] md:h-auto md:rounded-md md:py-1.5 md:text-[13px] md:font-medium disabled:opacity-50"
      >
        {busy ? <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Plus size={16} />}
        {busy ? t("Lecture…") : label}
      </button>
    </>
  );
}

function InvoiceSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useInvoice(id);
  const categories = useCategories();
  const me = useMe();
  const [editing, setEditing] = useState(false);
  const d = detail.data;
  const inv = d?.invoice;
  useAssistantEntity(
    inv ? { type: "facture", id: String(inv.id), label: `${t("Facture {marchand} · {titre}", { marchand: inv.merchant, titre: inv.title })}${inv.invoice_date ? ` · ${dateFr(inv.invoice_date)}` : ""}` } : null,
  );

  async function call(path: string, init: Parameters<typeof api>[1], ok?: string) {
    try {
      await api(path, init);
      await invalidateInvoices(qc);
      if (ok) toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
      return false;
    }
  }

  async function setItemCategory(item: InvoiceItem, categoryId: string | null) {
    if (!d) return;
    const items = d.items.map((i) => ({ label: i.label, quantity: i.quantity, amount: i.amount, ref: i.ref, url: i.url, categoryId: i.id === item.id ? categoryId : i.category_id }));
    await call(`/invoices/${id}/items`, { method: "PUT", json: items }, t("Catégorie de l'article enregistrée"));
  }

  async function remove() {
    if (!confirm(t("Supprimer cette facture et son fichier ?"))) return;
    if (await call(`/invoices/${id}`, { method: "DELETE" }, t("Facture supprimée"))) onClose();
  }

  return (
    <Sheet open onClose={onClose} title={t("Facture")}>
      {detail.error && <ErrorBox error={detail.error} />}
      {!d ? (
        <Spinner />
      ) : editing ? (
        <EditInvoice d={d.invoice} isMine={d.invoice.owner_user_id === me.data?.user?.id} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Card className="mb-3 p-4">
            <div className="text-[15px] font-semibold">{d.invoice.title}</div>
            <div className="mt-0.5 text-sm text-muted">
              {d.invoice.merchant}
              {d.invoice.invoice_date && ` · ${dateFr(d.invoice.invoice_date)}`}
            </div>
            <div className="mt-3 flex items-end justify-between gap-3">
              <div className="space-y-0.5 text-xs text-muted">
                {d.invoice.order_ref && <div>{t("Commande {ref}", { ref: d.invoice.order_ref })}</div>}
                {d.invoice.invoice_number && <div>{t("Facture {numero}", { numero: d.invoice.invoice_number })}</div>}
                <div>
                  {SOURCE_LABELS[d.invoice.source] ?? d.invoice.source}
                  {d.invoice.owner_user_id != null && t(" · privée")}
                </div>
              </div>
              {d.invoice.total != null && <span className="tnum text-xl font-bold">{moneyIn(d.invoice.total, d.invoice.currency)}</span>}
            </div>
            {d.invoice.warranty_until && (
              <div className={clsx("mt-3 flex items-center gap-1.5 text-sm", d.invoice.warranty_until >= today() ? "text-pos" : "text-muted")}>
                <ShieldCheck size={15} />
                {d.invoice.warranty_until >= today() ? t("Sous garantie jusqu'au {date}", { date: dateFr(d.invoice.warranty_until) }) : t("Garantie terminée le {date}", { date: dateFr(d.invoice.warranty_until) })}
              </div>
            )}
            {d.invoice.notes && <p className="mt-2 text-xs leading-relaxed text-muted">{d.invoice.notes}</p>}
          </Card>

          <div className="mb-4 flex gap-2">
            {d.invoice.file_mime && (
              <a href={`/api/invoices/${id}/file`} target="_blank" rel="noreferrer" className="press flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent py-3 font-semibold text-white">
                <ExternalLink size={17} /> {t("Ouvrir le fichier")}
              </a>
            )}
            <button type="button" onClick={() => setEditing(true)} className="press flex-1 rounded-xl bg-card py-3 font-semibold ring-1 ring-line">
              {t("Modifier")}
            </button>
          </div>

          {d.invoice.file_mime && <FilePreview url={`/api/invoices/${id}/file`} mime={d.invoice.file_mime} />}

          {d.items.length > 0 && (
            <section className="mb-4">
              <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("Articles")}</h3>
              <Card className="divide-y divide-line">
                {d.items.map((it) => (
                  <ItemRow key={it.id} item={it} currency={d.invoice.currency} categories={categories.data?.categories ?? []} onCategory={(c) => setItemCategory(it, c)} />
                ))}
              </Card>
              <p className="mt-1.5 px-1 text-xs text-muted">{t("La catégorie des articles se reporte sur l'opération reliée (ventilée si les catégories diffèrent).")}</p>
            </section>
          )}

          <LinkedTransactions id={id} noMatch={!!d.invoice.no_match} txs={d.transactions} onUnlink={(txId) => call(`/invoices/${id}/links/${encodeURIComponent(txId)}`, { method: "DELETE" }, t("Lien retiré"))} onLink={(txId) => call(`/invoices/${id}/links`, { method: "POST", json: { transactionId: txId } }, t("Facture reliée"))} />

          <button type="button" onClick={remove} className="mt-6 flex w-full items-center justify-center gap-1.5 py-2 text-sm text-neg">
            <Trash2 size={15} /> {t("Supprimer la facture")}
          </button>
        </>
      )}
    </Sheet>
  );
}

/** Liste de catégories groupées par poste, pour un <select> natif (pratique sur iPhone). */
export function CategorySelect({ value, categories, onChange, className }: { value: string | null; categories: Category[]; onChange: (id: string | null) => void; className?: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories.filter((c) => c.kind === "depense")) {
      const key = c.poste ?? c.group_name ?? tk("Autres");
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [categories]);
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label={t("Catégorie")} className={clsx("max-w-full rounded-lg bg-accent-soft px-2 py-1 text-xs font-medium text-accent outline-none", className)}>
      <option value="">{t("Sans catégorie")}</option>
      {groups.map(([poste, list]) => (
        <optgroup key={poste} label={td(poste)}>
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {td(c.name)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ItemRow({ item, currency, categories, onCategory }: { item: InvoiceItem; currency: string; categories: Category[]; onCategory: (id: string | null) => void }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[14px] leading-snug">
          {item.quantity !== 1 && <span className="tnum text-muted">{Number(item.quantity)} × </span>}
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="underline decoration-line underline-offset-2">
              {item.label}
            </a>
          ) : (
            item.label
          )}
        </div>
        {item.amount != null && <span className="tnum whitespace-nowrap text-sm font-medium">{moneyIn(item.amount, currency)}</span>}
      </div>
      <CategorySelect value={item.category_id} categories={categories} onChange={onCategory} className="mt-1.5" />
    </div>
  );
}

function LinkedTransactions({ id, noMatch, txs, onLink, onUnlink }: { id: number; noMatch: boolean; txs: LinkedTransaction[]; onLink: (txId: string) => void; onUnlink: (txId: string) => void }) {
  const [looking, setLooking] = useState(false);
  const suggestions = useQuery({
    queryKey: ["invoice", id, "suggestions"],
    queryFn: () => api<{ transactions: LinkedTransaction[] }>(`/invoices/${id}/suggestions`),
    enabled: looking || (txs.length === 0 && !noMatch),
  });
  if (noMatch && !txs.length && !looking)
    return (
      <section>
        <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("Opérations reliées")}</h3>
        <p className="px-1 text-sm text-muted">{t("Aucune opération attendue dans Pécule.")}</p>
        <button type="button" onClick={() => setLooking(true)} className="w-full py-2 text-sm text-accent">
          {t("Relier quand même une opération")}
        </button>
      </section>
    );
  return (
    <section>
      <h3 className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("Opérations reliées")}</h3>
      {txs.length > 0 ? (
        <Card className="mb-2 divide-y divide-line">
          {txs.map((tx) => (
            <div key={tx.id} className="flex items-center gap-3 px-4 py-3">
              <Link to={`/operations?q=${encodeURIComponent(displayLabel(tx.label))}`} className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-medium">{tx.merchant || displayLabel(tx.label)}</div>
                <div className="truncate text-xs text-muted">
                  {dateFr(tx.date)} · {tx.account_name}
                </div>
              </Link>
              <Amount value={tx.amount} className="text-sm font-semibold" />
              <button type="button" onClick={() => onUnlink(tx.id)} className="press rounded-full p-1.5 text-muted" aria-label={t("Retirer le lien")}>
                <X size={16} />
              </button>
            </div>
          ))}
        </Card>
      ) : (
        <p className="mb-2 px-1 text-sm text-muted">{t("Aucune opération reliée.")}</p>
      )}
      {(looking || txs.length === 0) &&
        (suggestions.isLoading ? (
          <Spinner label={t("Recherche…")} />
        ) : suggestions.data?.transactions.length ? (
          <>
            <div className="mb-1.5 px-1 text-xs text-muted">{t("Opérations proches (date d'achat, montant, marchand) :")}</div>
            <Card className="divide-y divide-line">
              {suggestions.data.transactions.map((tx) => (
                <button key={tx.id} type="button" onClick={() => onLink(tx.id)} className="press flex w-full items-center gap-3 px-4 py-3 text-left">
                  <Link2 size={16} className="shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{tx.merchant || displayLabel(tx.label)}</div>
                    <div className="truncate text-xs text-muted">
                      {tx.label} · {tx.account_name}
                    </div>
                  </div>
                  <Amount value={tx.amount} className="text-sm font-semibold" />
                </button>
              ))}
            </Card>
          </>
        ) : (
          <p className="px-1 text-xs text-muted">{t("Aucune opération proche (avant janvier 2026, Pécule n'a pas l'historique).")}</p>
        ))}
      {txs.length > 0 && !looking && (
        <button type="button" onClick={() => setLooking(true)} className="w-full py-2 text-sm text-accent">
          {t("Relier une autre opération")}
        </button>
      )}
    </section>
  );
}

function EditInvoice({ d, isMine, onDone }: { d: InvoiceSummary & { order_ref: string | null; notes: string | null }; isMine: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const [merchant, setMerchant] = useState(d.merchant);
  const [title, setTitle] = useState(d.title);
  const [date, setDate] = useState(d.invoice_date ?? "");
  const [total, setTotal] = useState(d.total != null ? String(d.total) : "");
  const [warranty, setWarranty] = useState(d.warranty_until ?? "");
  const [notes, setNotes] = useState(d.notes ?? "");
  const [priv, setPriv] = useState(d.owner_user_id != null);
  const [noMatch, setNoMatch] = useState(!!d.no_match);
  const iso = /^\d{4}-\d{2}-\d{2}$/;

  async function save() {
    const amount = total.trim() ? Number(total.replace(/\s/g, "").replace(",", ".")) : null;
    if (amount != null && Number.isNaN(amount)) return toast.error(t("Montant invalide"));
    if ((date && !iso.test(date)) || (warranty && !iso.test(warranty))) return toast.error(t("Dates au format AAAA-MM-JJ"));
    try {
      await api(`/invoices/${d.id}`, {
        method: "PATCH",
        json: { merchant: merchant.trim(), title: title.trim(), invoiceDate: date || null, total: amount, warrantyUntil: warranty || null, notes: notes.trim() || null, noMatch, ...(d.owner_user_id == null || isMine ? { private: priv } : {}) },
      });
      await invalidateInvoices(qc);
      toast.success(t("Facture enregistrée"));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    }
  }

  return (
    <div className="space-y-3">
      <Field label={t("Ce qui a été acheté")} value={title} onChange={setTitle} text />
      <Field label={t("Marchand")} value={merchant} onChange={setMerchant} text />
      <Field label={t("Date (AAAA-MM-JJ)")} value={date} onChange={setDate} text placeholder="2026-10-20" />
      <Field label={t("Total TTC ({devise})", { devise: moneySymbol(d.currency) })} value={total} onChange={setTotal} />
      <Field label={t("Garantie jusqu'au (AAAA-MM-JJ)")} value={warranty} onChange={setWarranty} text placeholder={t("Vide si sans garantie")} />
      <Field label={t("Note")} value={notes} onChange={setNotes} text />
      <label className="flex items-center gap-2 px-1 text-sm">
        <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        {t("Visible par moi seul")}
      </label>
      <label className="flex items-center gap-2 px-1 text-sm">
        <input type="checkbox" checked={noMatch} onChange={(e) => setNoMatch(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
        {t("Pas d'opération attendue (payée par un tiers, carte absente de Pécule…)")}
      </label>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDone} className="press flex-1 rounded-xl bg-card py-3.5 font-semibold ring-1 ring-line">
          {t("Annuler")}
        </button>
        <button type="button" onClick={save} className="press flex-1 rounded-xl bg-accent py-3.5 font-semibold text-white">
          {t("Enregistrer")}
        </button>
      </div>
    </div>
  );
}
