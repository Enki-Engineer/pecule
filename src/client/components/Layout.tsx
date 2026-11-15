import { toggleDiscreet, useDiscreet } from "../discret.ts";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { AssistantChat } from "../screens.tsx";
import { HelpLink } from "./HelpLink.tsx";
import { DemoBadge } from "./DemoBadge.tsx";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, BookOpen, CalendarCheck, ChevronLeft, ChevronRight, Eye, EyeOff, House, ListOrdered, PanelLeftClose, PanelLeftOpen, PieChart, PiggyBank, RefreshCw, Search, Settings, Sparkles } from "lucide-react";
import { Spinner } from "./ui.tsx";
import { cn } from "../cn.ts";
import { api, useMe, useMonth, useSync } from "../api.ts";
import { useTheme } from "../theme.ts";
import { CommandPalette, openPalette } from "./CommandPalette.tsx";
import { PANEL_MEDIA } from "../assistantBus.ts";
import { DrillDrawer } from "./DrillDrawer.tsx";
import { InvoiceViewer } from "./InvoiceViewer.tsx";
import { Shortcuts } from "./Shortcuts.tsx";
import { currentPeriodMonth, monthOfPeriod, shiftMonth, useCurrentCrumb, usePeriod, useRail, useScope } from "../shell.ts";
import { isYearPeriod, PERIOD_RE, shiftPeriod } from "../../lib/periods.ts";
import { COUNT_LINKS, type Counts } from "../nav.ts";
import { useModulesOff, useNav } from "../modules.ts";
import { pathEnabled } from "../../lib/modules.ts";
import { scopeApplies } from "../../lib/scope.ts";
import { screenKey } from "../../lib/ops-tabs.ts";
import { NavTracker, PullToRefresh, isTopLevel, useBack, useEdgeSwipeBack } from "./MobileShell.tsx";
import { useMedia } from "../useMedia.ts";
import { SeasonDecor } from "./SeasonDecor.tsx";
import { FetchingBar } from "./FetchingBar.tsx";
import { applyAppearance } from "../theme.ts";
import { AppLogo } from "./AppLogo.tsx";
import { useBirthdays } from "../birthdays.ts";
import { periodLabel } from "../format.ts";
import { t, tn } from "../../lib/i18n.ts";

/*
 * Coquille de l'appli. Ordinateur (≥ 768 px) : menu latéral compact et repliable (⌘\\) avec compteurs,
 * barre supérieure (fil d'Ariane, période, Foyer / Moi, recherche, synchro, assistant), contenu
 * pleine largeur, panneau assistant à droite (≥ 1280 px, ⌘J), transitions d'écran.
 * iPhone (phase 16) : 4 onglets et l'assistant au centre, barre du haut avec retour ou menu
 * (MobileShell), écrans qui glissent selon le sens de la navigation, retour par balayage, tirer pour actualiser.
 */

