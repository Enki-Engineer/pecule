import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, GripVertical, LayoutTemplate, Plus, X } from "lucide-react";
import { Card, Sheet } from "./ui.tsx";
import { cn } from "../cn.ts";
import type { DragSort } from "../dragSort.ts";
import { DASH_CARDS, DASH_KPIS, DASH_TEMPLATES, WIDTH_LABELS, missingCards, missingKpis, rowsOf, templateLayout, templateOf, widthsOf, type DashCardId, type DashKpiId, type DashLayout, type DashTemplateId, type DashWidth } from "../../lib/dashboard.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Mode construction du tableau de bord : ce qui s'ajoute à une carte ou à un chiffre clé pendant qu'on arrange
 * l'écran (la saisir, régler sa largeur, la retirer), la barre du haut, et les deux tiroirs — ajouter ce qui
 * manque, repartir d'un modèle. L'agencement lui-même vit dans pages/Dashboard.tsx.
 */

const tool = "grid size-7 place-items-center rounded-full text-muted hover:bg-bg hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent";

/** Cadre posé sur un bloc en mode construction : on le saisit n'importe où ; la barrette porte ce qui se règle. */
export function EditFrame({ id, label, sort, first, last, onNudge, onRemove, children }: { id: string; label: string; sort: DragSort; first: boolean; last: boolean; onNudge: (d: -1 | 1) => void; onRemove: () => void; children?: ReactNode }) {
  return (
    <>
      <div
        onPointerDown={(e) => sort.start(id, e)}
        className={cn("absolute inset-0 z-10 cursor-grab rounded-[var(--radius-card)] outline-2 -outline-offset-2 outline-dashed outline-line transition-[outline-color] hover:outline-accent", sort.dragging === id && "outline-accent")}
      />
      <div data-nodrag className="absolute -top-3.5 right-3 z-20 flex items-center gap-0.5 rounded-full bg-card p-0.5 shadow-[0_1px_2px_rgb(20_20_19/0.12),0_6px_16px_-8px_rgb(20_20_19/0.3)] ring-1 ring-line">
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
          className={cn(tool, "cursor-grab touch-none")}
        >
          <GripVertical size={15} />
        </button>
        {children}
        <button type="button" onClick={() => onNudge(-1)} disabled={first} aria-label={t("Placer avant")} title={t("Placer avant")} className={tool}>
          <ArrowLeft size={15} />
        </button>
        <button type="button" onClick={() => onNudge(1)} disabled={last} aria-label={t("Placer après")} title={t("Placer après")} className={tool}>
          <ArrowRight size={15} />
        </button>
        <button type="button" onClick={onRemove} aria-label={t("Retirer « {nom} »", { nom: label })} title={t("Retirer du tableau de bord")} className={tool}>
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

/** Barre du mode construction : reste sous la barre du haut pendant qu'on fait défiler le tableau de bord. */
export function EditBar({ onTemplates, onAdd, addCount, onCancel, onDone }: { onTemplates: () => void; onAdd: () => void; addCount: number; onCancel: () => void; onDone: () => void }) {
  const pill = "press flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold";
  return (
    <div className="sticky top-[58px] z-20 flex flex-wrap items-center gap-2 rounded-2xl bg-card/95 px-4 py-2.5 shadow-[0_1px_2px_rgb(20_20_19/0.1),0_14px_30px_-18px_rgb(20_20_19/0.35)] ring-1 ring-line backdrop-blur-md">
      <div className="mr-auto min-w-0">
        <div className="font-semibold">{t("Mode construction")}</div>
        <div className="text-[13px] text-muted">{t("Glisse une carte pour la déplacer, règle sa largeur ou retire-la.")}</div>
      </div>
      <button type="button" onClick={onTemplates} className={cn(pill, "bg-bg text-ink")}>
        <LayoutTemplate size={16} /> {t("Modèles")}
      </button>
      <button type="button" onClick={onAdd} className={cn(pill, "bg-bg text-ink")}>
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

/** Tiroir d'ajout : les chiffres clés et les cartes qui ne sont pas sur le tableau de bord. Un clic les pose à la fin. */
export function AddDrawer({ layout, onAddKpi, onAddCard, onClose }: { layout: DashLayout; onAddKpi: (id: DashKpiId) => void; onAddCard: (id: DashCardId) => void; onClose: () => void }) {
  const kpis = missingKpis(layout);
  const cards = missingCards(layout);
  return (
    <Sheet open onClose={onClose} title={t("Ajouter au tableau de bord")}>
      {!kpis.length && !cards.length && <div className="text-sm text-muted">{t("Tout est déjà sur ton tableau de bord.")}</div>}
      {kpis.length > 0 && (
        <section className="mb-6">
          <h3 className="mb-2 text-[13px] font-medium text-muted">{t("Chiffres clés")}</h3>
          <div className="flex flex-wrap gap-2">
            {kpis.map((id) => (
              <button key={id} type="button" onClick={() => onAddKpi(id)} className="press flex items-center gap-1.5 rounded-full bg-card px-3.5 py-2 text-sm font-medium shadow-[inset_0_0_0_1px_var(--color-line)]">
                <Plus size={15} className="text-accent" /> {t(DASH_KPIS.find((k) => k.id === id)!.label)}
              </button>
            ))}
          </div>
        </section>
      )}
      {cards.length > 0 && (
        <section>
          <h3 className="mb-2 text-[13px] font-medium text-muted">{t("Cartes")}</h3>
          <Card className="divide-y divide-line">
            {cards.map((id) => {
              const c = DASH_CARDS.find((x) => x.id === id)!;
              return (
                <button key={id} type="button" onClick={() => onAddCard(id)} className="press flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium">{t(c.label)}</span>
                    <span className="block text-[13px] text-muted">{t(c.hint)}</span>
                  </span>
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                    <Plus size={16} />
                  </span>
                </button>
              );
            })}
          </Card>
          <p className="mt-3 text-[13px] text-muted">{t("La carte se pose à la fin du tableau de bord : glisse-la ensuite où tu veux.")}</p>
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
