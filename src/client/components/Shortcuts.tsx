import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { X } from "lucide-react";
import { t } from "../../lib/i18n.ts";
import { useEnabled } from "../modules.ts";

/*
 * Raccourcis clavier (ordinateur) : « ? » affiche l'aide, « g » puis une lettre ouvre un écran
 * (comme dans Gmail ou Linear). Jamais pendant la saisie dans un champ.
 */

export const GO: { key: string; to: string; label: string }[] = [
  { key: "d", to: "/", label: t("Tableau de bord") },
  { key: "o", to: "/operations", label: t("Opérations") },
  { key: "a", to: "/mois", label: t("Analyse") },
  { key: "b", to: "/budget", label: t("Budget") },
  { key: "f", to: "/factures", label: t("Factures") },
  { key: "p", to: "/patrimoine", label: t("Patrimoine") },
  { key: "i", to: "/immobilier", label: t("Immobilier") },
  { key: "c", to: "/patrimoine/crypto", label: t("Crypto") },
  { key: "r", to: "/revenus", label: t("Revenus") },
  { key: "t", to: "/impots", label: t("Impôts") },
  { key: "k", to: "/documents", label: t("Coffre") },
  { key: "e", to: "/echeancier", label: t("Échéancier") },
  { key: "s", to: "/reglages", label: t("Réglages") },
];

const GENERAL: [string, string][] = [
  ["⌘ K", t("Rechercher partout")],
  ["⌘ J", t("Assistant")],
  ["⌘ ⇧ J", t("Assistant en plein écran")],
  ["⌘ \\", t("Replier le menu")],
  ["⌥ ← / ⌥ →", t("Mois précédent / suivant")],
  ["?", t("Cette aide")],
  [t("Échap"), t("Fermer la fiche ou la fenêtre")],
];

const TABLES: [string, string][] = [
  [t("↑ ↓ ou j k"), t("Ligne précédente / suivante")],
  ["x", t("Cocher l'opération (Maj + clic : une plage)")],
  [t("Clic droit"), t("Actions sur la ligne")],
  [t("Clic sur un graphique"), t("Opérations qui le composent")],
];

const typing = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

export function Shortcuts() {
  const navigate = useNavigate();
  const shown = useEnabled(GO);
  const [help, setHelp] = useState(false);
  const [pending, setPending] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelp((h) => !h);
        return;
      }
      if (e.key === "Escape" && help) return setHelp(false);
      if (pending) {
        const go = shown.find((g) => g.key === e.key.toLowerCase());
        setPending(false);
        clearTimeout(timer.current);
        if (go) {
          e.preventDefault();
          e.stopImmediatePropagation();
          setHelp(false);
          navigate(go.to, { viewTransition: true });
        }
        return;
      }
      if (e.key === "g") {
        setPending(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setPending(false), 1200);
      }
    };
    // Phase de capture : la lettre qui suit « g » ne doit pas aussi agir sur le tableau (j, k, x…).
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [help, pending, navigate, shown]);

  return (
    <>
      {pending &&
        createPortal(
          <div className="fixed bottom-5 left-1/2 z-[90] hidden -translate-x-1/2 rounded-md bg-ink px-3 py-1.5 text-[12px] text-white shadow-lg md:block">
            {t("Aller à…")} <span className="opacity-70">{shown.map((g) => g.key).join(" ")}</span>
          </div>,
          document.body,
        )}
      {help &&
        createPortal(
          <div className="fixed inset-0 z-[90] hidden place-items-center bg-black/30 md:grid" onClick={() => setHelp(false)}>
            <div role="dialog" aria-label={t("Raccourcis clavier")} className="w-[640px] max-w-[92vw] rounded-xl bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[15px] font-semibold">{t("Raccourcis clavier")}</h2>
                <button type="button" onClick={() => setHelp(false)} aria-label={t("Fermer")} className="rounded p-1 text-muted hover:bg-bg">
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-5 text-[13px]">
                <Group title={t("Partout")} rows={GENERAL} />
                <Group title={t("Tableaux et graphiques")} rows={TABLES} />
                <div className="col-span-2">
                  <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-muted">{t("Aller à (g puis…)")}</h3>
                  <div className="grid grid-cols-3 gap-x-6 gap-y-1">
                    {shown.map((g) => (
                      <div key={g.key} className="flex items-center gap-2">
                        <Kbd>g</Kbd>
                        <Kbd>{g.key}</Kbd>
                        <span className="text-muted">{g.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function Group({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <h3 className="mb-2 text-[11.5px] font-medium uppercase tracking-wide text-muted">{title}</h3>
      <div className="space-y-1.5">
        {rows.map(([k, label]) => (
          <div key={k} className="flex items-center justify-between gap-3">
            <span className="text-muted">{label}</span>
            <Kbd>{k}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-sans text-[11px] text-ink">{children}</kbd>;
}
