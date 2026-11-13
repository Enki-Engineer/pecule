import { Suspense, useEffect, useRef, useState } from "react";
import { AssistantChat } from "../screens.tsx";
import { DemoBadge } from "./DemoBadge.tsx";
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  House,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  PiggyBank,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
} from "lucide-react";
import { Spinner } from "./ui.tsx";
import { cn } from "../cn.ts";
import { api, useMe, useSync } from "../api.ts";
import { useTheme } from "../theme.ts";
import { CommandPalette, openPalette } from "./CommandPalette.tsx";
import { DrillDrawer } from "./DrillDrawer.tsx";
import { InvoiceViewer } from "./InvoiceViewer.tsx";
import { Shortcuts } from "./Shortcuts.tsx";
import { shiftMonth, useCurrentCrumb, usePeriod, useRail, useScope } from "../shell.ts";
import { COUNT_LINKS, type Counts } from "../nav.ts";
import { useModulesOff, useNav } from "../modules.ts";
import { pathEnabled } from "../../lib/modules.ts";
import { scopeApplies } from "../../lib/scope.ts";
import { NavTracker, PullToRefresh, isTopLevel, useBack, useEdgeSwipeBack } from "./MobileShell.tsx";
import { useMedia } from "../useMedia.ts";
import { SeasonDecor } from "./SeasonDecor.tsx";
import { FetchingBar } from "./FetchingBar.tsx";
import { applyAppearance } from "../theme.ts";
import { AppLogo } from "./AppLogo.tsx";
import { useBirthdays } from "../birthdays.ts";
import { locale, t, tn } from "../../lib/i18n.ts";

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
  [/^\/reglages/, [{ label: t("Réglages"), to: "/reglages" }]],
  [/^\/assistant/, [{ label: t("Assistant") }]],
];

const PANEL_KEY = "pecule.assistant.panel";
const useWideScreen = () => {
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => {
      mq.removeEventListener("change", on);
    };
  }, []);
  return wide;
};

