import { DemoBadge } from "./DemoBadge.tsx";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, LayoutGrid, RefreshCw, Search, Settings, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api, useMe, useSync } from "../api.ts";
import type { Counts } from "../nav.ts";
import { useNav } from "../modules.ts";
import { openPalette } from "./CommandPalette.tsx";
import { Sheet } from "./ui.tsx";
import { cn } from "../cn.ts";
import { useScope } from "../shell.ts";
import { t, tn } from "../../lib/i18n.ts";

/*
 * Coquille iPhone : hiérarchie des écrans (bouton retour partout, jamais d'impasse), sens de la
 * navigation pour les transitions (avancer, revenir, changer d'onglet), barre du haut avec grand
 * titre qui se réduit au défilement, menu « Tout Pécule », retour par balayage depuis le bord
 * gauche (appli installée) et « tirer pour actualiser » sur les écrans principaux.
 */

/* ---------- Plan des écrans ---------- */

type Meta = { title: string; parent?: string };
const ROUTES: [RegExp, Meta][] = [
  [/^\/$/, { title: t("Accueil") }],
  [/^\/operations/, { title: t("Opérations") }],
  [/^\/tri/, { title: t("À classer"), parent: "/operations" }],
  [/^\/factures/, { title: t("Factures") }],
  [/^\/mois/, { title: t("Mois") }],
  [/^\/comparer/, { title: t("Comparer"), parent: "/mois" }],
  [/^\/assistant/, { title: t("Assistant") }],
  [/^\/patrimoine\/crypto/, { title: t("Crypto"), parent: "/patrimoine" }],
  [/^\/patrimoine/, { title: t("Patrimoine") }],
  [/^\/credits\//, { title: t("Crédit"), parent: "/patrimoine" }],
  [/^\/immobilier\/./, { title: t("Bien"), parent: "/immobilier" }],
  [/^\/immobilier/, { title: t("Immobilier"), parent: "/patrimoine" }],
  [/^\/projections/, { title: t("Projections"), parent: "/patrimoine" }],
  [/^\/objectifs/, { title: t("Objectifs"), parent: "/patrimoine" }],
  [/^\/budget/, { title: t("Budget"), parent: "/" }],
  [/^\/soldes/, { title: t("Soldes à venir"), parent: "/" }],
  [/^\/revenus/, { title: t("Revenus"), parent: "/patrimoine" }],
  [/^\/impots/, { title: t("Impôts"), parent: "/patrimoine" }],
  [/^\/retraite/, { title: t("Retraite"), parent: "/patrimoine" }],
  [/^\/documents/, { title: t("Coffre"), parent: "/" }],
  [/^\/echeancier/, { title: t("Échéancier"), parent: "/" }],
  [/^\/reglages\/./, { title: t("Réglages"), parent: "/reglages" }],
  [/^\/reglages/, { title: t("Réglages"), parent: "/" }],
];
export const routeMeta = (path: string): Meta => ROUTES.find(([re]) => re.test(path))?.[1] ?? { title: "Pécule", parent: "/" };
export const isTopLevel = (path: string) => !routeMeta(path).parent;

/* ---------- Pile de navigation et sens des transitions ---------- */

type Entry = { path: string; idx: number };
const stack: Entry[] = [];
const historyIdx = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;
let marked = 0;

/** Sens de la prochaine transition : forward (avancer), back (revenir), tab (changer d'onglet), none. */
export function markNav(dir: "forward" | "back" | "tab" | "none") {
  document.documentElement.dataset.nav = dir;
  marked = Date.now();
}

/** Suit les changements d'adresse : pile des écrans visités, sens des transitions. */
export function NavTracker() {
  const location = useLocation();
  const type = useNavigationType();
  useLayoutEffect(() => {
    const idx = historyIdx();
    if (type === "POP" && Date.now() - marked > 400) markNav("back");
    while (stack.length && stack[stack.length - 1].idx >= idx && stack[stack.length - 1].path !== location.pathname) stack.pop();
    const top = stack.at(-1);
    if (top?.path === location.pathname) top.idx = idx;
    else stack.push({ path: location.pathname, idx });
  }, [location.key, location.pathname, type]);

  useEffect(() => {
    // Liens : la barre d'onglets (data-tab) change d'onglet, les autres avancent.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== window.location.origin) return;
      markNav(a.dataset.tab !== undefined ? "tab" : "forward");
    };
    // Retour du navigateur : Safari anime déjà le balayage (hasUAVisualTransition) → pas de double animation.
    const onPop = (e: PopStateEvent) => markNav((e as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition ? "none" : "back");
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);
  return null;
}

/** Retour : écran précédent de l'historique s'il y en a un, sinon l'écran parent. */
export function useBack() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const meta = routeMeta(pathname);
  const prev = [...stack].reverse().find((e) => e.path !== pathname && e.idx < historyIdx());
  const label = prev ? routeMeta(prev.path).title : meta.parent ? routeMeta(meta.parent).title : "Retour";
  const back = () => {
    markNav("back");
    if (prev) navigate(prev.idx - historyIdx());
    else navigate(meta.parent ?? "/", { replace: true });
  };
  return { top: !meta.parent, back, label };
}

/* ---------- Barre du haut et grand titre ---------- */

/** En-tête d'écran (iPhone) : barre collante (retour ou menu, titre réduit, recherche) puis grand titre. */
export function MobileHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  const { top, back, label } = useBack();
  const [scope] = useScope();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [compact, setCompact] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting), { rootMargin: "-52px 0px 0px 0px", threshold: 0 });
    io.observe(el);
    return () => {
      io.disconnect();
    };
  }, []);
  return (
    <>
      <div
        className={cn(
          "sticky top-0 z-30 -mx-4 border-b px-1.5 pt-[env(safe-area-inset-top)] backdrop-blur-xl transition-colors duration-200",
          compact ? "border-line bg-bg/85" : "border-transparent bg-bg/0",
        )}
      >
        <div className="relative flex h-11 items-center justify-between">
          <div className="relative z-10 min-w-0 max-w-[45%]">
            {top ? (
              <button type="button" onClick={() => setMenu(true)} aria-label={t("Tout Pécule")} className="press flex h-10 items-center gap-1.5 rounded-full pl-2 pr-2 text-ink">
                <LayoutGrid size={21} />
                {scope === "moi" && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent">{t("Moi")}</span>}
              </button>
            ) : (
              <button type="button" onClick={back} className="press flex h-10 max-w-full items-center gap-0.5 rounded-full pl-1 pr-2 text-[16px] text-accent">
                <ChevronLeft size={26} strokeWidth={2.2} className="-ml-1 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            )}
          </div>
          {/* Titre réduit : centré, n'occupe pas de place tant qu'il est caché (le libellé du retour reste lisible). */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 mx-auto max-w-[52%] truncate text-center text-[16px] font-semibold transition-all duration-200",
              compact ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
            )}
          >
            {title}
          </div>
          <div className="relative z-10 flex items-center justify-end">
            <DemoBadge />
            <button type="button" onClick={openPalette} aria-label={t("Rechercher")} className="press grid size-10 place-items-center rounded-full text-ink">
              <Search size={20} />
            </button>
          </div>
        </div>
      </div>
      <header className="flex items-end justify-between gap-3 px-0.5 pb-4 pt-1">
        <div className="min-w-0">
          <h1 ref={titleRef} className="page-title text-[30px] font-bold leading-[1.1] tracking-tight">
            {title}
          </h1>
          {subtitle && <div className="mt-1 text-[14px] text-muted">{subtitle}</div>}
        </div>
        {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
      </header>
      <MenuSheet open={menu} onClose={() => setMenu(false)} />
    </>
  );
}

/* ---------- Menu « Tout Pécule » ---------- */

export function MenuSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const me = useMe();
  const nav = useNav();
  const { pathname } = useLocation();
  const [scope, setScope] = useScope();
  const counts = useQuery({ queryKey: ["nav-counts"], queryFn: () => api<Counts>("/nav-counts"), staleTime: 60_000, enabled: open });
  if (!open) return null;
  const go = () => onClose();
  const scopeSwitch = (
    <div className="mb-4">
      <div className="flex rounded-[10px] bg-line/70 p-0.5">
        {(["foyer", "moi"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setScope(v)}
            aria-pressed={scope === v}
            className={cn("flex-1 rounded-[8px] py-2 text-[14px] font-semibold transition-colors", scope === v ? "bg-card text-ink shadow-sm" : "text-muted")}
          >
            {v === "foyer" ? t("Foyer") : t("Moi")}
          </button>
        ))}
      </div>
      <p className="mt-1.5 px-1 text-[12px] text-muted">
        {scope === "foyer" ? t("Tous les comptes du foyer (comptes communs compris).") : t("Seulement tes comptes : soldes, dépenses et opérations à classer.")}
      </p>
    </div>
  );
  const row = (to: string, label: string, Icon: typeof Settings, n?: number, danger?: boolean) => (
    <Link key={to} to={to} onClick={go} className={cn("press flex h-12 items-center gap-3 px-4", pathname === to && "text-accent")}>
      <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">
        <Icon size={17} />
      </span>
      <span className="flex-1 text-[16px]">{label}</span>
      {!!n && <span className={cn("rounded-full px-2 text-[12px] font-semibold tabular-nums", danger ? "bg-neg/10 text-neg" : "bg-accent-soft text-accent")}>{n}</span>}
      <ChevronRight size={17} className="text-muted" />
    </Link>
  );
  return (
    <Sheet open onClose={onClose} title={t("Tout Pécule")}>
      <div className="space-y-4 pb-2">
        {/* Foyer / Moi : seulement s'il y a un choix à faire (des comptes à soi, et d'autres). */}
        {me.data?.user?.scopeChoice !== false && scopeSwitch}
        {nav.map((g, i) => (
          <section key={i}>
            {g.title && <h3 className="mb-1.5 px-1 text-[12.5px] font-medium text-muted">{g.title}</h3>}
            <div className="card divide-y divide-line overflow-hidden">
              {g.items.map((t) => row(t.to, t.to === "/" ? "Accueil" : t.label, t.icon, t.count ? counts.data?.[t.count] : undefined, t.count === "tasksOverdue"))}
            </div>
          </section>
        ))}
        <div className="card divide-y divide-line overflow-hidden">
          {row("/assistant", t("Assistant"), Sparkles)}
          {row("/reglages", t("Réglages"), Settings, counts.data?.alerts, true)}
        </div>
        {me.data?.user && <p className="text-center text-[12px] text-muted">Connecté : {me.data.user.name}</p>}
      </div>
    </Sheet>
  );
}

