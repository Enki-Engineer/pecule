import { useDesktop } from "../desktop.ts";
import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, KeyRound, ScanFace, Upload } from "lucide-react";
import { api, ApiError } from "../api.ts";
import { SetupCodeHelp } from "./SetupCodeHelp.tsx";
import { forgetSetupCode } from "../setup-code.ts";
import { ProgressBar } from "./ui.tsx";
import { cn } from "../cn.ts";
import { locale, t, tn } from "../../lib/i18n.ts";
import { percent, RESTORE_CHUNK, type RestoreReport, type RestoreStage, type RestoreStatus, type SealedKind, type ServerArchive } from "../../lib/restore.ts";

type Opened = { jeton: string; archives: ServerArchive[]; morceau: number };

const n = (v: number) => v.toLocaleString(locale());
const mo = (octets: number) => t("{n} Mo", { n: n(Math.max(1, Math.round(octets / 1_048_576))) });
const day = (at: number | string) => new Date(at).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric" });
const hour = (at: number | string) => new Date(at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
const errorText = (e: unknown) => (e instanceof Error ? e.message : t("Erreur inattendue"));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function stageLabel(stage: RestoreStage): string {
  switch (stage) {
    case "envoi":
      return t("Envoi de l'archive…");
    case "dechiffrement":
    case "verification":
      return t("Vérification de l'archive…");
    case "preparation":
      return t("Préparation de la base…");
    case "donnees":
      return t("Chargement des données…");
    case "fichiers":
      return t("Remise en place des fichiers…");
    case "controle":
      return t("Contrôle de la base restaurée…");
    default:
      return t("Démarrage de Pécule…");
  }
}

function sealedLabel(kind: SealedKind): string {
  switch (kind) {
    case "ia":
      return t("la clé de l'IA");
    case "banque":
      return t("la clé d'Enable Banking");
    case "services":
      return t("les clés des services de crypto");
    case "stockage":
      return t("le secret du stockage des sauvegardes");
    default:
      return t("les notifications, à réactiver sur chaque appareil");
  }
}

/** Envoie l'archive par morceaux ; un morceau qui échoue est renvoyé, et l'envoi reprend là où le serveur en est. */
async function sendArchive(file: File, o: Opened, onProgress: (sent: number) => void) {
  const size = o.morceau || RESTORE_CHUNK;
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    try {
      const { recu } = await api<{ recu: number }>(`/restore/upload?offset=${offset}&total=${file.size}`, { method: "PUT", headers: { "X-Restauration": o.jeton, "Content-Type": "application/octet-stream" }, body: file.slice(offset, offset + size) });
      offset = recu;
      failures = 0;
      onProgress(offset);
    } catch (e) {
      // Session perdue, archive trop grosse, disque plein : inutile d'insister.
      if (e instanceof ApiError && [400, 401, 413, 507].includes(e.status)) throw e;
      if (++failures > 4) throw e;
      await wait(1500 * failures);
      // Morceau peut-être écrit malgré la coupure : repartir de ce que le serveur a reçu.
      const s = await api<RestoreStatus>("/restore/status", { headers: { "X-Restauration": o.jeton } }).catch(() => null);
      if (s?.etape === "envoi" && s.total === file.size) offset = s.fait;
      else if (s) offset = 0;
    }
  }
}

