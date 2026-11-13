import { useEffect, useSyncExternalStore } from "react";
import { queryClient, setScopeSource } from "./api.ts";
import { addMonths, isYearPeriod, PERIOD_RE } from "../lib/periods.ts";

/*
 * État de la coquille partagé entre les écrans : période globale (mois), périmètre Foyer / Moi,
 * menu replié, libellé dynamique du fil d'Ariane. Petits magasins externes, sans contexte React.
 */

function store<T>(initial: T, persist?: { key: string; storage: Storage }) {
  let value: T = initial;
  if (persist) {
    try {
      const raw = persist.storage.getItem(persist.key);
      if (raw != null) value = JSON.parse(raw) as T;
    } catch {
      /* valeur par défaut */
    }
  }
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(v: T) {
      value = v;
      if (persist) persist.storage.setItem(persist.key, JSON.stringify(v));
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const thisMonth = () => new Date().toLocaleDateString("sv-SE").slice(0, 7);

/* ---------- Période globale ---------- */

const period = store<string>(thisMonth(), { key: "pecule.periode", storage: sessionStorage });
// Dernier mois affiché : en revenant d'une année entière au mois, on retrouve celui qu'on regardait.
let lastMonth = thisMonth();

/** Période valide et pas dans le futur : un mois (« 2026-11 ») ou une année entière (« 2026 »). */
function cleanPeriod(p: string): string {
  const now = thisMonth();
  if (!PERIOD_RE.test(p)) return now;
  if (isYearPeriod(p)) return p > now.slice(0, 4) ? now.slice(0, 4) : p;
  return p > now ? now : p;
}

/**
 * Période affichée par les écrans d'analyse — un mois (AAAA-MM) ou une année entière (AAAA) —, partagée entre les
 * écrans et conservée pendant la session.
 */
export function usePeriod(): [string, (p: string) => void] {
  const p = cleanPeriod(useSyncExternalStore(period.subscribe, period.get));
  if (!isYearPeriod(p)) lastMonth = p;
  return [p, (next) => period.set(cleanPeriod(next))];
}

/** Mois à montrer en quittant une année entière : le dernier regardé s'il est de cette année, sinon son dernier mois écoulé. */
export function monthOfPeriod(p: string): string {
  if (!isYearPeriod(p)) return p;
  if (lastMonth.startsWith(`${p}-`)) return lastMonth;
  const now = thisMonth();
  return p === now.slice(0, 4) ? now : `${p}-12`;
}

export const currentPeriodMonth = thisMonth;

export const shiftMonth = (m: string, delta: number) => addMonths(m, delta);

/* ---------- Périmètre Foyer / Moi ---------- */

export type Scope = "foyer" | "moi";
const scope = store<Scope>("foyer", { key: "pecule.perimetre", storage: localStorage });

/** En-tête envoyé à l'API : « moi » = mes seuls comptes, sans le compte commun. */
setScopeSource(() => scope.get());

/** Périmètre courant, à mettre dans les clés de requête qui en dépendent. */
export const currentScopeKey = () => scope.get();

export function useScope(): [Scope, (s: Scope) => void] {
  const s = useSyncExternalStore(scope.subscribe, scope.get);
  return [
    s,
    (v) => {
      if (v === scope.get()) return;
      scope.set(v);
      // Les chiffres dépendent du périmètre : tout est relu.
      void queryClient.invalidateQueries();
    },
  ];
}

/* ---------- Menu replié ---------- */

const rail = store<boolean>(false, { key: "pecule.menu.replie", storage: localStorage });
export const useRail = (): [boolean, (v: boolean) => void] => [useSyncExternalStore(rail.subscribe, rail.get), rail.set];

/* ---------- Fil d'Ariane ---------- */

const crumb = store<string | null>(null);

/** Libellé de la page courante quand il dépend des données (nom d'un bien, d'un crédit…). */
export function useCrumb(label: string | null | undefined) {
  useEffect(() => {
    crumb.set(label ?? null);
    return () => crumb.set(null);
  }, [label]);
}
export const useCurrentCrumb = () => useSyncExternalStore(crumb.subscribe, crumb.get);
