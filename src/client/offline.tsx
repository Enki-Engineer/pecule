import { useSyncExternalStore, type ReactNode } from "react";
import { QueryClientProvider, onlineManager, type Query } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { WifiOff } from "lucide-react";
import { queryClient } from "./api.ts";
import { t } from "../lib/i18n.ts";

/*
 * Ouverture instantanée, même sans réseau : les dernières données de synthèse (accueil, soldes,
 * mois, patrimoine, budget, échéancier, première page d'opérations) sont gardées sur l'appareil
 * 7 jours au plus, affichées tout de suite puis rafraîchies. Effacées à la déconnexion ; désactivables
 * dans Réglages (« Garder les dernières données sur cet appareil »). Les fichiers (factures,
 * documents) et les conversations de l'assistant ne sont jamais gardés.
 */

const KEY = "pecule.cache";
const OFF_KEY = "pecule.cache.off";
/** Membre à qui appartiennent les données gardées sur cet appareil. */
const OWNER_KEY = "pecule.cache.membre";

/**
 * À appeler dès que l'identité est connue : si ce n'est plus le même membre que celui des données gardées, elles
 * sont effacées avant d'être montrées (retourne vrai dans ce cas).
 */
export function claimOfflineCache(userId: number | null, clear: () => void): boolean {
  const previous = localStorage.getItem(OWNER_KEY);
  if (userId == null) return false;
  localStorage.setItem(OWNER_KEY, String(userId));
  if (previous !== null && previous !== String(userId)) {
    clear();
    return true;
  }
  return false;
}
const MAX_AGE = 7 * 86_400_000;
/** Requêtes gardées (premier élément de la clé). */
const KEEP = new Set(["me", "summary", "accounts", "wealth", "dashboard", "nav-counts", "month", "trend", "balance-series", "categories", "budget", "agenda", "crypto", "properties", "loans", "transactions", "flows"]);

export const offlineCacheEnabled = () => localStorage.getItem(OFF_KEY) !== "1";

/** Oublie les données gardées sur l'appareil (déconnexion, réglage désactivé). */
export function clearOfflineCache() {
  localStorage.removeItem(KEY);
}

export function setOfflineCache(on: boolean) {
  if (on) localStorage.removeItem(OFF_KEY);
  else {
    localStorage.setItem(OFF_KEY, "1");
    clearOfflineCache();
  }
}

function keep(q: Query): boolean {
  if (q.state.status !== "success" || !KEEP.has(String(q.queryKey[0]))) return false;
  // Identité : gardée seulement si quelqu'un est connecté (sinon on enfermerait dehors après connexion).
  if (q.queryKey[0] === "me") return !!(q.state.data as { user?: unknown } | undefined)?.user;
  if (q.queryKey[0] === "transactions") {
    // Liste sans filtre seulement, première page : les opérations récentes.
    const f = q.queryKey[1] as Record<string, unknown> | undefined;
    const data = q.state.data as { pages?: unknown[] } | undefined;
    return !!f && Object.values(f).every((v) => v == null || v === "" || v === false) && (data?.pages?.length ?? 0) <= 1;
  }
  return true;
}

const persister = createSyncStoragePersister({
  storage: typeof window !== "undefined" ? window.localStorage : undefined,
  key: KEY,
  throttleTime: 2000,
});

export function OfflineProvider({ children }: { children: ReactNode }) {
  if (!offlineCacheEnabled()) return <PersistlessProvider>{children}</PersistlessProvider>;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: MAX_AGE, buster: "v1", dehydrateOptions: { shouldDehydrateQuery: keep } }}
      // Données restaurées : l'identité est revérifiée une fois (session expirée → page de connexion).
      onSuccess={() => {
        // Données restaurées d'un autre membre (même navigateur, pas de déconnexion entre les deux) : tout est oublié.
        const kept = (queryClient.getQueryData(["me"]) as { user?: { id?: number } | null } | undefined)?.user?.id;
        if (kept != null && localStorage.getItem(OWNER_KEY) !== String(kept)) queryClient.clear();
        void queryClient.invalidateQueries({ queryKey: ["me"] });
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}

function PersistlessProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Hors ligne : bandeau discret ; les écrans montrent les dernières données connues. */
export function OfflineBanner() {
  const online = useSyncExternalStore(
    (l) => onlineManager.subscribe(l),
    () => onlineManager.isOnline(),
  );
  if (online) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center pt-[calc(env(safe-area-inset-top)+6px)]">
      <span className="flex items-center gap-1.5 rounded-full bg-ink px-3 py-1 text-[12px] font-medium text-white shadow-md">
        <WifiOff size={13} /> {t("Hors ligne · dernières données connues")}
      </span>
    </div>
  );
}
