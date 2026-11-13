import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Tag } from "lucide-react";
import { toast } from "sonner";
import { api, queryClient, type Transaction } from "../api.ts";
import { useBudget, COMMITMENT_TYPES } from "../api-situation.ts";
import { natureOf } from "../../lib/nature.ts";
import { money } from "../format.ts";
import { cn } from "../cn.ts";
import { t as tr, tn } from "../../lib/i18n.ts";

/*
 * Nommer un prélèvement depuis sa fiche : sa forme de libellé (code du créancier, longueur des
 * numéros) est reliée à un engagement du budget, existant ou créé ; tous les prélèvements de même
 * forme prennent ce nom, et sa catégorie s'ils n'en ont pas.
 */

export function NameDebit({ t }: { t: Transaction }) {
  const [open, setOpen] = useState(false);
  if (Number(t.amount) >= 0 || natureOf(t.label, Number(t.amount)) !== "prelevement") return null;
  return (
    <div className="card mb-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="press flex w-full items-center gap-2 px-4 py-3 text-left text-[15px]">
        <Tag size={16} className="text-accent" />
        <span className="flex-1">{t.merchant ? tr("Renommer ce prélèvement") : tr("Nommer ce prélèvement")}</span>
        <ChevronDown size={17} className={cn("text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <NameDebitForm t={t} />}
    </div>
  );
}

function NameDebitForm({ t }: { t: Transaction }) {
  const shape = useQuery({
    queryKey: ["debit-shape", t.id],
    queryFn: () => api<{ regex: string; count: number; total: number; commitment: { id: number; label: string } | null }>(`/transactions/${encodeURIComponent(t.id)}/debit-shape`),
  });
  const budget = useBudget();
  const [mode, setMode] = useState<"link" | "new">("new");
  const [commitmentId, setCommitmentId] = useState<number | "">("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("abonnement");
  const [busy, setBusy] = useState(false);
  const commitments = (budget.data?.commitments ?? []).filter((c) => c.status !== "resilie");

  async function save() {
    setBusy(true);
    try {
      const body = mode === "link" ? { commitmentId: Number(commitmentId) } : { label: label.trim(), type };
      const r = await api<{ named: number }>(`/transactions/${encodeURIComponent(t.id)}/name-debit`, { method: "POST", json: body });
      toast.success(tn("{n} prélèvement nommé", "{n} prélèvements nommés", r.named));
      await queryClient.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("Enregistrement impossible"));
    } finally {
      setBusy(false);
    }
  }

  const valid = mode === "link" ? commitmentId !== "" : label.trim().length >= 2;
  // Une seule phrase à traduire ; elle est coupée à l'endroit du nom, affiché en gras.
  const linked = tr("déjà relié à « {nom} »", { nom: "\u0000" }).split("\u0000");
  return (
    <div className="space-y-3 border-t border-line px-4 py-3 text-sm">
      {shape.data && (
        <p className="text-muted">
          {tn("{n} prélèvement de même forme ({total} au total)", "{n} prélèvements de même forme ({total} au total)", shape.data.count, { total: money(-shape.data.total) })}
          {shape.data.commitment && (
            <>
              {" "}
              · {linked[0]}
              <b className="text-ink">{shape.data.commitment.label}</b>
              {linked[1]}
            </>
          )}
        </p>
      )}
      <div className="flex rounded-[10px] bg-line/70 p-0.5">
        {(["new", "link"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex-1 rounded-[8px] py-1.5 text-[13px] font-semibold", mode === m ? "bg-card text-ink shadow-sm" : "text-muted")}>
            {m === "new" ? tr("Nouvel engagement") : tr("Engagement existant")}
          </button>
        ))}
      </div>
      {mode === "new" ? (
        <>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tr("Nom (ex. Électricité — EDF)")} className="w-full rounded-lg bg-bg px-3 py-2.5 text-[16px] outline-none ring-1 ring-line md:text-[14px]" />
          <select value={type} onChange={(e) => setType(e.target.value)} aria-label={tr("Type d'engagement")} className="w-full rounded-lg bg-bg px-3 py-2.5 text-[15px] ring-1 ring-line md:text-[14px]">
            {Object.entries(COMMITMENT_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted">{tr("Ajouté au budget pour {montant} par mois, dans la catégorie de cette opération.", { montant: money(Math.abs(Number(t.amount))) })}</p>
        </>
      ) : (
        <select aria-label={tr("Engagement du budget")} value={commitmentId} onChange={(e) => setCommitmentId(e.target.value ? Number(e.target.value) : "")} className="w-full rounded-lg bg-bg px-3 py-2.5 text-[15px] ring-1 ring-line md:text-[14px]">
          <option value="">{tr("Choisir un engagement du budget…")}</option>
          {commitments.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} · {c.monthly != null ? tr("{montant}/mois", { montant: money(c.monthly) }) : c.annual != null ? tr("{montant}/an", { montant: money(c.annual) }) : ""}
            </option>
          ))}
        </select>
      )}
      <button type="button" disabled={!valid || busy} onClick={save} className="press w-full rounded-xl bg-accent py-2.5 font-semibold text-white disabled:opacity-40">
        {busy ? tr("Enregistrement…") : tr("Nommer")}
      </button>
    </div>
  );
}
