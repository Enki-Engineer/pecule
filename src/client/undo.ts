import { toast } from "sonner";
import { api, queryClient } from "./api.ts";
import { t } from "../lib/i18n.ts";

/**
 * Bandeau de confirmation avec « Annuler » (6 s) : rejoue l'état d'avant côté serveur (catégorie,
 * note, ventilation, règle et opérations semblables), puis rafraîchit les écrans.
 */
export function undoToast(message: string, undoId: string | undefined) {
  if (!undoId) return void toast.success(message);
  toast.success(message, {
    duration: 6000,
    action: {
      label: t("Annuler##retour en arrière"),
      onClick: () => {
        api<{ ok: boolean }>(`/undo/${encodeURIComponent(undoId)}`, { method: "POST" })
          .then(() => queryClient.invalidateQueries())
          .then(() => toast(t("Annulé##retour en arrière")))
          .catch((e) => toast.error(e instanceof Error ? e.message : t("Annulation impossible##retour en arrière")));
      },
    },
  });
}
