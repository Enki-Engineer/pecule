import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, CheckCheck, ChevronRight, FileDown, RotateCcw, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { useCrumb } from "../shell.ts";
import { Card, Empty, ErrorBox, PageHeader, Sheet, Spinner } from "../components/ui.tsx";
import { cn } from "../cn.ts";
import { money } from "../format.ts";
import type { ImportBatch, ImportDetail, ImportField, ImportItem } from "../importer.ts";
import { isPending, STATUS_LABELS, type ItemStatus } from "../../lib/imports.ts";
import { t, tn } from "../../lib/i18n.ts";

/*
 * Relecture d'un import (un « lot ») : ce qu'on a déposé dans le coffre, une ligne par fichier. Chaque fichier est
 * rangé au coffre ; ceux que Pécule sait lire (bulletins, avis d'impôt, échéanciers, relevés…) donnent une proposition.
 * Rien n'est écrit dans les écrans avant la validation, fichier par fichier ou d'un coup pour ce qui est sûr.
 * Le dépôt lui-même se fait dans le coffre (pages/Documents.tsx), qui ouvre le lot.
 */

const button = "press inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
const ghost = "press card inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium disabled:opacity-50";

const TONES: Record<ItemStatus, string> = {
  envoi: "bg-line/60 text-muted",
  attente: "bg-line/60 text-muted",
  lecture: "bg-accent-soft text-accent",
  a_relire: "bg-warn/15 text-warn",
  valide: "bg-pos/15 text-pos",
  range: "bg-pos/10 text-pos",
  ecarte: "bg-line/60 text-muted",
  doublon: "bg-line/60 text-muted",
  ignore: "bg-line/60 text-muted",
  erreur: "bg-neg/10 text-neg",
};

/** Ancienne adresse « /importer » (liens gardés, ligne de commande) : tout est désormais dans le coffre. */
export function Import() {
  const [params] = useSearchParams();
  const lot = Number(params.get("lot")) || null;
  return <Navigate to={lot ? `/documents?lot=${lot}` : "/documents"} replace />;
}

/* ---------- Un lot : une ligne par fichier ---------- */

