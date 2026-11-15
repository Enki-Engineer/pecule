import { lazy, useState, type ComponentType } from "react";
import { loadChunk } from "./reload.ts";

/*
 * Écrans chargés à la demande, mais préchargés quand l'appareil est au repos. Un React.lazy classique
 * « suspend » au premier rendu même si son code est déjà téléchargé : le squelette remplaçait alors
 * toute la page (impression de rechargement, ex. Opérations → Factures). Ici, une fois le code
 * préchargé, l'écran est rendu directement, sans passer par Suspense.
 */

type Loader<P> = () => Promise<ComponentType<P>>;
type Screen<P> = ComponentType<P> & { preload: () => Promise<void> };

function screen<P extends object>(load: Loader<P>): Screen<P> {
  let Loaded: ComponentType<P> | null = null;
  let pending: Promise<void> | null = null;
  const preload = () =>
    (pending ??= load().then(
      (c) => {
        Loaded = c;
      },
      (e) => {
        pending = null; // nouvel essai au prochain passage (réseau coupé, nouvelle version déployée…)
        throw e;
      },
    ));
  // L'écran est demandé maintenant : si son code manque (nouvelle version déployée), la page se recharge. Un
  // préchargement au repos qui échoue, lui, ne dérange personne.
  const Lazy = lazy(() => loadChunk(preload).then(() => ({ default: Loaded! }))) as unknown as ComponentType<P>;
  // Choix fait une fois par montage : passer de Lazy à Loaded en cours de route remonterait l'écran.
  function S(props: P) {
    const [C] = useState<ComponentType<P>>(() => Loaded ?? Lazy);
    return <C {...props} />;
  }
  return Object.assign(S, { preload });
}

export const Transactions = screen(() => import("./pages/Transactions.tsx").then((m) => m.Transactions));
// Fiche d'une opération, ouverte depuis le tiroir de forage (même code que l'écran Opérations).
export const OperationSheet = screen(() => import("./pages/Transactions.tsx").then((m) => m.OperationSheet));
export const Invoices = screen(() => import("./pages/Invoices.tsx").then((m) => m.Invoices));
export const Settings = screen(() => import("./pages/Settings.tsx").then((m) => m.Settings));
export const Import = screen(() => import("./pages/Import.tsx").then((m) => m.Import));
// Pages à graphiques (Recharts) chargées à la demande : l'accueil s'ouvre plus vite.
export const Month = screen(() => import("./pages/Analysis.tsx").then((m) => m.Analysis));
export const Wealth = screen(() => import("./pages/Wealth.tsx").then((m) => m.Wealth));
export const Crypto = screen(() => import("./pages/Crypto.tsx").then((m) => m.Crypto));
export const Assistant = screen(() => import("./pages/Assistant.tsx").then((m) => m.Assistant));
export const AssistantChat = screen(() => import("./pages/Assistant.tsx").then((m) => m.AssistantChat));
export const LoanDetail = screen(() => import("./pages/Loans.tsx").then((m) => m.LoanDetail));
export const Documents = screen(() => import("./pages/Documents.tsx").then((m) => m.Documents));
export const Agenda = screen(() => import("./pages/Agenda.tsx").then((m) => m.Agenda));
export const Budget = screen(() => import("./pages/Budget.tsx").then((m) => m.Budget));
export const Properties = screen(() => import("./pages/Property.tsx").then((m) => m.Properties));
export const PropertyDetail = screen(() => import("./pages/Property.tsx").then((m) => m.PropertyDetail));
export const Taxes = screen(() => import("./pages/Situation.tsx").then((m) => m.Taxes));
export const Retirement = screen(() => import("./pages/Situation.tsx").then((m) => m.Retirement));
export const Income = screen(() => import("./pages/Situation.tsx").then((m) => m.Income));
export const Projections = screen(() => import("./pages/Situation.tsx").then((m) => m.ProjectionsPage));
export const Compare = screen(() => import("./pages/Compare.tsx").then((m) => m.ComparePage));
export const Goals = screen(() => import("./pages/Goals.tsx").then((m) => m.Goals));
export const Triage = screen(() => import("./pages/Triage.tsx").then((m) => m.Triage));

/** Ordre de préchargement : onglets de l'iPhone d'abord, puis le reste, un écran à la fois. */
const ORDER: Screen<never>[] = [
  Transactions,
  OperationSheet,
  Invoices,
  Month,
  Wealth,
  Assistant,
  AssistantChat,
  Settings,
  Budget,
  Documents,
  Agenda,
  Crypto,
  Properties,
  PropertyDetail,
  LoanDetail,
  Taxes,
  Retirement,
  Income,
  Projections,
  Compare,
  Goals,
  Triage,
] as Screen<never>[];

const idle = (fn: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));

/** Précharge tous les écrans, un par un, quand l'appareil est au repos. */
export function preloadScreens() {
  let i = 0;
  const next = () => {
    const s = ORDER[i++];
    if (!s) return;
    s.preload().then(
      () => idle(next),
      () => idle(next),
    );
  };
  idle(next);
}
