import { useState, type ReactNode } from "react";
import { Card } from "./ui.tsx";
import { Donut } from "./Donut.tsx";
import { cn } from "../cn.ts";
import { money } from "../format.ts";

/*
 * Carte « en anneau » du tableau de bord : une répartition qui se lit d'un coup d'œil — l'anneau, son total au
 * centre, et à côté les parts avec leur montant et leur poids. Survoler une part (ou sa ligne) la fait ressortir et
 * l'écrit au centre ; un clic ouvre ce qu'elle contient. Sert aux dépenses du mois et à la répartition du patrimoine.
 */

export type RingPart = { key: string; label: string; value: number; color: string; /** Part sans catégorie : hachurée. */ hatched?: boolean; onPick?: () => void };

export function RingCard({ title, action, parts, noun, empty, className }: { title: string; /** Lien en haut à droite. */ action?: ReactNode; parts: RingPart[]; /** Ce que compte le total, écrit sous lui (« dépensé »). */ noun: string; /** Dit à la place de l'anneau quand il n'y a rien à répartir. */ empty: string; className?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  const pct = (v: number) => `${Math.round((v / total) * 100)} %`;
  const focus = shown.find((p) => p.key === active);
  return (
    <Card className={cn("@container p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {!total ? (
        <div className="text-sm text-muted">{empty}</div>
      ) : (
        <div className="flex flex-col items-center gap-4 @[17rem]:flex-row">
          <div data-chart className="w-[8.25rem] shrink-0 @[26rem]:w-[9.5rem]">
            <Donut
              arcs={shown.map((p) => ({ key: p.key, label: p.label, value: p.value, color: p.color, hatched: p.hatched }))}
              active={active}
              onActive={setActive}
              onPick={(k) => shown.find((p) => p.key === k)?.onPick?.()}
              label={`${title} : ${shown.map((p) => `${p.label} ${pct(p.value)}`).join(", ")}`}
            >
              {focus ? (
                <>
                  <div className="line-clamp-2 text-[11.5px] leading-tight text-muted">{focus.label}</div>
                  <div className="tnum mt-0.5 text-[14px] font-bold leading-tight @[26rem]:text-[15px]">{money(focus.value, true)}</div>
                  <div className="tnum text-[11.5px] text-muted">{pct(focus.value)}</div>
                </>
              ) : (
                <>
                  <div className="tnum text-[15px] font-bold leading-tight @[26rem]:text-[16px]">{money(total, true)}</div>
                  <div className="text-[11.5px] text-muted">{noun}</div>
                </>
              )}
            </Donut>
          </div>
          <ul className="w-full min-w-0 flex-1">
            {shown.map((p) => (
              <li key={p.key}>
                <button
                  type="button"
                  onClick={p.onPick}
                  onMouseEnter={() => setActive(p.key)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(p.key)}
                  onBlur={() => setActive(null)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left text-[13.5px]", active === p.key && "bg-bg")}
                >
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
                  <span className="min-w-0 flex-1 truncate">{p.label}</span>
                  <span className="tnum shrink-0 font-medium">{money(p.value, true)}</span>
                  <span className="tnum hidden w-9 shrink-0 text-right text-[12.5px] text-muted @[26rem]:block">{pct(p.value)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