function Report({ r }: { r: RestoreReport }) {
  const admins = r.membres.filter((m) => m.lien);
  const path = (link: string) => {
    // Le lien d'inscription est celui de ce serveur : on n'en garde que le chemin.
    const url = new URL(link);
    return url.pathname + url.search;
  };
  return (
    <div className="w-full max-w-sm text-left">
      <p className="text-center text-lg font-semibold">{t("Sauvegarde restaurée")}</p>
      <p className="mt-1 text-center text-sm text-muted">{t("Pécule est revenu à son état du {date} à {heure}.", { date: day(r.sauvegardeDu), heure: hour(r.sauvegardeDu) })}</p>
      <p className="tnum mt-3 text-center text-sm">
        {[
          tn("{n} membre", "{n} membres", r.membres.length, { n: n(r.membres.length) }),
          tn("{n} opération", "{n} opérations", r.operations, { n: n(r.operations) }),
          tn("{n} facture", "{n} factures", r.factures, { n: n(r.factures) }),
          tn("{n} document", "{n} documents", r.documents, { n: n(r.documents) }),
        ].join(" · ")}
      </p>
      {r.migrations > 0 && <p className="mt-3 text-sm text-muted">{t("La sauvegarde venait d'une version plus ancienne : la base a été mise à jour pour celle-ci.")}</p>}
      {r.adresseChangee === true && (
        <p className="card mt-3 px-4 py-3 text-sm">
          {t("L'adresse de Pécule n'est plus celle de la sauvegarde : les clés d'accès créées à l'ancienne adresse ne fonctionnent pas ici. Crée la tienne ci-dessous, puis donne un lien d'inscription à chaque membre depuis les réglages.")}
        </p>
      )}
      {r.sauvegardesEnPause && (
        <p className="card mt-3 px-4 py-3 text-sm">
          {t("Les sauvegardes automatiques sont en pause sur cette installation, pour qu'elle n'écrive pas à la place de celle d'origine : réactive-les dans les réglages si c'est bien elle qui sert désormais.")}
        </p>
      )}
      {r.clesIllisibles.length > 0 && (
        <p className="card mt-3 px-4 py-3 text-sm">
          {t("À refaire dans les réglages, car le secret de ce serveur n'est pas celui de l'ancien : {liste}.", { liste: r.clesIllisibles.map(sealedLabel).join(" ; ") })}
        </p>
      )}
      <div className="mt-6 flex flex-col items-center gap-3">
        {r.adresseChangee !== true && (
          <button type="button" onClick={() => window.location.assign("/")} className="press flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-accent py-4 text-lg font-semibold text-white shadow-lg">
            <ScanFace size={22} />
            {t("Se connecter")}
          </button>
        )}
        {admins.map((m) => (
          <a
            key={m.nom}
            href={path(m.lien!)}
            className={cn(
              "press flex w-full max-w-xs items-center justify-center gap-2 rounded-xl py-3 text-[15px] font-semibold",
              r.adresseChangee === true ? "bg-accent py-4 text-lg text-white shadow-lg" : "card text-ink",
            )}
          >
            <KeyRound size={18} />
            {t("Créer une clé d'accès pour {nom}", { nom: m.nom })}
          </a>
        ))}
      </div>
      {r.adresseChangee !== true && admins.length > 0 && <p className="mt-3 text-center text-xs text-muted">{t("Ta clé d'accès d'avant fonctionne si l'adresse de Pécule n'a pas changé. Sinon, crée-en une : le lien vaut sept jours.")}</p>}
    </div>
  );
}

/**
 * Premier démarrage, à la place de « Créer le foyer » : reprendre une sauvegarde complète dans cette installation
 * neuve. Le code d'installation, puis l'archive (envoyée par morceaux, ou choisie parmi celles du serveur), puis le
 * suivi du chargement — Pécule est en maintenance pendant ce temps — et ce qu'il reste à faire.
 */
