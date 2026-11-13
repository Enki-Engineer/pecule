import { Link } from "react-router";
import { Presentation } from "lucide-react";
import { useDemo } from "../api.ts";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";

/** Petit rappel discret « Démo » (barre du haut) ; mène au réglage pour en sortir. */
export function DemoBadge({ className }: { className?: string }) {
  if (!useDemo()) return null;
  return (
    <Link
      to="/reglages/demo"
      title={t("Mode démo : données fictives")}
      className={cn("demo-badge flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", className)}
    >
      <Presentation size={12} /> {t("Démo")}
    </Link>
  );
}
