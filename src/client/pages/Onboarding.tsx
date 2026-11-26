import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, Clock, Compass, Eye, FileUp, Globe, Landmark, LayoutGrid, Palette, PanelBottom, PanelLeft, Presentation, Search, Server, Shapes, Smartphone, Sparkles, Tags, TriangleAlert, UserPlus, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { api, closeWelcome, useAccounts, useMe, type Me } from "../api.ts";
import { useDesktop } from "../desktop.ts";
import { consentsOf, guideFacts, takeBankOutcome, useBankState, type BankScope } from "../api-bank.ts";
import { enterDemo } from "../demo.ts";
import { appLang, applyLang } from "../i18n.ts";
import { useNav } from "../modules.ts";
import { arrived, passage } from "../passage.ts";
import { TOUR_LINK } from "../tour.ts";
import { NAV } from "../nav.ts";
import { useTheme } from "../theme.ts";
import { useMedia } from "../useMedia.ts";
import { BankGuide } from "../components/BankGuide.tsx";
import { CurrencySelect, currencyName } from "../components/CurrencySelect.tsx";
import { countryName, timeZones } from "../components/HouseholdSettings.tsx";
import { BankBadge } from "../components/ui.tsx";
import { ArtAccounts, ArtHousehold, ArtLandmarks, ArtReady, ArtWelcome, type Spot } from "../components/WelcomeArt.tsx";
import { cn } from "../cn.ts";
import { COUNTRIES, guessRegion, regionOf, type Region } from "../../lib/countries.ts";
import { MODULES, MODULE_INFO, type ModuleId } from "../../lib/modules.ts";
import { asWelcomeStep, draftWithCountry, householdChanges, nextWelcomeStep, previousWelcomeStep, proposedHousehold, welcomeFlow, welcomeProgress, type HouseholdDraft, type WelcomeStep } from "../../lib/onboarding.ts";
import { LANGS, locale, t, tn, type Lang } from "../../lib/i18n.ts";
import "../../styles/bienvenue.css";

/*
 * Bienvenue : la présentation qu'un membre voit à sa première connexion, plein écran, hors de la coquille de l'appli.
 * Quelques étapes courtes — l'accueil, les réglages du foyer (administrateur), les repères pour ne pas se perdre,
 * puis les comptes, avec le guide pas à pas d'Enable Banking — et une fin qui dit quoi faire ensuite.
 *
 * Le serveur sait si elle attend le membre (`welcome`, src/server/welcome.ts) : elle s'ouvre d'elle-même, se reprend
 * là où on l'a laissée (l'étape est dans l'adresse et gardée par l'appareil), et ne revient plus une fois finie ou
 * passée. On la rejoue quand on veut par son adresse, /bienvenue. Règles : src/lib/onboarding.ts.
 */

type Household = { members: { id: number; name: string; role: string }[]; modulesOff: ModuleId[] } & Region;

/** Étape où le membre s'est arrêté, gardée par l'appareil (avec son identifiant : jamais l'étape d'un autre). */
const STEP_KEY = "pecule.bienvenue.etape";
const savedStep = (userId: number | undefined, flow: readonly WelcomeStep[]): WelcomeStep | null => {
  try {
    const [id, step] = (localStorage.getItem(STEP_KEY) ?? "").split(":");
    return id === String(userId) ? asWelcomeStep(step, flow) : null;
  } catch {
    return null;
  }
};
const keepStep = (userId: number, step: WelcomeStep | null) => {
  try {
    if (step) localStorage.setItem(STEP_KEY, `${userId}:${step}`);
    else localStorage.removeItem(STEP_KEY);
  } catch {
    /* stockage refusé : l'adresse porte l'étape */
  }
};

/** Place de l'illustration sur téléphone : plus grande pour la maquette de l'appli, réduite à un bandeau au-dessus des choix, absente des étapes à formulaire. */
const ART_PHONE: Partial<Record<WelcomeStep, "grand" | "petit" | "aucun">> = { foyer: "aucun", reperes: "grand", comptes: "petit", banque: "aucun" };

/** Icône d'un écran facultatif : celle de son entrée dans le menu. */
const MODULE_ICON = Object.fromEntries(MODULES.map((m) => [m, NAV.flatMap((g) => g.items).find((it) => MODULE_INFO[m].paths.includes(it.to))?.icon ?? Shapes])) as Record<ModuleId, LucideIcon>;

const lead = "mt-3 text-[16px] leading-relaxed text-muted lg:text-[15.5px]";
const sectionTitle = "mb-2 px-1 text-[13px] font-medium text-muted";
const warnBox = "flex items-start gap-2.5 rounded-xl bg-[color-mix(in_srgb,var(--color-warn)_10%,var(--color-card))] px-3.5 py-3 text-[13.5px] leading-snug text-warn";

