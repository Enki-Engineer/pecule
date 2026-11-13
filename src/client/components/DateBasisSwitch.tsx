import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, useMe } from "../api.ts";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";

/**
 * Jour retenu pour les statistiques : le jour de l'achat ou le jour où la banque écrit l'opération (pour une carte à
 * débit différé, le mois suivant). C'est un réglage du foyer, le même sur tous les écrans : l'administrateur le
 * change ici ou dans Réglages → Foyer ; en démo, chacun peut l'essayer.
 */
export function DateBasisSwitch({ className }: { className?: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const user = me.data?.user;
  const basis = user?.dateBasis ?? "debit";
  const allowed = !!user && (user.admin === true || user.demo === true);
  async function choose(next: "achat" | "debit") {
    if (next === basis || busy) return;
    setBusy(true);
    try {
      await api("/household/date-basis", { method: "PUT", json: { basis: next } });
      // Tous les chiffres datés changent de jour : tout est relu.
      await qc.invalidateQueries();
      toast.success(next === "achat" ? t("Les achats par carte comptent désormais au jour de l'achat") : t("Les achats par carte comptent désormais au jour du débit"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={cn("flex rounded-md bg-bg p-0.5 text-[12px] font-medium shadow-[inset_0_0_0_1px_var(--color-line)]", !allowed && "opacity-60", className)}
      role="group"
      aria-label={t("Jour retenu pour les achats par carte")}
      title={
        allowed
          ? t("Compter les achats par carte le jour de l'achat, ou le jour où la banque les prélève. Réglage du foyer : il vaut pour tous les écrans.")
          : t("Réglage du foyer, que seul l'administrateur change (Réglages → Foyer)")
      }
    >
      {(["achat", "debit"] as const).map((b) => (
        <button key={b} type="button" disabled={!allowed || busy} aria-pressed={basis === b} onClick={() => choose(b)} className={cn("rounded px-2 py-1 disabled:cursor-not-allowed", basis === b ? "bg-card text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted enabled:hover:text-ink")}>
          {b === "achat" ? t("Jour d'achat") : t("Jour du débit")}
        </button>
      ))}
    </div>
  );
}
