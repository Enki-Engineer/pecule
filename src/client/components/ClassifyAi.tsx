import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, useCategories, type Category } from "../api.ts";
import { Sheet, Spinner } from "./ui.tsx";
import { cn } from "../cn.ts";
import { aiCost, money } from "../format.ts";
import { undoToast } from "../undo.ts";
import { groupByPoste } from "../../lib/category-groups.ts";
import { preselected, type ClassConfidence } from "../../lib/classify.ts";
import { t, td, tn } from "../../lib/i18n.ts";

/*
 * Classement en lot proposé par l'IA (écran « À classer ») : une catégorie par libellé encore sans catégorie, les
 * plus fréquents d'abord. On relit, on change une catégorie, on décoche, puis on applique — rien n'est écrit avant,
 * et l'application s'annule. Utile après la reprise d'un historique, quand des centaines d'opérations arrivent d'un coup.
 */

type Proposal = { key: string; credit: boolean; label: string; count: number; total: number; typical: number; last: string; categoryId: string | null; confidence: ClassConfidence };
type Answer = { proposals: Proposal[]; operations: number; labels: number; remaining: number; costEur: number };
type Line = Proposal & { on: boolean };

const idOf = (p: { key: string; credit: boolean }) => `${p.credit ? "+" : "-"}${p.key}`;

export function ClassifyAiButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn("press card inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-accent", className)}>
        <Sparkles size={15} /> {t("Proposer un classement")}
      </button>
      {open && <ClassifyAiSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function ClassifyAiSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const categories = useCategories();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);
  const [spent, setSpent] = useState(0);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const a = await api<Answer>("/transactions/ai-classify", { method: "POST" });
      setAnswer(a);
      setSpent((s) => s + a.costEur);
      setLines(a.proposals.map((p) => ({ ...p, on: preselected(p) })));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Proposition impossible"));
    } finally {
      setBusy(false);
    }
  }
  // La demande part à l'ouverture : c'est pour elle qu'on a touché le bouton. Une seule fois : chaque demande coûte.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void propose();
  }, []);

  const picked = lines.filter((l) => l.on && l.categoryId);
  const operations = picked.reduce((s, l) => s + l.count, 0);
  const groups = useMemo(() => groupByPoste(categories.data?.categories ?? []), [categories.data]);
  const set = (id: string, patch: Partial<Line>) => setLines((list) => list.map((l) => (idOf(l) === id ? { ...l, ...patch } : l)));

  async function apply() {
    setBusy(true);
    try {
      const r = await api<{ updated: number; rules: number; undoId: string }>("/transactions/ai-classify/apply", { method: "POST", json: { picks: picked.map((l) => ({ key: l.key, credit: l.credit, categoryId: l.categoryId })), remember } });
      undoToast(r.rules ? tn("{n} opération classée · {r} règles retenues", "{n} opérations classées · {r} règles retenues", r.updated, { n: r.updated, r: r.rules }) : tn("{n} opération classée", "{n} opérations classées", r.updated, { n: r.updated }), r.undoId);
      await qc.invalidateQueries();
      // S'il reste des libellés, la suite se propose d'elle-même ; sinon l'écran se ferme sur le travail fait.
      if (answer && answer.remaining > 0) await propose();
      else onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Classement impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t("Classement proposé par l'IA")}>
      <div className="space-y-3 pb-2">
        <p className="text-sm text-muted">{t("L'IA propose une catégorie pour chaque libellé encore sans catégorie, les plus fréquents d'abord, d'après tes catégories et ce que tu as déjà classé. Relis, change ou décoche : rien n'est classé avant que tu l'appliques.")}</p>
        {error && <p className="rounded-xl bg-neg/10 px-3 py-2 text-sm text-neg">{error}</p>}
        {busy && !lines.length && (
          <div className="py-6 text-center text-sm text-muted">
            <Spinner />
            <p className="mt-2">{t("L'IA lit tes libellés…")}</p>
          </div>
        )}
        {answer && !busy && !lines.length && !error && <p className="rounded-xl bg-line/40 px-3 py-3 text-sm">{t("Plus aucun libellé à classer.")}</p>}
        {answer && lines.length > 0 && (
          <>
            <p className="text-xs text-muted">
              {tn("{n} opération sans catégorie", "{n} opérations sans catégorie", answer.operations, { n: answer.operations })} · {tn("{n} libellé", "{n} libellés", answer.labels, { n: answer.labels })}
              {answer.remaining > 0 && ` · ${t("les {n} premiers ici", { n: lines.length })}`} · {t("coût de l'IA {montant}", { montant: aiCost(spent) })}
            </p>
            <div className="divide-y divide-line rounded-xl border border-line">
              {lines.map((l) => (
                <ProposalRow key={idOf(l)} line={l} groups={groups} disabled={busy} onChange={(patch) => set(idOf(l), patch)} />
              ))}
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-accent)]" />
              <span>{t("Retenir ces choix : les prochaines opérations de même libellé seront classées de même.")}</span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={busy || !picked.length} onClick={apply} className="press inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {tn("Classer {n} opération", "Classer {n} opérations", operations, { n: operations })}
              </button>
              <button type="button" disabled={busy} onClick={onClose} className="press rounded-xl px-3 py-2.5 text-sm text-muted">
                {t("Fermer")}
              </button>
            </div>
            <p className="text-xs text-muted">{t("Les libellés décochés ou sans catégorie restent à classer.")}</p>
          </>
        )}
      </div>
    </Sheet>
  );
}

const TONE: Record<ClassConfidence, string> = { haute: "text-muted", moyenne: "text-muted", basse: "text-warn" };
const confidenceText = (c: ClassConfidence) => (c === "haute" ? t("sans doute##classement") : c === "moyenne" ? t("probable##classement") : t("supposition##classement"));

function ProposalRow({ line, groups, disabled, onChange }: { line: Line; groups: { poste: string; list: Category[] }[]; disabled: boolean; onChange: (patch: Partial<Line>) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <label className="flex min-w-0 flex-1 basis-56 items-start gap-2">
        <input type="checkbox" checked={line.on && !!line.categoryId} disabled={disabled || !line.categoryId} onChange={(e) => onChange({ on: e.target.checked })} className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]" />
        <span className="min-w-0">
          <span className="block text-sm font-medium [overflow-wrap:anywhere]">{line.label}</span>
          <span className="block text-xs text-muted">
            {tn("{n} opération", "{n} opérations", line.count, { n: line.count })} · <span className={cn("tnum", line.credit && "text-pos")}>{money(line.total)}</span>
            {line.categoryId && (
              <>
                {" "}
                · <span className={TONE[line.confidence]}>{confidenceText(line.confidence)}</span>
              </>
            )}
          </span>
        </span>
      </label>
      <select
        value={line.categoryId ?? ""}
        disabled={disabled}
        // Choisir une catégorie à la main coche la ligne ; la vider la décoche.
        onChange={(e) => onChange({ categoryId: e.target.value || null, on: !!e.target.value })}
        aria-label={t("Catégorie")}
        className="card min-w-0 max-w-full flex-1 basis-44 px-2 py-1.5 text-sm outline-none"
      >
        <option value="">{t("Ne pas classer")}</option>
        {groups.map((g) => (
          <optgroup key={g.poste} label={td(g.poste)}>
            {g.list.map((c) => (
              <option key={c.id} value={c.id}>
                {td(c.name)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
