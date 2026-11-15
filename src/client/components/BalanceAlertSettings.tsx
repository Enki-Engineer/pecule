import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Link } from "react-router";
import { AlertTriangle, ChevronRight, TrendingDown } from "lucide-react";
import { Card, Segmented, Spinner } from "./ui.tsx";
import { useBalanceAlert, useSaveBalanceRule, type AccountForecast, type BalanceRulePatch } from "../api-balance.ts";
import { dateLong, money, moneySymbol } from "../format.ts";
import { cn } from "../cn.ts";
import { BALANCE_DAYS } from "../../lib/balance.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Réglages → Notifications et appareil → Solde bas : la règle du membre (elle vaut sur tous ses appareils, et c'est
 * aussi elle que l'assistant lit et modifie). Un seuil, un délai de prévenance, puis compte par compte : surveillé
 * ou non, seuil propre s'il en faut un. Chaque ligne montre ce que la règle donne aujourd'hui : le solde, son point
 * le plus bas à venir, et l'alerte s'il passerait sous le seuil.
 */

const input = "tnum w-24 rounded-lg bg-bg px-2.5 py-1.5 text-right text-[14px] ring-1 ring-line";

/** Champ de montant qui n'enregistre qu'en quittant le champ (ou sur Entrée), et seulement si la valeur a changé. */
function AmountField({ value, placeholder, onCommit, label }: { value: number | null; placeholder?: string; onCommit: (v: number | null) => void; label: string }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setText(value == null ? "" : String(value));
  }, [value]);
  const commit = () => {
    const trimmed = text.trim().replace(",", ".");
    const next = trimmed === "" ? null : Number(trimmed);
    if (next != null && !Number.isFinite(next)) return setText(value == null ? "" : String(value));
    if (next !== value) onCommit(next);
  };
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[14px] text-muted">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className={input}
      />
      {moneySymbol()}
    </span>
  );
}

function AccountRow({ a, ruleThreshold, enabled, onChange }: { a: AccountForecast; ruleThreshold: number; enabled: boolean; onChange: (p: BalanceRulePatch) => void }) {
  const own = a.threshold !== ruleThreshold ? a.threshold : null;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={a.watched}
          disabled={!enabled}
          onChange={(e) => onChange({ accounts: { [a.id]: { watch: e.target.checked } } })}
          aria-label={t("Surveiller {compte}", { compte: a.name })}
          className="size-5 shrink-0 accent-[var(--color-accent)]"
        />
        <div className="min-w-0 flex-1">
          <div className={cn("truncate text-[15px] font-medium", !a.watched && "text-muted")}>{a.name}</div>
          <div className="tnum text-[13px] text-muted">
            {t("Aujourd'hui {montant}", { montant: money(a.balance) })}
            {a.min && a.min.date !== a.points[0]?.date && a.min.balance < a.balance && <> · {t("au plus bas {montant} le {date}", { montant: money(a.min.balance, true), date: dateLong(a.min.date) })}</>}
          </div>
        </div>
        {a.watched && <AmountField value={own} placeholder={String(ruleThreshold)} label={t("Seuil propre à {compte}", { compte: a.name })} onCommit={(v) => onChange({ accounts: { [a.id]: { threshold: v } } })} />}
      </div>
      {a.low && (
        <div className="mt-2 flex items-start gap-2 rounded-lg bg-warn/10 px-3 py-2 text-[13px] text-warn">
          <AlertTriangle size={15} className="mt-px shrink-0" />
          <span>
            {a.balance < a.threshold
              ? t("Déjà sous le seuil de {seuil}.", { seuil: money(a.threshold, true) })
              : a.low.cause
                ? t("Passerait à {montant} le {date}, après {cause}.", { montant: money(a.low.balance, true), date: dateLong(a.low.date), cause: a.low.cause.name })
                : t("Passerait à {montant} le {date}.", { montant: money(a.low.balance, true), date: dateLong(a.low.date) })}
          </span>
        </div>
      )}
    </div>
  );
}

export function BalanceAlertSettings() {
  const q = useBalanceAlert();
  const save = useSaveBalanceRule();
  if (!q.data) return <Spinner />;
  const { rule, accounts } = q.data;
  const change = (patch: BalanceRulePatch) =>
    save.mutate(patch, { onError: (e) => toast.error(e instanceof Error ? e.message : t("Enregistrement impossible")) });
  // Un délai réglé par l'assistant hors des choix proposés reste affiché tel quel.
  const dayChoices = [...new Set([...BALANCE_DAYS, rule.days])].sort((a, b) => a - b);
  return (
    <div className="space-y-3">
      <Card className="divide-y divide-line">
        <label className="flex items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block text-[15px] font-medium">{t("Surveiller mes soldes")}</span>
            <span className="block text-[13px] text-muted">{t("Pécule te prévient quand un compte est sous son seuil, ou va y passer.")}</span>
          </span>
          <input type="checkbox" checked={rule.enabled} onChange={(e) => change({ enabled: e.target.checked })} className="size-5 shrink-0 accent-[var(--color-accent)]" />
        </label>
        <div className={cn("flex items-center justify-between gap-3 px-4 py-3", !rule.enabled && "opacity-50")}>
          <span>
            <span className="block text-[15px] font-medium">{t("Seuil")}</span>
            <span className="block text-[13px] text-muted">{t("En dessous de ce montant, un compte est signalé. Un montant négatif prévient avant la limite d'un découvert autorisé.")}</span>
          </span>
          <AmountField value={rule.threshold} label={t("Seuil")} onCommit={(v) => v != null && change({ threshold: v })} />
        </div>
        <div className={cn("px-4 py-3", !rule.enabled && "opacity-50")}>
          <div className="text-[15px] font-medium">{t("Me prévenir")}</div>
          <div className="mb-2 text-[13px] text-muted">{t("Combien de jours avant que le compte passe sous le seuil (j = jours).")}</div>
          <Segmented value={String(rule.days)} onChange={(v) => change({ days: Number(v) })} options={dayChoices.map((d) => ({ value: String(d), label: t("{n} j", { n: d }) }))} />
        </div>
      </Card>

      {accounts.length > 0 && (
        <>
          <div className="px-1 pt-1 text-[13px] text-muted">{t("Comptes surveillés — décoche un compte pour l'écarter, ou donne-lui un seuil à lui (vide : le seuil ci-dessus).")}</div>
          <Card className="divide-y divide-line">
            {accounts.map((a) => (
              <AccountRow key={a.id} a={a} ruleThreshold={rule.threshold} enabled={rule.enabled} onChange={change} />
            ))}
          </Card>
        </>
      )}
      <Link to="/soldes" viewTransition className="press card flex items-center justify-between gap-3 px-4 py-3 text-[15px] font-medium">
        <span className="flex items-center gap-2.5">
          <TrendingDown size={17} className="text-muted" /> {t("Voir les soldes à venir")}
        </span>
        <ChevronRight size={17} className="text-muted" />
      </Link>
      <p className="px-1 text-[12.5px] leading-relaxed text-muted">
        {t(
          "Comment c'est calculé : le solde du jour, puis ce qui est attendu sur ce compte d'ici là, en entrées comme en sorties — ce qui y revient chaque mois (prélèvements, virements, salaire) et le relevé d'une carte à débit différé. Les achats du quotidien ne sont pas devinés : c'est une estimation, à lire comme « au mieux ». L'alerte arrive en notification si « Solde bas » est activé sur l'appareil, et se lit aussi sur le calendrier du mois et le tableau de bord. Tu peux demander à l'assistant de changer ces réglages.",
        )}
      </p>
    </div>
  );
}
