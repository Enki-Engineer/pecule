import { Link } from "react-router";
import { AlertTriangle, ChevronRight, Settings2 } from "lucide-react";
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

/**
 * Les comptes signalés, un bandeau par compte ; rien quand tout va bien. Le bandeau mène à la prévision du compte
 * (« Soldes à venir ») ; à sa droite, un bouton à part règle l'alerte.
 */
export function LowBalanceNotes({ className }: { className?: string }) {
  const low = lowAccounts(useBalanceAlert().data);
  if (!low.length) return null;
  return (
    <div className={cn("space-y-1.5", className)}>
      {low.map((a) => (
        <div key={a.id} className="flex items-stretch gap-1.5">
          <Link to={`/soldes?compte=${encodeURIComponent(a.id)}`} viewTransition title={t("Voir la prévision de ce compte")} className="press flex min-w-0 flex-1 items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-[13.5px] font-medium text-warn">
            <AlertTriangle size={16} className="mt-px shrink-0" />
            <span className="min-w-0 flex-1">{lowBalanceText(a)}</span>
            <ChevronRight size={16} className="mt-px shrink-0" />
          </Link>
          <Link to="/reglages/notifications" viewTransition title={t("Régler l'alerte de solde bas")} aria-label={t("Régler l'alerte de solde bas")} className="press flex shrink-0 items-center gap-1.5 rounded-xl bg-card px-3 text-[13px] font-semibold text-ink shadow-[inset_0_0_0_1px_var(--color-line)]">
            <Settings2 size={15} />
            <span className="hidden sm:inline">{t("Régler")}</span>
          </Link>
        </div>
      ))}
    </div>
  );
}
