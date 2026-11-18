import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "./ui.tsx";
import { Section } from "./SettingsSection.tsx";
import { api } from "../api.ts";
import { useSharing } from "../api-situation.ts";
import { t } from "../../lib/i18n.ts";

/**
 * Partage de ses revenus avec le foyer : l'interrupteur du membre. Chacun règle le sien, et lui seul — l'assistant
 * ne le change pas. Sans objet dans un foyer d'un seul membre.
 */
export function SharingSettings() {
  const sharing = useSharing();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (income: boolean) => api<{ income: boolean }>("/sharing", { method: "PUT", json: { income } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sharing"] });
      void qc.invalidateQueries({ queryKey: ["payslips"] });
      void qc.invalidateQueries({ queryKey: ["taxes"] });
    },
  });
  if (!sharing.data?.several) return null;
  return (
    <Section id="partage" title={t("Partage avec le foyer")}>
      <Card>
        <label className="flex items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block text-[15px] font-medium">{t("Partager mes revenus avec le foyer")}</span>
            <span className="block text-xs text-muted">
              {t(
                "Les autres membres lisent alors, dans la vue « Foyer » des écrans Revenus et Impôts, les montants de tes bulletins de paie et tes déclarations d'impôt personnelles. Tes bulletins et tes avis restent privés au coffre : personne d'autre ne les ouvre. Chaque membre règle son propre partage.",
              )}
            </span>
          </span>
          <input
            type="checkbox"
            checked={sharing.data.income}
            disabled={save.isPending}
            onChange={(e) =>
              save.mutate(e.target.checked, {
                onSuccess: (r) => toast.success(r.income ? t("Revenus partagés avec le foyer") : t("Revenus redevenus privés")),
                onError: (err) => toast.error(err instanceof Error ? err.message : t("Réglage non enregistré")),
              })
            }
            className="size-5 shrink-0 accent-[var(--color-accent)]"
          />
        </label>
      </Card>
    </Section>
  );
}
