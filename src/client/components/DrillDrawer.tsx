import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Paperclip } from "lucide-react";
import { api, type Transaction } from "../api.ts";
import { Amount, Sheet, Spinner } from "./ui.tsx";
import { dateFr, money } from "../format.ts";
import { txTitle } from "../../lib/labels.ts";
import { currentScopeKey } from "../shell.ts";
import { TxLogo } from "./Logo.tsx";
import { HoverPreview } from "./HoverPreview.tsx";
import { openInvoiceViewer } from "./InvoiceViewer.tsx";
import { OperationSheet } from "../screens.tsx";
import { t as tr, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Forage : un clic sur une marque de graphique (barre, segment, flux, case du calendrier) ouvre ce
 * tiroir avec les opérations qui la composent, leur total, et un lien vers l'écran Opérations filtré.
 * Une opération s'ouvre sur sa fiche, par-dessus le tiroir : on la lit, on la classe, on l'annote sans
 * quitter l'écran ; en la fermant on retrouve la liste, à jour. Une opération qui a une facture porte
 * un bouton « Facture » (visionneuse, sans quitter le tiroir).
 */

export type DrillFilters = { month?: string; nature?: string; poste?: string; category?: string; merchant?: string; debits?: boolean; credits?: boolean; day?: string; uncategorized?: boolean };
type Drill = { title: string; subtitle?: string; filters: DrillFilters } | null;

let current: Drill = null;
const listeners = new Set<() => void>();
const set = (d: Drill) => {
  current = d;
  for (const l of listeners) l();
};

/** Ouvre le tiroir des opérations correspondant à une marque de graphique. */
export const openDrill = (title: string, filters: DrillFilters, subtitle?: string) => set({ title, filters, subtitle });

export function DrillDrawer() {
  const drill = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
  return drill ? <DrillContent drill={drill} onClose={() => set(null)} /> : null;
}

function DrillContent({ drill, onClose }: { drill: NonNullable<Drill>; onClose: () => void }) {
  const navigate = useNavigate();
  const [picked, setPicked] = useState<Transaction | null>(null);
  // Un lien suivi depuis la fiche (facture reliée) change d'écran : le tiroir ne reste pas par-dessus.
  const { pathname } = useLocation();
  const openedOn = useRef(pathname);
  useEffect(() => {
    if (pathname !== openedOn.current) onClose();
  }, [pathname, onClose]);
  const f = drill.filters;
  const sp = new URLSearchParams({ limit: "500" });
  if (f.month) sp.set("month", f.month);
  if (f.nature) sp.set("nature", f.nature);
  if (f.poste) sp.set("poste", f.poste);
  if (f.category) sp.set("category", f.category);
  if (f.merchant) sp.set("merchant", f.merchant);
  if (f.debits) sp.set("debits", "1");
  if (f.credits) sp.set("credits", "1");
  if (f.uncategorized) sp.set("uncategorized", "1");
  const list = useQuery({
    queryKey: ["drill", sp.toString(), currentScopeKey()],
    queryFn: () => api<{ transactions: Transaction[] }>(`/transactions?${sp}`),
  });
  const rows = (list.data?.transactions ?? []).filter((t) => !f.day || t.date === f.day);
  const total = rows.reduce((s, t) => s + Number(t.amount), 0);
  // La place du bouton « Facture » n'est réservée que si une opération au moins en a une (montants alignés).
  const anyInvoice = rows.some((t) => t.invoice_count);
  const ops = new URLSearchParams();
  if (f.month) ops.set("mois", f.month);
  if (f.poste) ops.set("poste", f.poste);
  if (f.category) ops.set("categorie", f.category);
  if (f.merchant) ops.set("q", f.merchant);
  if (f.nature) ops.set("nature", f.nature);
  if (f.uncategorized) ops.set("a_classer", "1");
  return (
    <>
    <Sheet open onClose={onClose} title={drill.title}>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="text-[13px] text-muted">
          {drill.subtitle ?? ""}
          {list.data && ` ${tn("{n} opération", "{n} opérations", rows.length)}`}
        </div>
        <Amount value={total} className="text-xl font-semibold" />
      </div>
      {list.isLoading ? (
        <Spinner />
      ) : (
        <div className="card divide-y divide-line">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center hover:bg-bg">
              {/* L'opération : sa fiche s'ouvre par-dessus le tiroir, sans changer d'écran. */}
              <button
                type="button"
                title={tr("Ouvrir l'opération")}
                onClick={() => setPicked(t)}
                className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3.5 pr-2 text-left"
              >
                <TxLogo t={t} size="md" />
                <span className="min-w-0 flex-1">
                  <HoverPreview target={{ kind: "operation", t }}>
                    <span className="block truncate text-[13.5px] font-medium">{txTitle(t)}</span>
                  </HoverPreview>
                  <span className="block truncate text-[12px] text-muted">
                    {dateFr(t.date).slice(0, 5)} · {td(t.category_name ?? tk("À classer"))} · {t.account_name}
                  </span>
                </span>
                <Amount value={Number(t.amount)} className="text-[13.5px] font-semibold" />
              </button>
              {/* Sa facture : visionneuse par-dessus le tiroir (voir, télécharger). */}
              {t.invoice_count ? (
                <button
                  type="button"
                  onClick={() => openInvoiceViewer({ transactionId: t.id, title: txTitle(t) })}
                  title={tr("Voir la facture")}
                  aria-label={tr("Voir la facture de {nom}", { nom: txTitle(t) })}
                  className="mr-2 flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-accent hover:bg-accent-soft"
                >
                  <Paperclip size={14} /> {tr("Facture")}
                </button>
              ) : (
                <span className={anyInvoice ? "mr-2 w-[76px] shrink-0" : "w-1.5 shrink-0"} />
              )}
            </div>
          ))}
          {!rows.length && <div className="px-4 py-6 text-center text-sm text-muted">{tr("Aucune opération.")}</div>}
        </div>
      )}
      <button
        type="button"
        onClick={() => {
          onClose();
          navigate(`/operations?${ops}`, { viewTransition: true });
        }}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-[13px] font-medium text-accent hover:bg-accent-soft"
      >
        <ExternalLink size={14} /> {tr("Ouvrir dans Opérations")} {total ? `(${money(total)})` : ""}
      </button>
    </Sheet>
    {/* À côté du tiroir, pas dedans : les gestes faits sur la fiche ne déplacent pas le tiroir. */}
    {picked && (
      <Suspense fallback={null}>
        <OperationSheet t={picked} onClose={() => setPicked(null)} />
      </Suspense>
    )}
    </>
  );
}
