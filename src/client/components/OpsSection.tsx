import { Activity, createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { DEFAULT_TX_FILTERS, invoiceListQuery, transactionListQuery } from "../api.ts";
import { Invoices, Transactions } from "../screens.tsx";
import { Spinner } from "./ui.tsx";
import { OPS_PATHS, OPS_TABS, opsTab, scrollOnReturn, type OpsTab } from "../../lib/ops-tabs.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Section « Opérations | Factures ». Les deux écrans restent montés tant qu'on va de l'un à l'autre : celui qu'on
 * quitte est seulement masqué (Activity), si bien qu'y revenir ne reconstruit rien — ni les lignes, ni les logos
 * (qui réapparaissaient un à un, comme si la page se rechargeait) — et le rend tel qu'on l'a laissé : filtres de
 * l'adresse, recherche, fiche ouverte, hauteur de défilement. Quitter la section démonte les deux, comme tout écran.
 */

/**
 * L'adresse d'un écran de la section, donnée par la section plutôt que lue dans le navigateur : ses paramètres
 * (ceux de l'adresse quand il est affiché, les derniers qu'il a eus quand il est masqué), l'état porté par le lien
 * qui y a mené, et de quoi changer ses paramètres. Un écran ne suit ainsi que sa propre adresse : passer de l'un à
 * l'autre ne fait rendre à nouveau ni celui qu'on quitte ni celui qu'on retrouve, on l'affiche tel qu'il est.
 */
type SetParams = (next: URLSearchParams, options?: { replace?: boolean }) => void;
type Address = { search: string; state: unknown; setParams: SetParams };
const OwnAddress = createContext<Address | null>(null);
/** Pour la bascule : l'adresse où retrouver chaque écran, et si l'on a déjà basculé (la pastille glisse alors). */
const Tabs = createContext<{ hrefs: Record<OpsTab, string>; slide: boolean } | null>(null);

// Éléments fixes : afficher un écran masqué ne le fait pas rendre à nouveau à cause de son parent.
const SCREENS: Record<OpsTab, ReactNode> = { operations: <Transactions />, factures: <Invoices /> };

/** Code et première page de la liste d'un écran, pour le monter (masqué) avec ses lignes déjà là. */
const warm = (qc: QueryClient, tab: OpsTab) =>
  Promise.all([
    tab === "operations" ? Transactions.preload() : Invoices.preload(),
    tab === "operations"
      ? qc.prefetchInfiniteQuery({ ...transactionListQuery(DEFAULT_TX_FILTERS), staleTime: 60_000 })
      : qc.prefetchInfiniteQuery({ ...invoiceListQuery(undefined, ""), staleTime: 60_000 }),
  ]);

/** Un écran de la section, avec son adresse (stable tant qu'elle ne change pas). */
function TabScreen({ tab, search, state, go }: { tab: OpsTab; search: string; state: unknown; go: (tab: OpsTab, next: URLSearchParams, options?: { replace?: boolean }) => void }) {
  const address = useMemo<Address>(() => ({ search, state, setParams: (next, options) => go(tab, next, options) }), [tab, search, state, go]);
  return (
    <OwnAddress.Provider value={address}>
      <Suspense fallback={<Spinner />}>{SCREENS[tab]}</Suspense>
    </OwnAddress.Provider>
  );
}

export function OpsSection() {
  const { pathname, search, state } = useLocation();
  const tab = opsTab(pathname) ?? "operations";
  // Changer les paramètres d'un écran : une fonction qui ne change jamais (useNavigate en rend une nouvelle à chaque adresse).
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  useLayoutEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const go = useCallback((to: OpsTab, next: URLSearchParams, options?: { replace?: boolean }) => {
    const query = next.toString();
    void navigateRef.current({ pathname: OPS_PATHS[to], search: query ? `?${query}` : "" }, options);
  }, []);

  // Adresse de chaque écran : la sienne quand il est affiché, la dernière qu'il a eue quand il est masqué.
  const [searches, setSearches] = useState<Record<OpsTab, string>>(() => ({ operations: "", factures: "", [tab]: search }));
  if (searches[tab] !== search) setSearches({ ...searches, [tab]: search });

  // L'écran d'arrivée est monté tout de suite ; l'autre dès que sa liste est prête (sans attendre qu'on y aille).
  const [mounted, setMounted] = useState<Record<OpsTab, boolean>>(() => ({ operations: false, factures: false, [tab]: true }));
  if (!mounted[tab]) setMounted({ ...mounted, [tab]: true });
  const qc = useQueryClient();
  const [arrival] = useState(tab);
  useEffect(() => {
    let alive = true;
    const done = () => {
      if (alive) setMounted({ operations: true, factures: true });
    };
    warm(qc, arrival === "operations" ? "factures" : "operations").then(done, done);
    return () => {
      alive = false;
    };
  }, [qc, arrival]);
  const [slide, setSlide] = useState(false);
  if (!slide && tab !== arrival) setSlide(true);

  // Chaque écran garde sa hauteur de défilement (la page est commune aux deux).
  const heights = useRef<Record<OpsTab, number>>({ operations: 0, factures: 0 });
  const shown = useRef<{ tab: OpsTab; searches: Record<OpsTab, string> } | null>(null);
  useLayoutEffect(() => {
    const before = shown.current;
    if (before && before.tab !== tab) window.scrollTo(0, scrollOnReturn({ search: before.searches[tab], y: heights.current[tab] }, search));
    shown.current = { tab, searches };
  }, [tab, search, searches]);
  useEffect(() => {
    const onScroll = () => {
      if (shown.current) heights.current[shown.current.tab] = window.scrollY;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  const tabs = useMemo(() => ({ hrefs: { operations: OPS_PATHS.operations + searches.operations, factures: OPS_PATHS.factures + searches.factures }, slide }), [searches, slide]);
  return (
    <Tabs.Provider value={tabs}>
      {OPS_TABS.map(
        (k) =>
          mounted[k] && (
            <Activity key={k} mode={k === tab ? "visible" : "hidden"}>
              <TabScreen tab={k} search={searches[k]} state={k === tab ? state : null} go={go} />
            </Activity>
          ),
      )}
    </Tabs.Provider>
  );
}

function useOwnAddress(): Address {
  const address = useContext(OwnAddress);
  if (!address) throw new Error("Écran de la section « Opérations | Factures » rendu hors de OpsSection");
  return address;
}

/** Paramètres de l'adresse d'un écran de la section, et de quoi les changer (à la place de useSearchParams). */
export function useTabParams() {
  const { search, setParams } = useOwnAddress();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  return [params, setParams] as const;
}

/** État porté par le lien qui a mené à cet écran (à la place de useLocation().state) ; null quand il est masqué. */
export const useTabState = () => useOwnAddress().state;

/**
 * Champ de recherche d'une liste : le texte saisi, et sa valeur 300 ms après la dernière frappe (celle qu'on envoie
 * au serveur). Un lien qui arrive avec une autre recherche (« ?q=… ») sur l'écran déjà monté remplace le texte.
 */
export function useListSearch(urlQuery: string) {
  const [search, setSearch] = useState(urlQuery);
  const [debounced, setDebounced] = useState(urlQuery.trim());
  const [adopted, setAdopted] = useState(urlQuery);
  if (adopted !== urlQuery) {
    setAdopted(urlQuery);
    setSearch(urlQuery);
    setDebounced(urlQuery.trim());
  }
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  return [search, setSearch, debounced] as const;
}

/** Bascule « Opérations | Factures » (iPhone : Factures n'a plus d'onglet propre). */
export function OpsTabs({ current }: { current: OpsTab }) {
  const tabs = useContext(Tabs);
  const item = (key: OpsTab, label: string) => (
    <Link
      to={tabs?.hrefs[key] ?? OPS_PATHS[key]}
      replace
      data-tab
      aria-current={current === key ? "page" : undefined}
      className={clsx("relative flex-1 rounded-[10px] py-1.5 text-center text-sm font-medium", current === key ? "text-ink" : "text-muted")}
    >
      {label}
    </Link>
  );
  return (
    <div className="relative mb-3 flex gap-1 rounded-xl bg-line/60 p-1 md:hidden">
      {/* Pastille de l'écran affiché : après une bascule, elle arrive du côté qu'on vient de quitter. */}
      <span
        aria-hidden
        className={clsx(
          "absolute inset-y-1 w-[calc(50%-6px)] rounded-[10px] bg-card shadow-sm",
          current === "operations" ? "left-1" : "right-1",
          tabs?.slide && (current === "operations" ? "ops-pill-from-right" : "ops-pill-from-left"),
        )}
      />
      {item("operations", t("Opérations"))}
      {item("factures", t("Factures"))}
    </div>
  );
}