/* ---------- Gestes ---------- */

/** Geste commencé dans une feuille ou une fenêtre : elle gère ses propres gestes (glisser pour fermer). */
const inDialog = (e: TouchEvent) => !!(e.target as Element | null)?.closest?.('[role="dialog"], [role="menu"]');

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Retour par balayage depuis le bord gauche (appli installée sur l'écran d'accueil, où Safari n'offre
 * pas ce geste) : l'écran suit le doigt, puis revient ou part selon la distance.
 */
export function useEdgeSwipeBack(pageRef: RefObject<HTMLElement | null>, enabled: boolean, back: () => void) {
  useEffect(() => {
    if (!enabled || !standalone()) return;
    let start: { x: number; y: number; t: number } | null = null;
    let dx = 0;
    const el = () => pageRef.current;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t.clientX > 24 || e.touches.length > 1 || inDialog(e)) return;
      start = { x: t.clientX, y: t.clientY, t: Date.now() };
      dx = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      dx = Math.max(0, t.clientX - start.x);
      if (Math.abs(t.clientY - start.y) > 60 && dx < 30) {
        start = null;
        reset();
        return;
      }
      const node = el();
      if (node) {
        node.style.transition = "none";
        node.style.transform = `translateX(${dx}px)`;
        node.style.boxShadow = "-12px 0 24px rgb(0 0 0 / 0.08)";
      }
    };
    const reset = () => {
      const node = el();
      if (!node) return;
      node.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)";
      node.style.transform = "";
      setTimeout(() => {
        node.style.transition = "";
        node.style.boxShadow = "";
      }, 230);
    };
    const onEnd = () => {
      if (!start) return;
      const fast = dx > 40 && Date.now() - start.t < 250;
      start = null;
      if (dx > window.innerWidth * 0.33 || fast) {
        const node = el();
        if (node) {
          node.style.transition = "transform 180ms ease-out";
          node.style.transform = "translateX(100%)";
        }
        setTimeout(() => {
          markNav("none");
          back();
          const n = el();
          if (n) {
            n.style.transition = "";
            n.style.transform = "";
            n.style.boxShadow = "";
          }
        }, 170);
      } else reset();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, back, pageRef]);
}

