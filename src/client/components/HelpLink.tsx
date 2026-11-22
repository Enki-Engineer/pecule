import { Link, useLocation } from "react-router";
import { CircleHelp } from "lucide-react";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";
import { helpPath } from "../../lib/manual-help.ts";

/** « ? » de la barre du haut : ouvre la page du manuel qui explique l'écran affiché (absent dans le manuel lui-même). */
export function HelpLink({ className, size = 15, tour }: { className?: string; size?: number; /** Repère de la visite guidée (`data-tour`). */ tour?: string }) {
  const { pathname, search } = useLocation();
  if (pathname.startsWith("/manuel")) return null;
  return (
    <Link to={helpPath(pathname + search)} title={t("Aide sur cet écran")} aria-label={t("Aide sur cet écran")} data-tour={tour} className={cn("grid shrink-0 place-items-center rounded-full", className)}>
      <CircleHelp size={size} />
    </Link>
  );
}
