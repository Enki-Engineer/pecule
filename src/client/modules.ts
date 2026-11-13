import { useMemo } from "react";
import { useMe } from "./api.ts";
import { NAV } from "./nav.ts";
import { pathEnabled, type ModuleId } from "../lib/modules.ts";

/* Écrans facultatifs retirés par le foyer (src/lib/modules.ts) : la liste arrive avec l'identité (`/auth/me`). */

const NONE: readonly ModuleId[] = [];

export function useModulesOff(): readonly ModuleId[] {
  return useMe().data?.user?.modulesOff ?? NONE;
}

/** Ne garde, d'une liste de liens, que ceux dont l'écran est affiché. */
export function useEnabled<T extends { to: string }>(items: readonly T[]): readonly T[] {
  const off = useModulesOff();
  return useMemo(() => (off.length ? items.filter((i) => pathEnabled(i.to, off)) : items), [items, off]);
}

/** Le menu de l'appli sans les écrans retirés (un groupe vidé disparaît). */
export function useNav(): typeof NAV {
  const off = useModulesOff();
  return useMemo(() => (off.length ? NAV.map((g) => ({ ...g, items: g.items.filter((i) => pathEnabled(i.to, off)) })).filter((g) => g.items.length) : NAV), [off]);
}
