import { Link } from "react-router";
import { AlertTriangle } from "lucide-react";
import { lowAccounts, useBalanceAlert, type AccountForecast } from "../api-balance.ts";
import { dateLong, money } from "../format.ts";
import { cn } from "../cn.ts";
import type { LowPoint } from "../../lib/balance.ts";
import { t } from "../../lib/i18n.ts";

/* Solde bas : ce que la règle du membre signale aujourd'hui, dit en une phrase par compte (calendrier, accueil). */

/** « Compte commun passerait à 170 € le 19/11/2026, après Loyer. » */
export function lowBalanceText(a: AccountForecast & { low: LowPoint }): string {
  if (a.balance < a.threshold) return t("{compte} est sous son seuil : {montant}.", { compte: a.name, montant: money(a.balance, true) });
  const p = { compte: a.name, montant: money(a.low.balance, true), date: dateLong(a.low.date) };
  return a.low.cause ? t("{compte} passerait à {montant} le {date}, après {cause}.", { ...p, cause: a.low.cause.name }) : t("{compte} passerait à {montant} le {date}.", p);
}

/** Les comptes signalés, un encadré par compte ; rien quand tout va bien. Un clic mène au réglage de l'alerte. */
export function LowBalanceNotes({ className }: { className?: string }) {
  const low = lowAccounts(useBalanceAlert().data);
  if (!low.length) return null;
  return (
    <div className={cn("space-y-1.5", className)}>
      {low.map((a) => (
        <Link key={a.id} to="/reglages/notifications" title={t("Régler l'alerte de solde bas")} className="flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[13.5px] font-medium text-warn">
          <AlertTriangle size={16} className="mt-px shrink-0" />
          <span>{lowBalanceText(a)}</span>
        </Link>
      ))}
    </div>
  );
}
