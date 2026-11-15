import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { Download, ExternalLink, FileText, ShieldCheck, X } from "lucide-react";
import { useInvoice, useTransactionDetails } from "../api.ts";
import { dateFr, moneyIn } from "../format.ts";
import { cn } from "../cn.ts";
import { useMedia } from "../useMedia.ts";
import { Spinner } from "./ui.tsx";
import { t, td } from "../../lib/i18n.ts";

/*
 * Visionneuse de facture : s'ouvre par-dessus l'écran (ou le tiroir) en cours, sans le quitter.
 * Le fichier (PDF ou photo) à gauche, l'essentiel et les articles à droite, avec « Télécharger ».
 * On l'ouvre pour une facture précise ou pour une opération (ses factures en onglets).
 */

type Target = { invoiceId: number } | { transactionId: string; title?: string };

let current: Target | null = null;
const listeners = new Set<() => void>();
const set = (next: Target | null) => {
  current = next;
  for (const l of listeners) l();
};

/** Ouvre la visionneuse sur une facture, ou sur les factures reliées à une opération. */
export const openInvoiceViewer = (target: Target) => set(target);

export function InvoiceViewer() {
  const target = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  if (!target) return null;
  return createPortal(<Viewer target={target} onClose={() => set(null)} />, document.body);
}

function Viewer({ target, onClose }: { target: Target; onClose: () => void }) {
  const txId = "transactionId" in target ? target.transactionId : null;
  const details = useTransactionDetails(txId);
  const ids = "invoiceId" in target ? [target.invoiceId] : (details.data?.invoices.map((i) => i.id) ?? []);
  const [active, setActive] = useState(0);
  const id = ids[Math.min(active, ids.length - 1)] ?? null;
  useEffect(() => {
    // Échap ferme la visionneuse seule (pas le tiroir qui est dessous).
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  return (
    <div className="drawer-overlay fixed inset-0 z-[70] grid place-items-center bg-ink/40 md:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("Facture")}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-bg shadow-2xl md:h-[min(900px,92vh)] md:w-[min(1180px,94vw)] md:rounded-xl md:border md:border-line"
      >
        <div className="flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-card px-4 pt-[env(safe-area-inset-top)] md:px-5 md:pt-0">
          <FileText size={17} className="shrink-0 text-accent" />
          <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{"title" in target && target.title ? `${t("Facture")} · ${target.title}` : t("Facture")}</h2>
          {ids.length > 1 && (
            <div className="flex gap-1">
              {ids.map((x, i) => (
                <button key={x} type="button" onClick={() => setActive(i)} className={cn("rounded-md px-2.5 py-1 text-[13px] font-medium", i === active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          <button type="button" onClick={onClose} aria-label={t("Fermer (Échap)")} title={t("Fermer (Échap)")} className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-bg hover:text-ink">
            <X size={17} />
          </button>
        </div>
        {id != null ? (
          <Pane key={id} id={id} onClose={onClose} />
        ) : (
          <div className="p-6">{details.isLoading ? <Spinner /> : <p className="text-sm text-muted">{t("Aucune facture reliée à cette opération.")}</p>}</div>
        )}
      </div>
    </div>
  );
}

function Pane({ id, onClose }: { id: number; onClose: () => void }) {
  const navigate = useNavigate();
  const desktop = useMedia("(min-width: 768px)");
  const q = useInvoice(id);
  const d = q.data;
  if (!d) return <div className="p-6">{q.error ? <p className="text-sm text-neg">{t("Facture introuvable.")}</p> : <Spinner />}</div>;
  const inv = d.invoice;
  const file = `/api/invoices/${id}/file`;
  const mime = inv.file_mime;
  const today = new Date().toLocaleDateString("sv-SE");
  const btn = "press flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-[14px] font-semibold";
  return (
    <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[minmax(0,1fr)_340px]">
      {/* Le fichier */}
      <div className="min-h-0 bg-line/40 md:order-none md:h-full">
        {!mime ? (
          <div className="grid h-40 place-items-center px-6 text-center text-sm text-muted md:h-full">{t("Cette facture n'a pas de fichier : seuls ses articles ont été enregistrés.")}</div>
        ) : mime.startsWith("image/") ? (
          <div className="h-[46vh] overflow-auto p-3 md:h-full">
            <img src={file} alt={inv.title} className="mx-auto max-w-full rounded-md shadow" />
          </div>
        ) : desktop ? (
          <iframe src={file} title={inv.title} className="h-full w-full bg-white" />
        ) : (
          // L'iPhone n'affiche pas un PDF dans une page : on l'ouvre dans la visionneuse du système.
          <a href={file} target="_blank" rel="noreferrer" className="grid h-36 place-items-center text-center text-sm font-medium text-accent">
            <span className="flex flex-col items-center gap-2">
              <FileText size={34} /> {t("Toucher pour afficher le PDF")}
            </span>
          </a>
        )}
      </div>
      {/* L'essentiel */}
      <aside className="flex min-h-0 flex-col border-line bg-card md:border-l">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="text-[15px] font-semibold leading-snug">{inv.title}</div>
          <div className="mt-0.5 text-[13px] text-muted">
            {inv.merchant}
            {inv.invoice_date && ` · ${dateFr(inv.invoice_date)}`}
          </div>
          {inv.total != null && <div className="tnum mt-2 text-2xl font-bold">{moneyIn(inv.total, inv.currency)}</div>}
          <div className="mt-2 space-y-0.5 text-[12px] text-muted">
            {inv.order_ref && <div>{t("Commande {ref}", { ref: inv.order_ref })}</div>}
            {inv.invoice_number && <div>{t("Facture n° {numero}", { numero: inv.invoice_number })}</div>}
            {inv.file_name && <div className="truncate">{inv.file_name}</div>}
          </div>
          {inv.warranty_until && (
            <div className={cn("mt-2 flex items-center gap-1.5 text-[13px]", inv.warranty_until >= today ? "text-pos" : "text-muted")}>
              <ShieldCheck size={14} /> {inv.warranty_until >= today ? t("Sous garantie jusqu'au {date}", { date: dateFr(inv.warranty_until) }) : t("Garantie terminée le {date}", { date: dateFr(inv.warranty_until) })}
            </div>
          )}
          {d.items.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 text-[12.5px] font-medium text-muted">{t("Articles")}</h3>
              <ul className="divide-y divide-line text-[13px]">
                {d.items.map((it) => (
                  <li key={it.id} className="flex justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="line-clamp-2">{it.label}</span>
                      {it.category_name && <span className="block text-[11px] text-muted">{td(it.category_name)}</span>}
                    </span>
                    {it.amount != null && <span className="tnum shrink-0 font-medium">{moneyIn(it.amount, inv.currency)}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="grid shrink-0 gap-2 border-t border-line p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          {mime && (
            <a href={`${file}?download=1`} download={inv.file_name ?? true} className={cn(btn, "bg-accent text-white")}>
              <Download size={16} /> {t("Télécharger")}
            </a>
          )}
          <div className="grid grid-cols-2 gap-2">
            {mime && (
              <a href={file} target="_blank" rel="noreferrer" className={cn(btn, "bg-card text-[13px] ring-1 ring-line")}>
                <ExternalLink size={14} /> {t("Nouvel onglet")}
              </a>
            )}
            <button
              type="button"
              onClick={() => {
                onClose();
                navigate(`/factures?id=${id}`);
              }}
              className={cn(btn, "bg-card text-[13px] ring-1 ring-line", !mime && "col-span-2")}
            >
              {t("Fiche de la facture")}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
