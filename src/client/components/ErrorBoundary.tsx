import { Component, type ErrorInfo, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { t } from "../../lib/i18n.ts";
import { clearOfflineCache } from "../offline.tsx";

/*
 * Garde-fou d'affichage : une erreur pendant le rendu d'un écran (ou d'un bloc, avec `fallback`) ne démonte plus
 * toute l'appli — sans lui, il ne restait que le fond de la page. À la place : un message et « Recharger », qui
 * oublie d'abord les données gardées sur l'appareil : si c'est l'une d'elles que l'écran n'a pas su lire (gardée par
 * une version d'avant, sous une autre forme), recharger avec elle ramènerait au même message.
 */

type Props = { children: ReactNode; /** Ce qui remplace le bloc en panne ; par défaut, le message de pleine page. */ fallback?: ReactNode };

export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("[écran]", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="card max-w-sm p-6 text-center">
          <p className="text-[17px] font-semibold">{t("Cet écran n'a pas pu s'afficher")}</p>
          <p className="mt-2 text-sm text-muted">{t("Recharge la page pour repartir : tes données ne sont pas touchées.")}</p>
          <button
            type="button"
            onClick={() => {
              clearOfflineCache();
              window.location.reload();
            }}
            className="press mx-auto mt-4 flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 font-semibold text-white"
          >
            <RefreshCw size={16} /> {t("Recharger")}
          </button>
        </div>
      </div>
    );
  }
}