/** Fil d'Ariane : section et page d'après l'adresse ; la fiche ouverte ajoute son nom (useCrumb). */
const CRUMBS: [RegExp, { label: string; to?: string }[]][] = [
  [/^\/$/, [{ label: t("Tableau de bord") }]],
  [/^\/operations/, [{ label: t("Au quotidien") }, { label: t("Opérations"), to: "/operations" }]],
  [/^\/mois/, [{ label: t("Au quotidien") }, { label: t("Analyse"), to: "/mois" }]],
  [/^\/budget/, [{ label: t("Au quotidien") }, { label: t("Budget"), to: "/budget" }]],
  [/^\/factures/, [{ label: t("Au quotidien") }, { label: t("Factures"), to: "/factures" }]],
  [/^\/patrimoine\/crypto/, [{ label: t("Patrimoine"), to: "/patrimoine" }, { label: t("Crypto"), to: "/patrimoine/crypto" }]],
  [/^\/patrimoine/, [{ label: t("Patrimoine") }, { label: t("Vue d'ensemble"), to: "/patrimoine" }]],
  [/^\/immobilier/, [{ label: t("Patrimoine"), to: "/patrimoine" }, { label: t("Immobilier"), to: "/immobilier" }]],
  [/^\/credits/, [{ label: t("Patrimoine"), to: "/patrimoine" }, { label: t("Crédits"), to: "/patrimoine" }]],
  [/^\/projections/, [{ label: t("Patrimoine"), to: "/patrimoine" }, { label: t("Projections"), to: "/projections" }]],
  [/^\/objectifs/, [{ label: t("Patrimoine"), to: "/patrimoine" }, { label: t("Objectifs"), to: "/objectifs" }]],
  [/^\/tri/, [{ label: t("Au quotidien") }, { label: t("Opérations"), to: "/operations" }, { label: t("À classer"), to: "/tri" }]],
  [/^\/comparer/, [{ label: t("Au quotidien") }, { label: t("Analyse"), to: "/mois" }, { label: t("Comparer"), to: "/comparer" }]],
  [/^\/revenus/, [{ label: t("Situation") }, { label: t("Revenus"), to: "/revenus" }]],
  [/^\/impots/, [{ label: t("Situation") }, { label: t("Impôts"), to: "/impots" }]],
  [/^\/retraite/, [{ label: t("Situation") }, { label: t("Retraite"), to: "/retraite" }]],
  [/^\/documents/, [{ label: t("Documents") }, { label: t("Coffre"), to: "/documents" }]],
  [/^\/echeancier/, [{ label: t("Documents") }, { label: t("Échéancier"), to: "/echeancier" }]],
  [/^\/manuel/, [{ label: t("Manuel"), to: "/manuel" }]],
  [/^\/reglages/, [{ label: t("Réglages"), to: "/reglages" }]],
  [/^\/assistant/, [{ label: t("Assistant") }]],
];

const PANEL_KEY = "pecule.assistant.panel";
const useWideScreen = () => {
  const [wide, setWide] = useState(() => window.matchMedia(PANEL_MEDIA).matches);
  useEffect(() => {
    const mq = window.matchMedia(PANEL_MEDIA);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => {
      mq.removeEventListener("change", on);
    };
  }, []);
  return wide;
};

