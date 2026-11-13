import { CURRENCIES } from "../../lib/currencies.ts";
import { locale, t } from "../../lib/i18n.ts";

/** Nom d'une devise dans la langue de l'appli (« franc suisse »), à défaut son code. */
export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames([locale()], { type: "currency" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Choix d'une devise parmi celles que Pécule sait convertir. `short` : le code seul (à côté d'un montant). */
export function CurrencySelect({ value, onChange, short = false, className = "card px-3 py-2 text-sm", label = t("Devise") }: { value: string; onChange: (code: string) => void; short?: boolean; className?: string; label?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={className}>
      {CURRENCIES.map((code) => (
        <option key={code} value={code}>
          {short ? code : `${code} — ${currencyName(code)}`}
        </option>
      ))}
    </select>
  );
}