export function Batch({ id, onBack }: { id: number; onBack: () => void }) {
  const qc = useQueryClient();
  const batch = useQuery({
    queryKey: ["import", id],
    queryFn: () => api<ImportBatch>(`/imports/${id}`),
    refetchInterval: (q) => (q.state.data && !q.state.data.capped && q.state.data.items.some((i) => isPending(i.status)) ? 2000 : false),
  });
  const [open, setOpen] = useState<number | null>(null);
  const [filter, setFilter] = useState<"tout" | "a_relire" | "autres">("tout");
  const [busy, setBusy] = useState(false);
  const b = batch.data;
  useCrumb(b?.name);

  async function act(run: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await run();
      if (done) toast.success(done);
      // Une validation écrit dans les écrans : tout ce qui est affiché ailleurs se rafraîchit.
      await qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Action impossible"));
    } finally {
      setBusy(false);
    }
  }

  if (batch.error) return <ErrorBox error={batch.error} />;
  if (!b) return <Spinner />;
  const reading = (b.counts.envoi ?? 0) + (b.counts.attente ?? 0) + (b.counts.lecture ?? 0);
  const review = b.counts.a_relire ?? 0;
  const left = (b.counts.ignore ?? 0) + (b.counts.doublon ?? 0) + (b.counts.erreur ?? 0) + (b.counts.ecarte ?? 0);
  const shown = b.items.filter((i) => (filter === "tout" ? true : filter === "a_relire" ? i.status === "a_relire" : i.status !== "a_relire"));

  return (
    <>
      <PageHeader
        title={b.name}
        subtitle={
          <>
            {tn("{n} fichier", "{n} fichiers", b.items.length, { n: b.items.length })}
            {reading > 0 && !b.capped && ` · ${t("{n} en cours de lecture", { n: reading })}`}
            {review > 0 && ` · ${t("{n} à relire", { n: review })}`}
            {b.ai && ` · ${t("coût de l'IA {montant}", { montant: money(b.costEur) })}`}
          </>
        }
        right={
          <button type="button" onClick={onBack} className={ghost}>
            <ArrowLeft size={15} /> {t("Retour au coffre")}
          </button>
        }
      />
      <div className="space-y-4">
        {b.status === "annule" && <Card className="p-4 text-sm text-muted">{t("Cet import a été annulé : ce qu'il avait apporté a été retiré.")}</Card>}
        {!b.ai && b.status !== "annule" && (
          <Card className="p-4 text-sm">
            {t("L'IA n'est pas réglée : les fichiers sont rangés au coffre sans être lus (les exports de la banque, eux, sont lus).")}{" "}
            <Link to="/reglages/connexions?c=ia" className="font-medium text-accent">
              {t("Réglages → Comptes et connexions")}
            </Link>
          </Card>
        )}
        {b.capped && (
          <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <AlertTriangle size={18} className="shrink-0 text-warn" />
            <span className="min-w-0 flex-1">{t("Plafond de dépense atteint ({montant}) : la lecture est en pause.", { montant: money(b.costCapEur) })}</span>
            <button type="button" disabled={busy} className={ghost} onClick={() => act(() => api(`/imports/${id}`, { method: "PATCH", json: { costCapEur: b.costCapEur + 5 } }))}>
              {t("Autoriser 5 € de plus")}
            </button>
          </Card>
        )}
        {b.status !== "annule" && (
          <div className="flex flex-wrap items-center gap-2">
            {b.safe > 0 && (
              <button type="button" disabled={busy} className={button} onClick={() => act(() => api(`/imports/${id}/validate-safe`, { method: "POST" }), t("Fichiers sûrs validés"))}>
                <CheckCheck size={16} /> {tn("Valider le fichier sûr", "Valider les {n} fichiers sûrs", b.safe, { n: b.safe })}
              </button>
            )}
            <div className="flex gap-1 text-sm">
              {(["tout", "a_relire", "autres"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} className={cn("rounded-lg px-3 py-1.5", filter === f ? "bg-accent-soft font-medium text-accent" : "text-muted")}>
                  {f === "tout" ? t("Tout") : f === "a_relire" ? t("À relire") : t("Le reste")}
                </button>
              ))}
            </div>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {left > 0 && (
                <a href={`/api/imports/${id}/report`} className={ghost}>
                  <FileDown size={15} /> {t("Fichiers non importés ({n})", { n: left })}
                </a>
              )}
              <button
                type="button"
                disabled={busy}
                className={cn(ghost, "text-neg")}
                onClick={() => confirm(t("Annuler cet import ? Tout ce qu'il a apporté (documents, factures, données validées) sera retiré.")) && act(() => api(`/imports/${id}`, { method: "DELETE" }), t("Import annulé"))}
              >
                <Trash2 size={15} /> {t("Annuler l'import")}
              </button>
            </span>
          </div>
        )}
        {b.safe > 0 && <p className="px-1 text-xs text-muted">{t("« Sûr » : tous les contrôles passent, la lecture est sans doute, et rien de ce que Pécule contient déjà ne changerait.")}</p>}

        <Card className="divide-y divide-line">
          {shown.length === 0 && <Empty>{t("Aucun fichier dans cette vue.")}</Empty>}
          {shown.map((i) => (
            <Row key={i.id} item={i} onOpen={() => setOpen(i.id)} />
          ))}
        </Card>
      </div>
      {open !== null && <Review id={open} onClose={() => setOpen(null)} onChange={() => qc.invalidateQueries()} />}
    </>
  );
}

function Pill({ status }: { status: ItemStatus }) {
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", TONES[status])}>{t(STATUS_LABELS[status])}</span>;
}

function Row({ item, onOpen }: { item: ImportItem; onOpen: () => void }) {
  const name = item.path.split("/").pop() ?? item.path;
  const dir = item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : null;
  const detail =
    item.status === "a_relire"
      ? [item.type ? t(item.type) : null, t("contrôles {a} sur {b}", { a: item.checksOk, b: item.checksTotal }), item.changes ? tn("{n} écart avec l'existant", "{n} écarts avec l'existant", item.changes, { n: item.changes }) : item.known ? t("déjà enregistré, rien ne change") : null].filter(Boolean).join(" · ")
      : item.status === "ignore" && item.error
        ? t(item.error)
        : (item.summary ?? item.error ?? (item.invoiceId ? t("Rangé dans les factures") : item.status === "range" ? t("Rangé au coffre") : item.status === "doublon" ? t("Déjà dans Pécule") : ""));
  const clickable = !["envoi", "attente", "lecture", "ignore"].includes(item.status);
  return (
    <button type="button" disabled={!clickable} onClick={onOpen} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left", clickable && "press")}>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium">{item.title ?? name}</span>
          {item.safe && <span className="shrink-0 rounded-full bg-pos/15 px-2 py-0.5 text-[11px] font-semibold text-pos">{t("Sûr")}</span>}
        </span>
        {(dir || item.title) && <span className="block truncate text-xs text-muted">{[dir, item.title ? name : null].filter(Boolean).join(" / ")}</span>}
        {detail && <span className={cn("mt-0.5 block text-xs", item.status === "erreur" ? "text-neg" : "text-muted")}>{detail}</span>}
      </span>
      <Pill status={item.status} />
      {clickable && <ChevronRight size={17} className="shrink-0 text-muted" />}
    </button>
  );
}

