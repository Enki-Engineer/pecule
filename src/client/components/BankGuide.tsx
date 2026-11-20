import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, ExternalLink, FileKey2, RefreshCw, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api, useMe, type Account } from "../api.ts";
import { BANK_COUNTRIES, BANK_STATE_KEY, consentsOf, guideFacts, useBankState, type Bank, type BankScope, type BankState } from "../api-bank.ts";
import { BankBadge, ErrorBox, Field } from "./ui.tsx";
import { mainButton, quietButton } from "./Connector.tsx";
import { cn } from "../cn.ts";
import { dateFr } from "../format.ts";
import { region } from "../region.ts";
import { ebKeyFile } from "../../lib/enable-banking.ts";
import { BANK_GUIDE_STEPS, bankGuide, type BankGuideState, type BankGuideStep } from "../../lib/onboarding.ts";
import { locale, t, tn } from "../../lib/i18n.ts";
import "../../styles/guide.css";

/*
 * « Relier ta banque », pas à pas : créer son application chez Enable Banking, l'activer en y reliant ses comptes,
 * donner sa clé à Pécule, puis autoriser Pécule à lire. Le guide suit ce que Pécule sait lire (clé reconnue,
 * application active, accord donné) : on le quitte et on y revient sans rien perdre. Il sert dans la présentation
 * de bienvenue et dans Réglages → Comptes et connexions → Enable Banking — une seule façon de faire.
 * Les noms entre guillemets sont ceux de la console d'Enable Banking, en anglais : ils ne se traduisent pas.
 */

const SIGN_IN = "https://enablebanking.com/sign-in/";
const CONSOLE = "https://enablebanking.com/cp/applications";

type Declared = { application: boolean; activation: boolean };

/**
 * Ce que le membre dit avoir fait chez Enable Banking, gardé sur l'appareil : l'aller-retour vers leur console,
 * une page rechargée ou le passage par la banque ne le font pas repartir du début.
 */
function useDeclared(scope: BankScope, userId: number | undefined): [Declared, (next: Declared) => void] {
  const key = `pecule.banque.guide.${userId ?? 0}.${scope}`;
  const [declared, setDeclared] = useState<Declared>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<Declared> | null;
      return { application: v?.application === true, activation: v?.activation === true };
    } catch {
      return { application: false, activation: false };
    }
  });
  const save = (next: Declared) => {
    setDeclared(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* stockage refusé (navigation privée) : gardé le temps de l'écran */
    }
  };
  return [declared, save];
}

/** Vrai tant que c'est ouvert, et encore un instant après : le contenu reste là le temps de se replier. */
function useLinger(open: boolean, ms = 320) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(false), ms);
    return () => {
      clearTimeout(timer);
    };
  }, [open, ms]);
  return open || shown;
}

const stateLabel = (state: BankGuideState) => (state === "fait" ? t("Fait") : state === "en_cours" ? t("En cours##étape") : t("À venir"));

