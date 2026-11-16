/*
 * Accueil du téléphone à la carte : l'ordre de ses blocs et ceux qu'on a retirés, mémorisés sur l'appareil
 * (components/CardLayout.tsx). Règles pures.
 */

export type CardLayout<T extends string> = { order: T[]; hidden: T[] };

/**
 * Réglage relu d'un enregistrement : ne garde que les blocs que cette version connaît, une fois chacun. Un bloc né
 * depuis prend sa place d'origine (juste après le bloc qui le précède) : visible, ou retiré s'il fait partie de
 * `quiet` — un bloc qu'on propose sans l'imposer. `null` si ce n'est pas un réglage.
 */
export function cleanCardLayout<T extends string>(all: readonly T[], quiet: readonly T[] = []): (raw: unknown) => CardLayout<T> | null {
  return (raw) => {
    if (!raw || typeof raw !== "object") return null;
    const { order: savedOrder, hidden: savedHidden } = raw as { order?: unknown; hidden?: unknown };
    if (!Array.isArray(savedOrder) || !Array.isArray(savedHidden)) return null;
    const known = (id: unknown): id is T => all.includes(id as T);
    const order = savedOrder.filter(known).filter((id, i, list) => list.indexOf(id) === i);
    const hidden = savedHidden.filter(known).filter((id, i, list) => list.indexOf(id) === i);
    for (const id of all) {
      if (order.includes(id)) continue;
      order.splice(order.indexOf(all[all.indexOf(id) - 1]) + 1, 0, id);
      if (quiet.includes(id) && !hidden.includes(id)) hidden.push(id);
    }
    return { order, hidden };
  };
}

/** Blocs affichés, dans l'ordre. */
export const shownCards = <T extends string>(l: CardLayout<T>): T[] => l.order.filter((id) => !l.hidden.includes(id));

/** Nouvel ordre des blocs affichés ; les blocs retirés gardent leur rang, à la suite. */
export const reorderShown = <T extends string>(l: CardLayout<T>, shown: readonly T[]): CardLayout<T> => ({ ...l, order: [...shown, ...l.order.filter((id) => !shown.includes(id))] });

/** Retire un bloc de l'écran : il attend dans « Ajouter ». */
export const hideCard = <T extends string>(l: CardLayout<T>, id: T): CardLayout<T> => (l.hidden.includes(id) ? l : { ...l, hidden: [...l.hidden, id] });

/** Remet un bloc à l'écran, à la fin de ceux qu'on voit. */
export const showCard = <T extends string>(l: CardLayout<T>, id: T): CardLayout<T> => {
  const hidden = l.hidden.filter((x) => x !== id);
  return { order: [...l.order.filter((x) => x !== id && !hidden.includes(x)), id, ...l.order.filter((x) => x !== id && hidden.includes(x))], hidden };
};
