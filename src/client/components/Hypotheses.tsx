import { Card } from "./ui.tsx";
import { cn } from "../cn.ts";
import { money } from "../format.ts";
import type { Projections } from "../api-situation.ts";
import { splitHypotheses } from "../../lib/projections.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Hypothèses d'une poche des projections. Les trois scénarios répètent presque tout leur texte :
 * on montre côte à côte ce qui change (valeur projetée, écart au point de départ, hypothèses
 * propres), puis une seule fois ce qui vaut pour tous.
 */

export type Scenario = { key: string; label: string };

function Bullets({ items, muted }: { items: string[]; muted?: boolean }) {
  return (
    <ul className={cn("space-y-1 text-[13px] leading-snug", muted && "text-muted")}>
      {items.map((s) => (
        <li key={s} className="flex gap-2">
          <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted" />
          <span className="min-w-0">{s}</span>
        </li>
      ))}
    </ul>
  );
}

const delta = (value: number, start: number) => {
  const pct = Math.round(((value - start) / start) * 100);
  return { pct, text: `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)} %` };
};

export function HypothesisCard({ poche, color, rows, scenarios, className }: { poche: string; color?: string; rows: Projections["rows"]; scenarios: Scenario[]; className?: string }) {
  const row = (key: string) => rows.find((r) => r.poche === poche && r.scenario === key);
  const split = splitHypotheses(Object.fromEntries(scenarios.map((s) => [s.key, row(s.key)?.hypothesis])));
  const start = split.start;
  // Rien de propre à un scénario : trois valeurs côte à côte, même sur iPhone.
  const compact = scenarios.every((s) => (split.specific[s.key] ?? []).length === 0);
  return (
    <Card className={cn("@container p-4", className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          {color && <span aria-hidden className="size-2.5 rounded-sm" style={{ background: color }} />}
          {poche}
        </h3>
        {start && (
          <span className="text-[12.5px] text-muted">
            {t("Départ :")} <span className="tnum font-semibold text-ink">{money(start.amount, true)}</span> {t("nets au {date}", { date: start.date })}
          </span>
        )}
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-3" : "@lg:grid-cols-3")}>
        {scenarios.map((s) => {
          const value = row(s.key)?.value;
          const d = start && start.amount > 0 && value != null ? delta(Number(value), start.amount) : null;
          const own = split.specific[s.key] ?? [];
          return (
            <section key={s.key} className={cn("min-w-0 rounded-lg bg-bg", compact ? "p-2.5" : "p-3")}>
              <div className="text-[12.5px] font-medium text-muted">{s.label}</div>
              <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
                <span className={cn("tnum font-bold", compact ? "text-[15px] @lg:text-[17px]" : "text-[17px]")}>{money(value == null ? null : Number(value), true)}</span>
                {d && <span className={cn("tnum text-[12px] font-medium", d.pct > 0 ? "text-pos" : d.pct < 0 ? "text-neg" : "text-muted")}>{d.text}</span>}
              </div>
              {own.length > 0 && (
                <div className="mt-2 border-t border-line pt-2">
                  <Bullets items={own} />
                </div>
              )}
            </section>
          );
        })}
      </div>
      {split.common.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[12.5px] font-medium text-muted">{compact ? t("Mêmes hypothèses dans tous les scénarios") : t("Dans tous les scénarios")}</div>
          <Bullets items={split.common} muted />
        </div>
      )}
    </Card>
  );
}
