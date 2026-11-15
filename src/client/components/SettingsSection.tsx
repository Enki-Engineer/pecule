import { createContext, useContext, type ReactNode } from "react";

/* Section d'un écran de réglages : un titre et son contenu. Dans un bloc dépliable (Connexions), le bloc porte déjà le titre. */

const Bare = createContext(false);

/** Rend les sections qu'il contient sans leur titre (le bloc qui les accueille l'affiche déjà). */
export function BareSections({ children }: { children: ReactNode }) {
  return <Bare.Provider value={true}>{children}</Bare.Provider>;
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const bare = useContext(Bare);
  if (bare) return <div id={id}>{children}</div>;
  return (
    <section id={id} className="scroll-mt-20">
      <h2 className="mb-2 px-1 text-[15px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