export function Onboarding() {
  useTheme(); // applique le thème choisi et suit le système (hors de la coquille, personne d'autre ne le fait)
  const me = useMe();
  const user = me.data?.user;
  const admin = user?.admin === true;
  const real = !!user && !user.demo;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  // L'appli a deux coquilles : celle du téléphone et celle de l'ordinateur. On montre celle que le membre a sous les yeux.
  const desktop = useMedia("(min-width: 768px)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  const flow = useMemo(() => welcomeFlow({ admin }), [admin]);

  const household = useQuery({ queryKey: ["household"], queryFn: () => api<Household>("/household"), staleTime: 60_000, enabled: real });
  const accounts = useAccounts();
  const bank = useBankState(real);
  const count = accounts.data?.accounts.length ?? null;

  const [step, setStep] = useState<WelcomeStep>(() => asWelcomeStep(params.get("etape"), flow) ?? savedStep(user?.id, flow) ?? "bienvenue");
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Étapes par où le membre est passé : « Retour » les remonte. */
  const trail = useRef<WelcomeStep[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  // Arrivée depuis l'écran de connexion : le coffre peut glisser jusqu'ici, la présentation est dessinée.
  useLayoutEffect(() => {
    arrived();
  }, []);

  // L'étape est dans l'adresse (une page rechargée la garde) et sur l'appareil (l'appli rouverte plus tard la reprend).
  const userId = user?.id;
  useEffect(() => {
    // Pas en démo : la présentation n'y existe pas, l'écran repart vers l'accueil sans toucher à l'adresse.
    if (userId == null || !real) return;
    keepStep(userId, step);
    if (params.get("etape") !== step) setParams({ etape: step }, { replace: true, state: location.state });
  }, [step, userId, real]);

  /** Passe à une étape : celle qu'on quitte s'efface, la suivante arrive du côté où l'on va. */
  function go(next: WelcomeStep, direction: "forward" | "back" = "forward") {
    if (next === step || phase === "out") return;
    if (direction === "forward") trail.current.push(step);
    setDir(direction);
    const arrive = () => {
      setStep(next);
      setPhase("in");
      window.scrollTo(0, 0);
    };
    if (reduce) return arrive();
    setPhase("out");
    timer.current = setTimeout(arrive, 170);
  }
  const forward = (opts?: { bank?: boolean }) => {
    const next = nextWelcomeStep(step, flow, opts);
    if (next) go(next);
  };
  const previous = trail.current.at(-1) ?? previousWelcomeStep(step, flow);
  const back = previous
    ? () => {
        // Pendant qu'une étape s'efface, un second appui ne compte pas (il dépilerait une étape de trop).
        if (phase === "out") return;
        trail.current.pop();
        go(previous, "back");
      }
    : undefined;

  /**
   * Fin de la présentation (finie ou passée) : l'appli s'ouvre sur `to` sans attendre le serveur, qui le retient en
   * arrière-plan — un réseau lent ne laisse personne devant un écran vide.
   */
  async function finish(to: string) {
    if (leaving || !user) return;
    setLeaving(true);
    keepStep(user.id, null);
    // Le texte s'efface, puis le coffre va se ranger dans le menu.
    if (!reduce) await new Promise((resolve) => setTimeout(resolve, 200));
    if (user.welcome) closeWelcome(qc, user.id);
    passage(() => navigate(to, { replace: true, state: { depuisBienvenue: true } }));
  }
  const skip = () => {
    if (user?.welcome) toast.message(t("Présentation passée. Tu la retrouves dans le manuel, à « Premiers pas »."));
    void finish("/");
  };

  /* ---------- Ton foyer ---------- */
  const guess = useMemo(() => guessRegion(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages), []);
  const saved = useMemo<HouseholdDraft | null>(() => (household.data ? { country: household.data.country, currency: household.data.currency, timeZone: household.data.timeZone, modulesOff: household.data.modulesOff } : null), [household.data]);
  const [draft, setDraft] = useState<HouseholdDraft | null>(null);
  useEffect(() => {
    // Proposé une fois, quand on sait ce que le foyer a déjà (réglages et comptes) ; ensuite le membre a la main.
    if (!draft && saved && count !== null) setDraft(proposedHousehold(saved, guess, count === 0));
  }, [draft, saved, count, guess]);

  async function saveHousehold() {
    const next = nextWelcomeStep("foyer", flow);
    if (!saved || !draft || !user || !next) return forward();
    const changes = householdChanges(saved, draft);
    if (!changes.settings && !changes.currency) return forward();
    setBusy(true);
    try {
      if (changes.settings) await api("/household", { method: "PUT", json: changes.settings });
      if (changes.currency) await api("/household/currency", { method: "PUT", json: { currency: changes.currency } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Réglage non enregistré"));
      setBusy(false);
      return;
    }
    // Pays ou devise changés : l'appli remonte ses écrans, cette présentation comprise. L'étape suivante est notée
    // d'abord, pour qu'elle reprenne au bon endroit.
    keepStep(user.id, next);
    setParams({ etape: next }, { replace: true, state: location.state });
    await qc.invalidateQueries({ queryKey: ["household"] });
    await qc.invalidateQueries({ queryKey: ["me"] });
    setBusy(false);
    go(next);
  }

  /* ---------- Repères ---------- */
  const [spotPick, setSpot] = useState<Spot>("menu");
  const spots: Spot[] = desktop ? ["menu", "recherche", "aide", "assistant"] : ["onglets", "tout", "outils", "assistant"];
  const spot = spots.includes(spotPick) ? spotPick : spots[0];

  /* ---------- Tes comptes ---------- */
  // L'administrateur relie l'application du foyer ; un autre membre, la sienne (comptes à son seul nom).
  const scope: BankScope = bank.data?.own || !admin ? "moi" : "foyer";
  const facts = bank.data && user ? guideFacts(bank.data, scope, user.id) : null;
  const keyed = !!facts && facts.keySaved && !facts.keyUnreadable;
  const linked = keyed && facts.consents > 0;
  const myBank = (bank.data && consentsOf(bank.data, scope, user?.id)[0]?.aspsp) ?? null;
  // L'administrateur est invité à relier la banque du foyer ; un autre membre fait d'abord le tour.
  const [choice, setChoice] = useState<Source>(admin ? "banque" : "plus-tard");
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => api<{ ai: { enabled: boolean } }>("/connections"), enabled: real && admin && step === "pret" });

  if (!user) return null;
  // La présentation règle de vraies choses (foyer, banque) : pas en démo.
  if (user.demo) return <Navigate to="/" replace />;

  const host = household.data?.members.find((m) => m.role === "admin" && m.id !== user.id)?.name ?? null;
  const progress = welcomeProgress(step, flow);

  /** Entrée au clavier : le bouton principal de l'étape, où que soit le focus hors d'un champ ou d'un bouton. */
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, summary, [role='switch'], [role='radio']")) return;
    e.currentTarget.querySelector<HTMLButtonElement>("[data-bv-primary]:not(:disabled)")?.click();
  };

  const art: Record<WelcomeStep, ReactNode> = {
    bienvenue: <ArtWelcome opened={(location.state as { arrivee?: boolean } | null)?.arrivee === true} />,
    foyer: draft ? <ArtHousehold modulesOff={draft.modulesOff} currency={draft.currency} /> : null,
    reperes: <ArtLandmarks desktop={desktop} spot={spot} />,
    comptes: <ArtAccounts bank={myBank} keyed={keyed} linked={linked} />,
    banque: <ArtAccounts bank={myBank} keyed={keyed} linked={linked} />,
    pret: <ArtReady />,
  };
  const body: Record<WelcomeStep, ReactNode> = {
    bienvenue: <StepWelcome name={user.name} host={host} admin={admin} onNext={() => forward()} />,
    foyer: <StepHousehold draft={draft} onChange={setDraft} guess={guess} locked={count !== null && count > 0} busy={busy} back={back} onNext={() => void saveHousehold()} />,
    reperes: <StepLandmarks desktop={desktop} spot={spot} onSpot={setSpot} auto={!reduce} back={back} onNext={() => forward()} />,
    comptes: (
      <StepAccounts
        admin={admin}
        institutions={accounts.data?.accounts.map((a) => a.institution) ?? null}
        linked={linked}
        choice={choice}
        onChoice={setChoice}
        demo={me.data?.demoAvailable === true}
        back={back}
        onBank={() => forward({ bank: true })}
        onLater={() => forward()}
      />
    ),
    banque: <StepBank scope={scope} linked={linked} back={back} onNext={() => forward()} />,
    pret: (
      <StepReady
        name={user.name}
        admin={admin}
        alone={(household.data?.members.length ?? 2) < 2}
        accounts={count ?? 0}
        linked={linked}
        importing={choice === "fichier" && count === 0 && !linked}
        ai={connections.data?.ai.enabled !== false}
        back={back}
        onFinish={(to) => void finish(to)}
      />
    ),
  };

  return (
    <div className="bv" data-dir={dir} data-leaving={leaving} onKeyDown={onKey}>
      <main className="bv-card" aria-label={t("Présentation de Pécule")}>
        <header className="bv-top">
          <div className="bv-progress" role="progressbar" aria-valuemin={1} aria-valuemax={progress.total} aria-valuenow={progress.index + 1} aria-label={t("Étape {n} sur {total}", { n: progress.index + 1, total: progress.total })}>
            {Array.from({ length: progress.total }, (_, i) => (
              <span key={i} data-on={i <= progress.index} />
            ))}
          </div>
          <span className="flex-1" />
          {step === "bienvenue" && <LangSelect />}
          {step !== "pret" && (
            <button type="button" onClick={skip} disabled={leaving} title={user.welcome ? t("Passer la présentation") : undefined} className="press -mr-2 rounded-full px-3 py-1.5 text-[14px] font-medium text-muted hover:text-ink">
              {user.welcome ? t("Passer") : t("Fermer")}
            </button>
          )}
        </header>
        {/* Illustration : rien à y lire ni à y toucher (le texte de l'étape dit tout). */}
        <aside className="bv-art" data-phone={ART_PHONE[step]} aria-hidden inert>
          <div key={step} className="bv-art-inner" data-phase={phase}>
            {art[step]}
          </div>
        </aside>
        <section className="bv-body">
          <div key={step} className="bv-step" data-phase={phase}>
            {body[step]}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ---------- Briques communes ---------- */

/** Titre d'une étape : il reçoit le focus à son arrivée (lecteurs d'écran, puis Entrée pour continuer). */
function Heading({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 ref={ref} tabIndex={-1} className="bv-title text-[30px] font-semibold leading-[1.08] tracking-[-0.03em] lg:text-[34px]">
      {children}
    </h1>
  );
}

type Action = { label: string; onClick: () => void; busy?: boolean; quiet?: boolean };

/** Boutons d'une étape : retour à gauche, la suite à droite (collés en bas de l'écran sur téléphone). */
function Actions({ back, primary }: { back?: () => void; primary: Action }) {
  return (
    <div className="bv-actions">
      {back && (
        <button type="button" onClick={back} aria-label={t("Retour")} title={t("Retour")} className="press grid size-12 shrink-0 place-items-center rounded-xl bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line)] lg:size-11">
          <ArrowLeft size={18} />
        </button>
      )}
      <button
        type="button"
        data-bv-primary
        onClick={primary.onClick}
        disabled={primary.busy}
        className={cn(
          "press ml-auto flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-6 text-[16px] font-semibold disabled:opacity-60 lg:h-11 lg:flex-none lg:text-[15px]",
          primary.quiet ? "bg-card text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "bg-accent text-white",
        )}
      >
        <span className="truncate">{primary.label}</span>
        {!primary.quiet && <ArrowRight size={17} className="shrink-0" />}
      </button>
    </div>
  );
}

/** Langue de Pécule pour ce membre, dès l'accueil : un membre invité n'a pas eu l'occasion de la choisir. */
function LangSelect() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  async function choose(lang: Lang) {
    if (lang === appLang() || busy) return;
    setBusy(true);
    try {
      await api("/auth/language", { method: "PUT", json: { language: lang } });
      qc.setQueryData<Me>(["me"], (me) => (me?.user ? { ...me, user: { ...me.user, language: lang } } : me));
      // La page se recharge dans la langue choisie ; la présentation reprend à la même étape.
      applyLang(lang);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Langue non enregistrée"));
      setBusy(false);
    }
  }
  return (
    <label className="focus-frame flex h-9 items-center gap-1.5 rounded-full pl-2.5 text-[14px] font-medium text-muted">
      <Globe size={15} className="shrink-0" />
      <select value={appLang()} disabled={busy} onChange={(e) => void choose(e.target.value as Lang)} aria-label={t("Langue")} className="bg-transparent py-1 outline-none">
        {LANGS.map((l) => (
          <option key={l.id} value={l.id} lang={l.id}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ---------- 1. Bienvenue ---------- */

function StepWelcome({ name, host, admin, onNext }: { name: string; host: string | null; admin: boolean; onNext: () => void }) {
  const desktop = useDesktop();
  const points: [LucideIcon, string][] = [
    [Eye, t("Pécule ne fait que lire tes comptes : aucun paiement n'en part.")],
    desktop ? [Server, t("Tes données vivent sur cet ordinateur, pas chez un éditeur.")] : [Server, t("Tes données vivent sur le serveur de ton foyer, pas chez un éditeur.")],
    desktop ? [Users, t("Chaque membre du foyer a son mot de passe et sa propre vue.")] : [Users, t("Chaque membre du foyer a sa clé d'accès et sa propre vue.")],
  ];
  return (
    <>
      <Heading>{t("Bienvenue, {nom}.", { nom: name })}</Heading>
      <p className={lead}>
        {admin || !host
          ? t("Pécule réunit les finances de ton foyer au même endroit : comptes, budget, patrimoine, papiers. Deux minutes pour le régler à ta main.")
          : t("{hote} t'ouvre le Pécule du foyer : comptes, budget, patrimoine et papiers, au même endroit. Deux minutes pour t'y retrouver.", { hote: host })}
      </p>
      <ul className="mt-7 space-y-3.5">
        {points.map(([Icon, text]) => (
          <li key={text} className="flex items-start gap-3 text-[15px]">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Icon size={16} />
            </span>
            <span className="pt-1 leading-snug">{text}</span>
          </li>
        ))}
      </ul>
      <Actions primary={{ label: t("Commencer"), onClick: onNext }} />
    </>
  );
}

/* ---------- 2. Ton foyer (administrateur) ---------- */

function StepHousehold({ draft, onChange, guess, locked, busy, back, onNext }: { draft: HouseholdDraft | null; onChange: (d: HouseholdDraft) => void; guess: Region; locked: boolean; busy: boolean; back?: () => void; onNext: () => void }) {
  const countries = useMemo(
    () =>
      Object.keys(COUNTRIES)
        .map((code) => ({ code, name: countryName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale())),
    [],
  );
  const select = "w-full rounded-lg border border-line bg-card px-2.5 py-2 text-[15px] text-ink lg:text-sm";
  // Le fuseau suit le pays. Il n'est montré que s'il s'en écarte (celui du navigateur n'est pas le fuseau habituel du
  // pays) : rien n'est enregistré que le membre n'ait eu sous les yeux. Une fois montré, il reste.
  const [zoneShown, setZoneShown] = useState(false);
  const zone = draft && !locked ? draft.timeZone : null;
  const usualZone = draft ? regionOf(draft.country).timeZone : null;
  if (zone && !zoneShown && zone !== usualZone) setZoneShown(true);
  const zones = useMemo(() => (zone ? [...new Set([zone, ...timeZones()])].sort() : []), [zone]);
  const toggle = (m: ModuleId) => draft && onChange({ ...draft, modulesOff: draft.modulesOff.includes(m) ? draft.modulesOff.filter((x) => x !== m) : [...draft.modulesOff, m] });
  return (
    <>
      <Heading>{t("Ton foyer")}</Heading>
      <p className={lead}>{t("Deux réglages qui valent pour tout le foyer.")}</p>
      {draft ? (
        <div className="mt-6 space-y-6">
          <section>
            <h2 className={sectionTitle}>{t("Où vis-tu ?")}</h2>
            {locked ? (
              <div className="card px-4 py-3">
                <span className="block text-[15px] font-medium">
                  {countryName(draft.country)} · {currencyName(draft.currency)}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{t("Le foyer a déjà des comptes : le pays et la devise se changent dans Réglages → Foyer, qui dit d'abord ce qui sera recalculé.")}</span>
              </div>
            ) : (
              <div className="card grid gap-x-4 gap-y-3 px-4 py-3.5 sm:grid-cols-2">
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-[13px] font-medium">{t("Pays")}</span>
                  <select value={draft.country} onChange={(e) => onChange(draftWithCountry(draft, e.target.value, guess))} className={select}>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block min-w-0">
                  <span className="mb-1.5 block text-[13px] font-medium">{t("Devise du foyer")}</span>
                  <CurrencySelect value={draft.currency} onChange={(currency) => onChange({ ...draft, currency })} className={select} label={t("Devise du foyer")} />
                </label>
                {zoneShown && (
                  <label className="block min-w-0 sm:col-span-2">
                    <span className="mb-1.5 block text-[13px] font-medium">{t("Fuseau horaire")}</span>
                    <select value={draft.timeZone} onChange={(e) => onChange({ ...draft, timeZone: e.target.value })} className={select}>
                      {zones.map((z) => (
                        <option key={z} value={z}>
                          {z.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                    <span className="mt-1.5 block text-xs text-muted">{t("Il dit quel jour on est : échéances, notifications, résumé du lundi.")}</span>
                  </label>
                )}
              </div>
            )}
          </section>
          <section>
            <h2 className={sectionTitle}>{t("Que veux-tu suivre ?")}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {MODULES.map((m) => {
                const on = !draft.modulesOff.includes(m);
                const Icon = MODULE_ICON[m];
                return (
                  <button key={m} type="button" role="switch" aria-checked={on} onClick={() => toggle(m)} className="press card flex items-center gap-3 px-3.5 py-2.5 text-left">
                    <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl transition-colors", on ? "bg-accent-soft text-accent" : "bg-line/50 text-muted")}>
                      <Icon size={17} />
                    </span>
                    <span className={cn("min-w-0 flex-1 transition-opacity", !on && "opacity-55")}>
                      <span className="block text-[15px] font-medium leading-tight">{t(MODULE_INFO[m].label)}</span>
                      <span className="block text-xs leading-snug text-muted">{t(MODULE_INFO[m].hint)}</span>
                    </span>
                    <span aria-hidden className={cn("grid size-[22px] shrink-0 place-items-center rounded-full transition-colors", on ? "bg-accent text-white" : "shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-muted)_45%,transparent)]")}>
                      {on && <Check size={13} strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-xs text-muted">{t("Un écran décoché sort du menu, ses données restent. À revoir dans Réglages → Foyer.")}</p>
          </section>
        </div>
      ) : (
        <div className="mt-6 space-y-3" role="status" aria-label={t("Chargement…")}>
          <div className="skeleton h-28 rounded-[var(--radius-card)]" />
          <div className="skeleton h-40 rounded-[var(--radius-card)]" />
        </div>
      )}
      <Actions back={back} primary={{ label: t("Continuer"), onClick: onNext, busy: busy || !draft }} />
    </>
  );
}

/* ---------- 3. Pour t'y retrouver ---------- */

function StepLandmarks({ desktop, spot, onSpot, auto, back, onNext }: { desktop: boolean; spot: Spot; onSpot: (s: Spot) => void; auto: boolean; back?: () => void; onNext: () => void }) {
  const nav = useNav();
  const list = (items: string[]) => new Intl.ListFormat(locale(), { type: "conjunction" }).format(items);
  const mac = /Mac|iPhone|iPad/.test(navigator.userAgent);
  const rows: { id: Spot; icon: LucideIcon; title: string; text: string }[] = desktop
    ? [
        { id: "menu", icon: PanelLeft, title: t("Le menu"), text: t("À gauche, tous les écrans, rangés par familles : {familles}.", { familles: list(nav.flatMap((g) => (g.title ? [g.title] : []))) }) },
        { id: "recherche", icon: Search, title: t("La recherche"), text: t("{touche} trouve tout : un écran, une opération, une facture, un article du manuel.", { touche: mac ? "⌘K" : "Ctrl+K" }) },
        { id: "aide", icon: CircleHelp, title: t("Le « ? »"), text: t("En haut de chaque écran, il ouvre la page du manuel qui l'explique.") },
        { id: "assistant", icon: Sparkles, title: t("L'assistant"), text: t("Pose-lui une question sur tes chiffres ou sur l'appli. Il n'écrit rien sans ta confirmation.") },
      ]
    : [
        { id: "onglets", icon: PanelBottom, title: t("Les onglets"), text: t("En bas, les écrans de tous les jours : {onglets}.", { onglets: list([t("Accueil"), t("Opérations"), t("Mois"), t("Patrimoine")]) }) },
        { id: "tout", icon: LayoutGrid, title: t("Tout Pécule"), text: t("Le bouton en haut à gauche ouvre tous les autres écrans.") },
        { id: "outils", icon: Search, title: t("La loupe et le « ? »"), text: t("En haut à droite : chercher partout, et ouvrir l'aide de l'écran affiché.") },
        { id: "assistant", icon: Sparkles, title: t("L'assistant"), text: t("Le bouton au centre, en bas. Il n'écrit rien sans ta confirmation.") },
      ];
  // Les repères défilent d'eux-mêmes tant que le membre n'en a pas choisi un.
  const [touched, setTouched] = useState(false);
  const ids = rows.map((r) => r.id).join();
  useEffect(() => {
    if (!auto || touched) return;
    const order = ids.split(",") as Spot[];
    const timer = setTimeout(() => onSpot(order[(order.indexOf(spot) + 1) % order.length]), 3400);
    return () => {
      clearTimeout(timer);
    };
  }, [auto, touched, spot, ids, onSpot]);
  const pick = (id: Spot) => {
    setTouched(true);
    onSpot(id);
  };
  return (
    <>
      <Heading>{t("Pour t'y retrouver")}</Heading>
      <p className={lead}>{t("Quatre repères, et tu es chez toi.")}</p>
      <ul className="mt-4 space-y-1 lg:mt-5 lg:space-y-1.5">
        {rows.map((r) => {
          const on = r.id === spot;
          return (
            <li key={r.id}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => pick(r.id)}
                onMouseEnter={() => pick(r.id)}
                onFocus={() => pick(r.id)}
                className={cn("press flex w-full items-start gap-3 rounded-2xl px-3 py-2.5 text-left transition-[background-color,box-shadow] duration-300", on ? "bg-card shadow-[0_1px_1px_rgb(20_20_19/0.04),0_10px_24px_-14px_rgb(20_20_19/0.22)] lg:bg-bg lg:shadow-none" : "hover:bg-card/60 lg:hover:bg-bg/60")}
              >
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl transition-colors duration-300", on ? "bg-accent text-white" : "bg-accent-soft text-accent")}>
                  <r.icon size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15.5px] font-semibold leading-snug">{r.title}</span>
                  <span className="block text-[14px] leading-snug text-muted">{r.text}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Actions back={back} primary={{ label: t("Continuer"), onClick: onNext }} />
    </>
  );
}

/* ---------- 4. Tes comptes ---------- */

type Source = "banque" | "fichier" | "plus-tard";

function StepAccounts({
  admin,
  institutions,
  linked,
  choice,
  onChoice,
  demo,
  back,
  onBank,
  onLater,
}: {
  admin: boolean;
  /** Banques des comptes que le foyer suit déjà (null : pas encore lu). */
  institutions: (string | null)[] | null;
  linked: boolean;
  choice: Source;
  onChoice: (c: Source) => void;
  demo: boolean;
  back?: () => void;
  onBank: () => void;
  onLater: () => void;
}) {
  const qc = useQueryClient();
  const question = useId();
  const [entering, setEntering] = useState(false);
  async function seeDemo() {
    setEntering(true);
    try {
      await enterDemo(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Mode démo indisponible"));
      setEntering(false);
    }
  }

  if (institutions === null)
    return (
      <>
        <Heading>{t("Tes comptes")}</Heading>
        <div className="mt-6 space-y-3" role="status" aria-label={t("Chargement…")}>
          <div className="skeleton h-24 rounded-[var(--radius-card)]" />
          <div className="skeleton h-20 rounded-[var(--radius-card)]" />
        </div>
        <Actions back={back} primary={{ label: t("Continuer"), onClick: onLater, busy: true }} />
      </>
    );

  // Le foyer suit déjà des comptes : rien d'obligatoire ici, seulement de quoi relier les siens.
  if (institutions.length > 0) {
    const banks = [...new Set(institutions.filter((b): b is string => !!b))];
    return (
      <>
        <Heading>{t("Tes comptes")}</Heading>
        <p className={lead}>{tn("Le foyer suit déjà {n} compte dans Pécule.", "Le foyer suit déjà {n} comptes dans Pécule.", institutions.length)}</p>
        <div className="mt-6 space-y-3">
          {banks.length > 0 && (
            <div className="card flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3.5">
              {banks.slice(0, 5).map((b) => (
                <span key={b} className="flex min-w-0 items-center gap-2 text-[14.5px] font-medium">
                  <BankBadge bank={b} size="sm" /> <span className="truncate">{b}</span>
                </span>
              ))}
              {banks.length > 5 && <span className="text-[13px] text-muted">+ {banks.length - 5}</span>}
            </div>
          )}
          <button type="button" onClick={onBank} className="press card flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
              <Landmark size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15.5px] font-semibold leading-snug">{linked ? t("Relier une autre banque") : admin ? t("Relier une banque") : t("Des comptes à ton seul nom ?")}</span>
              <span className="block text-[13.5px] leading-snug text-muted">
                {admin ? t("Par Enable Banking : lecture seule, gratuit pour un usage personnel.") : t("Relie-les avec ta propre application Enable Banking. Les comptes communs, eux, sont suivis par le foyer.")}
              </span>
            </span>
            <ChevronRight size={18} className="shrink-0 text-muted" />
          </button>
        </div>
        <Actions back={back} primary={{ label: t("Continuer"), onClick: onLater }} />
      </>
    );
  }

  const options: { id: Source; icon: LucideIcon; title: string; text: string; badge?: string }[] = [
    {
      id: "banque",
      icon: Landmark,
      title: admin ? t("Relier ma banque") : t("Relier mes comptes"),
      badge: admin ? t("Recommandé") : undefined,
      text: admin
        ? t("Pécule lit tes comptes chez ta banque, par son interface officielle (Enable Banking). Lecture seule, gratuit pour un usage personnel, à jour tout seul. Compte dix minutes.")
        : t("Avec ta propre application Enable Banking, pour les comptes à ton nom : lecture seule, gratuit pour un usage personnel. Compte dix minutes."),
    },
    { id: "fichier", icon: FileUp, title: t("Importer un fichier de ma banque"), text: t("L'export OFX, QIF ou CSV de ton espace client : rien à relier, à refaire de temps en temps.") },
    { id: "plus-tard", icon: Clock, title: t("Plus tard"), text: t("Fais d'abord le tour : la carte « Bien démarrer » de l'accueil t'y ramènera.") },
  ];
  // Un fichier à importer : la présentation se termine, et sa dernière étape y mène.
  const run = choice === "banque" ? onBank : onLater;
  // Comme des boutons radio : un seul arrêt de tabulation, les flèches changent de choix (le focus suit), Entrée continue.
  const onKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      return run();
    }
    const move = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 0;
    if (!move) return;
    e.preventDefault();
    const next = options[(options.findIndex((o) => o.id === choice) + move + options.length) % options.length];
    onChoice(next.id);
    e.currentTarget.querySelector<HTMLElement>(`[data-choice="${next.id}"]`)?.focus();
  };
  return (
    <>
      <Heading>{t("Tes comptes")}</Heading>
      <p id={question} className={lead}>
        {admin ? t("Il manque l'essentiel : tes opérations. D'où viendront-elles ?") : t("Le foyer n'a pas encore de compte dans Pécule. D'où viendront tes opérations ?")}
      </p>
      <div className="mt-6 space-y-2.5" role="radiogroup" aria-labelledby={question} onKeyDown={onKeys}>
        {options.map((o) => {
          const on = o.id === choice;
          return (
            <button key={o.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-choice={o.id} onClick={() => onChoice(o.id)} onDoubleClick={run} className="press bv-choice card flex w-full items-start gap-3 px-4 py-3.5 text-left">
              <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl transition-colors duration-200", on ? "bg-accent text-white" : "bg-accent-soft text-accent")}>
                <o.icon size={19} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-[15.5px] font-semibold leading-snug">{o.title}</span>
                  {o.badge && <span className="chip text-[11.5px]">{o.badge}</span>}
                </span>
                <span className="mt-0.5 block text-[13.5px] leading-snug text-muted">{o.text}</span>
              </span>
              <span aria-hidden className={cn("mt-1 grid size-5 shrink-0 place-items-center rounded-full transition-colors duration-200", on ? "bg-accent text-white" : "shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-muted)_45%,transparent)]")}>
                {on && <span className="size-2 rounded-full bg-current" />}
              </span>
            </button>
          );
        })}
      </div>
      {demo && (
        <button type="button" onClick={() => void seeDemo()} disabled={entering} className="press -mx-1 mt-4 flex items-center gap-2 self-start rounded-lg px-1 py-1 text-[14px] font-medium text-accent disabled:opacity-60">
          <Presentation size={16} /> {t("Voir Pécule rempli, avec une famille fictive")}
        </button>
      )}
      <Actions back={back} primary={{ label: t("Continuer"), onClick: run }} />
    </>
  );
}

/* ---------- 4 bis. Relier ta banque (guide Enable Banking) ---------- */

function StepBank({ scope, linked, back, onNext }: { scope: BankScope; linked: boolean; back?: () => void; onNext: () => void }) {
  // Retour de la banque : le serveur a laissé le résultat dans un témoin.
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const outcome = takeBankOutcome();
    if (outcome === "reliee") toast.success(t("Banque reliée. La première lecture est en cours."));
    else if (outcome) setFailed(true);
  }, []);
  return (
    <>
      <Heading>{t("Relier ta banque")}</Heading>
      <p className={lead}>
        {scope === "moi"
          ? t("Pour les comptes à ton seul nom, il te faut ta propre application Enable Banking, créée avec ton adresse mail : l'usage gratuit ne couvre que les comptes de la personne inscrite.")
          : t("Enable Banking est un prestataire agréé : il lit tes comptes auprès de ta banque, avec ton accord, sans jamais pouvoir y toucher. Chaque foyer y crée sa propre application, gratuite pour un usage personnel.")}
      </p>
      <div className="mt-6 space-y-4">
        {failed && !linked && (
          <p role="alert" className={warnBox}>
            <TriangleAlert size={16} className="mt-px shrink-0" /> <span>{t("La liaison avec la banque n'a pas abouti. Relance-la et valide sans attendre.")}</span>
          </p>
        )}
        <BankGuide scope={scope} from="bienvenue" />
      </div>
      <Actions back={back} primary={linked ? { label: t("Continuer"), onClick: onNext } : { label: t("Plus tard"), onClick: onNext, quiet: true }} />
    </>
  );
}

/* ---------- 5. C'est parti ---------- */

function StepReady({
  name,
  admin,
  alone,
  accounts,
  linked,
  importing,
  ai,
  back,
  onFinish,
}: {
  name: string;
  admin: boolean;
  alone: boolean;
  accounts: number;
  linked: boolean;
  /** Le membre a choisi d'importer un fichier de sa banque : c'est ce qu'il lui reste à faire en sortant. */
  importing: boolean;
  ai: boolean;
  back?: () => void;
  onFinish: (to: string) => void;
}) {
  const desktop = useDesktop();
  // L'appli de bureau ne s'ouvre que sur cet ordinateur : rien à installer sur un téléphone.
  const installed = desktop || window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const all: (false | { icon: LucideIcon; title: string; text: string; to: string })[] = [
    // La visite guidée : le menu et les outils, montrés dans l'appli elle-même dès qu'on y entre.
    { icon: Compass, title: t("Suivre la visite guidée"), text: t("Le menu et les outils de l'appli, éclairés un à un dans l'appli elle-même."), to: TOUR_LINK },
    accounts > 0 && { icon: Tags, title: t("Classer tes opérations"), text: t("Pécule retient tes choix et classe les suivantes de lui-même."), to: "/tri" },
    admin && !ai && { icon: Sparkles, title: t("Brancher l'assistant"), text: t("Facultatif : avec ta propre clé d'IA, Pécule lit tes factures et répond à tes questions."), to: "/reglages/connexions?c=ia" },
    admin && alone && { icon: UserPlus, title: t("Inviter un autre adulte"), text: desktop ? t("À chacun son mot de passe et sa vue du foyer.") : t("À chacun sa clé d'accès et sa vue du foyer."), to: "/reglages/compte" },
    !installed && { icon: Smartphone, title: t("Installer Pécule sur ton téléphone"), text: t("Sur l'écran d'accueil, il s'ouvre comme une appli et peut te prévenir."), to: "/manuel/installer-telephone" },
    { icon: Palette, title: t("Mettre Pécule à ton goût"), text: t("Clair ou sombre, couleur, thèmes de l'année."), to: "/reglages/apparence" },
  ];
  const tiles = all.filter((x) => x !== false).slice(0, 3);
  return (
    <>
      <Heading>{t("Tout est prêt, {nom}.", { nom: name })}</Heading>
      <p className={lead}>
        {accounts > 0
          ? t("Tes comptes sont là. Pécule classe ce qu'il reconnaît ; le reste t'attend dans « À classer ».")
          : linked
            ? t("Ta banque est reliée : la première lecture prend quelques minutes, tes comptes arrivent.")
            : importing
              ? t("Ton Pécule est réglé. Il ne reste qu'à déposer l'export de ta banque : ses opérations arrivent aussitôt.")
              : t("Ton Pécule est réglé. Il ne lui manque que tes comptes : la carte « Bien démarrer » de l'accueil t'y ramènera.")}
      </p>
      <section className="mt-6">
        <h2 className={sectionTitle}>{t("Et ensuite ?")}</h2>
        <div className="space-y-2">
          {tiles.map((x) => (
            <button key={x.to} type="button" onClick={() => onFinish(x.to)} className="press card flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                <x.icon size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold leading-snug">{x.title}</span>
                <span className="block text-[13.5px] leading-snug text-muted">{x.text}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted" />
            </button>
          ))}
        </div>
        <p className="mt-3 px-1 text-xs text-muted">{t("Cette présentation se revoit quand tu veux, depuis le manuel.")}</p>
      </section>
      <Actions back={back} primary={importing ? { label: t("Importer mon fichier"), onClick: () => onFinish("/reglages/connexions?c=fichiers") } : { label: t("Découvrir mon Pécule"), onClick: () => onFinish("/") }} />
    </>
  );
}
