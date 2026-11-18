import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, useMe } from "../api.ts";
import type { TaxReturn } from "../api-situation.ts";
import { t } from "../../lib/i18n.ts";

/** Nom du déclarant d'une déclaration : le membre, ou « Commune » pour celle du foyer. */
export const ownerLabel = (r: Pick<TaxReturn, "owner">) => r.owner?.name ?? t("Commune##declaration");

/**
 * Déclarant d'une déclaration d'impôt. Le membre choisit entre « commune » et la sienne pour la déclaration du foyer
 * ou pour la sienne ; celle d'un autre membre se lit seulement.
 */
export function TaxOwner({ r }: { r: TaxReturn }) {
  const me = useMe().data?.user;
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (personal: boolean) => api(`/taxes/returns/${r.income_year}/owner`, { method: "PUT", json: { personal } }),
    onSuccess: () => {
      toast.success(t("Déclaration mise à jour"));
      void qc.invalidateQueries({ queryKey: ["taxes"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("Enregistrement impossible")),
  });
  if (!r.editable || !me) return <>{ownerLabel(r)}</>;
  return (
    <select
      value={r.owner ? "personnelle" : "commune"}
      disabled={save.isPending}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => save.mutate(e.target.value === "personnelle")}
      aria-label={t("Déclaration des revenus {annee}", { annee: r.income_year })}
      title={t("Commune : l'imposition du foyer. Personnelle : la tienne seule (imposition séparée) ; les autres membres ne la voient que si tu partages tes revenus.")}
      className="max-w-full rounded-md border border-line bg-card px-1.5 py-0.5 text-[13px]"
    >
      <option value="commune">{t("Commune##declaration")}</option>
      <option value="personnelle">{t("Personnelle : {nom}", { nom: me.name })}</option>
    </select>
  );
}
