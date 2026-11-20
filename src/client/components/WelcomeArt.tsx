import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, Check, CircleHelp, Eye, FolderOpen, House, Landmark, LayoutGrid, ListOrdered, PieChart, PiggyBank, Plug, Receipt, RefreshCw, Search, Settings, Sparkles, type LucideIcon } from "lucide-react";
import { AppLogo } from "./AppLogo.tsx";
import { ChestLogo } from "./ChestLogo.tsx";
import { BrandLogo } from "./Logo.tsx";
import { BankBadge } from "./ui.tsx";
import { cn } from "../cn.ts";
import { NAV } from "../nav.ts";
import { formatMoney } from "../../lib/currencies.ts";
import { moduleOfPath, type ModuleId } from "../../lib/modules.ts";
import { locale, t } from "../../lib/i18n.ts";

/*
 * Illustrations de la présentation de bienvenue (pages/Onboarding.tsx), une par étape. Elles sont dessinées avec les
 * vrais éléments de l'appli — son menu, ses icônes, ses libellés, son logo — pour que ce qu'on y voit soit ce qu'on
 * retrouvera ensuite. Purement décoratives (`aria-hidden` : le texte de l'étape dit tout). Styles : styles/bienvenue.css.
 */

/** Variables de style d'un élément (angle, rang…). */
const vars = (v: Record<string, string | number>) => v as CSSProperties;

/* ---------- Bienvenue ---------- */

/** Ce que Pécule réunit : opérations, analyse, patrimoine, coffre, factures, assistant. */
const PILLARS: LucideIcon[] = [ListOrdered, PieChart, PiggyBank, FolderOpen, Receipt, Sparkles];

/** Le coffre, et autour de lui ce que Pécule réunit. `opened` : il vient de s'ouvrir sur l'écran de connexion, il le reste. */
export function ArtWelcome({ opened }: { opened: boolean }) {
  const [open, setOpen] = useState(opened);
  useEffect(() => {
    if (opened) return;
    const timer = setTimeout(() => setOpen(true), 500);
    return () => {
      clearTimeout(timer);
    };
  }, [opened]);
  return (
    <div className="bv-orbit">
      <span className="bv-orbit-ring" />
      <span className="bv-orbit-glow" />
      {PILLARS.map((Icon, n) => (
        <span key={n} className="bv-sat" style={vars({ "--a": `${90 - n * 60}deg`, "--n": n })}>
          <Icon strokeWidth={2} />
        </span>
      ))}
      <div className="bv-orbit-core [view-transition-name:pecule-coffre]">
        <ChestLogo open={open} still={opened} />
      </div>
    </div>
  );
}

/* ---------- Ton foyer ---------- */