function GuideStep({ id, n, last, state, title, where, open, onToggle, children }: { id: BankGuideStep; n: number; last: boolean; state: BankGuideState; title: string; where: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const mounted = useLinger(open);
  return (
    <li className="relative pl-11" data-etat={state} data-etape={id}>
      {!last && <span aria-hidden data-done={state === "fait"} className="guide-line absolute bottom-0 left-[13px] top-9 w-0.5 overflow-hidden rounded-full" />}
      <span
        aria-hidden
        className={cn(
          "absolute left-0 top-0.5 grid size-7 place-items-center rounded-full text-[13px] font-semibold tabular-nums",
          state === "fait" ? "bg-accent text-white" : state === "en_cours" ? "guide-now bg-card text-accent shadow-[inset_0_0_0_2px_var(--color-accent)]" : "bg-line/70 text-muted",
        )}
      >
        {state === "fait" ? <Check size={15} strokeWidth={3} className="guide-check" /> : n}
      </span>
      <button type="button" onClick={onToggle} aria-expanded={open} className="press flex w-full items-start gap-2 rounded-lg pb-3 text-left">
        <span className="min-w-0 flex-1">
          <span className={cn("block text-[15.5px] font-semibold leading-snug", state === "a_venir" && "text-muted")}>{title}</span>
          <span className="block text-[12.5px] text-muted">
            <span className={state === "fait" ? "font-medium text-ink" : "sr-only"}>{stateLabel(state)} · </span>
            {where}
          </span>
        </span>
        <ChevronDown size={17} className={cn("mt-1 shrink-0 text-muted transition-transform duration-300", open && "rotate-180")} />
      </button>
      <div className="guide-body" data-open={open}>
        <div inert={!open}>{mounted && <div className="space-y-3 pb-6 pr-0.5 pt-0.5 text-[14px] leading-relaxed">{children}</div>}</div>
      </div>
    </li>
  );
}

/** Une valeur à recopier chez Enable Banking, avec son bouton de copie. */
function CopyField({ label, value }: { label: string; value: string }) {
  // Hors d'une adresse sûre (Pécule ouvert en http), le navigateur n'a pas de presse-papiers : l'appel échoue
  // aussitôt, et on le dit au lieu de ne rien faire.
  const copy = () =>
    new Promise<void>((done) => done(navigator.clipboard.writeText(value))).then(
      () => toast.success(t("Adresse copiée")),
      () => toast.error(t("Copie impossible : sélectionne l'adresse à la main.")),
    );
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      <div className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2 shadow-[inset_0_0_0_1px_var(--color-line)]">
        <code className="min-w-0 flex-1 select-all break-all text-[13px]">{value}</code>
        <button type="button" onClick={copy} title={t("Copier")} aria-label={`${t("Copier")} : ${label}`} className="press shrink-0 rounded-lg p-1.5 text-muted hover:text-ink">
          <Copy size={15} />
        </button>
      </div>
    </div>
  );
}

const warnBox = "flex items-start gap-2.5 rounded-xl bg-[color-mix(in_srgb,var(--color-warn)_10%,var(--color-card))] px-3.5 py-3 text-[13.5px] leading-snug text-warn";

/**
 * Identifiant et clé privée d'une application : celle du foyer, ou la clé personnelle du membre. Le plus simple est
 * de donner le fichier que la console d'Enable Banking a fait télécharger : son nom porte l'identifiant, son texte
 * la clé. On peut aussi tout saisir à la main.
 */
