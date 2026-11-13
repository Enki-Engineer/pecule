import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../cn.ts";

/*
 * Réglages → Comptes et connexions : un bloc par connecteur (Enable Banking, Finta, CoinStats…), avec son logo, son
 * nom et son état. Replié, il dit l'essentiel en une ligne ; déplié, il montre ce qu'il alimente puis ses réglages,
 * en parties séparées par un trait (`Part`) — jamais de cadre dans un cadre.
 */

export type ConnectorState = "ok" | "attention" | "off";

const PILL: Record<ConnectorState, string> = { ok: "bg-pos/10 text-pos", attention: "bg-warn/15 text-warn", off: "bg-line/70 text-muted" };

export function Connector({
  logo,
  name,
  summary,
  state,
  stateLabel,
  open,
  onToggle,
  children,
}: {
  logo: ReactNode;
  name: string;
  /** L'essentiel en une ligne : ce qui est relié, depuis quand. */
  summary: string;
  state: ConnectorState;
  stateLabel: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("card overflow-clip", open && "shadow-[0_0_0_1px_var(--color-accent)]")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="press flex w-full items-center gap-3 px-4 py-3.5 text-left">
        {logo}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="text-[16px] font-semibold leading-tight">{name}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold leading-none", PILL[state])}>{stateLabel}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-snug text-muted">{summary}</span>
        </span>
        <ChevronDown size={18} className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="border-t border-line">{children}</div>}
    </div>
  );
}

/** Une partie d'un connecteur déplié : un petit titre, éventuellement une action à droite, et son contenu. */
export function Part({ title, aside, children, flush = false }: { title?: string; aside?: ReactNode; children: ReactNode; flush?: boolean }) {
  return (
    <section className="border-t border-line first:border-t-0">
      {(title || aside) && (
        <header className="flex items-center justify-between gap-3 px-4 pt-3.5">
          {title && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>}
          {aside}
        </header>
      )}
      <div className={cn(flush ? "pt-1.5" : "px-4 pb-4 pt-2", !title && !aside && !flush && "pt-4")}>{children}</div>
    </section>
  );
}

/** Tuile d'icône d'un connecteur sans logo de marque (fichiers, saisie à la main, calendrier…). */
export function ConnectorIcon({ children, tone }: { children: ReactNode; tone: string }) {
  return <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-white", tone)}>{children}</span>;
}

/** Titre d'une famille de connecteurs. */
export function Family({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="scroll-mt-20">
      <h2 className="px-1 text-[15px] font-semibold">{title}</h2>
      {hint && <p className="px-1 text-[13px] text-muted">{hint}</p>}
      <div className="mt-2.5 space-y-2.5">{children}</div>
    </section>
  );
}

/** Bouton discret d'une partie (« Renouveler », « Retirer »…). */
export const quietButton = "press rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-accent hover:bg-accent-soft disabled:opacity-50";
export const dangerButton = "press rounded-lg px-2.5 py-1.5 text-[13px] font-medium text-neg hover:bg-neg/10 disabled:opacity-50";
export const mainButton = "press inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50";