/** Tirer pour actualiser (écrans principaux) : synchronise les banques puis recharge les données. */
export function PullToRefresh({ enabled }: { enabled: boolean }) {
  const sync = useSync();
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const pullRef = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    let startY: number | null = null;
    const onStart = (e: TouchEvent) => {
      if (window.scrollY > 0 || busy || e.touches[0].clientX < 24 || inDialog(e)) return;
      startY = e.touches[0].clientY;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      const d = e.touches[0].clientY - startY;
      if (d <= 0 || window.scrollY > 0) {
        pullRef.current = 0;
        setPull(0);
        return;
      }
      // Résistance : le contenu suit de moins en moins le doigt.
      pullRef.current = Math.min(110, d * 0.5);
      setPull(pullRef.current);
    };
    const onEnd = async () => {
      if (startY == null) return;
      startY = null;
      const reached = pullRef.current >= 64;
      pullRef.current = 0;
      setPull(0);
      if (!reached) return;
      setBusy(true);
      try {
        const r = await sync.mutateAsync();
        await qc.invalidateQueries();
        toast.success(r.inserted ? tn("{n} nouvelle opération", "{n} nouvelles opérations", r.inserted) : t("À jour"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("Synchronisation impossible"));
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [enabled, busy, sync, qc]);
  if (!pull && !busy) return null;
  const ready = pull >= 64;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-[calc(env(safe-area-inset-top)+8px)] md:hidden" style={{ transform: `translateY(${busy ? 36 : pull * 0.6}px)` }}>
      <span className={cn("grid size-9 place-items-center rounded-full bg-card text-accent shadow-md ring-1 ring-line transition-transform", ready && "scale-110")}>
        <RefreshCw size={17} className={cn(busy && "animate-spin")} style={busy ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
      </span>
    </div>
  );
}
