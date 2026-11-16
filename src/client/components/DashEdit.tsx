import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, GripVertical, LayoutTemplate, Plus, X } from "lucide-react";
import { Card, Sheet } from "./ui.tsx";
import { cn } from "../cn.ts";
import type { DragSort } from "../dragSort.ts";
import { DASH_TEMPLATES, WIDTH_LABELS, rowsOf, templateLayout, templateOf, widthsOf, type DashCardId, type DashLayout, type DashTemplateId, type DashWidth } from "../../lib/dashboard.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Mode construction du tableau de bord et de l'accueil du téléphone : ce qui s'ajoute à une carte ou à un chiffre
 * clé pendant qu'on arrange l'écran (la saisir, régler sa largeur, la retirer), la barre du haut, et les deux
 * tiroirs — ajouter ce qui manque, repartir d'un modèle. L'agencement lui-même vit dans pages/Dashboard.tsx et
 * pages/Home.tsx.
 */

const tool = "grid place-items-center rounded-full text-muted hover:bg-bg hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

/** Cadre posé sur un bloc en mode construction : on le saisit n'importe où ; la barrette porte ce qui se règle. */
export function EditFrame({ id, label, sort, first, last, vertical = false, onNudge, onRemove, children }: { id: string; label: string; sort: DragSort; first: boolean; last: boolean; /** Blocs en colonne (téléphone) : les flèches montent et descendent. */ vertical?: boolean; onNudge: (d: -1 | 1) => void; onRemove: () => void; children?: ReactNode }) {
  const Before = vertical ? ArrowUp : ArrowLeft;
  const After = vertical ? ArrowDown : ArrowRight;
  const before = vertical ? t("Monter") : t("Placer avant");
  const after = vertical ? t("Descendre") : t("Placer après");
  // Au doigt (téléphone), des boutons plus larges.
  const btn = cn(tool, vertical ? "size-9" : "size-7");
  return (
    <>
      <div
        onPointerDown={(e) => sort.start(id, e)}
        className={cn("absolute inset-0 z-10 cursor-grab select-none rounded-[var(--radius-card)] [-webkit-touch-callout:none] outline-2 -outline-offset-2 outline-dashed outline-line transition-[outline-color] hover:outline-accent", sort.dragging === id && "outline-accent")}
      />
      <div data-nodrag className={cn("absolute right-3 z-20 flex items-center gap-0.5 rounded-full bg-card p-0.5 shadow-[0_1px_2px_rgb(20_20_19/0.12),0_6px_16px_-8px_rgb(20_20_19/0.3)] ring-1 ring-line", vertical ? "-top-5" : "-top-3.5")}>
        <button
          type="button"
          data-grip
          onPointerDown={(e) => sort.start(id, e)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
            if (!d || (d < 0 ? first : last)) return;
            e.preventDefault();
            onNudge(d);
          }}
          aria-label={t("Déplacer « {nom} » (flèches du clavier)", { nom: label })}
          title={t("Glisser pour déplacer")}
          className={cn(btn, "cursor-grab touch-none")}
        >
          <GripVertical size={15} />
        </button>
        {children}
        <button type="button" onClick={() => onNudge(-1)} disabled={first} aria-label={before} title={before} className={btn}>
          <Before size={15} />
        </button>
        <button type="button" onClick={() => onNudge(1)} disabled={last} aria-label={after} title={after} className={btn}>
          <After size={15} />
        </button>
        <button type="button" onClick={onRemove} aria-label={t("Retirer « {nom} »", { nom: label })} title={t("Retirer du tableau de bord")} className={btn}>
          <X size={15} />
        </button>
      </div>
    </>
  );
}

/** Largeur d'une carte : un petit dessin par largeur permise (un tiers, la moitié, deux tiers, toute la largeur). */
export function WidthPicker({ id, value, onChange }: { id: DashCardId; value: DashWidth; onChange: (w: DashWidth) => void }) {
  return (
    <div role="group" aria-label={t("Largeur de la carte")} className="mx-0.5 flex items-center gap-0.5 border-x border-line px-1">
      {widthsOf(id).map((w) => (
        <button key={w} type="button" onClick={() => onChange(w)} aria-pressed={w === value} aria-label={t(WIDTH_LABELS[w])} title={t(WIDTH_LABELS[w])} className={cn("grid h-7 w-7 place-items-center rounded-md hover:bg-bg", w === value && "bg-bg")}>
          <span className={cn("block h-2.5 w-[18px] overflow-hidden rounded-[3px] ring-1", w === value ? "ring-ink" : "ring-muted/60")}>
            <span className={cn("block h-full", w === value ? "bg-ink" : "bg-muted/60")} style={{ width: `${(w / 12) * 100}%` }} />
          </span>
        </button>
      ))}
    </div>
  );
}

