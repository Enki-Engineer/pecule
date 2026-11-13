import { toast } from "sonner";
import { Card } from "./ui.tsx";
import { useFun, useSetFun } from "../fun.ts";
import { FUN_UNITS } from "../../lib/fun.ts";
import { SEASONS } from "../../lib/seasons.ts";
import { t } from "../../lib/i18n.ts";

/** Équivalences amusantes : interrupteur du membre (tous ses appareils), avec l'unité du thème affiché en exemple. */
export function FunSettings() {
  const fun = useFun();
  const save = useSetFun();
  const unit = fun.season ? FUN_UNITS[fun.season] : null;
  const sample = fun.season ? fun.themed(100) : null;
  return (
    <Card>
      <label className="flex items-center justify-between gap-3 px-4 py-3">
        <span>
          <span className="block text-[15px] font-medium">{t("Équivalences amusantes")}</span>
          <span className="block text-xs text-muted">
            {t("Pendant un thème, les dépenses se lisent aussi dans l'unité du moment (litres de bière à la Saint-Patrick, kilos de bonbons à Halloween…) et, toute l'année, en temps de travail d'après tes bulletins de paie. Avec, sur l'accueil, « Le chiffre du moment » et ce que coûte la fête en cours. Aucun montant ne change. Valable sur tous tes appareils, assistant compris.")}
            {!fun.priced && <> {t("Les unités des thèmes ont un prix fixé en euros : dans une autre devise, seule l'équivalence en temps de travail s'affiche.")}</>}
            {fun.enabled && fun.priced && unit && fun.season && (
              <>
                {" "}
                {sample
                  ? t("En ce moment ({theme}) : {unite}, soit 100 € ≈ {equivalent}.", { theme: SEASONS[fun.season].label, unite: `${unit.emoji} ${unit.ref}`, equivalent: sample.text })
                  : t("En ce moment ({theme}) : {unite}.", { theme: SEASONS[fun.season].label, unite: `${unit.emoji} ${unit.ref}` })}
              </>
            )}
          </span>
        </span>
        <input
          type="checkbox"
          checked={fun.enabled}
          disabled={!fun.loaded || save.isPending}
          onChange={(e) =>
            save.mutate(e.target.checked, {
              onSuccess: () => toast.success(e.target.checked ? t("Équivalences activées") : t("Équivalences désactivées")),
              onError: (err) => toast.error(err instanceof Error ? err.message : t("Réglage non enregistré")),
            })
          }
          className="size-5 shrink-0 accent-[var(--color-accent)]"
        />
      </label>
    </Card>
  );
}