export function Layout() {
  const { pathname } = useLocation();
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
  const panelOpen = xl && panel && pathname !== "/assistant";
  // Les fenêtres (fiches) laissent le panneau de l'assistant libre : on peut lui parler de ce qui est ouvert.
  useEffect(() => {
    document.documentElement.style.setProperty("--assistant-panel", panelOpen ? "400px" : "0px");
  }, [panelOpen]);

  const togglePanel = (open = !panel) => {
    setPanel(open);
    localStorage.setItem(PANEL_KEY, open ? "1" : "0");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (xl) togglePanel();
        else navigate("/assistant");
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setRail(!rail);
      }
    };
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent<string>).detail;
      if (xl) {
        togglePanel(true);
        setPrefill(q);
      } else navigate(`/assistant?q=${encodeURIComponent(q)}`);
    };
    // Conversation existante (résumé de la semaine) : panneau sur grand écran, page sinon.
    const onThread = () => (xl ? togglePanel(true) : navigate("/assistant"));
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
          <div key={pathname} ref={pageRef} className="page-enter">
            <Suspense fallback={<Spinner />}>
              {/* Un écran retiré par le foyer ramène à l'accueil, même ouvert par son adresse. */}
              {pathEnabled(pathname, modulesOff) ? <Outlet /> : <Navigate to="/" replace />}
            </Suspense>
          </div>
        </main>
      </div>

      {/* Panneau assistant (ordinateur ≥ 1280 px) */}
      {panelOpen && (
        <aside className="sticky top-0 hidden h-screen border-l border-line bg-card xl:block">
          <Suspense fallback={<Spinner label={t("Ouverture de l'assistant…")} />}>
            <AssistantChat variant="panel" prefill={prefill} onClose={() => togglePanel(false)} />
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
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/85 backdrop-blur-xl md:hidden">
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
    "group relative flex h-8 items-center gap-2.5 rounded-md text-[13.5px] font-medium transition-colors",
    rail ? "justify-center px-0" : "px-2.5",
    active ? "bg-card text-accent shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-card/70 hover:text-ink",
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
    const danger = key === "tasksOverdue" || key === "alerts";
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
    <aside className="sticky top-0 hidden h-screen flex-col overflow-y-auto border-r border-line bg-bg px-2.5 pb-3 pt-3.5 md:flex">
      <Link to="/" viewTransition className={cn("mb-3 flex h-8 items-center gap-2", rail ? "justify-center" : "px-1.5")}>
        <AppLogo className="size-7 rounded-md" />
        {!rail && <span className="text-[16px] font-semibold tracking-tight">Pécule</span>}
      </Link>
      {nav.map((g, i) => (
        <div key={i} className="mb-2">
          {g.title && !rail && <div className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{g.title}</div>}
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
  const [scope, setScope] = useScope();
  const showPeriod = pathname.startsWith("/mois") || pathname.startsWith("/operations");
  const scoped = scopeApplies(pathname);
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
    <header className="sticky top-0 z-30 hidden h-[52px] items-center gap-3 border-b border-line bg-card/85 px-6 backdrop-blur-md md:flex">
      <button type="button" onClick={() => navigate(-1)} disabled={!canGoBack} aria-label={t("Retour")} title={t("Retour")} className="-ml-2 grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-bg hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent">
        <ArrowLeft size={17} />
      </button>
      <nav aria-label={t("Fil d'Ariane")} className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]">
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
      {showPeriod && <PeriodPicker operations={pathname.startsWith("/operations")} />}
      {/* Foyer / Moi : grisé sur les écrans qui ne dépendent pas des comptes (le choix n'y changerait rien). */}
      <div
        className={cn("flex rounded-md bg-bg p-0.5 text-[12.5px] font-medium shadow-[inset_0_0_0_1px_var(--color-line)]", !scoped && "cursor-not-allowed opacity-45")}
        title={scoped ? t("Foyer : tous les comptes · Moi : mes comptes, sans le compte commun") : t("Foyer / Moi : sans effet sur cet écran, qui ne dépend pas des comptes")}
      >
        {(["foyer", "moi"] as const).map((s) => (
          <button
            key={s}
            type="button"
            disabled={!scoped}
            aria-pressed={scope === s}
            onClick={() => setScope(s)}
            className={cn("rounded px-2.5 py-1 disabled:pointer-events-none", scope === s ? (scoped ? "bg-card text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-ink") : "text-muted enabled:hover:text-ink")}
          >
            {s === "foyer" ? t("Foyer") : t("Moi")}
          </button>
        ))}
      </div>
      <button type="button" onClick={openPalette} className="flex h-8 w-56 items-center gap-2 rounded-md bg-bg px-2.5 text-[13px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink">
        <Search size={14} />
        <span className="flex-1 text-left">{t("Rechercher…")}</span>
        <kbd className="text-[11px]">⌘K</kbd>
      </button>
      <button type="button" onClick={refresh} disabled={sync.isPending} title={t("Synchroniser les banques")} className="grid size-8 place-items-center rounded-md text-muted hover:bg-bg hover:text-ink disabled:opacity-50">
        <RefreshCw size={15} className={sync.isPending ? "animate-spin" : ""} />
      </button>
      <button
        type="button"
        onClick={onAssistant}
        title={t("Assistant (⌘J)")}
        className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium", panelOpen ? "bg-accent text-white" : "text-accent hover:bg-accent-soft")}
      >
        <Sparkles size={14} /> {t("Assistant")}
      </button>
    </header>
  );
}

const monthLabelLong = (m: string) => new Date(`${m}-15T12:00:00`).toLocaleDateString(locale(), { month: "long", year: "numeric" });

/**
 * Période : sur Analyse, le mois global (partagé, ⌥← / ⌥→) ; sur Opérations, le filtre « mois »
 * de l'adresse, avec « Toutes les dates ».
 */
function PeriodPicker({ operations }: { operations: boolean }) {
  const [global, setGlobal] = usePeriod();
  const [params, setParams] = useSearchParams();
  const value = operations ? params.get("mois") : global;
  const set = (m: string | null) => {
    if (!operations) return m && setGlobal(m);
    const next = new URLSearchParams(params);
    if (m) next.set("mois", m);
    else next.delete("mois");
    setParams(next, { replace: true });
  };
  const now = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const months = Array.from({ length: 36 }, (_, i) => shiftMonth(now, -i));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const base = value ?? now;
      const next = shiftMonth(base, e.key === "ArrowLeft" ? -1 : 1);
      if (next <= now) set(next);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });
  return (
    <div className="focus-frame flex h-8 items-center rounded-md bg-bg text-[13px] shadow-[inset_0_0_0_1px_var(--color-line)]" title={t("Période (⌥← / ⌥→)")}>
      <button type="button" onClick={() => set(shiftMonth(value ?? now, -1))} className="grid h-full w-7 place-items-center text-muted hover:text-ink" aria-label={t("Mois précédent")}>
        <ChevronLeft size={14} />
      </button>
      <select value={value ?? ""} onChange={(e) => set(e.target.value || null)} className="h-full bg-transparent px-1 font-medium capitalize outline-none" aria-label={t("Période")}>
        {operations && <option value="">{t("Toutes les dates")}</option>}
        {months.map((m) => (
          <option key={m} value={m}>
            {monthLabelLong(m)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => value && value < now && set(shiftMonth(value, 1))}
        disabled={!value || value >= now}
        className="grid h-full w-7 place-items-center text-muted hover:text-ink disabled:opacity-30"
        aria-label={t("Mois suivant")}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}

type MobileTabDef = { to: string; label: string; icon: typeof House; match: (p: string) => boolean };
const mobileTabs: MobileTabDef[] = [
  { to: "/", label: t("Accueil"), icon: House, match: (p) => p === "/" || p.startsWith("/reglages") },
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
