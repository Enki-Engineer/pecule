import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams, type NavigateFunction } from "react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ScanFace, KeyRound } from "lucide-react";
import { api, freshMe, useMe } from "../api.ts";
import { blockText, deviceName, pageBlock, useAccess, withPasskey } from "../access.ts";
import { AddressNotice, NewPassword, PasswordLogin } from "../components/AccessForms.tsx";
import { Onboarding } from "../screens.tsx";
import { ChestLogo, chestOpeningMs } from "../components/ChestLogo.tsx";
import { RestoreSetup } from "../components/RestoreSetup.tsx";
import { SetupCodeHelp } from "../components/SetupCodeHelp.tsx";
import { forgetSetupCode, linkedSetupCode } from "../setup-code.ts";
import { appLang, applyLang } from "../i18n.ts";
import { clearOfflineCache } from "../offline.tsx";
import { passage } from "../passage.ts";
import { LANGS, t } from "../../lib/i18n.ts";

/** Le coffre est fermé ; il s'ouvre (`open`) quand la clé d'accès vient d'être reconnue. */
function Shell({ children, open }: { children: React.ReactNode; open: boolean }) {
  return (
    <div className="safe-top flex min-h-screen flex-col items-center justify-center px-6 text-center">
      {/* Même nom de transition que le coffre de la présentation de bienvenue : il y glisse, là où le navigateur sait le faire. */}
      <ChestLogo open={open} className="mb-5 size-20 rounded-[22px] shadow-lg [view-transition-name:pecule-coffre]" />
      <h1 className="mb-10 text-3xl font-bold tracking-tight">Pécule</h1>
      {children}
    </div>
  );
}

/** Laisse le coffre s'ouvrir avant de quitter l'écran. */
const chestOpens = () => new Promise<void>((resolve) => setTimeout(resolve, chestOpeningMs()));

/**
 * La session vient de s'ouvrir : pendant que le coffre s'ouvre, on lit qui est là, puis on entre. Un membre que la
 * présentation de bienvenue attend (première connexion) y va tout droit, le coffre déjà ouvert ; les autres vont à
 * `next` — comme celui qui se connectait pour un écran précis (le consentement d'une application : sa demande
 * expire, elle passe avant la présentation, qui s'ouvrira à sa prochaine visite de l'appli).
 */
async function enter(qc: QueryClient, navigate: NavigateFunction, next: string) {
  // Nouvelle connexion : rien de ce qu'un autre membre a pu laisser sur cet appareil ne doit s'afficher.
  qc.clear();
  clearOfflineCache();
  const [me] = await Promise.all([freshMe(qc), chestOpens()]);
  if (!me?.user?.welcome || next !== "/") return navigate(next, { replace: true });
  await Onboarding.preload().catch(() => undefined);
  passage(() => navigate("/bienvenue", { replace: true, state: { arrivee: true } }));
}

/** Le refus d'une clé d'accès arrive déjà expliqué (`withPasskey`) ; celui du serveur se montre tel quel. */
const errorText = (e: unknown) => (e instanceof Error ? e.message : t("Erreur inattendue"));

const linkButton = "press mt-5 text-sm text-muted underline";
const mainButton = "press flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-accent py-4 text-lg font-semibold text-white shadow-lg disabled:opacity-60";

/**
 * Premier démarrage d'une installation neuve : le premier membre du foyer se crée lui-même (il en sera
 * l'administrateur), avec le code d'installation. Sa session s'ouvre aussitôt ; l'écran d'inscription lui propose
 * ensuite de protéger son accès, sans que ce choix lui barre l'entrée. Ouvert par le lien du premier démarrage,
 * l'écran a déjà le code : il ne reste qu'un prénom à donner.
 */