export function Layout() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  useTheme(); // applique le thème choisi et suit le système en mode « auto »
  useBirthdays(); // anniversaires du foyer recopiés sur l'appareil : le thème du jour J s'applique dès l'ouverture
  // Couleur et saison : déjà posées par theme-init.js ; recalculées si l'appli reste ouverte d'un jour à l'autre.
  useEffect(() => {
    applyAppearance();
    const t = setInterval(applyAppearance, 3600_000);
    return () => clearInterval(t);
  }, []);
  const modulesOff = useModulesOff();
  const xl = useWideScreen();
  const mobile = !useMedia("(min-width: 768px)");
  const top = isTopLevel(pathname);
  const pageRef = useRef<HTMLDivElement>(null);
  const { back } = useBack();
  const backRef = useRef(back);
  backRef.current = back;
  const stableBack = useRef(() => backRef.current()).current;
  useEdgeSwipeBack(pageRef, mobile && !top, stableBack);
  const [rail, setRail] = useRail();
  const [panel, setPanel] = useState(() => localStorage.getItem(PANEL_KEY) === "1");
  const [prefill, setPrefill] = useState<string | undefined>();
  // Sur ordinateur, l'adresse /assistant est le plein écran de l'assistant : la même conversation que le panneau,
  // déployée par-dessus l'appli (le bouton Précédent du navigateur en sort).
  const full = !mobile && pathname === "/assistant";
  const panelOpen = xl && panel && !full;
  // Les fenêtres (fiches) laissent le panneau de l'assistant libre : on peut lui parler de ce qui est ouvert.
  useEffect(() => {
    document.documentElement.style.setProperty("--assistant-panel", panelOpen ? "400px" : "0px");
  }, [panelOpen]);
  // En plein écran, l'appli derrière ne défile pas.
  useEffect(() => {
    if (!full) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [full]);

  const togglePanel = (open = !panel) => {
    setPanel(open);
    localStorage.setItem(PANEL_KEY, open ? "1" : "0");
  };
  // Écran d'où l'on est passé en plein écran : on y revient en le quittant.
  const lastScreen = useRef("/");
  useEffect(() => {
    if (pathname !== "/assistant") lastScreen.current = pathname + search;
  }, [pathname, search]);
  /** Quitte le plein écran : vers le panneau (écran assez large), sinon l'assistant se ferme. */
  const leaveFull = (toPanel: boolean) => {
    togglePanel(toPanel && xl);
    navigate(lastScreen.current);
  };
  const enterFull = () => {
    // En sortant par un lien de la réponse, la conversation reste à portée de main dans le panneau.
    if (xl) togglePanel(true);
    navigate("/assistant");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        // ⌘⇧J : plein écran ; ⌘J : panneau (ou plein écran quand la fenêtre est trop étroite pour le panneau).
        if (full) leaveFull(true);
        else if (e.shiftKey || !xl) enterFull();
        else togglePanel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setRail(!rail);
      }
    };
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (full) setPrefill(q);
      else if (xl) {
        togglePanel(true);
        setPrefill(q);
      } else navigate(q ? `/assistant?q=${encodeURIComponent(q)}` : "/assistant");
    };
    // Conversation existante (résumé de la semaine) : panneau sur grand écran, page sinon.
    const onThread = () => {
      if (full) return;
      if (xl) togglePanel(true);
      else navigate("/assistant");
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pecule-ask", onAsk);
    window.addEventListener("pecule-thread", onThread);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pecule-ask", onAsk);
      window.removeEventListener("pecule-thread", onThread);
    };
  });

  return (
    <div
      className={cn(
        "md:grid",
        rail ? "md:grid-cols-[60px_minmax(0,1fr)]" : "md:grid-cols-[228px_minmax(0,1fr)]",
        panelOpen && (rail ? "xl:grid-cols-[60px_minmax(0,1fr)_400px]" : "xl:grid-cols-[228px_minmax(0,1fr)_400px]"),
      )}
    >
      <Sidebar rail={rail} onRail={() => setRail(!rail)} xl={xl} panelOpen={panelOpen} onAssistant={() => togglePanel()} />

      <div className="min-w-0">
        <TopBar onAssistant={() => (xl ? togglePanel() : navigate("/assistant"))} panelOpen={panelOpen} />
        <main
          // Même zone pour tous les écrans : le titre ne change jamais de place. Un écran qui se lit mieux
          // en colonne (conversation, réglages) limite lui-même la largeur de son contenu.
          className="main-content mx-auto w-full min-w-0 max-w-[1600px] px-4 pb-28 md:px-8 md:pb-12 md:pt-6"
        >
          <div key={screenKey(pathname)} ref={pageRef} className="page-enter">
            <Suspense fallback={<Spinner />}>
              {/* Un écran retiré par le foyer ramène à l'accueil, même ouvert par son adresse. */}
              {pathEnabled(pathname, modulesOff) ? <Outlet /> : <Navigate to="/" replace />}
            </Suspense>
          </div>
        </main>
      </div>

      {/* Assistant sur ordinateur : panneau à droite (≥ 1280 px) ou plein écran (/assistant). Le même élément porte
          les deux formes : passer de l'une à l'autre garde la conversation et la réponse en cours. */}
      {(panelOpen || full) && (
        <aside className={full ? "chat-full fixed inset-0 z-50 bg-bg" : "sticky top-0 hidden h-screen border-l border-line bg-card xl:block"}>
          <Suspense fallback={<Spinner label={t("Ouverture de l'assistant…")} />}>
            {full ? (
              <AssistantChat variant="full" prefill={new URLSearchParams(search).get("q") ?? prefill} onClose={() => leaveFull(false)} onReduce={xl ? () => leaveFull(true) : undefined} />
            ) : (
              <AssistantChat variant="panel" prefill={prefill} onClose={() => togglePanel(false)} onExpand={enterFull} />
            )}
          </Suspense>
        </aside>
      )}

      <NavTracker />
      <FetchingBar />
      <SeasonDecor />
      <PullToRefresh enabled={mobile && top && pathname !== "/assistant"} />
      <CommandPalette />
      <DrillDrawer />
      <InvoiceViewer />
      <Shortcuts />

      {/* Barre d'onglets (mobile) : 4 onglets et l'assistant au centre ; Factures est dans Opérations, Réglages dans l'accueil. */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 bg-card/90 shadow-[0_-1px_0_var(--color-line)] backdrop-blur-xl md:hidden">
        <div className="mx-auto flex max-w-lg items-center justify-around pt-1">
          {mobileTabs.slice(0, 2).map((t) => (
            <MobileTab key={t.to} tab={t} active={t.match(pathname)} />
          ))}
          <Link
            to="/assistant"
            data-tab
            aria-label={t("Assistant")}
            className={cn(
              "grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-[0_6px_16px_color-mix(in_srgb,var(--color-accent)_35%,transparent)] transition-transform duration-150 active:scale-90",
              pathname === "/assistant" ? "bg-ink" : "bg-accent",
            )}
          >
            <Sparkles size={22} />
          </Link>
          {mobileTabs.slice(2).map((t) => (
            <MobileTab key={t.to} tab={t} active={t.match(pathname)} />
          ))}
        </div>
      </nav>
    </div>
  );
}

