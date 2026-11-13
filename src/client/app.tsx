import { Fragment, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { Toaster } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adoptRegion, region } from "./region.ts";
import { api, useMe } from "./api.ts";
import { adoptData, appLang, applyLang, hasData } from "./i18n.ts";
import { claimOfflineCache, clearOfflineCache, OfflineBanner, OfflineProvider } from "./offline.tsx";
import { Layout } from "./components/Layout.tsx";
import { Spinner } from "./components/ui.tsx";
import { Enroll, Login } from "./pages/Auth.tsx";
import { Authorize } from "./pages/Authorize.tsx";
import { Privacy, Terms } from "./pages/Legal.tsx";
import { Home } from "./pages/Home.tsx";
import {
  Agenda,
  Assistant,
  Budget,
  Compare,
  Crypto,
  Documents,
  Goals,
  Import,
  Income,
  Invoices,
  LoanDetail,
  Month,
  preloadScreens,
  Projections,
  Properties,
  PropertyDetail,
  Retirement,
  Settings,
  Taxes,
  Transactions,
  Triage,
  Wealth,
} from "./screens.tsx";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const location = useLocation();
  // isPending (et non isLoading) : pendant la restauration des données gardées sur l'appareil, la requête
  // attend sans charger ; conclure « pas connecté » à ce moment renvoyait à tort vers la connexion.
  // Langue choisie par le membre (sur cet appareil ou un autre) : adoptée ici dès qu'elle vient du serveur, pas d'une copie gardée sur l'appareil.
  const language = me.isFetchedAfterMount ? me.data?.user?.language : null;
  // Données gardées sur l'appareil : elles appartiennent au membre connecté ; un autre membre les fait effacer.
  const qc = useQueryClient();
  const memberId = me.isFetchedAfterMount ? (me.data?.user?.id ?? null) : null;
  useEffect(() => {
    if (
      claimOfflineCache(memberId, () => {
        clearOfflineCache();
        qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      })
    )
      void qc.invalidateQueries();
  }, [memberId, qc]);
  useEffect(() => {
    if (language && language !== appLang()) applyLang(language);
  }, [language]);
  // Noms de catégories et de postes dans la langue de l'appli : rafraîchis à chaque ouverture ; s'ils changent,
  // les écrans sont remontés une fois (clé). Sans copie sur l'appareil, on attend le premier envoi plutôt que
  // d'afficher les noms en français puis de les remplacer.
  const signedIn = !!me.data?.user;
  const names = useQuery({ queryKey: ["i18n-data"], queryFn: () => api<{ names: Record<string, string> }>("/i18n/data"), staleTime: 10 * 60_000, enabled: signedIn });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (names.data && adoptData(names.data.names)) setVersion((v) => v + 1);
  }, [names.data]);
  if (me.isPending) return <Spinner />;
  if (!me.data?.user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (appLang() !== "fr" && !hasData() && names.isPending) return <Spinner />;
  // Pays, devise et fuseau du foyer : adoptés avant d'afficher un montant ; les écrans sont remontés s'ils changent (clé).
  adoptRegion(me.data.user.region);
  const { currency, timeZone, country } = region();
  return <Fragment key={`${version}:${country}:${currency}:${timeZone}`}>{children}</Fragment>;
}

function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<Login />} />
      <Route path="/inscription" element={<Enroll />} />
      <Route path="/autoriser" element={<Authorize />} />
      {/* Pages publiques : lisibles sans connexion. */}
      <Route path="/confidentialite" element={<Privacy />} />
      <Route path="/conditions" element={<Terms />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Home />} />
        <Route path="operations" element={<Transactions />} />
        <Route path="tri" element={<Triage />} />
        <Route path="comparer" element={<Compare />} />
        <Route path="objectifs" element={<Goals />} />
        <Route path="factures" element={<Invoices />} />
        <Route path="mois" element={<Month />} />
        <Route path="patrimoine" element={<Wealth />} />
        <Route path="patrimoine/crypto" element={<Crypto />} />
        <Route path="credits" element={<Navigate to="/patrimoine" replace />} />
        <Route path="credits/:id" element={<LoanDetail />} />
        <Route path="budget" element={<Budget />} />
        <Route path="immobilier" element={<Properties />} />
        <Route path="immobilier/:id" element={<PropertyDetail />} />
        <Route path="impots" element={<Taxes />} />
        <Route path="retraite" element={<Retirement />} />
        <Route path="revenus" element={<Income />} />
        <Route path="projections" element={<Projections />} />
        <Route path="documents" element={<Documents />} />
        <Route path="echeancier" element={<Agenda />} />
        <Route path="importer" element={<Import />} />
        <Route path="reglages" element={<Settings />} />
        <Route path="reglages/:groupe" element={<Settings />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <OfflineProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <OfflineBanner />
      <Toaster position="top-center" richColors />
    </OfflineProvider>
  </StrictMode>,
);

// Écrans préchargés quand l'appareil est au repos : le premier passage sur un écran reste instantané.
preloadScreens();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
