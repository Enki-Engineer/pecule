import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "../api.ts";
import { blockText, pageBlock, useAccess } from "../access.ts";
import { NewPassword } from "./AccessForms.tsx";
import { t } from "../../lib/i18n.ts";

/*
 * Réglages → Compte et sécurité : le mot de passe du membre connecté (en choisir un, le changer, le retirer), et le
 * réglage de l'administrateur qui exige la clé d'accès de tous. La clé d'accès reste proposée d'abord ; le mot de
 * passe sert là où elle ne peut pas se créer, ou si le membre le préfère.
 */

const refresh = (qc: ReturnType<typeof useQueryClient>) => Promise.all([qc.invalidateQueries({ queryKey: ["access"] }), qc.invalidateQueries({ queryKey: ["users"] })]);
const say = (e: unknown) => toast.error(e instanceof Error ? e.message : t("Action impossible"));

/** Sur la ligne du membre connecté : son mot de passe, et ce qui manque à son accès. */
export function PasswordSettings({ name }: { name: string }) {
  const qc = useQueryClient();
  const access = useAccess().data;
  const [editing, setEditing] = useState(false);
  if (!access) return null;
  const block = pageBlock(access);
  const unprotected = !access.passkeys && !access.hasPassword;

  async function remove() {
    if (!confirm(t("Retirer ton mot de passe ? Tu te connecteras avec ta clé d'accès."))) return;
    try {
      await api("/auth/password", { method: "DELETE" });
      await refresh(qc);
      toast.success(t("Mot de passe retiré"));
    } catch (e) {
      say(e);
    }
  }

  return (
    <div className="mt-2 space-y-2 text-sm">
      {unprotected && (
        <div className="text-warn">
          {access.desktop
            ? t("Ton accès n'est pas protégé : sans mot de passe, Pécule s'ouvre sur cet ordinateur sans rien demander.")
            : access.password
              ? t("Ton accès n'est pas protégé : crée une clé d'accès avec « {bouton} », ou choisis un mot de passe. Sans eux, tu ne reviendras sur un autre appareil que par un lien donné sur le serveur.", { bouton: t("Ajouter cet appareil") })
              : t("Ton accès n'est pas protégé : crée une clé d'accès avec « {bouton} ». Sans elle, tu ne reviendras sur un autre appareil que par un lien donné sur le serveur.", { bouton: t("Ajouter cet appareil") })}
        </div>
      )}
      {/* Pourquoi « Ajouter cet appareil » ne peut rien ici, dit avant qu'on essaie. */}
      {block && block !== "adresse" && <div className="text-muted">{blockText(block, access.address)}</div>}
      {access.password && (
        <div className="flex items-center justify-between gap-3 text-muted">
          <span>{access.hasPassword ? t("Mot de passe choisi") : t("Pas de mot de passe")}</span>
          <span className="flex shrink-0 items-center gap-4">
            {access.hasPassword && !!access.passkeys && !editing && (
              <button type="button" onClick={remove} className="press font-medium text-muted">
                {t("Retirer")}
              </button>
            )}
            <button type="button" onClick={() => setEditing((v) => !v)} className="press font-medium text-accent">
              {editing ? t("Annuler") : access.hasPassword ? t("Changer") : t("Choisir un mot de passe")}
            </button>
          </span>
        </div>
      )}
      {editing && (
        <div className="rounded-xl bg-bg p-3">
          <NewPassword
            name={name}
            current={access.hasPassword === true}
            onDone={async () => {
              setEditing(false);
              await refresh(qc);
              toast.success(t("Mot de passe enregistré"));
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Administrateur : exiger la clé d'accès de tous les membres (plus aucun mot de passe). */
export function AccessPolicy() {
  const qc = useQueryClient();
  const access = useAccess().data;
  const [busy, setBusy] = useState(false);
  // L'appli de bureau n'a que le mot de passe : il n'y a pas de clé d'accès à exiger.
  if (!access || access.desktop) return null;

  async function set(only: boolean) {
    if (only && !confirm(t("Exiger une clé d'accès de tous les membres ? Les mots de passe déjà choisis sont effacés et les autres sessions fermées ; un membre qui n'avait que son mot de passe reviendra par un lien d'inscription."))) return;
    setBusy(true);
    try {
      await api("/auth/policy", { method: "PUT", json: { passkeysOnly: only } });
      await refresh(qc);
    } catch (e) {
      say(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="mt-3 flex items-start gap-3 px-1 text-sm">
      <input type="checkbox" checked={access.passkeysOnly === true} disabled={busy} onChange={(e) => set(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]" />
      <span>
        <span className="font-medium">{t("Exiger une clé d'accès de tous les membres")}</span>
        <span className="mt-0.5 block text-muted">{t("Plus aucun mot de passe n'est accepté. Pour une installation servie en https ; sur le réseau de la maison en http, le mot de passe est le seul moyen d'entrer.")}</span>
      </span>
    </label>
  );
}