/* ---------- Menu latéral (ordinateur) ---------- */

const navItem = (active: boolean, rail: boolean) =>
  cn(
    "group relative flex h-9 items-center gap-2.5 rounded-xl text-[14px] font-medium transition-colors",
    rail ? "justify-center px-0" : "px-2.5",
    active ? "bg-card font-semibold text-ink shadow-[0_1px_1px_rgb(20_20_19/0.04),0_6px_16px_-10px_rgb(20_20_19/0.18)] [&>svg]:text-accent" : "text-muted hover:bg-card/70 hover:text-ink",
  );

function Sidebar({ rail, onRail, xl, panelOpen, onAssistant }: { rail: boolean; onRail: () => void; xl: boolean; panelOpen: boolean; onAssistant: () => void }) {
  const me = useMe();
  const nav = useNav();
  const counts = useQuery({ queryKey: ["nav-counts"], queryFn: () => api<Counts>("/nav-counts"), refetchInterval: 120_000, staleTime: 60_000 });
  // Compteur d'une entrée : en menu replié, un point ; sinon un lien à part, qui ouvre l'écran déjà filtré sur ce qu'il compte.
  const dot = (key?: keyof Counts) => (rail && key && counts.data?.[key] ? <span className="absolute right-1.5 top-1 size-2 rounded-full bg-accent" /> : null);
  const badge = (key?: keyof Counts) => {
    const n = key ? (counts.data?.[key] ?? 0) : 0;
    if (!key || !n || rail) return null;
    const link = COUNT_LINKS[key];
    const danger = key === "tasksOverdue" || key === "alerts" || key === "lowBalance";
    return (
      <Link
        to={link.to}
        viewTransition
        title={link.label(n)}
        aria-label={link.label(n)}
        className={cn(
          "absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums transition-colors",
          danger ? "bg-neg/10 text-neg hover:bg-neg hover:text-white" : "bg-accent-soft text-accent hover:bg-accent hover:text-white",
        )}
      >
        {n}
      </Link>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-screen flex-col overflow-y-auto bg-bg px-3 pb-3 pt-4 md:flex">
      <Link to="/" viewTransition className={cn("mb-3 flex h-8 items-center gap-2", rail ? "justify-center" : "px-1.5")}>
        <AppLogo className="size-7 rounded-md" />
        {!rail && <span className="text-[18px] font-semibold tracking-tight">Pécule</span>}
      </Link>
      {nav.map((g, i) => (
        <div key={i} className="mb-2">
          {g.title && !rail && <div className="px-2.5 pb-1 pt-3 text-[12px] font-medium text-muted">{g.title}</div>}
          {g.title && rail && <div className="mx-3 my-2 border-t border-line" />}
          {g.items.map((it) => (
            <div key={it.to} className="relative">
              <NavLink to={it.to} end={it.end} viewTransition title={rail ? it.label : undefined} className={({ isActive }) => cn(navItem(isActive, rail), !rail && it.count && counts.data?.[it.count] ? "pr-10" : null)}>
                <it.icon size={16} strokeWidth={2} className="shrink-0" />
                {!rail && <span className="truncate">{it.label}</span>}
                {dot(it.count)}
              </NavLink>
              {badge(it.count)}
            </div>
          ))}
        </div>
      ))}
      <div className="mt-auto space-y-0.5 pt-4">
        {xl ? (
          <button type="button" onClick={onAssistant} title={rail ? "Assistant (⌘J)" : undefined} className={cn(navItem(panelOpen, rail), "w-full text-accent")}>
            <Sparkles size={16} className="shrink-0" />
            {!rail && <span className="flex-1 text-left">{t("Assistant")}</span>}
            {!rail && <kbd className="rounded border border-line px-1 text-[10px] text-muted">⌘J</kbd>}
          </button>
        ) : (
          <NavLink to="/assistant" viewTransition className={({ isActive }) => cn(navItem(isActive, rail), "text-accent")}>
            <Sparkles size={16} className="shrink-0" /> {!rail && "Assistant"}
          </NavLink>
        )}
        <NavLink to="/manuel" viewTransition title={rail ? t("Manuel") : undefined} className={({ isActive }) => navItem(isActive, rail)}>
          <BookOpen size={16} className="shrink-0" />
          {!rail && <span>{t("Manuel")}</span>}
        </NavLink>
        <div className="relative">
          <NavLink to="/reglages" viewTransition title={rail ? t("Réglages") : undefined} className={({ isActive }) => navItem(isActive, rail)}>
            <Settings size={16} className="shrink-0" />
            {!rail && <span>{t("Réglages")}</span>}
            {dot("alerts")}
          </NavLink>
          {badge("alerts")}
        </div>
        <button type="button" onClick={onRail} title={rail ? t("Déplier le menu (⌘\\)") : t("Replier le menu (⌘\\)")} className={cn(navItem(false, rail), "w-full")}>
          {rail ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!rail && <span className="flex-1 text-left">{t("Replier")}</span>}
          {!rail && me.data?.user && <span className="text-[11px] text-muted">{me.data.user.name}</span>}
        </button>
      </div>
    </aside>
  );
}

/* ---------- Barre supérieure (ordinateur) ---------- */

function TopBar({ onAssistant, panelOpen }: { onAssistant: () => void; panelOpen: boolean }) {
  const { pathname } = useLocation();
  const current = useCurrentCrumb();
  const crumbs = CRUMBS.find(([re]) => re.test(pathname))?.[1] ?? [];
  const sync = useSync();
  const discreet = useDiscreet();
  const [scope, setScope] = useScope();
  const showPeriod = pathname.startsWith("/mois") || pathname.startsWith("/operations");
  const scoped = scopeApplies(pathname);
  const scopeChoice = useMe().data?.user?.scopeChoice !== false;
  // Sans choix à faire, on reste sur « Foyer » : un « Moi » gardé d'avant ne doit pas vider les écrans sans moyen d'en sortir.
  useEffect(() => {
    if (!scopeChoice && scope === "moi") setScope("foyer");
  }, [scopeChoice, scope, setScope]);
  // Libellés des boutons : seulement quand la barre a la place (elle perd 400 px quand le panneau de l'assistant est ouvert).
  const label = panelOpen ? "hidden 2xl:inline" : "hidden xl:inline";
  async function refresh() {
    try {
      const r = await sync.mutateAsync();
      toast.success(r.inserted ? tn("{n} nouvelle opération", "{n} nouvelles opérations", r.inserted) : t("Tout est à jour"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Synchronisation impossible"));
    }
  }
  // Retour à l'écran d'avant : dans une fenêtre d'appli (sans barre de navigateur), c'est le seul moyen de revenir sur ses pas.
  const navigate = useNavigate();
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0;
  return (
    <header className={cn("sticky top-0 z-30 hidden h-[52px] items-center bg-bg/80 backdrop-blur-md md:flex", panelOpen ? "gap-2 px-4 2xl:gap-3 2xl:px-6" : "gap-2 px-4 xl:gap-3 xl:px-6")}>
      <button type="button" onClick={() => navigate(-1)} disabled={!canGoBack} aria-label={t("Retour")} title={t("Retour")} className="-ml-2 hidden size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-bg hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent lg:grid">
        <ArrowLeft size={17} />
      </button>
      {/* Fil d'Ariane : il cède sa place aux réglages de période quand la barre est étroite (le menu dit déjà où l'on est). */}
      {showPeriod && <div className={cn("min-w-0 flex-1", panelOpen ? "2xl:hidden" : "lg:hidden")} />}
      <nav aria-label={t("Fil d'Ariane")} className={cn("min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-[13px]", showPeriod ? (panelOpen ? "hidden 2xl:flex" : "hidden lg:flex") : "flex")}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1 && !current;
          return (
            <span key={i} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight size={13} className="shrink-0 text-muted/60" />}
              {c.to && !last ? (
                <Link to={c.to} viewTransition className="truncate text-muted hover:text-ink">
                  {c.label}
                </Link>
              ) : (
                <span className={cn("truncate", last ? "font-semibold text-ink" : "text-muted")}>{c.label}</span>
              )}
            </span>
          );
        })}
        {current && (
          <span className="flex min-w-0 items-center gap-1.5">
            <ChevronRight size={13} className="shrink-0 text-muted/60" />
            <span className="truncate font-semibold text-ink">{current}</span>
          </span>
        )}
      </nav>
      <DemoBadge className="py-1 text-[12px]" />
      {showPeriod && <PeriodPicker operations={pathname.startsWith("/operations")} label={label} />}
      {/* Foyer / Moi : grisé sur les écrans qui ne dépendent pas des comptes (le choix n'y changerait rien) ; absent quand
          tous les comptes sont ceux du membre (« Moi » et « Foyer » diraient la même chose). */}
      {scopeChoice && (
      <div
        className={cn("flex shrink-0 rounded-full bg-line/70 p-0.5 text-[12.5px] font-medium", !scoped && "cursor-not-allowed opacity-45")}
        title={scoped ? t("Foyer : tous les comptes · Moi : mes comptes, sans le compte commun") : t("Foyer / Moi : sans effet sur cet écran, qui ne dépend pas des comptes")}
      >
        {(["foyer", "moi"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={!scoped}
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
            className={cn("rounded-full px-3 py-1 disabled:pointer-events-none", scope === s ? (scoped ? "bg-card text-ink shadow-[0_1px_2px_rgb(20_20_19/0.12)]" : "text-ink") : "text-muted enabled:hover:text-ink")}
          >
            {s === "foyer" ? t("Foyer") : t("Moi")}
          </button>
        ))}
      </div>
      )}
      {/* Recherche : le champ entier s'il y a la place, sinon la loupe seule (période affichée ou panneau de l'assistant ouvert). */}
      <button
        type="button"
        onClick={openPalette}
        title={t("Rechercher (⌘K)")}
        aria-label={t("Rechercher…")}
        className={cn(
          "flex h-8 shrink-0 items-center gap-2 rounded-full bg-card text-[13px] text-muted shadow-[0_1px_2px_rgb(20_20_19/0.08)] hover:text-ink",
          showPeriod || panelOpen ? "w-8 justify-center 2xl:w-48 2xl:justify-start 2xl:px-2.5" : "w-8 justify-center lg:w-56 lg:justify-start lg:px-2.5",
          showPeriod && panelOpen && "2xl:w-8 2xl:justify-center 2xl:px-0",
        )}
      >
        <Search size={14} className="shrink-0" />
        <span className={cn("hidden flex-1 text-left", showPeriod || panelOpen ? (showPeriod && panelOpen ? "" : "2xl:block") : "lg:block")}>{t("Rechercher…")}</span>
        <kbd className={cn("hidden text-[11px]", showPeriod || panelOpen ? (showPeriod && panelOpen ? "" : "2xl:block") : "lg:block")}>⌘K</kbd>
      </button>
      <button
        type="button"
        onClick={toggleDiscreet}
        aria-pressed={discreet}
        title={discreet ? t("Afficher les montants (M)") : t("Masquer les montants (M)")}
        aria-label={discreet ? t("Afficher les montants") : t("Masquer les montants")}
        className={cn("grid size-8 shrink-0 place-items-center rounded-full", discreet ? "bg-ink text-card" : "text-muted hover:bg-card hover:text-ink")}
      >
        {discreet ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
      <HelpLink className="size-8 text-muted hover:bg-card hover:text-ink" />
      <button type="button" onClick={refresh} disabled={sync.isPending} title={t("Synchroniser les banques")} className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-bg hover:text-ink disabled:opacity-50">
        <RefreshCw size={15} className={sync.isPending ? "animate-spin" : ""} />
      </button>
      <button
        type="button"
        onClick={onAssistant}
        title={t("Assistant (⌘J)")}
        aria-label={t("Assistant")}
        className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold", panelOpen ? "bg-accent-soft text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "bg-ink text-card hover:opacity-90")}
      >
        <Sparkles size={14} /> <span className={label}>{t("Assistant")}</span>
      </button>
    </header>
  );
}

