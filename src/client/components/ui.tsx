import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { cn } from "../cn.ts";
import { MobileHeader } from "./MobileShell.tsx";
import { LogoImg, type LogoSize } from "./Logo.tsx";
import { useBankLogoKey, useBrandsVersion } from "../api-brands.ts";
import { brandOf } from "../../lib/brands.ts";
import { Info, X } from "lucide-react";
import { money, moneyIn } from "../format.ts";
import { useMedia } from "../useMedia.ts";
import { isDiscreet } from "../discret.ts";
import { t } from "../../lib/i18n.ts";

export function Card({ className, children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    <div className={clsx("card", onClick && "press cursor-pointer", className)} onClick={onClick}>
      {children}
    </div>
  );
}

/** Pastille « i » : la définition d'un chiffre — au survol, au clavier ou au toucher (components/Tooltip.tsx). */
export function InfoTip({ text }: { text: string }) {
  return (
    <span data-tip={text} tabIndex={0} role="note" aria-label={text} className="grid size-4 shrink-0 place-items-center rounded-full text-muted/70 hover:text-ink">
      <Info size={13} />
    </span>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  const desktop = useMedia("(min-width: 768px)");
  // iPhone : barre du haut (retour ou menu, titre réduit au défilement) et grand titre.
  if (!desktop) return <MobileHeader title={title} subtitle={subtitle} right={right} />;
  return (
    <header className="flex items-end justify-between gap-3 pb-5">
      <div className="min-w-0">
        <h1 className="page-title text-[30px] font-semibold leading-tight tracking-[-0.025em]">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[15px] text-muted">{subtitle}</div>}
      </div>
      {right}
    </header>
  );
}

export function Amount({ value, className, colored = true, round = false }: { value: number | null; className?: string; colored?: boolean; round?: boolean }) {
  return (
    <span className={clsx("tnum whitespace-nowrap", colored && !isDiscreet() && value != null && value > 0 && "text-pos", className)}>
      {value != null && value > 0 && colored && !isDiscreet() ? "+" : ""}
      {money(value, round)}
    </span>
  );
}

/**
 * Montant d'une opération, avec en dessous son montant d'origine quand le compte n'est pas dans la devise du foyer
 * (« −45,00 $US »). Pour un compte dans la devise du foyer : le montant seul, comme `Amount`.
 */
export function TxAmount({ tx, className }: { tx: { amount: number; original_amount?: number | null; original_currency?: string | null }; className?: string }) {
  if (tx.original_amount == null || !tx.original_currency) return <Amount value={tx.amount} className={className} />;
  return (
    <span className="flex flex-col items-end">
      <Amount value={tx.amount} className={className} />
      <span className="tnum whitespace-nowrap text-xs font-normal text-muted">{moneyIn(tx.original_amount, tx.original_currency)}</span>
    </span>
  );
}

/**
 * Choix entre quelques options. Une option peut être indisponible (`disabled`) : elle reste lisible, grisée, et son
 * `title` dit pourquoi au survol (elle garde le focus du clavier : `aria-disabled`, pas l'attribut `disabled`).
 */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; disabled?: boolean; title?: string }[]; onChange: (v: T) => void }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  const track = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  // La pastille prend la place réelle de l'option choisie : les options n'ont la même largeur que si le
  // bandeau est étiré (iPhone) ; sur ordinateur, « Par poche » est plus large que « Net ».
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const buttons = [...el.querySelectorAll<HTMLButtonElement>(":scope > button")];
    const measure = () => {
      const b = buttons[i];
      if (!b) return;
      // Rectangles plutôt qu'offsetLeft/offsetWidth, arrondis à l'entier : la pastille tombe au sous-pixel près.
      const box = el.getBoundingClientRect();
      const r = b.getBoundingClientRect();
      const left = Math.round((r.left - box.left) * 100) / 100;
      const width = Math.round(r.width * 100) / 100;
      setPill((p) => (p && p.left === left && p.width === width ? p : { left, width }));
    };
    measure();
    // Largeur du bandeau ou d'un libellé qui change (fenêtre, police chargée, libellés) : on remesure.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const b of buttons) ro.observe(b);
    return () => {
      ro.disconnect();
    };
  }, [i, options.length]);
  return (
    <div ref={track} className="relative flex rounded-full bg-line/70 p-0.5">
      {/* Pastille qui glisse sous l'option choisie. Posée une fois mesurée (avant le premier affichage) : elle n'arrive donc pas en glissant. */}
      {pill && (
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0 rounded-full bg-card shadow-[0_1px_3px_rgb(20_20_19/0.14)] transition-[transform,width] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
          style={{ width: pill.width, transform: `translateX(${pill.left}px)` }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => !o.disabled && onChange(o.value)}
          aria-pressed={value === o.value}
          aria-disabled={o.disabled || undefined}
          title={o.title}
          className={clsx(
            "relative z-10 flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[14px] font-semibold transition-colors md:px-4 md:py-1 md:text-[13px] md:font-medium",
            value === o.value ? "text-ink" : o.disabled ? "cursor-not-allowed text-muted/45" : "text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Fiches ouvertes, dans l'ordre d'ouverture (la dernière est au-dessus). */
const openSheets: object[] = [];

/**
 * Fiche de détail : feuille qui monte du bas sur l'iPhone, tiroir à droite sur ordinateur (la page
 * reste visible ; clic à côté ou Échap pour fermer ; le panneau de l'assistant reste libre).
 */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const desktop = useMedia("(min-width: 768px)");
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    // Une fiche peut s'ouvrir par-dessus une autre (opération au-dessus du tiroir de forage) :
    // Échap ne ferme que celle du dessus, et la page reste figée tant qu'il en reste une.
    const me = {};
    openSheets.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openSheets.at(-1) === me) closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    // Sur ordinateur, la page reste défilable derrière le tiroir : bloquer le défilement retirait la
    // barre de défilement et décalait toute la page de sa largeur.
    if (!desktop) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      openSheets.splice(openSheets.indexOf(me), 1);
      if (!openSheets.length) document.body.style.overflow = "";
    };
  }, [open, desktop]);
  if (!open) return null;
  // Rendu au niveau du document : au-dessus de la barre supérieure et des transitions d'écran.
  if (desktop)
    return createPortal(
      <div className="drawer-overlay fixed inset-y-0 left-0 right-[var(--assistant-panel,0px)] z-50 bg-ink/10" onClick={onClose}>
        <aside
          role="dialog"
          aria-label={title}
          className="drawer absolute inset-y-0 right-0 flex w-[min(560px,48vw)] flex-col bg-bg shadow-[-16px_0_40px_-8px_rgb(20_20_19/0.18)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex h-[56px] shrink-0 items-center justify-between px-5">
            <h2 className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
            <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-md text-muted hover:bg-bg hover:text-ink" aria-label={t("Fermer (Échap)")} title={t("Fermer (Échap)")}>
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </aside>
      </div>,
      document.body,
    );
  return createPortal(<MobileSheet title={title} onClose={onClose}>{children}</MobileSheet>, document.body);
}

