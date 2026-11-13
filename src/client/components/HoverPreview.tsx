import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileText, Paperclip, ShieldCheck } from "lucide-react";
import { useDocument, useInvoice, useTransactionDetails, type Transaction } from "../api.ts";
import { useMedia } from "../useMedia.ts";
import { dateFr, money, moneyIn } from "../format.ts";
import { txTitle } from "../../lib/labels.ts";
import { TxLogo, BrandLogo } from "./Logo.tsx";
import { t as tr, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Aperçus au survol (ordinateur) : une petite fiche apparaît après un court arrêt de la souris sur
 * une opération, une facture ou un document (catégorie, articles de la facture, résumé du document),
 * sans ouvrir de tiroir. Rien sur l'iPhone (pas de survol) ni au clavier seul.
 */

type Target = { kind: "operation"; t: Transaction } | { kind: "facture"; id: number } | { kind: "document"; id: number };
const DELAY = 380;

export function HoverPreview({ target, children, className }: { target: Target; children: ReactNode; className?: string }) {
  const desktop = useMedia("(hover: hover) and (min-width: 768px)");
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!desktop) return <>{children}</>;
  return (
    <span
      ref={ref}
      className={className ?? "contents"}
      onMouseEnter={() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => ref.current && setRect((ref.current.firstElementChild ?? ref.current).getBoundingClientRect()), DELAY);
      }}
      onMouseLeave={() => {
        clearTimeout(timer.current);
        setRect(null);
      }}
      onMouseDown={() => {
        clearTimeout(timer.current);
        setRect(null);
      }}
    >
      {children}
      {rect && <Card target={target} anchor={rect} />}
    </span>
  );
}

function Card({ target, anchor }: { target: Target; anchor: DOMRect }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - w - 8);
    const below = anchor.bottom + 8 + h < window.innerHeight;
    const top = below ? anchor.bottom + 6 : Math.max(8, anchor.top - h - 6);
    // Ne met à jour que si la position change (sinon chaque rendu en relançait un : boucle infinie).
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  });
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed z-[75] w-80 rounded-lg border border-line bg-card p-3 text-[13px] shadow-xl"
      style={{ left: pos?.left ?? anchor.left, top: pos?.top ?? anchor.bottom + 6, visibility: pos ? "visible" : "hidden" }}
    >
      {target.kind === "operation" ? <TxPreview t={target.t} /> : target.kind === "facture" ? <InvoicePreview id={target.id} /> : <DocPreview id={target.id} />}
    </div>,
    document.body,
  );
}

function TxPreview({ t }: { t: Transaction }) {
  const d = useTransactionDetails(t.invoice_count || t.split_count ? t.id : null);
  return (
    <>
      <div className="flex items-start gap-2.5">
        <TxLogo t={t} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{txTitle(t)}</div>
          <div className="truncate text-[12px] text-muted">{t.label}</div>
        </div>
        <span className="tnum shrink-0 font-semibold">{money(Number(t.amount))}</span>
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
        <span className="text-muted">{tr("Date")}</span>
        <span>{dateFr(t.date)}</span>
        <span className="text-muted">{tr("Compte")}</span>
        <span className="truncate">{t.account_name}</span>
        <span className="text-muted">{tr("Catégorie")}</span>
        <span className={t.category_name ? "" : "font-medium text-warn"}>{td(t.category_name ?? tk("À classer"))}</span>
      </div>
      {t.note && <div className="mt-2 rounded bg-bg px-2 py-1 text-[12px]">{t.note}</div>}
      {d.data && d.data.items.length > 0 && (
        <div className="mt-2 border-t border-line pt-2">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
            <Paperclip size={11} /> {tr("Facture")}
          </div>
          {d.data.items.slice(0, 4).map((i) => (
            <div key={i.id} className="flex justify-between gap-2 text-[12px]">
              <span className="truncate">{i.label}</span>
              {i.amount != null && <span className="tnum shrink-0 text-muted">{money(i.amount)}</span>}
            </div>
          ))}
          {d.data.items.length > 4 && <div className="text-[11px] text-muted">{tn("… et {n} autre article", "… et {n} autres articles", d.data.items.length - 4)}</div>}
        </div>
      )}
    </>
  );
}

function InvoicePreview({ id }: { id: number }) {
  const q = useInvoice(id);
  const d = q.data;
  if (!d) return <div className="skeleton h-16 rounded" />;
  const i = d.invoice;
  return (
    <>
      <div className="flex items-start gap-2.5">
        <BrandLogo texts={[i.merchant]} size="md" tone="neutral" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{i.title}</div>
          <div className="text-[12px] text-muted">
            {i.merchant}
            {i.invoice_date && ` · ${dateFr(i.invoice_date)}`}
          </div>
        </div>
        {i.total != null && <span className="tnum shrink-0 font-semibold">{moneyIn(i.total, i.currency)}</span>}
      </div>
      {d.items.length > 0 && (
        <div className="mt-2 space-y-0.5 border-t border-line pt-2 text-[12px]">
          {d.items.slice(0, 5).map((it) => (
            <div key={it.id} className="flex justify-between gap-2">
              <span className="truncate">{it.label}</span>
              <span className="shrink-0 text-muted">{td(it.category_name) ?? ""}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted">
        <span>{d.transactions.length ? tn("Reliée à {n} opération", "Reliée à {n} opérations", d.transactions.length) : tr("Pas encore reliée à un paiement")}</span>
        {i.warranty_until && (
          <span className="flex items-center gap-1">
            <ShieldCheck size={11} /> {tr("garantie jusqu'au {date}", { date: dateFr(i.warranty_until) })}
          </span>
        )}
      </div>
    </>
  );
}

function DocPreview({ id }: { id: number }) {
  const q = useDocument(id);
  const d = q.data;
  if (!d) return <div className="skeleton h-16 rounded" />;
  return (
    <>
      <div className="flex items-start gap-2">
        <FileText size={16} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <div className="font-semibold leading-snug">{d.title}</div>
          <div className="text-[12px] text-muted">
            {d.kind}
            {d.doc_date && ` · ${dateFr(d.doc_date)}`}
            {d.expires_at && ` · ${tr("expire le {date}", { date: dateFr(d.expires_at) })}`}
          </div>
        </div>
      </div>
      {d.summary && <p className="mt-2 line-clamp-5 text-[12px] leading-relaxed">{d.summary}</p>}
      {d.facts.length > 0 && (
        <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-line pt-2 text-[12px]">
          {d.facts.slice(0, 4).map((f, i) => (
            <span key={i} className="contents">
              <span className="text-muted">{f.label}</span>
              <span className="truncate">{f.value}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
