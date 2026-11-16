import { useState } from "react";
import type { CardLayout } from "../../lib/card-layout.ts";

/*
 * Accueil du téléphone à la carte : l'ordre de ses blocs et ceux qu'on a retirés, mémorisés sur l'appareil. On les
 * arrange à l'écran, en mode construction (pages/Home.tsx, règles dans src/lib/home-layout.ts). Le tableau de bord
 * de l'ordinateur a son propre agencement, gardé par le serveur (src/lib/dashboard.ts).
 */

/** `clean` relit ce que l'appareil a gardé ; `origin` donne l'agencement d'un appareil qui n'a encore rien réglé. */
export function useCardLayout<T extends string>(storageKey: string, clean: (raw: unknown) => CardLayout<T> | null, origin: () => CardLayout<T>): [CardLayout<T>, (l: CardLayout<T>) => void] {
  const [layout, setLayout] = useState<CardLayout<T>>(() => {
    try {
      const saved = clean(JSON.parse(localStorage.getItem(storageKey) ?? "null"));
      if (saved) return saved;
    } catch {
      /* réglage illisible : agencement d'origine */
    }
    return origin();
  });
  return [
    layout,
    (l) => {
      localStorage.setItem(storageKey, JSON.stringify(l));
      setLayout(l);
    },
  ];
}
