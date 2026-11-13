import { useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye, PencilLine, ShieldCheck, TriangleAlert } from "lucide-react";
import { api, useMe } from "../api.ts";
import { AppLogo } from "../components/AppLogo.tsx";
import { Spinner } from "../components/ui.tsx";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";

type Pending = { client: string; redirectHost: string; loopback: boolean; member: string; actionsRequested: boolean };

const OPTIONS = [
  { actions: false, icon: Eye, title: t("Lecture seule"), text: t("Consulter tes opérations, ton budget, ton patrimoine, tes factures et tes documents.") },
  { actions: true, icon: PencilLine, title: t("Lecture et actions"), text: t("En plus : classer des opérations, relier des factures, modifier un placement… Claude te demande ton accord avant chaque action.") },
];

/**
 * Consentement OAuth : l'appli Claude demande l'accès au serveur MCP de Pécule. Le membre connecté choisit
 * lecture seule ou lecture et actions ; l'accès vaut pour sa vue, et se retire dans Réglages → Compte et sécurité.
 */
export function Authorize() {
  const me = useMe();
  const location = useLocation();
  const [params] = useSearchParams();
  const id = params.get("demande") ?? "";
  const user = me.data?.user;
  const pending = useQuery({ queryKey: ["oauth-request", id], queryFn: () => api<Pending>(`/oauth/requests/${encodeURIComponent(id)}`), enabled: !!user && !user.demo && !!id, retry: false });
  const [actions, setActions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (me.isPending) return <Spinner />;
  // Pas connecté : la clé d'accès d'abord, puis retour ici avec la demande.
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname + location.search }} />;

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirect: string }>(`/oauth/requests/${encodeURIComponent(id)}/decision`, { method: "POST", json: { approve, actions } });
      window.location.assign(r.redirect);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Erreur inattendue"));
      setBusy(false);
    }
  }

  const d = pending.data;
  const problem = user.demo ? t("Quitte le mode démo pour connecter une application.") : !id ? t("Demande incomplète : relance la connexion depuis Claude.") : pending.error ? (pending.error instanceof Error ? pending.error.message : t("Demande introuvable")) : null;
  return (
    <div className="safe-top mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-6 flex flex-col items-center text-center">
        <AppLogo className="mb-4 size-16 rounded-[18px] shadow-lg" />
        <h1 className="text-2xl font-bold tracking-tight">{t("Connecter {client} à Pécule", { client: d?.client ?? "Claude" })}</h1>
      </div>
      {problem ? (
        <p className="card px-4 py-4 text-center text-sm text-neg">{problem}</p>
      ) : !d ? (
        <Spinner />
      ) : (
        <>
          <div className="card divide-y divide-line">
            <p className="flex items-start gap-3 px-4 py-3.5 text-sm">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-accent" />
              <span>
                <strong>{d.client}</strong> {t("pourra interroger Pécule dans")} <strong>{t("ta vue, {membre}", { membre: d.member })}</strong>
                {t(" : tes données privées comprises, pas celles des autres membres.")}
              </span>
            </p>
            <p className="px-4 py-3 text-sm text-muted">
              {t("Après ton accord, tu retournes vers")} <strong className="text-ink">{d.redirectHost}</strong>.
            </p>
            {d.loopback && (
              <p className="flex items-start gap-3 px-4 py-3 text-sm text-warn">
                <TriangleAlert size={18} className="mt-0.5 shrink-0" />
                <span>{t("Le retour se fait vers un programme de cet ordinateur (Claude Code). N'accepte que si tu viens de lancer cette connexion toi-même.")}</span>
              </p>
            )}
          </div>
          <div className="mt-4 space-y-2" role="radiogroup" aria-label={t("Étendue de l'accès")}>
            {OPTIONS.map((o) => (
              <button
                key={o.title}
                type="button"
                role="radio"
                aria-checked={actions === o.actions}
                onClick={() => setActions(o.actions)}
                className={cn("press card flex w-full items-start gap-3 px-4 py-3.5 text-left", actions === o.actions && "outline-2 -outline-offset-2 outline-accent")}
              >
                <o.icon size={18} className={cn("mt-0.5 shrink-0", actions === o.actions ? "text-accent" : "text-muted")} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{o.title}</span>
                  <span className="block text-sm text-muted">{o.text}</span>
                </span>
                {/* Pastille de choix : pleine pour l'option retenue. */}
                <span aria-hidden className={cn("mt-1 grid size-5 shrink-0 place-items-center rounded-full border-2", actions === o.actions ? "border-accent" : "border-line")}>
                  {actions === o.actions && <span className="size-2.5 rounded-full bg-accent" />}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => decide(false)} disabled={busy} className="press card py-3.5 font-medium disabled:opacity-60">
              {t("Refuser")}
            </button>
            <button type="button" onClick={() => decide(true)} disabled={busy} className="press rounded-xl bg-accent py-3.5 font-semibold text-white shadow-lg disabled:opacity-60">
              {busy ? t("Un instant…") : t("Autoriser")}
            </button>
          </div>
          {error && <p className="mt-3 text-center text-sm text-neg">{error}</p>}
          <p className="mt-4 text-center text-xs text-muted">{t("Tu pourras retirer cet accès à tout moment dans Réglages → Compte et sécurité.")}</p>
        </>
      )}
    </div>
  );
}
