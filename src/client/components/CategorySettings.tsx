import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, useCategories } from "../api.ts";
import { askAssistant } from "../assistantBus.ts";
import { undoToast } from "../undo.ts";
import { Card, InfoTip } from "./ui.tsx";
import { groupByPoste } from "../../lib/category-groups.ts";
import { t, td, tn } from "../../lib/i18n.ts";

/*
 * Réglages → Classement → « Catégories » : le référentiel du foyer, poste par poste, et les catégories que Pécule
 * propose depuis son installation (src/lib/starter-proposals.ts). Rien ne s'ajoute sans le geste du membre : chaque
 * ligne dit, avant, quel poste elle rejoint et combien d'opérations ses règles lui amènent ; « Annuler » la retire.
 */

type Proposal = { id: string; name: string; poste: string; newPoste: boolean; rules: number; moves: number };

export function CategorySettings() {
  const qc = useQueryClient();
  const categories = useCategories();
  const proposed = useQuery({ queryKey: ["category-proposals"], queryFn: () => api<{ proposals: Proposal[] }>("/categories/proposals") });
  const [busy, setBusy] = useState(false);
  const groups = groupByPoste(categories.data?.categories ?? []);
  const proposals = proposed.data?.proposals ?? [];

  async function add(p: Proposal) {
    setBusy(true);
    try {
      const r = await api<{ moves: number; undoId?: string }>(`/categories/proposals/${encodeURIComponent(p.id)}`, { method: "POST" });
      // Le référentiel, les règles et, s'il y en a, les opérations reclassées : tous les écrans se relisent.
      await qc.invalidateQueries();
      const nom = td(p.name);
      undoToast(r.moves ? tn("« {nom} » ajoutée · {n} opération reclassée", "« {nom} » ajoutée · {n} opérations reclassées", r.moves, { n: r.moves, nom }) : t("« {nom} » ajoutée", { nom }), r.undoId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Ajout impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {proposals.length > 0 && (
        <Card className="p-4">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold">
            <Sparkles size={15} className="text-accent" /> {t("Catégories proposées")}
          </p>
          <p className="mt-1 text-sm text-muted">{t("Des catégories courantes que ton foyer n'a pas encore. Ajoute celles qui te servent : chacune rejoint son poste, avec ses règles de classement.")}</p>
          <ul className="mt-2 divide-y divide-line">
            {proposals.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{td(p.name)}</span>
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{p.newPoste ? t("{poste} (nouveau poste)", { poste: td(p.poste) }) : td(p.poste)}</span>
                    {p.moves > 0 && (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap text-ink">
                        {tn("{n} opération la rejoindra", "{n} opérations la rejoindront", p.moves)}
                        <InfoTip text={t("Les opérations que ses règles reconnaissent : celles qui n'avaient pas de catégorie, et celles qu'une règle de départ avait rangées ailleurs. Un classement fait à la main ne bouge pas.")} />
                      </span>
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => add(p)}
                  aria-label={t("Ajouter la catégorie « {nom} »", { nom: td(p.name) })}
                  className="press inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold ring-1 ring-line hover:bg-bg disabled:opacity-50"
                >
                  <Plus size={15} /> {t("Ajouter")}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="max-h-[24rem] divide-y divide-line overflow-y-auto">
        {groups.map((g) => (
          <div key={g.poste} className="px-4 py-2.5 text-sm">
            <p className="font-medium">{td(g.poste)}</p>
            <p className="text-muted">{g.list.map((c) => td(c.name)).join(" · ")}</p>
          </div>
        ))}
      </Card>
      <p className="px-1 text-xs text-muted">
        {t("Renommer une catégorie, la déplacer vers un autre poste ou en créer une autre se demande à l'assistant.")}{" "}
        <button type="button" onClick={() => askAssistant(t("Crée une catégorie « … » dans le poste « … »"))} className="font-medium text-accent underline-offset-2 hover:underline">
          {t("Demander à l'assistant")}
        </button>
      </p>
    </div>
  );
}
