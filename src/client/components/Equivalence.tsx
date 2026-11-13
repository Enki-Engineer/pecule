import { cn } from "../cn.ts";
import { useFun } from "../fun.ts";

/**
 * Un montant relu dans l'unité du thème et en temps de travail : « ≈ 12 pintes de bière 🍺 (à 7 € la pinte) · 3 h 20 de travail ».
 * N'affiche rien si les équivalences sont coupées ou si le montant ne fait pas une unité. `prefix` introduit la phrase.
 */
export function Equivalence({ amount, prefix, className }: { amount: number; prefix?: string; className?: string }) {
  const fun = useFun();
  const themed = fun.themed(amount);
  const work = fun.work(amount);
  if (!themed && !work) return null;
  return (
    <div className={cn("text-xs text-muted", className)}>
      {prefix ? `${prefix} ≈ ` : "≈ "}
      {themed && (
        <>
          <span className="font-medium text-ink">
            {themed.text} {themed.emoji}
          </span>{" "}
          ({themed.ref})
        </>
      )}
      {themed && work && " · "}
      {work && <span className={cn(!themed && "font-medium text-ink")}>{work}</span>}
    </div>
  );
}
