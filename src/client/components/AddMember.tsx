import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { t } from "../../lib/i18n.ts";

/** Réglages → Compte et sécurité : l'administrateur ajoute un membre au foyer, puis lui envoie son lien d'inscription. */
export function AddMember() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await api("/auth/users", { method: "POST", json: { name } });
      setName("");
      await qc.invalidateQueries({ queryKey: ["users"] });
      toast.success(t("Membre ajouté : envoie-lui son lien d'inscription."));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Action impossible"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2 px-1">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Prénom du nouveau membre")} aria-label={t("Prénom du nouveau membre")} className="card min-w-0 grow px-3 py-2 text-sm" />
      <button type="button" onClick={add} disabled={busy || !name.trim()} className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60">
        <UserPlus size={15} /> {t("Ajouter un membre")}
      </button>
    </div>
  );
}
