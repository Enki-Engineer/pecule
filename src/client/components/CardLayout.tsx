import { useState } from "react";
import clsx from "clsx";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, Sheet } from "./ui.tsx";
import { t } from "../../lib/i18n.ts";

/*
 * Accueil à la carte : l'ordre des blocs d'un écran et ceux qu'on masque, mémorisés sur l'appareil. Sert à
 * l'accueil du téléphone et au tableau de bord de l'ordinateur — chacun sa liste de blocs et sa clé de mémoire.
 */

export type CardLayout<T extends string> = { order: T[]; hidden: T[] };

export function useCardLayout<T extends string>(storageKey: string, all: readonly T[]): [CardLayout<T>, (l: CardLayout<T>) => void] {
  const [layout, setLayout] = useState<CardLayout<T>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as CardLayout<T> | null;
      if (saved) {
        // Nouveaux blocs ajoutés depuis : visibles, à leur place d'origine (juste après le bloc qui les précède).
        const order = saved.order.filter((id) => all.includes(id));
        for (const id of all) if (!order.includes(id)) order.splice(order.indexOf(all[all.indexOf(id) - 1]) + 1, 0, id);
        return { order, hidden: saved.hidden.filter((id) => all.includes(id)) };
      }
    } catch {
      /* réglage illisible : ordre par défaut */
    }
    return { order: [...all], hidden: [] };
  });
  return [
    layout,
    (l) => {
      localStorage.setItem(storageKey, JSON.stringify(l));
      setLayout(l);
    },
  ];
}

/** Fiche de réglage : cocher pour afficher, flèches pour déplacer, et le retour à l'ordre d'origine. */
export function LayoutCustomizer<T extends string>({ title, cards, layout, onChange, onClose }: { title: string; cards: readonly { id: T; label: string }[]; layout: CardLayout<T>; onChange: (l: CardLayout<T>) => void; onClose: () => void }) {
  const move = (i: number, d: -1 | 1) => {
    const order = [...layout.order];
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ ...layout, order });
  };
  const toggle = (id: T) => onChange({ ...layout, hidden: layout.hidden.includes(id) ? layout.hidden.filter((x) => x !== id) : [...layout.hidden, id] });
  return (
    <Sheet open onClose={onClose} title={title}>
      <Card className="divide-y divide-line">
        {layout.order.map((id, i) => (
          <div key={id} className="flex items-center gap-3 px-4 py-2.5">
            <input type="checkbox" checked={!layout.hidden.includes(id)} onChange={() => toggle(id)} aria-label={t("Afficher")} className="size-5 accent-[var(--color-accent)]" />
            <span className={clsx("flex-1 text-[15px]", layout.hidden.includes(id) && "text-muted line-through")}>{cards.find((c) => c.id === id)?.label}</span>
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t("Monter")} title={t("Monter")} className="press grid size-8 place-items-center rounded-lg text-muted disabled:opacity-30">
              <ArrowUp size={17} />
            </button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === layout.order.length - 1} aria-label={t("Descendre")} title={t("Descendre")} className="press grid size-8 place-items-center rounded-lg text-muted disabled:opacity-30">
              <ArrowDown size={17} />
            </button>
          </div>
        ))}
      </Card>
      <button type="button" onClick={() => onChange({ order: cards.map((c) => c.id), hidden: [] })} className="mt-3 w-full py-2 text-sm text-muted">
        {t("Revenir à l'ordre d'origine")}
      </button>
    </Sheet>
  );
}