/**
 * Période. Sur Analyse : la période globale (partagée entre les écrans), un mois ou une année entière. Sur
 * Opérations : le filtre « mois » de l'adresse (un mois, une année, ou « Toutes les dates »). Le sélecteur « Mois |
 * Année » choisit le pas ; les flèches et ⌥← / ⌥→ avancent d'un pas ; « Aujourd'hui » ramène à la période en cours
 * et n'apparaît que si l'on s'en est écarté.
 */
function PeriodPicker({ operations, label }: { operations: boolean; label: string }) {
  const [global, setGlobal] = usePeriod();
  const [params, setParams] = useSearchParams();
  const raw = operations ? params.get("mois") : global;
  const value = raw && PERIOD_RE.test(raw) ? raw : null;
  const now = currentPeriodMonth();
  const year = value ? isYearPeriod(value) : false;
  const current = year ? now.slice(0, 4) : now;
  // Mois qui portent des opérations (les plus récents d'abord) : ce sont eux, et leurs années, que l'on propose.
  const known = useMonth(now).data?.months;
  const months = useMemo(() => {
    const recent = Array.from({ length: 36 }, (_, i) => shiftMonth(now, -i));
    return [...new Set([...recent, ...(known ?? [])])].filter((m) => m <= now).sort((a, b) => b.localeCompare(a));
  }, [known, now]);
  const years = useMemo(() => [...new Set(months.map((m) => m.slice(0, 4)))], [months]);
  const set = (p: string | null) => {
    if (!operations) return p && setGlobal(p);
    const next = new URLSearchParams(params);
    if (p) next.set("mois", p);
    else next.delete("mois");
    setParams(next, { replace: true });
  };
  const setUnit = (toYear: boolean) => {
    if (value && toYear === year) return;
    set(toYear ? (value ?? now).slice(0, 4) : value ? monthOfPeriod(value) : now);
  };
  const step = (delta: number) => {
    const next = shiftPeriod(value ?? current, delta);
    if (next <= current) set(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });
  const frame = "flex h-8 items-center rounded-full bg-card text-[13px] shadow-[0_1px_2px_rgb(20_20_19/0.08)]";
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className={cn(frame, "hidden p-0.5 text-[12.5px] font-medium lg:flex")} role="group" aria-label={t("Pas de la période")}>
        {([false, true] as const).map((y) => (
          <button
            key={String(y)}
            type="button"
            onClick={() => setUnit(y)}
            aria-pressed={!!value && year === y}
            title={y ? t("Une année entière") : t("Un mois")}
            className={cn("h-full rounded-full px-2.5", value && year === y ? "bg-ink text-card" : "text-muted hover:text-ink")}
          >
            {y ? t("Année") : t("Mois##pas")}
          </button>
        ))}
      </div>
      <div className={cn(frame, "focus-frame")} title={t("Période (⌥← / ⌥→)")}>
        <button type="button" onClick={() => step(-1)} className="grid h-full w-7 place-items-center text-muted hover:text-ink" aria-label={year ? t("Année précédente") : t("Mois précédent")}>
          <ChevronLeft size={14} />
        </button>
        <select value={value ?? ""} onChange={(e) => set(e.target.value || null)} className="h-full bg-transparent px-1 font-medium outline-none" aria-label={t("Période")}>
          {operations && <option value="">{t("Toutes les dates")}</option>}
          {/* Les années entières d'abord, puis les mois : le sélecteur suffit quand « Mois | Année » manque de place. */}
          <optgroup label={t("Années entières")}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </optgroup>
          {!year &&
            years.map((y) => (
              <optgroup key={y} label={y}>
                {months
                  .filter((m) => m.startsWith(y))
                  .map((m) => (
                    <option key={m} value={m}>
                      {periodLabel(m)}
                    </option>
                  ))}
              </optgroup>
            ))}
        </select>
        <button type="button" onClick={() => step(1)} disabled={!value || value >= current} className="grid h-full w-7 place-items-center text-muted hover:text-ink disabled:opacity-30" aria-label={year ? t("Année suivante") : t("Mois suivant")}>
          <ChevronRight size={14} />
        </button>
      </div>
      {value && value !== current && (
        <button
          type="button"
          onClick={() => set(current)}
          title={year ? t("Revenir à l'année en cours") : t("Revenir au mois en cours")}
          aria-label={t("Aujourd'hui")}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium text-accent hover:bg-accent-soft"
        >
          <CalendarCheck size={15} /> <span className={label}>{t("Aujourd'hui")}</span>
        </button>
      )}
    </div>
  );
}

