import { SPEND_NATURES } from "./nature.ts";

/*
 * Frise du mois (Analyse → Frise) : règles pures. Chaque opération tombe dans un couloir (ce qui entre, ce qui sort
 * par moyen de paiement, ce qui part en épargne), sa taille dit son montant, et les opérations d'un même jour
 * s'empilent autour de l'axe du couloir. Le cumul suit la définition du « Reste du mois » : entrées − sorties − épargne.
 */

export type TimelinePoint = {
  id: string;
  date: string;
  day: number;
  /** Montant signé : positif quand l'argent entre. */
  amount: number;
  kind: "depense" | "revenu" | "epargne";
  nature: string;
  name: string;
  category: string | null;
  poste: string | null;
};

export type Lane = "entrees" | (typeof SPEND_NATURES)[number] | "epargne";
export const LANES: readonly Lane[] = ["entrees", ...SPEND_NATURES, "epargne"];

/** Couloir d'une opération. Un remboursement entre ; une dépense d'une nature hors liste suit les prélèvements (le cas par défaut des natures). */
export function laneOf(p: Pick<TimelinePoint, "kind" | "amount" | "nature">): Lane {
  if (p.kind === "epargne") return "epargne";
  if (p.kind === "revenu" || p.amount > 0) return "entrees";
  return (SPEND_NATURES as readonly string[]).includes(p.nature) ? (p.nature as Lane) : "prelevement";
}

/** Rayon d'une bulle : l'aire suit le montant (racine carrée), entre un minimum lisible et `max`. */
export function bubbleRadius(amount: number, largest: number, max = 20, min = 4): number {
  if (!(largest > 0)) return min;
  return Math.max(min, Math.min(max, Math.sqrt(Math.abs(amount) / largest) * max));
}

/**
 * Décalages verticaux de bulles empilées sur un même jour (la plus grosse au centre, les suivantes en alternance
 * au-dessus et au-dessous), et la demi-hauteur occupée.
 */
export function stackOffsets(radii: number[], gap = 2): { offsets: number[]; extent: number } {
  const offsets: number[] = [];
  let up = 0;
  let down = 0;
  radii.forEach((r, i) => {
    if (i === 0) {
      offsets.push(0);
      up = down = r;
    } else if (i % 2 === 1) {
      offsets.push(-(up + gap + r));
      up += gap + 2 * r;
    } else {
      offsets.push(down + gap + r);
      down += gap + 2 * r;
    }
  });
  return { offsets, extent: Math.max(up, down) };
}

/** Reste du mois au soir de chaque jour (indice 0 = le 1er) ; null après `upTo` (jours à venir du mois en cours). */
export function cumulativeNet(points: Pick<TimelinePoint, "day" | "amount">[], days: number, upTo = days): (number | null)[] {
  const byDay = new Array<number>(days).fill(0);
  for (const p of points) if (p.day >= 1 && p.day <= days) byDay[p.day - 1] += p.amount;
  let sum = 0;
  return byDay.map((v, i) => {
    sum += v;
    return i < upTo ? Math.round(sum * 100) / 100 : null;
  });
}

/** Graduations rondes d'un axe couvrant [min, max], zéro compris (3 à 5 valeurs). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (hi === lo) return [0];
  const raw = (hi - lo) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) ticks.push(Math.round(v * 100) / 100 || 0);
  return ticks;
}
