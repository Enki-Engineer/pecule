import { useState } from "react";
import { cleanCardLayout, type CardLayout } from "../../lib/card-layout.ts";

/*
 * Accueil du téléphone à la carte : l'ordre de ses blocs et ceux qu'on a retirés, mémorisés sur l'appareil. On les
 * arrange à l'écran, en mode construction (pages/Home.tsx). Le tableau de bord de l'ordinateur a son propre
 * agencement, gardé par le serveur (src/lib/dashboard.ts).
 */

export { cleanCardLayout, type CardLayout } from "../../lib/card-layout.ts";

export function useCardLayout<T extends string>(storageKey: string, all: readonly T[]): [CardLayout<T>, (l: CardLayout<T>) => void] {
  const [layout, setLayout] = useState<CardLayout<T>>(() => {
    try {
      const saved = cleanCardLayout(all)(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
      if (saved) return saved;
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