/** Le menu de l'appli tel qu'il sera : un écran décoché s'en retire sous les yeux ; et un montant dans la devise choisie. */
export function ArtHousehold({ modulesOff, currency }: { modulesOff: readonly ModuleId[]; currency: string }) {
  const off = (to: string) => {
    const m = moduleOfPath(to);
    return !!m && modulesOff.includes(m);
  };
  return (
    <div className="relative w-[min(17.5rem,84cqw)] text-[min(12.5px,calc(100cqh/47))]">
      <div className="card px-[0.9em] pb-[0.9em] pt-[1em]">
        <div className="mb-[0.5em] flex items-center gap-[0.6em] px-[0.4em]">
          <AppLogo className="size-[1.9em] rounded-[0.5em]" />
          <span className="text-[1.25em] font-semibold tracking-tight">Pécule</span>
        </div>
        {NAV.map((g, i) => (
          <Fragment key={i}>
            {g.title && (
              <div className="bv-menu-row" data-off={g.items.every((it) => off(it.to))}>
                <div>
                  <div className="px-[0.6em] pb-[0.2em] pt-[0.75em] text-[0.9em] font-medium text-muted">{g.title}</div>
                </div>
              </div>
            )}
            {g.items.map((it) => (
              <div key={it.to} className="bv-menu-row" data-off={off(it.to)}>
                <div>
                  <div className={cn("flex h-[1.95em] items-center gap-[0.65em] rounded-[0.7em] px-[0.6em] font-medium", i === 0 ? "bg-bg font-semibold text-ink" : "text-muted")}>
                    <it.icon className={cn("size-[1.15em] shrink-0", i === 0 && "text-accent")} strokeWidth={2} />
                    <span className="truncate">{it.label}</span>
                  </div>
                </div>
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      {/* Remonté à chaque changement de devise : le montant se pose de nouveau. */}
      <div key={currency} className="bv-pop card absolute -right-[1.1em] -top-[1.5em] px-[1.1em] py-[0.75em] shadow-[0_0_0_1px_var(--color-line),0_14px_30px_-14px_rgb(20_20_19/0.35)]">
        <div className="text-[0.88em] text-muted">{t("Tes montants")}</div>
        <div className="figure text-[1.55em]">{formatMoney(1234.56, currency, locale())}</div>
      </div>
    </div>
  );
}

/* ---------- Pour t'y retrouver ---------- */

/** Zones de l'appli que la présentation montre : sur ordinateur (menu, recherche, aide, assistant) et sur téléphone. */
export type Spot = "menu" | "recherche" | "aide" | "assistant" | "onglets" | "tout" | "outils";

const bar = (width: string, strong = false) => <span className={cn("bv-bar", strong && "bv-bar-strong")} style={{ width }} />;

/** Position d'un élément dans un ancêtre, en pixels de mise en page (sans tenir compte d'une animation en cours). */
function offsetIn(target: HTMLElement, root: HTMLElement) {
  let x = 0;
  let y = 0;
  for (let el: HTMLElement | null = target; el && el !== root; el = el.offsetParent as HTMLElement | null) {
    x += el.offsetLeft;
    y += el.offsetTop;
  }
  return { x, y, w: target.offsetWidth, h: target.offsetHeight };
}

function DeskMock() {
  const groups = NAV.filter((g) => g.title);
  const icon = "size-[1.25em] shrink-0";
  return (
    <div className="bv-mock-frame">
      <div className="flex min-h-0 flex-col bg-bg px-[0.9em] pb-[0.9em] pt-[1.1em]">
        <div data-zone="reste" className="mb-[0.8em] flex items-center gap-[0.55em] px-[0.3em]">
          <AppLogo className="size-[1.9em] rounded-[0.5em]" />
          <span className="text-[1.35em] font-semibold tracking-tight">Pécule</span>
        </div>
        <div data-zone="menu" data-halo="menu" className="rounded-[0.8em]">
          <div className="flex h-[2.1em] items-center gap-[0.6em] rounded-[0.7em] bg-card px-[0.6em] shadow-[0_1px_2px_rgb(20_20_19/0.1)]">
            <House className={cn(icon, "text-accent")} strokeWidth={2.2} />
            {bar("5.6em", true)}
          </div>
          {groups.map((g) => (
            <Fragment key={g.title}>
              <div className="truncate px-[0.6em] pb-[0.25em] pt-[0.85em] text-[0.95em] font-medium text-muted">{g.title}</div>
              {g.items.slice(0, 2).map((it, k) => (
                <div key={it.to} className="flex h-[1.75em] items-center gap-[0.6em] px-[0.6em] text-muted">
                  <it.icon className={icon} strokeWidth={2} />
                  {bar(k ? "4.4em" : "5.8em")}
                </div>
              ))}
            </Fragment>
          ))}
        </div>
        <div className="mt-auto space-y-[0.15em] pt-[0.6em]">
          <div data-zone="assistant" className="flex h-[1.75em] items-center gap-[0.6em] px-[0.6em] text-accent">
            <Sparkles className={icon} strokeWidth={2} />
            {bar("4.6em", true)}
          </div>
          <div data-zone="reste" className="flex h-[1.75em] items-center gap-[0.6em] px-[0.6em] text-muted">
            <BookOpen className={icon} strokeWidth={2} />
            {bar("3.6em")}
          </div>
          <div data-zone="reste" className="flex h-[1.75em] items-center gap-[0.6em] px-[0.6em] text-muted">
            <Settings className={icon} strokeWidth={2} />
            {bar("4.2em")}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex h-[3.7em] shrink-0 items-center gap-[0.75em] px-[1.3em]">
          <span data-zone="reste" className="min-w-0 flex-1">
            {bar("7em", true)}
          </span>
          <span data-zone="recherche" data-halo="recherche" className="flex h-[2.15em] w-[12.5em] items-center gap-[0.5em] rounded-full bg-bg px-[0.8em] text-muted">
            <Search className="size-[1.1em] shrink-0" strokeWidth={2.2} />
            <span className="min-w-0 flex-1 truncate text-[0.98em]">{t("Rechercher…")}</span>
            <span className="text-[0.85em]">⌘K</span>
          </span>
          <span data-zone="reste" className="text-muted">
            <Eye className={icon} strokeWidth={2} />
          </span>
          <span data-zone="aide" data-halo="aide" className="grid size-[2.15em] place-items-center rounded-full text-ink">
            <CircleHelp className="size-[1.35em]" strokeWidth={2} />
          </span>
          <span data-zone="reste" className="text-muted">
            <RefreshCw className={icon} strokeWidth={2} />
          </span>
          <span data-zone="assistant" data-halo="assistant" className="flex h-[2.15em] items-center gap-[0.45em] rounded-full bg-ink px-[0.9em] text-[0.98em] font-semibold text-card">
            <Sparkles className="size-[1.05em]" strokeWidth={2.2} /> {t("Assistant")}
          </span>
        </div>
        <div data-zone="reste" className="flex min-h-0 flex-1 flex-col gap-[0.9em] px-[1.3em] pb-[1.3em] pt-[0.4em]">
          {bar("11em", true)}
          <div className="grid grid-cols-3 gap-[0.9em]">
            {["62%", "48%", "70%"].map((w) => (
              <div key={w} className="space-y-[0.7em] rounded-[1em] bg-bg p-[0.9em]">
                {bar("55%")}
                <span className="bv-bar bv-bar-strong" style={{ width: w, height: "1.1em" }} />
              </div>
            ))}
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-[0.9em]">
            <div className="flex flex-col rounded-[1em] bg-bg p-[0.9em]">
              {bar("40%")}
              <svg viewBox="0 0 120 44" preserveAspectRatio="none" className="mt-[0.7em] min-h-0 w-full flex-1">
                <path d="M0 36 C14 30 20 34 32 26 S52 28 62 18 82 22 94 10 110 12 120 4" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            </div>
            <div className="space-y-[0.8em] rounded-[1em] bg-bg p-[0.9em]">
              {bar("60%")}
              {bar("85%")}
              {bar("72%")}
              {bar("80%")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PhoneMock() {
  const tabs: [LucideIcon, string][] = [
    [House, t("Accueil")],
    [ListOrdered, t("Opérations")],
    [PieChart, t("Mois")],
    [PiggyBank, t("Patrimoine")],
  ];
  const tab = ([Icon, label]: [LucideIcon, string], active: boolean) => (
    <span key={label} className={cn("flex w-[3.6em] flex-col items-center gap-[0.25em] text-[0.78em] font-medium", active ? "text-accent" : "text-muted")}>
      <Icon className="size-[2.1em]" strokeWidth={active ? 2.3 : 1.9} />
      <span className="max-w-full truncate">{label}</span>
    </span>
  );
  return (
    <div className="bv-mock-frame">
      <div className="flex h-[3.6em] shrink-0 items-center justify-between px-[0.9em] pt-[0.5em]">
        <span data-zone="tout" data-halo="tout" className="grid size-[2.4em] place-items-center rounded-full">
          <LayoutGrid className="size-[1.6em]" strokeWidth={2} />
        </span>
        <span data-zone="outils" data-halo="outils" className="flex items-center gap-[0.9em] rounded-full px-[0.5em] py-[0.45em]">
          <CircleHelp className="size-[1.5em]" strokeWidth={2} />
          <Search className="size-[1.5em]" strokeWidth={2} />
        </span>
      </div>
      <div data-zone="reste" className="flex min-h-0 flex-1 flex-col gap-[0.9em] px-[1.1em] pt-[0.3em]">
        <div className="text-[2.1em] font-bold leading-none tracking-tight">Pécule</div>
        {bar("9em")}
        <div className="space-y-[0.7em] rounded-[1.2em] bg-card p-[1em]">
          {bar("60%")}
          <span className="bv-bar bv-bar-strong" style={{ width: "48%", height: "1.5em" }} />
          <svg viewBox="0 0 120 30" preserveAspectRatio="none" className="h-[2.6em] w-full">
            <path d="M0 24 C14 20 22 24 34 17 S54 19 66 11 86 14 98 6 112 8 120 3" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
        <div className="space-y-[0.7em] rounded-[1.2em] bg-card p-[1em]">
          {bar("52%")}
          {bar("88%")}
          {bar("70%")}
        </div>
      </div>
      <div data-halo="onglets" className="flex shrink-0 items-center justify-between border-t border-line bg-card px-[0.5em] pb-[0.9em] pt-[0.55em]">
        <span data-zone="onglets" className="flex flex-1 justify-around">
          {tab(tabs[0], true)}
          {tab(tabs[1], false)}
        </span>
        <span data-zone="assistant" data-halo="assistant" className="grid size-[3.1em] shrink-0 place-items-center rounded-[1em] bg-accent text-white">
          <Sparkles className="size-[1.5em]" strokeWidth={2} />
        </span>
        <span data-zone="onglets" className="flex flex-1 justify-around">
          {tab(tabs[2], false)}
          {tab(tabs[3], false)}
        </span>
      </div>
    </div>
  );
}

/**
 * La maquette de l'appli — celle de l'ordinateur ou celle du téléphone, selon l'appareil — où un halo désigne la zone
 * dont parle la ligne choisie (`spot`) ; le reste s'estompe.
 */
export function ArtLandmarks({ desktop, spot }: { desktop: boolean; spot: Spot }) {
  const root = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const target = el.querySelector<HTMLElement>(`[data-halo="${spot}"]`);
      if (!target) return setBox(null);
      const b = offsetIn(target, el);
      // Le halo déborde un peu de la zone : un demi-cadratin de la maquette.
      const pad = Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.45);
      const next = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
      setBox((prev) => (prev && prev.x === next.x && prev.y === next.y && prev.w === next.w && prev.h === next.h ? prev : next));
    };
    measure();
    // La maquette suit la taille de son volet : le halo se replace.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [spot, desktop]);
  return (
    <div ref={root} className={cn("bv-mock", desktop ? "bv-mock-desk" : "bv-mock-phone")} data-spot={spot}>
      {desktop ? <DeskMock /> : <PhoneMock />}
      <span className="bv-halo" data-ready={box !== null} style={box ? vars({ "--x": `${box.x}px`, "--y": `${box.y}px`, "--w": `${box.w}px`, "--h": `${box.h}px` }) : undefined} />
    </div>
  );
}

/* ---------- Tes comptes ---------- */

function Node({ label, done, children }: { label: string; done: boolean; children: ReactNode }) {
  return (
    <span className="flex w-[6.4em] flex-col items-center gap-[0.45em] text-center">
      <span className="relative">
        {children}
        {done && (
          <span className="guide-check absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-accent text-white shadow-[0_0_0_2px_var(--color-card)]">
            <Check size={12} strokeWidth={3.2} />
          </span>
        )}
      </span>
      <span className="max-w-full truncate text-[12px] font-medium leading-tight">{label}</span>
    </span>
  );
}

/**
 * D'où viennent les opérations : la banque, Enable Banking qui la lit, Pécule qui range. Les traits se remplissent
 * quand la banque est reliée (`linked`) ; `keyed` : Pécule a la clé de l'application.
 */
export function ArtAccounts({ bank, keyed, linked }: { bank: string | null; keyed: boolean; linked: boolean }) {
  return (
    <div className="bv-chain-zoom flex flex-col items-center gap-5">
      <div className="bv-chain">
        <Node label={bank ?? t("Ta banque")} done={linked}>
          {bank ? (
            <BankBadge bank={bank} />
          ) : (
            <span className="grid size-10 place-items-center rounded-xl bg-card text-accent shadow-[0_0_0_1px_var(--color-line)]">
              <Landmark size={19} />
            </span>
          )}
        </Node>
        <span className="bv-link" data-on={linked} />
        <Node label="Enable Banking" done={keyed}>
          <BrandLogo texts={["Enable Banking"]} icon={Plug} />
        </Node>
        <span className="bv-link" data-on={linked} />
        <Node label="Pécule" done={linked}>
          <AppLogo className="size-10 rounded-xl" />
        </Node>
      </div>
      <span className="chip text-[12.5px]">
        <Eye size={13} /> {t("Lecture seule")}
      </span>
    </div>
  );
}

/* ---------- C'est parti ---------- */

/** Pièces qui s'envolent du coffre : départ (x), dérive (dx) et rotation. */
const COINS: [x: number, dx: number, rot: number][] = [
  [-13, -330, -50],
  [-7, -150, 35],
  [-2, -20, -20],
  [3, 110, 40],
  [8, 240, -35],
  [13, 360, 55],
  [0, 40, 20],
];
const STARS: [top: string, left: string, size: string][] = [
  ["12%", "20%", "9%"],
  ["20%", "76%", "7%"],
  ["72%", "10%", "6%"],
  ["78%", "82%", "8%"],
];

/** Le coffre s'ouvre, quelques pièces s'en envolent. */
export function ArtReady() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setOpen(true), 380);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="bv-ready">
      <span className="bv-ready-rays" />
      {STARS.map(([top, left, size], n) => (
        <svg key={n} viewBox="0 0 24 24" className="bv-star" style={{ top, left, width: size, ...vars({ "--n": n }) }}>
          <path fill="currentColor" d="M12 0c.9 6.6 4.5 10.2 12 12-7.5 1.8-11.1 5.4-12 12-.9-6.6-4.5-10.2-12-12C7.5 10.200 11.100 6.600 12 0Z" />
        </svg>
      ))}
      <div className="bv-ready-chest [view-transition-name:pecule-coffre]">
        <ChestLogo open={open} />
      </div>
      {COINS.map(([x, dx, rot], n) => (
        <span key={n} className="bv-coin" style={vars({ "--x": `${x}%`, "--dx": `${dx}%`, "--rot": `${rot}deg`, "--n": n })} />
      ))}
    </div>
  );
}