function Setup({ command }: { command?: string }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState(() => linkedSetupCode() ?? "");
  // Le code est venu avec le lien : son champ n'est montré que si le serveur le refuse.
  const [linked, setLinked] = useState(() => !!linkedSetupCode());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reprendre une sauvegarde au lieu de créer un foyer neuf.
  const [restoring, setRestoring] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api("/auth/setup", { method: "POST", json: { name, code } });
      // Le code a servi : il n'est plus gardé pour cet onglet.
      forgetSetupCode();
      // La session est ouverte : reste à choisir comment protéger son accès (clé d'accès, mot de passe, ou plus tard).
      window.location.assign("/inscription");
    } catch (e) {
      setError(errorText(e));
      // Refusé : le code du lien ne sera pas reproposé, son champ revient.
      forgetSetupCode();
      setLinked(false);
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
        <RestoreSetup onBack={() => setRestoring(false)} linkedCode={linkedSetupCode()} command={command} />
      ) : (
        <>
          <p className="mb-1 text-lg font-semibold">{t("Bienvenue dans Pécule")}</p>
          <p className="mb-6 max-w-xs text-sm text-muted">{t("Cette installation est neuve. Crée le premier membre du foyer : il en sera l'administrateur.")}</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ton prénom")} aria-label={t("Ton prénom")} autoComplete="given-name" className={field} />
          {linked ? (
            <p className="mt-2 max-w-xs text-xs text-muted">{t("Code d'installation reçu avec le lien.")}</p>
          ) : (
            <>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("Code d'installation")} aria-label={t("Code d'installation")} autoComplete="off" spellCheck={false} className={`${field} mt-3`} />
              <SetupCodeHelp command={command} />
            </>
          )}
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
  const me = useMe().data;
  const fresh = me?.setup === true;
  const [setup, setSetup] = useState(fresh);
  if (fresh && !setup) setSetup(true);

  const access = useAccess().data;
  const block = pageBlock(access);
  // Choisi par le membre : le formulaire du mot de passe plutôt que la clé d'accès.
  const [byPassword, setByPassword] = useState(false);

  async function entered() {
    setOpen(true);
    await enter(qc, navigate, next);
  }

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/login/options", { method: "POST" });
      const response = await withPasskey(() => startAuthentication({ optionsJSON: options }), access?.address);
      await api("/auth/login/verify", { method: "POST", json: { response } });
      await entered();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Ouverte ailleurs qu'à l'adresse de l'installation, la page ne peut rien : on dit où aller, avant tout le reste.
  if (access && block === "adresse")
    return (
      <Shell open={false}>
        <AddressNotice access={access} />
      </Shell>
    );
  if (setup) return <Setup command={me?.setupCommand} />;
  // Un membre au moins a un mot de passe : il est proposé, et d'office là où une clé d'accès ne peut pas servir.
  const password = access?.passwordLogin === true;
  const form = password && (block !== null || byPassword);
  return (
    <Shell open={open}>
      {block === null && !form && (
        <>
          <button type="button" onClick={login} disabled={busy} className={mainButton}>
            <ScanFace size={22} />
            {busy ? t("Connexion…") : t("Se connecter")}
          </button>
          <p className="mt-4 max-w-xs text-sm text-muted">{t("Face ID, Touch ID ou le code de l'appareil, avec la clé d'accès créée à l'inscription.")}</p>
        </>
      )}
      {form && <PasswordLogin onDone={entered} />}
      {/* Pourquoi la clé d'accès manque ici : dit seulement quand il n'y a pas de mot de passe à proposer à la place. */}
      {block !== null && access && !password && <p className="max-w-xs text-sm text-muted">{blockText(block, access.address)}</p>}
      {block !== null && access && !password && (
        <p className="mt-3 max-w-xs text-sm">
          {access.desktop
            ? t("Aucun membre n'a encore de mot de passe : pour entrer, ouvre le menu Aide de l'appli, puis « {menu} ».", { menu: t("Mot de passe oublié…") })
            : t("Aucun membre n'a encore de mot de passe : demande un lien d'inscription à l'administrateur du foyer. Si c'est toi, la commande « lien » de l'installation en donne un.")}
        </p>
      )}
      {block === null && password && (
        <button type="button" onClick={() => (setByPassword((v) => !v), setError(null))} className={linkButton}>
          {byPassword ? t("Se connecter avec ma clé d'accès") : t("Se connecter avec un mot de passe")}
        </button>
      )}
      {error && <p role="alert" className="mt-4 max-w-xs text-sm text-neg">{error}</p>}
    </Shell>
  );
}

/**
 * Protéger son accès : créer sa clé d'accès, ou choisir un mot de passe là où elle ne peut pas servir (ou si on le
 * préfère). On y arrive par un lien d'inscription (`jeton` : un nouveau membre, un appareil de plus, un mot de passe
 * oublié), ou déjà connecté — juste après le premier démarrage, où ce choix peut attendre.
 */