/** Feuille du bas (iPhone) : monte à l'ouverture ; on la ferme en la faisant glisser vers le bas. */
function MobileSheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null);
  const [dy, setDy] = useState(0);
  const [closing, setClosing] = useState(false);
  const close = () => {
    setClosing(true);
    setTimeout(onClose, 200);
  };
  const onStart = (e: React.TouchEvent) => {
    // Depuis la poignée ou l'en-tête, ou depuis le contenu quand il est en haut de son défilement.
    if ((panel.current?.scrollTop ?? 0) > 0) return;
    drag.current = { y: e.touches[0].clientY, t: Date.now(), dy: 0 };
  };
  const onMove = (e: React.TouchEvent) => {
    if (!drag.current) return;
    const d = e.touches[0].clientY - drag.current.y;
    drag.current.dy = Math.max(0, d);
    setDy(drag.current.dy);
  };
  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.dy > 120 || (d.dy > 40 && Date.now() - d.t < 220)) close();
    else setDy(0);
  };
  return (
    <div
      className={cn("sheet-overlay fixed inset-0 z-[60] flex items-end justify-center bg-black/35 transition-opacity duration-200", closing && "opacity-0")}
      onClick={close}
    >
      <div
        ref={panel}
        role="dialog"
        aria-label={title}
        className="sheet-panel safe-bottom max-h-[90dvh] w-full overflow-y-auto overscroll-contain rounded-t-[20px] bg-bg px-4 pb-4 shadow-[0_-8px_30px_rgb(0_0_0/0.12)]"
        style={{ transform: closing ? "translateY(100%)" : dy ? `translateY(${dy}px)` : undefined, transition: drag.current ? "none" : "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)" }}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onStart}
        onTouchMove={onMove}
        onTouchEnd={onEnd}
      >
        <div className="sticky top-0 z-10 -mx-4 bg-bg/95 px-4 pb-2 pt-2 backdrop-blur">
          <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-line" aria-hidden />
          <div className="flex items-center justify-between gap-3">
            <h2 className="min-w-0 truncate text-[18px] font-bold">{title}</h2>
            <button type="button" onClick={close} className="press grid size-8 shrink-0 place-items-center rounded-full bg-card text-muted ring-1 ring-line" aria-label={t("Fermer")}>
              <X size={16} />
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Onglets d'une page (ordinateur et iPhone) ; la valeur vit dans l'adresse (?onglet=…) pour le retour arrière. */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors",
            value === o.value ? "bg-ink text-card" : "text-muted hover:bg-line/60 hover:text-ink",
          )}
        >
          {o.label}
          {o.count != null && <span className="rounded bg-bg px-1.5 text-[11px] text-muted tabular-nums">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Chargement : squelette de cartes (le contenu prend sa place sans saut). */
export function Spinner({ label = t("Chargement…") }: { label?: string }) {
  return (
    <div className="space-y-3 py-2" role="status" aria-label={label}>
      <div className="skeleton h-28 rounded-[var(--radius-card)]" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-20 rounded-[var(--radius-card)]" />
        <div className="skeleton h-20 rounded-[var(--radius-card)]" />
      </div>
      <div className="skeleton h-14 rounded-[var(--radius-card)]" />
      <div className="skeleton h-14 rounded-[var(--radius-card)]" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-muted">{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="card p-4 text-sm text-neg">{error instanceof Error ? error.message : t("Erreur inattendue")}</div>;
}

export function Row({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-0 md:px-4 md:py-2.5">
      <span className="text-[15px] md:text-[13px] md:text-muted">{label}</span>
      <span className="tnum text-right text-[15px] font-medium md:text-[13px]">{value}</span>
    </div>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <div className={clsx("h-2.5 overflow-hidden rounded-full bg-line/80", className)}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(value * 1000) / 10}%` }} />
    </div>
  );
}

/**
 * Pastille d'une banque : pour une banque reliée, le logo donné par Enable Banking quand il fait mieux que l'icône
 * de son site (le serveur en décide : pas de bonne icône, logo ni trop allongé ni trop pâle) ; sinon l'icône du
 * site de la marque ; sinon ses initiales.
 */
export function BankBadge({ bank, size = "lg" }: { bank: string | null; size?: LogoSize }) {
  useBrandsVersion();
  const bankKey = useBankLogoKey(bank);
  const b = (bank ?? "?").toLowerCase();
  const style = b.includes("caisse")
    ? "bg-[#d0121b] text-white"
    : b.includes("bourso")
      ? "bg-[#0a1f44] text-[#ff3e8a]"
      : b.includes("action")
        ? "bg-[#f4b400] text-[#1b2a4a]"
        : b.includes("populaire")
          ? "bg-[#0b3a85] text-white"
          : "bg-accent-soft text-accent";
  const initials = b.includes("caisse") ? "CE" : b.includes("bourso") ? "B" : b.includes("action") ? "AL" : b.includes("populaire") ? "BP" : (bank ?? "?").slice(0, 2).toUpperCase();
  const brand = brandOf(bank);
  const fallback = <span className={cn("grid shrink-0 place-items-center font-bold", size === "sm" ? "size-7 rounded-md text-[10px]" : size === "md" ? "size-9 rounded-[10px] text-xs" : "size-10 rounded-xl text-sm", style)}>{initials}</span>;
  const site = <LogoImg logoKey={brand?.domain ? `d:${brand.domain}` : null} alt={bank ?? ""} size={size} fallback={fallback} />;
  return bankKey ? <LogoImg logoKey={bankKey} alt={bank ?? ""} size={size} fit="contain" fallback={site} /> : site;
}

/** Petite courbe sans axes (SVG pur, sans Recharts pour garder l'accueil léger). */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null;
  const w = 300;
  const h = 48;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={clsx("h-12 w-full", className)} aria-hidden>
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="url(#spark)" />
      <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

/** Champ de saisie en carte (montants par défaut, `text` pour du texte libre). */
export function Field({ label, value, onChange, text, placeholder }: { label: string; value: string; onChange: (v: string) => void; text?: boolean; placeholder?: string }) {
  return (
    <label className="card block px-4 py-3">
      <span className="block text-xs text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={text ? "text" : "decimal"}
        placeholder={placeholder}
        className="tnum w-full bg-transparent text-[17px] font-medium outline-none placeholder:text-muted/60"
      />
    </label>
  );
}