type MobileTabDef = { to: string; label: string; icon: typeof House; match: (p: string) => boolean };
const mobileTabs: MobileTabDef[] = [
  { to: "/", label: t("Accueil"), icon: House, match: (p) => p === "/" || p.startsWith("/reglages") || p.startsWith("/manuel") },
  { to: "/operations", label: t("Opérations"), icon: ListOrdered, match: (p) => p.startsWith("/operations") || p.startsWith("/factures") },
  { to: "/mois", label: t("Mois"), icon: PieChart, match: (p) => p.startsWith("/mois") },
  { to: "/patrimoine", label: t("Patrimoine"), icon: PiggyBank, match: (p) => p.startsWith("/patrimoine") || p.startsWith("/credits") },
];

function MobileTab({ tab, active }: { tab: MobileTabDef; active: boolean }) {
  return (
    <Link
      to={tab.to}
      data-tab
      aria-current={active ? "page" : undefined}
      className={cn("relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[10.5px] font-medium transition-colors active:scale-95", active ? "text-accent" : "text-muted")}
    >
      <span className={cn("absolute top-0 h-0.5 w-6 rounded-full bg-accent transition-all duration-300", active ? "opacity-100" : "w-0 opacity-0")} />
      <tab.icon size={22} strokeWidth={active ? 2.3 : 1.9} />
      {tab.label}
    </Link>
  );
}