export function Enroll() {
  const [params] = useSearchParams();
  const jeton = params.get("jeton") ?? undefined;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useMe().data;
  const access = useAccess().data;
  const block = pageBlock(access);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Choisi par le membre : un mot de passe plutôt qu'une clé d'accès.
  const [byPassword, setByPassword] = useState(false);
  // Un nouveau membre va droit à la présentation de bienvenue : son code est prêt quand son accès est protégé.
  useEffect(() => {
    void Onboarding.preload().catch(() => undefined);
  }, []);

  async function entered() {
    // Langue choisie sur cet appareil avant l'inscription (premier démarrage) : le membre l'adopte, s'il n'en a pas.
    if (appLang() !== "fr") await api("/auth/language", { method: "PUT", json: { language: appLang(), onlyIfUnset: true } }).catch(() => undefined);
    setOpen(true);
    await enter(qc, navigate, "/");
  }

  async function enroll() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api<{ options: Parameters<typeof startRegistration>[0]["optionsJSON"]; userName: string }>(
        "/auth/register/options",
        { method: "POST", json: { jeton } },
      );
      const response = await withPasskey(() => startRegistration({ optionsJSON: options }), access?.address);
      await api("/auth/register/verify", { method: "POST", json: { response, jeton, deviceName: deviceName() } });
      await entered();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  // Ni lien d'inscription ni session : il n'y a personne à inscrire.
  if (me && !me.user && !jeton) return <Navigate to="/connexion" replace />;
  if (access && block === "adresse")
    return (
      <Shell open={false}>
        <AddressNotice access={access} />
      </Shell>
    );
  // Déjà connecté (premier démarrage) : le choix peut attendre.
  const signedIn = !!me?.user && !jeton;
  const password = access?.password === true;
  const form = password && (block !== null || byPassword);
  return (
    <Shell open={open}>
      <p className="mb-2 text-lg font-semibold">{t("Protège ton accès")}</p>
      {block === null && !form && (
        <>
          <p className="mb-6 max-w-xs text-[15px]">{t("Crée ta clé d'accès : elle remplace le mot de passe et se déverrouille avec Face ID ou Touch ID.")}</p>
          <button type="button" onClick={enroll} disabled={busy} className={mainButton}>
            <KeyRound size={22} />
            {busy ? t("Création…") : t("Créer ma clé d'accès")}
          </button>
        </>
      )}
      {/* Dit une fois que le serveur a dit où l'on est : avant, l'appli de bureau montrerait un instant le texte d'une adresse IP. */}
      {access && block !== null && <p className="mb-5 max-w-xs text-sm text-muted">{blockText(block, access.address)}</p>}
      {form && (
        <>
          <p className="mb-4 max-w-xs text-[15px]">{t("Choisis un mot de passe : tu te connecteras avec ton prénom et lui.")}</p>
          <NewPassword jeton={jeton} name={signedIn ? me?.user?.name : undefined} current={signedIn && access?.hasPassword === true} onDone={entered} />
        </>
      )}
      {block !== null && access && !password && <p className="max-w-xs text-sm">{t("Cette installation n'accepte que les clés d'accès : ouvre-la à une adresse en https, sur un nom de domaine.")}</p>}
      {block === null && password && (
        <button type="button" onClick={() => (setByPassword((v) => !v), setError(null))} className={linkButton}>
          {byPassword ? t("Créer plutôt une clé d'accès") : t("Choisir plutôt un mot de passe")}
        </button>
      )}
      {error && <p role="alert" className="mt-4 max-w-xs text-sm text-neg">{error}</p>}
      {signedIn && (
        <>
          <button type="button" onClick={() => void enter(qc, navigate, "/")} className={linkButton}>
            {t("Plus tard")}
          </button>
          {access && !access.passkeys && !access.hasPassword && (
            <p className="mt-2 max-w-xs text-xs text-muted">
              {access.desktop
                ? t("Ça se fait aussi plus tard, dans les réglages. D'ici là, Pécule s'ouvre sur cet ordinateur sans rien demander.")
                : t("Ça se fait aussi plus tard, dans les réglages. D'ici là, sans clé d'accès ni mot de passe, tu ne reviendras sur un autre appareil que par un lien donné sur le serveur.")}
            </p>
          )}
        </>
      )}
    </Shell>
  );
}