export function RestoreSetup({ onBack, linkedCode, command }: { onBack: () => void; /** Code reçu avec le lien du premier démarrage. */ linkedCode?: string | null; /** Commande qui, sur le serveur, donne ce lien. */ command?: string }) {
  const desktop = useDesktop();
  const [code, setCode] = useState(linkedCode ?? "");
  // Le code est venu avec le lien : son champ n'est montré que si le serveur le refuse.
  const [linked, setLinked] = useState(!!linkedCode);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [archive, setArchive] = useState<string | null>(null);
  // Clé de récupération d'une archive chiffrée (« .zip.age ») : elle ne sert qu'à cette restauration.
  const [cle, setCle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Suivi : envoi puis chargement. `null` tant que rien n'est lancé.
  const [status, setStatus] = useState<RestoreStatus | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const jeton = opened?.jeton;
  const encrypted = !!file && /\.age$/i.test(file.name);
  const following = status !== null && status.etape !== "envoi" && status.etape !== "termine" && status.etape !== "echec";
  const done = status?.etape === "termine";
  // La sauvegarde est restaurée : le code d'installation a servi, il n'est plus gardé pour cet onglet.
  useEffect(() => {
    if (done) forgetSetupCode();
  }, [done]);

  // Pendant le chargement, l'état se relit toutes les deux secondes ; une réponse manquée (maintenance, réseau) n'arrête rien.
  useEffect(() => {
    if (!following || !jeton) return;
    let stopped = false;
    const timer = setInterval(() => {
      api<RestoreStatus>("/restore/status", { headers: { "X-Restauration": jeton } }).then(
        (s) => {
          if (!stopped) setStatus(s);
        },
        (e) => {
          // Le serveur a redémarré : il ne connaît plus cette restauration.
          if (!stopped && e instanceof ApiError && e.status === 401) setStatus({ etape: "echec", fait: 0, total: 0, erreur: e.message, rapport: null, cleRefusee: false });
        },
      );
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [following, jeton]);

  async function open() {
    setBusy(true);
    setError(null);
    try {
      setOpened(await api<Opened>("/restore/open", { method: "POST", json: { code } }));
    } catch (e) {
      setError(errorText(e));
      // Refusé : le code du lien ne sera pas reproposé, son champ revient.
      forgetSetupCode();
      setLinked(false);
    } finally {
      setBusy(false);
    }
  }

  /** `again` : l'archive est déjà sur le serveur (seule la clé de récupération était en cause) : on ne la renvoie pas. */
  async function start(again = false) {
    if (!opened || (!file && !archive)) return;
    setBusy(true);
    setError(null);
    try {
      if (file && !again) {
        setStatus({ etape: "envoi", fait: 0, total: file.size, erreur: null, rapport: null, cleRefusee: false });
        await sendArchive(file, opened, (sent) => setStatus({ etape: "envoi", fait: sent, total: file.size, erreur: null, rapport: null, cleRefusee: false }));
      }
      setStatus(await api<RestoreStatus>("/restore/start", { method: "POST", headers: { "X-Restauration": opened.jeton }, json: file ? (encrypted ? { cle: cle.trim() } : {}) : { archive } }));
    } catch (e) {
      setStatus(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function retry() {
    setStatus(null);
    setError(null);
    setFile(null);
    setArchive(null);
  }

  const field = "card w-full max-w-xs px-4 py-3 text-center text-base";
  const main = "press mt-6 w-full max-w-xs rounded-xl bg-accent py-4 text-lg font-semibold text-white shadow-lg disabled:opacity-60";
  const back = (
    <button type="button" onClick={onBack} className="press mt-5 text-sm text-muted underline">
      {t("Créer un nouveau foyer à la place")}
    </button>
  );

  if (status?.etape === "termine" && status.rapport) return <Report r={status.rapport} />;

  // Clé de récupération absente ou refusée : l'archive est restée sur le serveur, il suffit de redonner la clé.
  if (status?.etape === "echec" && status.cleRefusee && file)
    return (
      <>
        <p className="mb-1 text-lg font-semibold">{t("Clé de récupération")}</p>
        <p className="max-w-xs text-sm text-neg">{status.erreur ?? t("Erreur inattendue")}</p>
        <input key="cle" value={cle} onChange={(e) => setCle(e.target.value)} placeholder={t("Clé de récupération")} aria-label={t("Clé de récupération")} autoComplete="off" spellCheck={false} className={`${field} mt-4`} />
        <p className="mt-2 max-w-xs text-xs text-muted">{desktop ? t("L'archive est restée sur cet ordinateur : pas besoin de la renvoyer.") : t("L'archive est restée sur le serveur : pas besoin de la renvoyer.")}</p>
        <button type="button" onClick={() => start(true)} disabled={busy || !cle.trim()} className={main}>
          {t("Réessayer avec cette clé")}
        </button>
        {error && <p className="mt-4 max-w-xs text-sm text-neg">{error}</p>}
        {back}
      </>
    );

  if (status?.etape === "echec")
    return (
      <>
        <p className="mb-1 text-lg font-semibold">{t("Restauration interrompue")}</p>
        <p className="max-w-xs text-sm text-neg">{status.erreur ?? t("Erreur inattendue")}</p>
        <button type="button" onClick={retry} className={main}>
          {t("Recommencer")}
        </button>
        {back}
      </>
    );

  if (status)
    return (
      <div className="w-full max-w-xs" role="status" aria-live="polite">
        <p className="mb-3 text-lg font-semibold">{stageLabel(status.etape)}</p>
        <ProgressBar value={status.total > 0 ? percent(status.fait, status.total) / 100 : status.etape === "demarrage" ? 1 : 0} className={cn(status.total === 0 && "animate-pulse")} />
        <p className="tnum mt-2 text-sm text-muted">{status.total > 0 ? `${percent(status.fait, status.total)} %` : " "}</p>
        <p className="mt-4 text-sm text-muted">{t("Garde cette page ouverte jusqu'à la fin : une grosse sauvegarde demande plusieurs minutes.")}</p>
      </div>
    );

  if (!opened)
    return (
      <>
        <p className="mb-1 text-lg font-semibold">{t("Restaurer une sauvegarde")}</p>
        <p className="mb-6 max-w-xs text-sm text-muted">{t("Reprends une sauvegarde complète de Pécule dans cette installation neuve : membres, opérations, factures, documents et réglages reviennent tels qu'ils étaient.")}</p>
        {linked ? (
          <p className="max-w-xs text-xs text-muted">{t("Code d'installation reçu avec le lien.")}</p>
        ) : (
          <>
            <input key="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={t("Code d'installation")} aria-label={t("Code d'installation")} autoComplete="off" spellCheck={false} className={field} />
            <SetupCodeHelp command={command} />
          </>
        )}
        <button type="button" onClick={open} disabled={busy || !code.trim()} className={main}>
          {t("Continuer")}
        </button>
        {error && <p className="mt-4 max-w-xs text-sm text-neg">{error}</p>}
        {back}
      </>
    );

  return (
    <>
      <p className="mb-1 text-lg font-semibold">{t("Choisis la sauvegarde")}</p>
      <p className="mb-5 max-w-xs text-sm text-muted">{desktop ? t("L'archive téléchargée depuis Réglages → Compte et sécurité, une copie chiffrée reprise de ton stockage extérieur, ou une archive écrite par Pécule.") : t("L'archive téléchargée depuis Réglages → Compte et sécurité, une copie chiffrée reprise de ton stockage extérieur, ou une archive écrite par le serveur.")}</p>
      <input
        key="archive"
        ref={input}
        type="file"
        accept=".zip,.age,application/zip"
        className="hidden"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setArchive(null);
        }}
      />
      <button type="button" onClick={() => input.current?.click()} aria-pressed={!!file} className={cn("press card flex w-full max-w-xs items-center gap-3 px-4 py-3 text-left", file && "outline-2 -outline-offset-2 outline-accent")}>
        <Upload size={18} className="shrink-0 text-accent" />
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">{file ? file.name : t("Choisir une archive sur cet appareil")}</span>
          {file && <span className="block text-xs text-muted">{mo(file.size)}</span>}
        </span>
      </button>
      {opened.archives.length > 0 && (
        <div className="mt-4 w-full max-w-xs text-left">
          <p className="mb-2 text-center text-xs text-muted">{desktop ? t("Ou une archive déjà sur cet ordinateur :") : t("Ou une archive déjà sur le serveur :")}</p>
          <div className="flex max-h-52 flex-col gap-2 overflow-y-auto">
            {opened.archives.map((a) => (
              <button
                key={a.nom}
                type="button"
                aria-pressed={archive === a.nom}
                onClick={() => {
                  setArchive(a.nom);
                  setFile(null);
                }}
                className={cn("press card flex items-center gap-3 px-4 py-2.5 text-left", archive === a.nom && "outline-2 -outline-offset-2 outline-accent")}
              >
                <ArchiveRestore size={17} className="shrink-0 text-muted" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{a.nom}</span>
                  <span className="block text-xs text-muted">{t("le {date} à {heure} ({taille})", { date: day(a.at), heure: hour(a.at), taille: mo(a.octets) })}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {encrypted && (
        <>
          <input value={cle} onChange={(e) => setCle(e.target.value)} placeholder={t("Clé de récupération")} aria-label={t("Clé de récupération")} autoComplete="off" spellCheck={false} className={`${field} mt-4`} />
          <p className="mt-2 max-w-xs text-xs text-muted">{t("Cette archive est chiffrée. Sa clé de récupération commence par AGE-SECRET-KEY-1 : Pécule te l'a montrée le jour où tu as créé la clé de chiffrement.")}</p>
        </>
      )}
      <button type="button" onClick={() => start()} disabled={busy || (!file && !archive) || (encrypted && !cle.trim())} className={main}>
        {t("Restaurer cette sauvegarde")}
      </button>
      {error && <p className="mt-4 max-w-xs text-sm text-neg">{error}</p>}
      {back}
    </>
  );
}