/** Carte qui n'a rien à montrer pour l'instant (aucune enveloppe, résumé pas encore prêt…) : en construction, elle garde sa place. */
export function EmptySlot({ label }: { label: string }) {
  return (
    <Card className="hidden h-full min-h-24 flex-col justify-center px-5 py-4 [.dash-body:empty+&]:flex">
      <div className="font-semibold">{label}</div>
      <div className="text-sm text-muted">{t("Rien à montrer pour l'instant : la carte apparaîtra quand elle aura de quoi.")}</div>
    </Card>
  );
}

/**
 * Barre du mode construction : reste en haut pendant qu'on fait défiler l'écran. Sur téléphone (`compact`), les
 * boutons seuls, sur une ligne ; la consigne est écrite sous la barre, dans la page.
 */
export function EditBar({ compact = false, hint = "", onTemplates, onAdd, addCount, onCancel, onDone }: { compact?: boolean; hint?: string; onTemplates?: () => void; onAdd: () => void; addCount: number; onCancel: () => void; onDone: () => void }) {
  const pill = cn("press flex items-center gap-2 rounded-full py-2 text-sm font-semibold", compact ? "px-3" : "px-4");
  return (
    <div
      className={cn(
        "sticky z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-card/95 shadow-[0_1px_2px_rgb(20_20_19/0.1),0_14px_30px_-18px_rgb(20_20_19/0.35)] ring-1 ring-line backdrop-blur-md",
        compact ? "top-[calc(env(safe-area-inset-top)+0.5rem)] px-2.5 py-2" : "top-[58px] px-4 py-2.5",
      )}
    >
      {!compact && (
        <div className="mr-auto min-w-0">
          <div className="font-semibold">{t("Mode construction")}</div>
          <div className="text-[13px] text-muted">{hint}</div>
        </div>
      )}
      {onTemplates && (
        <button type="button" onClick={onTemplates} className={cn(pill, "bg-bg text-ink")}>
          <LayoutTemplate size={16} /> {t("Modèles")}
        </button>
      )}
      <button type="button" onClick={onAdd} className={cn(pill, "bg-bg text-ink", compact && "mr-auto")}>
        <Plus size={16} /> {t("Ajouter")}
        {addCount > 0 && <span className="tnum rounded-full bg-card px-1.5 text-xs text-muted">{addCount}</span>}
      </button>
      <button type="button" onClick={onCancel} className={cn(pill, "text-muted hover:text-ink")}>
        {t("Annuler")}
      </button>
      <button type="button" onClick={onDone} className={cn(pill, "bg-accent text-card")}>
        <Check size={16} /> {t("Terminé")}
      </button>
    </div>
  );
}

/**
 * Dans le tiroir d'ajout : un clic pose l'élément à la fin ; à la souris, le tirer hors de sa ligne le porte
 * jusqu'à sa place (`out` reçoit la position du pointeur, encore enfoncé).
 */
function pull(e: ReactPointerEvent, out: ((x: number, y: number) => void) | undefined) {
  if (!out || e.pointerType !== "mouse" || e.button !== 0) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
  };
  const move = (ev: PointerEvent) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
    stop();
    out(ev.clientX, ev.clientY);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop);
  window.addEventListener("pointercancel", stop);
}

type AddItem<T extends string> = { id: T; label: string; hint?: string };

/**
 * Tiroir d'ajout : les chiffres clés et les cartes qui ne sont pas à l'écran. Un clic les pose à la fin ; sur
 * ordinateur, on peut aussi les tirer hors du tiroir jusqu'à leur place (`onDragKpi`, `onDragCard`).
 */
