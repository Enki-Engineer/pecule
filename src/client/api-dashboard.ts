import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, useDemo } from "./api.ts";
import { cleanLayout, defaultLayout, fromLegacy, type DashLayout } from "../lib/dashboard.ts";
import { t } from "../lib/i18n.ts";

/*
 * Agencement du tableau de bord du membre (src/lib/dashboard.ts), gardé par le serveur : il suit le membre d'un
 * ordinateur à l'autre. Le navigateur en garde une copie pour l'afficher sans attendre la réponse.
 */

const KEY = ["dash-layout"];
/** Copie du dernier agencement lu ; la démo a la sienne, pour ne pas se montrer à la place du vrai tableau de bord. */
const copyKey = (demo: boolean) => `pecule.dashboard.layout.v2${demo ? ".demo" : ""}`;
/** L'ancien réglage, gardé par l'appareil avant que le serveur ne s'en charge (ordre et blocs masqués). */
const LEGACY_KEY = "pecule.dashboard.layout";

const read = (key: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
};
/** Sans agencement enregistré : la vue d'ensemble (toujours le même objet, pour ne rien recalculer à chaque rendu). */
const DEFAULT = defaultLayout();
const put = (layout: DashLayout) => api<{ layout: DashLayout }>("/dashboard/layout", { method: "PUT", json: { layout } });

export function useDashLayout(): { layout: DashLayout; save: (layout: DashLayout) => void } {
  const demo = useDemo();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...KEY, demo],
    queryFn: async (): Promise<DashLayout | null> => {
      const saved = cleanLayout((await api<{ layout: unknown }>("/dashboard/layout")).layout);
      if (saved) {
        localStorage.setItem(copyKey(demo), JSON.stringify(saved));
        return saved;
      }
      // Premier passage depuis que le serveur garde l'agencement : celui que l'appareil avait est repris tel quel.
      const legacy = demo ? null : fromLegacy(read(LEGACY_KEY));
      if (legacy) {
        await put(legacy);
        localStorage.setItem(copyKey(demo), JSON.stringify(legacy));
        localStorage.removeItem(LEGACY_KEY);
        return legacy;
      }
      localStorage.removeItem(copyKey(demo));
      return null;
    },
    placeholderData: () => cleanLayout(read(copyKey(demo))),
    staleTime: 5 * 60_000,
  });

  const save = useCallback(
    (layout: DashLayout) => {
      qc.setQueryData([...KEY, demo], layout);
      localStorage.setItem(copyKey(demo), JSON.stringify(layout));
      put(layout).catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : t("Enregistrement impossible"));
        void qc.invalidateQueries({ queryKey: KEY });
      });
    },
    [qc, demo],
  );

  return { layout: q.data ?? DEFAULT, save };
}

/**
 * Brouillon d'un mode construction, gardé le temps de la séance de la fenêtre : quitter l'écran, rétrécir la fenêtre
 * ou recharger la page ne perd pas ce qu'on était en train d'arranger — on retrouve la construction en cours, avec
 * ses boutons « Annuler » et « Terminé ». `clean` relit ce qui a été gardé (`null` s'il n'est plus valable).
 */
export function useSessionDraft<T>(key: string, clean: (raw: unknown) => T | null): [T | null, Dispatch<SetStateAction<T | null>>] {
  const [draft, setDraft] = useState<T | null>(() => {
    try {
      return clean(JSON.parse(sessionStorage.getItem(key) ?? "null"));
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (draft === null) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, JSON.stringify(draft));
    } catch {
      /* stockage refusé (navigation privée) : le brouillon vit le temps de l'écran */
    }
  }, [key, draft]);
  return [draft, setDraft];
}

/** Brouillon du tableau de bord en construction (la démo a le sien). */
export function useDashDraft() {
  const demo = useDemo();
  return useSessionDraft<DashLayout>(`pecule.dashboard.draft${demo ? ".demo" : ""}`, cleanLayout);
}
