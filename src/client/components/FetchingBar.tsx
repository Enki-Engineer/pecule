import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";

/*
 * Fine barre de progression en haut de l'écran pendant un chargement visible (nouveau mois, filtre,
 * écran ouvert pour la première fois) : l'écran reste en place, on sait qu'il se met à jour. Les
 * rafraîchissements en arrière-plan (données déjà affichées) ne l'allument pas.
 */
export function FetchingBar() {
  const n = useIsFetching({ predicate: (q) => q.state.status === "pending" && q.getObserversCount() > 0 });
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!n) return setShow(false);
    const t = setTimeout(() => setShow(true), 180);
    return () => clearTimeout(t);
  }, [n]);
  if (!show) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-[env(safe-area-inset-top)] z-[80] h-0.5 overflow-hidden">
      <div className="fetch-bar h-full w-1/3 rounded-full bg-accent" />
    </div>
  );
}
