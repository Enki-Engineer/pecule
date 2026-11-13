import { useEffect, useState } from "react";

/** Vrai tant que la requête média correspond (ex. « (min-width: 1024px) »), suivi en direct. */
export function useMedia(query: string) {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => {
      mq.removeEventListener("change", on);
    };
  }, [query]);
  return match;
}
