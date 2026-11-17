import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ScanFace, KeyRound } from "lucide-react";
import { api, useMe } from "../api.ts";
import { ChestLogo, chestOpeningMs } from "../components/ChestLogo.tsx";
import { RestoreSetup } from "../components/RestoreSetup.tsx";
import { appLang, applyLang } from "../i18n.ts";
import { clearOfflineCache } from "../offline.tsx";
import { LANGS, t } from "../../lib/i18n.ts";

/** Le coffre est fermé ; il s'ouvre (`open`) quand la clé d'accès vient d'être reconnue. */
function Shell({ children, open }: { children: React.ReactNode; open: boolean }) {
  return (
    <div className="safe-top flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <ChestLogo open={open} className="mb-5 size-20 rounded-[22px] shadow-lg" />
      <h1 className="mb-10 text-3xl font-bold tracking-tight">Pécule</h1>
      {children}
    </div>
  );
}

/** Laisse le coffre s'ouvrir avant de quitter l'écran. */
const chestOpens = () => new Promise<void>((resolve) => setTimeout(resolve, chestOpeningMs()));

const errorText = (e: unknown) =>
  e instanceof Error && e.name === "NotAllowedError" ? t("Opération annulée.") : e instanceof Error ? e.message : t("Erreur inattendue");

/**
 * Premier démarrage d'une installation neuve : le premier membre du foyer se crée lui-même (il en sera
 * l'administrateur), avec le code d'installation, puis crée sa clé d'accès sur l'écran d'inscription.
 */
function Setup() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reprendre une sauvegarde au lieu de créer un foyer neuf.
  const [restoring, setRestoring] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { link } = await api<{ link: string }>("/auth/setup", { method: "POST", json: { name, code } });
      // Le lien d'inscription est celui de ce serveur : on n'en garde que le chemin.
      const url = new URL(link);
      window.location.assign(url.pathname + url.search);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  const field = "card w-full max-w-xs px-4 py-3 text-center text-base";
  return (
    <Shell open={false}>
      {/* Langue de ce premier écran (gardée sur l'appareil, puis adoptée par le membre à son inscription). */}
      <div className="mb-5 flex flex-wrap justify-center gap-1.5">
        {LANGS.map((l) => (
          <button key={l.id} type="button" lang={l.id} onClick={() => applyLang(l.id)} aria-pressed={appLang() === l.id} className={`press rounded-full px-3 py-1 text-sm ${appLang() === l.id ? "bg-accent text-white" : "card text-muted"}`}>
            {l.label}
          </button>
        ))}
      </div>
      {restoring ? (
        <RestoreSetup onBack={() => setRestoring(false)} />
      ) : (
        <>
          <p className="mb-1 text-lg font-semibold">{t("Bienvenue dans Pécule")}</p>
          <p className="mb-6 max-w-xs text-sm text-muted">{t("Cette installation est neuve. Crée le premier membre du foyer : il en sera l'administrateur.")}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ton prénom")} aria-label={t("Ton prénom")} autoComplete="given-name" className={field} />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("Code d'installation")} aria-label={t("Code d'installation")} autoComplete="off" spellCheck={false} className={`${field} mt-3`} />
          <p className="mt-2 max-w-xs text-xs text-muted">{t("Le code d'installation est écrit dans le fichier de réglages du serveur (SETUP_CODE, à défaut API_TOKEN) ; « setup » l'affiche à l'installation.")}</p>
          <button type="button" onClick={create} disabled={busy || !name.trim() || !code.trim()} className="press mt-6 w-full max-w-xs rounded-xl bg-accent py-4 text-lg font-semibold text-white shadow-lg disabled:opacity-60">
            {t("Créer le foyer")}
          </button>
          {error && <p className="mt-4 text-sm text-neg">{error}</p>}
          <button type="button" onClick={() => setRestoring(true)} className="press mt-5 text-sm text-muted underline">
            {t("J'ai une sauvegarde : la restaurer")}
          </button>
        </>
      )}
    </Shell>
  );
}

export function Login() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  // Écran demandé avant la connexion (ex. le consentement d'une application) : on y retourne, s'il est bien interne.
  const asked = (useLocation().state as { from?: unknown } | null)?.from;
  const next = typeof asked === "string" && asked.startsWith("/") && !asked.startsWith("//") ? asked : "/";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Installation neuve (aucun membre) : l'écran de premier démarrage remplace la connexion.
  // Une fois affiché, cet écran reste : une restauration y donne des membres à l'installation sans qu'il doive disparaître.
  const fresh = useMe().data?.setup === true;
  const [setup, setSetup] = useState(fresh);
  if (fresh && !setup) setSetup(true);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/login/options", { method: "POST" });
      const response = await startAuthentication({ optionsJSON: options });
      await api("/auth/login/verify", { method: "POST", json: { response } });
      setOpen(true);
      await chestOpens();
      // Nouvelle connexion : rien de ce qu'un autre membre a pu laisser sur cet appareil ne doit s'afficher.
      qc.clear();
      clearOfflineCache();
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(next, { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (setup) return <Setup />;
  return (
    <Shell open={open}>
      <button
        type="button"
        onClick={login}
        disabled={busy}
        className="press flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-accent py-4 text-lg font-semibold text-white shadow-lg disabled:opacity-60"
      >
        <ScanFace size={22} />
        {busy ? t("Connexion…") : t("Se connecter")}
      </button>
      <p className="mt-4 max-w-xs text-sm text-muted">{t("Face ID, Touch ID ou le code de l'appareil, avec la clé d'accès créée à l'inscription.")}</p>
      {error && <p className="mt-4 text-sm text-neg">{error}</p>}
    </Shell>
  );
}

export function Enroll() {
  const [params] = useSearchParams();
  const jeton = params.get("jeton") ?? undefined;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"]; userName: string }>(
        "/auth/register/options",
        { method: "POST", json: { jeton } },
      );
      const response = await startRegistration({ optionsJSON: options });
      const deviceName = /iPhone/.test(navigator.userAgent) ? "iPhone" : /iPad/.test(navigator.userAgent) ? "iPad" : /Mac/.test(navigator.userAgent) ? "Mac" : t("Appareil");
      await api("/auth/register/verify", { method: "POST", json: { response, jeton, deviceName } });
      // Langue choisie sur cet appareil avant l'inscription (premier démarrage) : le membre l'adopte, s'il n'en a pas.
      if (appLang() !== "fr") await api("/auth/language", { method: "PUT", json: { language: appLang(), onlyIfUnset: true } }).catch(() => undefined);
      setOpen(true);
      await chestOpens();
      // Nouvelle connexion : rien de ce qu'un autre membre a pu laisser sur cet appareil ne doit s'afficher.
      qc.clear();
      clearOfflineCache();
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/", { replace: true });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell open={open}>
      <p className="mb-6 max-w-xs text-[15px]">{t("Crée ta clé d'accès : elle remplace le mot de passe et se déverrouille avec Face ID ou Touch ID.")}</p>
      <button
        type="button"
        onClick={enroll}
        disabled={busy}
        className="press flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-accent py-4 text-lg font-semibold text-white shadow-lg disabled:opacity-60"
      >
        <KeyRound size={22} />
        {busy ? t("Création…") : t("Créer ma clé d'accès")}
      </button>
      {error && <p className="mt-4 text-sm text-neg">{error}</p>}
    </Shell>
  );
}