export function AddDrawer<K extends string, C extends string>({ title, kpis = [], cards, onAddKpi, onAddCard, onDragKpi, onDragCard, onClose }: { title: string; kpis?: AddItem<K>[]; cards: AddItem<C>[]; onAddKpi?: (id: K) => void; onAddCard: (id: C) => void; onDragKpi?: (id: K, x: number, y: number) => void; onDragCard?: (id: C, x: number, y: number) => void; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title={title}>
      {!kpis.length && !cards.length && <div className="text-sm text-muted">{t("Tout est déjà à l'écran.")}</div>}
      {kpis.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-[13px] font-medium text-muted">{t("Chiffres clés")}</h3>
          <div className="flex flex-wrap gap-2">
            {kpis.map((k) => (
              <button key={k.id} type="button" onClick={() => onAddKpi?.(k.id)} onPointerDown={(e) => pull(e, onDragKpi && ((x, y) => onDragKpi(k.id, x, y)))} className="press flex select-none items-center gap-1.5 rounded-full bg-card px-3.5 py-2 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-line)]">
                <Plus size={15} className="text-accent" /> {k.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {cards.length > 0 && (
        <section>
          {kpis.length > 0 && <h3 className="mb-2 text-[13px] font-medium text-muted">{t("Cartes")}</h3>}
          <Card className="divide-y divide-line">
            {cards.map((c) => (
              <button key={c.id} type="button" onClick={() => onAddCard(c.id)} onPointerDown={(e) => pull(e, onDragCard && ((x, y) => onDragCard(c.id, x, y)))} className="press flex w-full select-none items-center gap-3 px-4 py-3 text-left hover:bg-bg">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-medium">{c.label}</span>
                  {c.hint && <span className="block text-[13px] text-muted">{c.hint}</span>}
                </span>
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <Plus size={16} />
                </span>
              </button>
            ))}
          </Card>
          <p className="mt-3 text-[13px] text-muted">{onDragCard ? t("Un clic pose la carte à la fin du tableau de bord ; tu peux aussi la tirer hors du tiroir jusqu'à sa place.") : t("Le bloc se pose à la fin de l'accueil : déplace-le ensuite où tu veux.")}</p>
        </section>
      )}
    </Sheet>
  );
}

/** Aperçu d'un modèle : la rangée des chiffres clés, puis les cartes à leur largeur. */
function Preview({ layout }: { layout: DashLayout }) {
  return (
    <span aria-hidden className="flex w-28 shrink-0 flex-col gap-[3px] rounded-lg bg-bg p-1.5">
      <span className="flex gap-[3px]">
        {layout.kpis.map((k) => (
          <span key={k} className="h-1.5 flex-1 rounded-[2px] bg-muted/50" />
        ))}
      </span>
      {rowsOf(layout.cards).map((row, i) => (
        <span key={i} className="flex gap-[3px]">
          {row.map((c) => (
            <span key={c.id} className="h-3 rounded-[2px] bg-muted/30" style={{ flex: c.w }} />
          ))}
        </span>
      ))}
    </span>
  );
}

/** Tiroir des modèles : en choisir un remplace l'agencement en cours, qui se modifie ensuite librement. */
export function TemplatesDrawer({ layout, onApply, onClose }: { layout: DashLayout; onApply: (id: DashTemplateId) => void; onClose: () => void }) {
  const current = templateOf(layout);
  return (
    <Sheet open onClose={onClose} title={t("Modèles")}>
      <div className="space-y-2">
        {DASH_TEMPLATES.map((m) => (
          <button key={m.id} type="button" onClick={() => onApply(m.id)} aria-pressed={m.id === current} className={cn("press card flex w-full items-center gap-4 p-3.5 text-left", m.id === current && "ring-2 ring-accent")}>
            <Preview layout={templateLayout(m.id)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-[15px] font-semibold">
                {t(m.label)}
                {m.id === current && <span className="chip text-xs">{t("en place")}</span>}
              </span>
              <span className="mt-0.5 block text-[13px] text-muted">{t(m.hint)}</span>
            </span>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-muted">{t("Un modèle remplace l'agencement en cours ; tu le modifies ensuite comme tu veux. Tant que tu n'as pas choisi « Terminé », « Annuler » rend ton tableau de bord d'avant.")}</p>
    </Sheet>
  );
}