/* ---------- Relecture d'un fichier ---------- */

function Review({ id, onClose, onChange }: { id: number; onClose: () => void; onChange: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["import-item", id], queryFn: () => api<ImportDetail>(`/imports/items/${id}`) });
  const [busy, setBusy] = useState(false);
  const d = detail.data;

  async function act(action: "validate" | "revert" | "discard" | "retry", done: string, close = true) {
    setBusy(true);
    try {
      await api(`/imports/items/${id}/${action}`, { method: "POST" });
      toast.success(done);
      onChange();
      if (close) onClose();
      else await detail.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Action impossible"));
    } finally {
      setBusy(false);
    }
  }
  async function edit(key: string, value: string | number | null) {
    try {
      qc.setQueryData(["import-item", id], await api<ImportDetail>(`/imports/items/${id}`, { method: "PATCH", json: { edits: { [key]: value } } }));
      onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Correction refusée"));
      void detail.refetch();
    }
  }

  return (
    <Sheet open onClose={onClose} title={d?.title ?? t("Fichier")}>
      {detail.error ? (
        <ErrorBox error={detail.error} />
      ) : !d ? (
        <Spinner />
      ) : (
        <div className="space-y-4 pb-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <Pill status={d.status} />
            {d.type && <span>{t(d.type)}</span>}
            {d.confidence && d.status === "a_relire" && <span>· {d.confidence === "haute" ? t("lecture sans doute") : d.confidence === "moyenne" ? t("lecture à vérifier") : t("lecture incertaine")}</span>}
            <span className="min-w-0 truncate">· {d.path}</span>
          </div>
          {(d.documentId || d.invoiceId) && (
            <a href={d.invoiceId ? `/api/invoices/${d.invoiceId}/file` : `/api/documents/${d.documentId}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent">
              <FileDown size={15} /> {t("Ouvrir le fichier")}
            </a>
          )}
          {d.summary && <p className="rounded-xl bg-pos/10 px-3 py-2 text-sm text-pos">{d.summary}</p>}
          {d.error && d.status !== "ignore" && <p className={cn("rounded-xl px-3 py-2 text-sm", d.status === "erreur" ? "bg-neg/10 text-neg" : "bg-line/40 text-muted")}>{d.error}</p>}

          {d.existing && (
            <div className="rounded-xl border border-line p-3 text-sm">
              <p className="font-medium">{d.existing.summary}</p>
              {d.existing.diffs.length === 0 ? (
                <p className="mt-0.5 text-xs text-muted">{t("Rien de ce qui est déjà enregistré ne changerait.")}</p>
              ) : (
                <div className="mt-2 space-y-1">
                  {d.existing.diffs.map((x) => (
                    <div key={x.label} className="flex items-baseline gap-2 text-xs">
                      <span className="min-w-0 flex-1 text-muted">{t(x.label)}</span>
                      <span className="tnum text-muted line-through">{x.before}</span>
                      <span className="tnum font-semibold">{x.after}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {d.fields.length > 0 && (
            <div className="grid gap-2 md:grid-cols-2">
              {d.fields.map((f) => (
                <FieldInput key={`${f.key}:${String(f.value)}`} field={f} edited={d.edited.includes(f.key)} uncertain={d.confidence !== "haute"} disabled={d.status !== "a_relire" || busy} onSave={(v) => edit(f.key, v)} />
              ))}
            </div>
          )}

          {d.checks.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[12.5px] font-medium text-muted">{t("Contrôles")}</h3>
              {d.checks.map((c) => (
                <div key={c.label} className="flex items-start gap-2 text-sm">
                  {c.ok ? <Check size={16} className="mt-0.5 shrink-0 text-pos" /> : <X size={16} className="mt-0.5 shrink-0 text-neg" />}
                  <span className={c.ok ? "" : "text-neg"}>{c.label}</span>
                </div>
              ))}
            </div>
          )}
          {d.doubts.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[12.5px] font-medium text-muted">{t("Points à vérifier")}</h3>
              {d.doubts.map((x) => (
                <p key={x} className="flex items-start gap-2 text-sm text-muted">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" /> {x}
                </p>
              ))}
            </div>
          )}
          {d.table && (
            <div>
              <h3 className="mb-1 text-[12.5px] font-medium text-muted">
                {d.table.title} · {tn("{n} ligne##tableau", "{n} lignes##tableau", d.table.total, { n: d.table.total })}
              </h3>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted">
                      {d.table.columns.map((c) => (
                        <th key={c} className="px-2 py-1.5 font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.table.lines.map((line, i) => (
                      <tr key={i} className="border-t border-line">
                        {line.map((v, j) => (
                          <td key={j} className={cn("px-2 py-1", typeof v === "number" && "tnum text-right")}>
                            {v == null ? "—" : typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.table.total > d.table.lines.length && <p className="mt-1 text-xs text-muted">{t("Début et fin du tableau : toutes les lignes seront enregistrées.")}</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {d.status === "a_relire" && (
              <button type="button" disabled={busy} className={button} onClick={() => act("validate", t("Fichier validé"))}>
                <Check size={16} /> {t("Valider")}
              </button>
            )}
            {d.status === "valide" && (
              <button type="button" disabled={busy} className={ghost} onClick={() => act("revert", t("Validation annulée"), false)}>
                <Undo2 size={15} /> {t("Annuler la validation")}
              </button>
            )}
            {["a_relire", "erreur", "range", "ecarte"].includes(d.status) && d.documentId && (
              <button type="button" disabled={busy} className={ghost} onClick={() => act("retry", t("Lecture relancée"))}>
                <RotateCcw size={15} /> {t("Relire le fichier")}
              </button>
            )}
            {["a_relire", "erreur"].includes(d.status) && (
              <button type="button" disabled={busy} className={cn(ghost, "text-muted")} onClick={() => act("discard", t("Fichier écarté"))}>
                {t("Écarter")}
              </button>
            )}
          </div>
          {d.status === "a_relire" && <p className="text-xs text-muted">{t("Écarter laisse le document au coffre, sans rien écrire dans les écrans.")}</p>}
        </div>
      )}
    </Sheet>
  );
}

/** Champ proposé : surligné quand la lecture n'est pas sûre, marqué quand tu l'as corrigé. Enregistré en quittant le champ. */
function FieldInput({ field, edited, uncertain, disabled, onSave }: { field: ImportField; edited: boolean; uncertain: boolean; disabled: boolean; onSave: (v: string | number | null) => void }) {
  const shown = field.value == null ? "" : typeof field.value === "number" && field.type !== "annee" ? String(field.value).replace(".", ",") : String(field.value);
  const [text, setText] = useState(shown);
  const missing = field.required && field.value == null;
  const frame = cn("card block px-3 py-2", missing ? "ring-1 ring-neg/50" : edited ? "ring-1 ring-accent/50" : uncertain && field.value != null && "bg-warn/5");
  const label = (
    <span className="flex items-center justify-between gap-2 text-xs text-muted">
      <span>{t(field.label)}</span>
      {edited && <span className="text-accent">{t("corrigé")}</span>}
      {missing && <span className="text-neg">{t("à renseigner")}</span>}
    </span>
  );
  if (field.type === "choix")
    return (
      <label className={frame}>
        {label}
        <select value={shown} disabled={disabled} onChange={(e) => onSave(e.target.value || null)} className="w-full bg-transparent text-[15px] font-medium outline-none">
          {!field.options?.some((o) => o.value === shown) && <option value="">{t("Choisir…")}</option>}
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label className={frame}>
      {label}
      <input
        type={field.type === "date" ? "date" : field.type === "mois" ? "month" : "text"}
        inputMode={field.type === "montant" || field.type === "nombre" || field.type === "pourcent" || field.type === "annee" ? "decimal" : undefined}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text.trim() !== shown && onSave(text.trim() === "" ? null : text.trim())}
        className="tnum w-full bg-transparent text-[15px] font-medium outline-none"
      />
    </label>
  );
}