export function BankKeyForm({ scope, onSaved }: { scope: BankScope; onSaved: (next: BankState) => void }) {
  const [appId, setAppId] = useState("");
  const [key, setKey] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function read(file: File | null | undefined) {
    if (!file) return;
    setProblem(null);
    // Une clé tient en quelques milliers de caractères : un fichier bien plus gros n'en est pas une.
    const found = file.size > 50_000 ? null : ebKeyFile(file.name, await file.text().catch(() => ""));
    if (!found?.key) {
      setFileName(null);
      setProblem(found?.kind === "certificat" ? t("Ce fichier est le certificat public, celui qu'on donne à Enable Banking. Pécule a besoin de la clé privée : le fichier .pem téléchargé, ou private.key.") : t("Ce fichier ne contient pas de clé privée."));
      return;
    }
    setKey(found.key);
    setFileName(file.name);
    if (found.appId) setAppId(found.appId);
  }

  async function send() {
    setBusy(true);
    setProblem(null);
    try {
      onSaved(await api<BankState>("/bank/enable-banking/key", { method: "PUT", json: { appId: appId.trim(), privateKey: key, scope } }));
      setKey("");
      setFileName(null);
      toast.success(t("Clé enregistrée"));
    } catch (e) {
      const message = e instanceof Error ? e.message : t("Action impossible");
      // Application pas encore activée chez Enable Banking : on dit quoi faire, pas seulement ce qui a été refusé.
      setProblem(/not active/i.test(message) ? `${message} ${t("Relie d'abord tes comptes à l'application chez Enable Banking (« Activate by linking accounts »), puis réessaie.")}` : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void read(e.dataTransfer.files[0]);
        }}
        className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-dashed px-3.5 py-3 transition-colors", over ? "border-accent bg-accent-soft" : "border-[color-mix(in_srgb,var(--color-muted)_45%,transparent)]")}
      >
        {/* Aucun filtre de type : sur iPhone, un fichier .pem serait grisé. Le contenu est contrôlé à la lecture. */}
        <input
          ref={picker}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className={cn(fileName ? quietButton : mainButton, fileName && "-mx-2.5")} onClick={() => picker.current?.click()}>
          {!fileName && <FileKey2 size={16} />} {fileName ? t("Choisir un autre fichier") : t("Choisir le fichier de la clé")}
        </button>
        {fileName ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
            <Check size={15} strokeWidth={2.6} className="guide-check shrink-0 text-accent" />
            <span className="truncate">{t("Clé lue dans {fichier}", { fichier: fileName })}</span>
          </span>
        ) : (
          <span className="hidden text-[13px] text-muted md:inline">{t("ou dépose-le ici")}</span>
        )}
      </div>
      {(fileName || manual) && <Field text label={t("Identifiant de l'application")} value={appId} onChange={setAppId} placeholder="00000000-0000-0000-0000-000000000000" />}
      {manual && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">{t("Clé privée (contenu du fichier .key ou .pem)")}</span>
          <textarea value={key} onChange={(e) => setKey(e.target.value)} rows={4} spellCheck={false} placeholder="-----BEGIN PRIVATE KEY-----" className="card w-full px-3 py-2 font-mono text-xs" />
        </label>
      )}
      {problem && (
        <p role="alert" className={warnBox}>
          <TriangleAlert size={16} className="mt-px shrink-0" /> <span>{problem}</span>
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {(fileName || manual) && (
          <button type="button" className={mainButton} disabled={busy || !appId.trim() || !key.trim()} onClick={send}>
            {busy ? t("Vérification…") : t("Enregistrer la clé")}
          </button>
        )}
        {!manual && (
          <button type="button" className={cn(quietButton, !fileName && "-mx-2.5")} onClick={() => setManual(true)}>
            {t("Saisir la clé à la main")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Choix du pays et de la banque, puis départ vers la page d'accord. `from` : l'écran où la banque ramènera. */
export function BankLinkForm({ from }: { from?: "bienvenue" }) {
  // Par défaut, le pays du foyer (s'il fait partie de ceux qu'Enable Banking couvre).
  const [country, setCountry] = useState(() => (BANK_COUNTRIES.includes(region().country) ? region().country : "FR"));
  const [bank, setBank] = useState("");
  const [busy, setBusy] = useState(false);
  const banks = useQuery({ queryKey: ["bank", "enable-banking", "banks", country], queryFn: () => api<{ banks: Bank[] }>(`/bank/enable-banking/banks?pays=${country}`), staleTime: 3600_000 });
  const countryName = (code: string) => new Intl.DisplayNames([locale()], { type: "region" }).of(code) ?? code;

  async function connect() {
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>("/bank/enable-banking/connect", { method: "POST", json: { aspsp: bank, country, ...(from ? { from } : {}) } });
      // On quitte Pécule pour la page d'accord : le bouton reste pris jusque-là.
      window.location.href = url;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Action impossible"));
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setBank("");
          }}
          className="rounded-lg border border-line bg-card px-3 py-2 text-sm"
          aria-label={t("Pays")}
        >
          {BANK_COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </select>
        <select value={bank} onChange={(e) => setBank(e.target.value)} className="min-w-0 max-w-full rounded-lg border border-line bg-card px-3 py-2 text-sm" aria-label={t("Banque")}>
          <option value="">{banks.isLoading ? t("Chargement…") : t("Choisir une banque")}</option>
          {(banks.data?.banks ?? [])
            .filter((b) => b.personal)
            .map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
        </select>
        <button type="button" className={mainButton} disabled={busy || !bank} onClick={connect}>
          {t("Relier")}
        </button>
      </div>
      {banks.error && <p className="mt-2 text-xs text-warn">{banks.error instanceof Error ? banks.error.message : t("Action impossible")}</p>}
      <p className="mt-2 text-xs text-muted">{t("Tu passeras par une page d'accord puis par ta banque. Valide sans attendre : la page d'accord expire au bout d'un quart d'heure. La banque doit d'abord avoir été reliée dans la console d'Enable Banking.")}</p>
    </>
  );
}

const extLink = cn(mainButton, "no-underline");

export function BankGuide({ scope, from }: { scope: BankScope; from?: "bienvenue" }) {
  const qc = useQueryClient();
  const userId = useMe().data?.user?.id;
  const state = useBankState();
  const [declared, setDeclared] = useDeclared(scope, userId);
  // Étape dépliée à la main (« aucune » : toutes repliées) ; sinon celle qui est en cours.
  const [picked, setPicked] = useState<BankGuideStep | "aucune" | null>(null);
  const [replacing, setReplacing] = useState(false);
  const s = state.data;
  const facts = s ? guideFacts(s, scope, userId) : null;
  const guide = facts ? bankGuide({ ...facts, declared }) : null;
  const current = guide?.current ?? null;
  // Où en est le guide : l'étape en cours, « fini », ou rien tant que l'état n'est pas lu.
  const stage = guide ? (current ?? "fini") : null;
  const root = useRef<HTMLDivElement>(null);
  const lastStage = useRef(stage);
  // Une étape vient d'être franchie : le guide rouvre celle qui suit. Le bouton qui avait le focus a disparu avec
  // l'étape quittée (repliée, ou son formulaire retiré) : le focus va à l'étape qui s'ouvre, pour que le clavier ne
  // reparte pas du haut de la page — sauf s'il est posé ailleurs, où on le laisse.
  useEffect(() => {
    const previous = lastStage.current;
    lastStage.current = stage;
    setPicked(null);
    setReplacing(false);
    if (previous === null || stage === null || stage === "fini" || previous === stage) return;
    const active = document.activeElement;
    const stranded = !active || active === document.body || (!!root.current?.contains(active) && !!active.closest("[inert]"));
    if (stranded) root.current?.querySelector<HTMLElement>(`[data-etape="${stage}"] > button`)?.focus({ preventScroll: true });
  }, [stage]);
  // Première lecture : les comptes arrivent quelques minutes après l'accord. On les guette cinq minutes à partir de
  // l'ouverture du guide, puis on laisse faire.
  const linked = guide?.done === true;
  const [opened] = useState(() => Date.now());
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api<{ accounts: Account[] }>("/accounts"),
    enabled: linked,
    refetchInterval: (q) => (linked && !q.state.data?.accounts.some((a) => a.feed === "enablebanking") && Date.now() - opened < 5 * 60_000 ? 5000 : false),
  });

  if (state.isLoading)
    return (
      <div className="space-y-4" role="status" aria-label={t("Chargement…")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="skeleton size-7 shrink-0 rounded-full" />
            <div className="skeleton h-9 flex-1 rounded-xl" />
          </div>
        ))}
      </div>
    );
  if (state.error || !s || !facts || !guide) return <ErrorBox error={state.error} />;

  const shown = picked === "aucune" ? null : (picked ?? current);
  const toggle = (id: BankGuideStep) => setPicked(shown === id ? "aucune" : id);
  const origin = new URL(s.redirectUrl).origin;
  const mine = consentsOf(s, scope, userId);
  const read = (accounts.data?.accounts ?? []).filter((a) => a.feed === "enablebanking").length;
  const keyOk = facts.keySaved && !facts.keyUnreadable;
  const check = () =>
    state.refetch().then((r) => {
      if (r.data && !guideFacts(r.data, scope, userId).application?.active) toast.message(t("Pas encore active : relie d'abord tes comptes chez Enable Banking, puis vérifie de nouveau."));
    });

  const content: Record<BankGuideStep, ReactNode> = {
    application: (
      <>
        <ol className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-muted">
          <li>{t("Crée ton compte sur enablebanking.com : tu reçois un lien par mail, à ouvrir dans le même navigateur.")}</li>
          <li>
            {t("Dans « API applications », choisis « Add a new application » et remplis :")}
            <ul className="mt-1 list-disc space-y-0.5 pl-5 marker:text-muted">
              <li>{t("l'environnement : « Production » ;")}</li>
              <li>{t("la clé : garde « Generate in the browser », ton navigateur la téléchargera ;")}</li>
              <li>{t("« Application name » : le nom que ta banque t'affichera, par exemple Pécule ;")}</li>
              <li>{t("« Allowed redirect URLs » : l'adresse de retour ci-dessous.")}</li>
            </ul>
          </li>
          <li>{t("Valide par « Register » : un fichier se télécharge, c'est la clé de ton application. Garde-le pour la suite.")}</li>
        </ol>
        <CopyField label={t("Adresse de retour à déclarer")} value={s.redirectUrl} />
        <details className="group">
          <summary className="press -mx-2.5 inline-flex cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-muted [&::-webkit-details-marker]:hidden">
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" /> {t("Autres champs, facultatifs")}
          </summary>
          <div className="mt-2 space-y-3">
            <CopyField label={t("Page de confidentialité (« Privacy URL »)")} value={`${origin}/confidentialite`} />
            <CopyField label={t("Conditions d'utilisation (« Terms URL »)")} value={`${origin}/conditions`} />
            <p className="text-[13px] text-muted">{t("Tu préfères générer la clé toi-même ? Choisis « Generate outside the browser » : la console donne les commandes, et ta clé est alors le fichier private.key.")}</p>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <a href={SIGN_IN} target="_blank" rel="noreferrer" className={extLink}>
            {t("Ouvrir Enable Banking")} <ExternalLink size={15} />
          </a>
          {!keyOk && (
            <button type="button" className={quietButton} onClick={() => setDeclared({ ...declared, application: true })}>
              {t("C'est fait, j'ai le fichier")}
            </button>
          )}
        </div>
      </>
    ),
    activation: (
      <>
        <p>{t("Sur la page de ton application, clique sur « Activate by linking accounts » : choisis ton pays et ta banque, puis identifie-toi auprès d'elle comme d'habitude.")}</p>
        <p>{t("Recommence pour chaque banque à suivre : Pécule ne pourra lire que les comptes reliés là. L'application passe alors de « Inactive » à « Active ».")}</p>
        {keyOk && facts.application && !facts.application.active && (
          <p role="status" className={warnBox}>
            <TriangleAlert size={16} className="mt-px shrink-0" /> <span>{t("Enable Banking indique que l'application n'est pas encore active.")}</span>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <a href={CONSOLE} target="_blank" rel="noreferrer" className={extLink}>
            {t("Ouvrir mes applications")} <ExternalLink size={15} />
          </a>
          {keyOk && facts.application ? (
            !facts.application.active && (
              <button type="button" className={cn(quietButton, "inline-flex items-center gap-1.5")} disabled={state.isFetching} onClick={() => void check()}>
                <RefreshCw size={14} className={cn(state.isFetching && "animate-spin")} /> {t("Vérifier")}
              </button>
            )
          ) : (
            <button type="button" className={quietButton} onClick={() => setDeclared({ application: true, activation: true })}>
              {t("C'est fait, elle est active")}
            </button>
          )}
        </div>
      </>
    ),
    cle:
      keyOk && !replacing ? (
        <>
          <p>
            {t("Clé enregistrée : application « {nom} ».", { nom: facts.application?.name ?? (scope === "moi" ? s.own?.appId : s.appId) ?? "—" })} {t("Tu peux supprimer le fichier téléchargé, ou le ranger en lieu sûr.")}
          </p>
          <button type="button" className={cn(quietButton, "-mx-2.5")} onClick={() => setReplacing(true)}>
            {t("Remplacer la clé")}
          </button>
        </>
      ) : (
        <>
          <p>{t("Choisis le fichier téléchargé à l'étape 1 (son nom finit par .pem) : Pécule y lit l'identifiant de l'application et sa clé. La clé est gardée chiffrée, et n'est plus jamais affichée.")}</p>
          {facts.keyUnreadable && (
            <p role="status" className={warnBox}>
              <TriangleAlert size={16} className="mt-px shrink-0" /> <span>{t("La clé enregistrée n'est plus lisible (le secret du serveur a changé) : saisis-la de nouveau.")}</span>
            </p>
          )}
          <BankKeyForm
            scope={scope}
            onSaved={(next) => {
              qc.setQueryData(BANK_STATE_KEY, next);
              setReplacing(false);
              void qc.invalidateQueries({ queryKey: ["connections"] });
            }}
          />
        </>
      ),
    accord: (
      <>
        {keyOk && facts.application && !facts.application.redirectOk && (
          <p role="status" className={warnBox}>
            <TriangleAlert size={16} className="mt-px shrink-0" />
            <span>
              {t("L'adresse de retour n'est pas déclarée chez Enable Banking :")} <span className="select-all break-all font-mono text-[12.5px]">{s.redirectUrl}</span>
            </span>
          </p>
        )}
        <p>
          {mine.length
            ? t("Une autre banque ? Relie-la d'abord à l'application chez Enable Banking, puis choisis-la ici.")
            : t("Choisis ta banque. Tu passeras par une page d'accord, puis par ta banque, une seconde fois : c'est normal. La première fois disait à Enable Banking quels comptes sont les tiens ; celle-ci autorise ton Pécule à les lire, pendant 180 jours.")}
        </p>
        {keyOk && facts.application?.active ? (
          <BankLinkForm from={from} />
        ) : keyOk && !facts.application ? (
          // Enable Banking n'a pas répondu (son message est en tête du guide) : on lui redemande.
          <button type="button" className={cn(quietButton, "-mx-2.5 inline-flex items-center gap-1.5")} disabled={state.isFetching} onClick={() => void state.refetch()}>
            <RefreshCw size={14} className={cn(state.isFetching && "animate-spin")} /> {t("Vérifier")}
          </button>
        ) : (
          <p className="text-[13px] text-muted">{t("La liste des banques s'ouvre dès que l'application est active et que Pécule a sa clé.")}</p>
        )}
      </>
    ),
  };

  const titles: Record<BankGuideStep, [title: string, where: string]> = {
    application: [t("Crée ton application"), t("Chez Enable Banking, en cinq minutes")],
    activation: [t("Relie tes comptes à l'application"), t("Chez Enable Banking, avec ta banque")],
    cle: [t("Donne sa clé à Pécule"), t("Ici, dans Pécule")],
    accord: [t("Autorise Pécule à lire tes comptes"), t("Ici, puis chez ta banque")],
  };

  return (
    <div ref={root} className="space-y-5">
      {/* Ce qu'Enable Banking répond de travers (clé révoquée, service en panne) se dit en tête, quelle que soit l'étape ouverte. */}
      {keyOk && facts.error && (
        <p role="status" className={warnBox}>
          <TriangleAlert size={16} className="mt-px shrink-0" /> <span>{facts.error}</span>
        </p>
      )}
      {!s.redirectUrl.startsWith("https://") && (
        <p role="status" className={warnBox}>
          <TriangleAlert size={16} className="mt-px shrink-0" />
          <span>{t("Enable Banking demande une adresse en https, et ton Pécule est ouvert en http ({adresse}). Relie ta banque une fois ton adresse en https en place ; en attendant, tu peux importer un fichier de ta banque.", { adresse: origin })}</span>
        </p>
      )}
      {linked && (
        <div className="guide-linked rounded-2xl bg-accent-soft/70 p-4 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_16%,transparent)]">
          <ul className="space-y-2.5">
            {mine.map((x) => (
              <li key={x.id} className="flex items-center gap-3">
                <BankBadge bank={x.aspsp} size="md" />
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold leading-snug">{t("{banque} est reliée", { banque: x.aspsp })}</span>
                  <span className="block text-xs text-muted">{t("Accord valable jusqu'au {date}", { date: dateFr(x.validUntil.slice(0, 10)) })}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-2 text-[13.5px]" aria-live="polite">
            {read > 0 ? (
              <>
                <Check size={16} strokeWidth={2.6} className="guide-check shrink-0 text-accent" /> {tn("{n} compte lu chez la banque", "{n} comptes lus chez la banque", read, { n: read })}
              </>
            ) : (
              <>
                <RefreshCw size={14} className="shrink-0 animate-spin text-muted" /> {t("Première lecture en cours : tes comptes arrivent dans quelques minutes.")}
              </>
            )}
          </p>
        </div>
      )}
      <ol>
        {BANK_GUIDE_STEPS.map((id, i) => (
          <GuideStep key={id} id={id} n={i + 1} last={i === BANK_GUIDE_STEPS.length - 1} state={guide.states[id]} title={titles[id][0]} where={titles[id][1]} open={shown === id} onToggle={() => toggle(id)}>
            {content[id]}
          </GuideStep>
        ))}
      </ol>
    </div>
  );
}
