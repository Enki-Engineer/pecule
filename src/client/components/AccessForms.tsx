import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { api } from "../api.ts";
import { blockText, type Access } from "../access.ts";
import { linkedSetupCode } from "../setup-code.ts";
import { PASSWORD_MIN, passwordProblem, passwordProblemText } from "../../lib/password-rules.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Les formulaires du mot de passe : en choisir un (inscription, réglages) et se connecter avec. La clé d'accès reste
 * proposée d'abord ; le mot de passe sert là où elle ne peut pas se créer, ou si le membre le préfère.
 */

const field = "card w-full px-4 py-3 text-base";
const errorOf = (e: unknown) => (e instanceof Error ? e.message : t("Erreur inattendue"));

/** La page n'est pas ouverte à l'adresse de l'installation : rien n'y marchera. On dit où aller. */
export function AddressNotice({ access }: { access: Access }) {
  // Le code d'installation reçu avec le lien du premier démarrage suit à la bonne adresse : il n'est gardé que pour celle-ci.
  const code = linkedSetupCode();
  return (
    <div className="card w-full max-w-xs space-y-3 p-4 text-left text-sm">
      <p>{blockText("adresse", access.address)}</p>
      <a href={code ? `${access.address}/#code=${encodeURIComponent(code)}` : access.address} className="press block rounded-xl bg-accent py-3 text-center font-semibold text-white">
        {t("Ouvrir {adresse}", { adresse: access.address.replace(/^https?:\/\//, "") })}
      </a>
    </div>
  );
}

/** Bouton œil : montrer ou masquer ce qu'on tape. */
function Reveal({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-label={shown ? t("Masquer le mot de passe") : t("Afficher le mot de passe")} aria-pressed={shown} className="press absolute inset-y-0 right-0 flex items-center px-3 text-muted">
      {shown ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );
}

/**
 * Choisir un mot de passe (ou le changer). `jeton` : avec un lien d'inscription, sans session ; `current` : le membre
 * en a déjà un, qui lui est redemandé ; `name` : son prénom, pour que le gestionnaire de mots de passe range le tout.
 */
export function NewPassword({ jeton, name, current, onDone, submit }: { jeton?: string; name?: string; current?: boolean; onDone: () => void | Promise<void>; submit?: string }) {
  const [old, setOld] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const problem = passwordProblem(password, name);
    if (problem) return setError(passwordProblemText(problem));
    if (password !== again) return setError(t("Les deux mots de passe ne sont pas les mêmes."));
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password", { method: "POST", json: { password, ...(jeton ? { jeton } : {}), ...(current ? { currentPassword: old } : {}) } });
      await onDone();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="w-full max-w-xs space-y-3 text-left">
      {/* Pour le gestionnaire de mots de passe : il range le mot de passe sous ce prénom. */}
      {name && <input type="text" name="username" autoComplete="username" value={name} readOnly hidden />}
      {current && <input type="password" value={old} onChange={(e) => setOld(e.target.value)} placeholder={t("Mot de passe actuel")} aria-label={t("Mot de passe actuel")} autoComplete="current-password" className={field} />}
      <div className="relative">
        <input type={shown ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Nouveau mot de passe")} aria-label={t("Nouveau mot de passe")} autoComplete="new-password" className={`${field} pr-11`} />
        <Reveal shown={shown} onToggle={() => setShown((v) => !v)} />
      </div>
      <input type={shown ? "text" : "password"} value={again} onChange={(e) => setAgain(e.target.value)} placeholder={t("Encore une fois")} aria-label={t("Le même mot de passe, encore une fois")} autoComplete="new-password" className={field} />
      <p className="text-xs text-muted">{t("{n} caractères au moins. Une phrase convient très bien.", { n: PASSWORD_MIN })}</p>
      {!window.isSecureContext && <p className="text-xs text-warn">{t("Cette adresse est en http : le mot de passe et tes données y circulent en clair sur le réseau de la maison. Pour un usage durable, une adresse en https.")}</p>}
      <button type="submit" disabled={busy || !password || !again || (current && !old)} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 font-semibold text-white shadow-lg disabled:opacity-60">
        <LockKeyhole size={19} /> {busy ? t("Enregistrement…") : (submit ?? t("Enregistrer mon mot de passe"))}
      </button>
      {error && <p role="alert" className="text-sm text-neg">{error}</p>}
    </form>
  );
}

/** Se connecter par son prénom et son mot de passe. */
export function PasswordLogin({ onDone }: { onDone: () => void | Promise<void> }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password/login", { method: "POST", json: { name, password } });
      await onDone();
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={login} className="w-full max-w-xs space-y-3 text-left">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ton prénom")} aria-label={t("Ton prénom")} name="username" autoComplete="username" autoCapitalize="words" className={field} />
      <div className="relative">
        <input type={shown ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Mot de passe")} aria-label={t("Mot de passe")} autoComplete="current-password" className={`${field} pr-11`} />
        <Reveal shown={shown} onToggle={() => setShown((v) => !v)} />
      </div>
      <button type="submit" disabled={busy || !name.trim() || !password} className="press flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 font-semibold text-white shadow-lg disabled:opacity-60">
        <LockKeyhole size={19} /> {busy ? t("Connexion…") : t("Se connecter")}
      </button>
      {error && <p role="alert" className="text-sm text-neg">{error}</p>}
      <p className="text-xs text-muted">{t("Mot de passe oublié ? L'administrateur du foyer te donne un nouveau lien d'inscription.")}</p>
    </form>
  );
}
