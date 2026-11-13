import { Link } from "react-router";
import { Card } from "./ui.tsx";
import { cn } from "../cn.ts";
import { dateFr, money } from "../format.ts";
import { useFun } from "../fun.ts";
import { pickHighlight, type FunHighlight } from "../../lib/fun.ts";
import { t, td } from "../../lib/i18n.ts";

const target = (h: FunHighlight): { to: string; state?: { openTx: string } } =>
  h.kind === "depense" && h.transactionId && h.date ? { to: `/operations?mois=${h.date.slice(0, 7)}`, state: { openTx: h.transactionId } } : h.kind === "poste" ? { to: "/mois" } : { to: "/budget" };

/**
 * « Le chiffre du moment » (accueil et tableau de bord) : une dépense mise en lumière par jour, relue dans l'unité
 * du thème et en temps de travail, puis ce que la fête en cours a coûté. Rien si les équivalences sont coupées.
 */
export function FunCard({ className }: { className?: string }) {
  const fun = useFun();
  if (!fun.enabled || !fun.data) return null;
  const h = pickHighlight(fun.data.highlights, new Date());
  const themed = h ? fun.themed(h.amount) : null;
  const work = h ? fun.work(h.amount) : null;
  // Budget de la fête : seulement s'il y a quelque chose à dire (une dépense, ou un point de comparaison).
  const b = fun.data.budget && (fun.data.budget.total > 0 || (fun.data.budget.lastYear ?? 0) > 0) ? fun.data.budget : null;
  const showHighlight = h && (themed || work);
  if (!showHighlight && !b) return null;
  return (
    <Card className={cn("p-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{t("Le chiffre du moment")}</h2>
        <Link to="/reglages/apparence" className="text-sm text-accent">
          {t("Régler")}
        </Link>
      </div>
      <div className={cn("mt-3 grid gap-5", showHighlight && b && "md:grid-cols-2")}>
        {showHighlight && (
          <Link to={target(h).to} state={target(h).state} className="press block">
            <div className="text-sm text-muted">
              <span className="font-medium text-ink">{h.kind === "poste" ? td(h.label) : h.label}</span>, {t("{texte} :", { texte: h.detail })} <span className="tnum font-medium text-ink">{money(h.amount, true)}</span>
            </div>
            <div className="mt-1.5 text-[22px] font-bold leading-tight tracking-tight">
              ≈ {themed ? `${themed.text} ${themed.emoji}` : work}
            </div>
            <div className="mt-1 text-xs text-muted">{[themed?.ref, themed ? work : null].filter(Boolean).join(" · ")}</div>
          </Link>
        )}
        {b && (
          <div className={cn(showHighlight && "border-t border-line pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0")}>
            <div className="text-sm text-muted">
              <span className="font-medium text-ink">{b.title}</span>{t(", ce que ça coûte depuis le {date}", { date: dateFr(b.from) })}
            </div>
            <div className="tnum mt-1.5 text-[22px] font-bold leading-tight tracking-tight">{money(b.total, true)}</div>
            {b.lines.length > 0 && (
              <div className="mt-1 text-xs text-muted">
                {b.lines.map((l) => `${td(l.name)} ${money(l.total, true)}`).join(" · ")}
              </div>
            )}
            <div className="mt-1 text-xs text-muted">
              {t("Compté : {quoi}.", { quoi: b.what })} {b.lastYear == null ? t("Pas encore de comparaison avec l'an dernier.") : t("L'an dernier, sur toute la période : {montant}.", { montant: money(b.lastYear, true) })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
