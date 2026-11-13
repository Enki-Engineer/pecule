import { useId, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/*
 * Anneau de répartition (SVG, sans dépendance). Les parts sont dessinées dans l'ordre reçu, séparées
 * par un filet de la couleur de la carte, coins arrondis. La part survolée ressort, les autres
 * s'effacent ; le centre (enfants) affiche le total ou la part survolée. Une part assez large porte
 * l'icône de son poste : la couleur n'est jamais le seul repère. Le détail accessible au clavier est
 * la liste qui accompagne l'anneau.
 */

export type DonutArc = { key: string; label: string; value: number; color: string; hatched?: boolean; icon?: LucideIcon };

const C = 100;
/** Rayons visibles ; le tracé est rentré de la moitié du contour qui arrondit les coins. */
const R_OUT = 98;
const R_IN = 75;
const ROUND = 3;
/** Filet visible entre deux parts (unités du dessin : ≈ 2,5 px à l'écran). */
const GAP = 2;
const ro = R_OUT - ROUND / 2;
const ri = R_IN + ROUND / 2;
const half = (GAP + ROUND) / 2;
const padOut = Math.asin(half / ro);
const padIn = Math.asin(half / ri);
/** Part la plus fine qui reste visible. */
const MIN_SWEEP = 2 * padIn + 0.03;
const ICON = 11;

const pt = (r: number, a: number) => `${(C + r * Math.sin(a)).toFixed(2)},${(C - r * Math.cos(a)).toFixed(2)}`;

/** Angles de chaque part : proportionnels, avec un minimum pour que les petites restent visibles. */
function layout(values: number[]) {
  const total = values.reduce((s, v) => s + v, 0);
  const raw = values.map((v) => (v / total) * 2 * Math.PI);
  const small = raw.filter((s) => s < MIN_SWEEP).length;
  const large = raw.filter((s) => s >= MIN_SWEEP).reduce((s, v) => s + v, 0);
  const scale = large > 0 ? (2 * Math.PI - small * MIN_SWEEP) / large : 1;
  let a = 0;
  return raw.map((s) => {
    const sweep = s < MIN_SWEEP ? MIN_SWEEP : s * scale;
    const out = { start: a, end: a + sweep };
    a += sweep;
    return out;
  });
}

export function Donut({
  arcs,
  active,
  onActive,
  onPick,
  label,
  children,
}: {
  arcs: DonutArc[];
  active: string | null;
  onActive: (key: string | null) => void;
  onPick?: (key: string) => void;
  /** Description pour les lecteurs d'écran. */
  label: string;
  children?: ReactNode;
}) {
  const id = useId();
  const shown = arcs.filter((a) => a.value > 0);
  const angles = shown.length ? layout(shown.map((a) => a.value)) : [];
  const paint = (a: DonutArc) => (a.hatched ? `url(#${id})` : a.color);
  return (
    <div className="relative aspect-square w-full">
      <svg viewBox="0 0 200 200" className="size-full overflow-visible" role="img" aria-label={label} onMouseLeave={() => onActive(null)}>
        <defs>
          <pattern id={id} patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--color-line)" />
            <rect width="2" height="5" fill="var(--color-muted)" />
          </pattern>
        </defs>
        {!shown.length && <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} fill="none" stroke="var(--color-line)" strokeWidth={R_OUT - R_IN} />}
        {shown.map((a, i) => {
          const { start, end } = angles[i];
          const dim = active != null && active !== a.key;
          const common = {
            opacity: dim ? 0.28 : 1,
            style: { cursor: onPick ? "pointer" : "default", transition: "opacity 150ms" },
            onMouseEnter: () => onActive(a.key),
            onClick: () => onPick?.(a.key),
          } as const;
          const mid = (start + end) / 2;
          const Icon = a.icon;
          // Icône seulement si la part est assez large pour sa pastille.
          const room = (end - start) * ((R_OUT + R_IN) / 2) > 34;
          return (
            <g key={a.key} aria-hidden {...common}>
              {shown.length === 1 ? (
                <circle cx={C} cy={C} r={(R_OUT + R_IN) / 2} fill="none" stroke={paint(a)} strokeWidth={R_OUT - R_IN} />
              ) : (
                <path
                  d={`M${pt(ro, start + padOut)} A${ro},${ro} 0 ${end - start - 2 * padOut > Math.PI ? 1 : 0} 1 ${pt(ro, end - padOut)} L${pt(ri, end - padIn)} A${ri},${ri} 0 ${end - start - 2 * padIn > Math.PI ? 1 : 0} 0 ${pt(ri, start + padIn)} Z`}
                  fill={paint(a)}
                  stroke={paint(a)}
                  strokeWidth={ROUND}
                  strokeLinejoin="round"
                />
              )}
              {Icon && room && (
                <g transform={`translate(${C + ((R_OUT + R_IN) / 2) * Math.sin(mid)} ${C - ((R_OUT + R_IN) / 2) * Math.cos(mid)})`}>
                  <circle r={8.5} fill="var(--color-card)" />
                  <Icon x={-ICON / 2} y={-ICON / 2} width={ICON} height={ICON} strokeWidth={2.2} color="var(--color-ink)" />
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="w-[58%] text-center">{children}</div>
      </div>
    </div>
  );
}
