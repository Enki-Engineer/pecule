/*
 * Répartition d'un mois (donuts de l'Analyse) : sorties par poste, entrées par catégorie.
 * Mêmes lignes que l'écran Mois (`/months/:month`), donc mêmes totaux.
 *
 * Couleurs : une part garde sa couleur d'un mois à l'autre. Les sorties colorent les 8 postes les
 * plus lourds des 12 derniers mois, rangés dans l'ordre du référentiel (B1, B2…) ; les autres postes
 * partagent le gris « Autres ». Les entrées prennent le rang de leur code (A1 → 1…). Les parts sont
 * dessinées dans cet ordre fixe : chaque poste garde aussi sa place sur l'anneau.
 */

import { tk } from "./i18n.ts";

export const MAX_COLORED = 8;

export type BreakdownRow = { id: string | null; name: string | null; poste: string | null; kind: string | null; total: number; count: number };

export type Part = {
  key: string;
  label: string;
  /** Montant positif ; pour les sorties, dépense nette des remboursements (peut être négative). */
  total: number;
  count: number;
  /** La même part le mois précédent. */
  prev: number;
  /** Rang de couleur (1 à 8, `--series-N`) ; null : gris « Autres » ou hachuré « à classer ». */
  slot: number | null;
  /** Sans catégorie. */
  unclassified: boolean;
  /** Part de l'anneau qui la représente : la sienne, « autres » ou « a-classer ». */
  arc: string;
  /** Filtre des opérations : poste (sorties) ou catégorie (entrées). */
  poste?: string;
  category?: string;
  /** Catégories du poste (sorties), les plus lourdes d'abord. */
  items: { id: string | null; name: string; total: number; count: number }[];
};

const byCode = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true });
const r2 = (n: number) => Math.round(n * 100) / 100 + 0;

/** Postes qui portent une couleur : les plus lourds de la période, dans l'ordre de leur code. */
export function pickColored(rows: { poste: string; code: string; total: number }[], max = MAX_COLORED): string[] {
  return rows
    .filter((r) => Number(r.total) > 0)
    .sort((a, b) => Number(b.total) - Number(a.total))
    .slice(0, max)
    .sort((a, b) => byCode(a.code, b.code))
    .map((r) => r.poste);
}

const finish = (parts: Omit<Part, "arc">[]): Part[] =>
  parts
    .map((p) => ({ ...p, total: r2(p.total), prev: r2(p.prev), arc: p.unclassified ? "a-classer" : p.slot ? p.key : "autres" }))
    .sort((a, b) => b.total - a.total);

/** Sorties du mois par poste. `colored` : postes colorés (du serveur) ; à défaut, ceux du mois. */
export function spendingParts(rows: BreakdownRow[], previous: BreakdownRow[], colored?: string[]): Part[] {
  const spend = (list: BreakdownRow[]) => list.filter((r) => r.kind === "depense");
  const prev = new Map<string, number>();
  for (const r of spend(previous)) prev.set(r.poste ?? "", (prev.get(r.poste ?? "") ?? 0) - Number(r.total));
  const map = new Map<string, Omit<Part, "arc"> & { code: string }>();
  for (const r of spend(rows)) {
    const k = r.poste ?? "";
    const p = map.get(k) ?? { key: k || "a-classer", label: r.poste ?? tk("À classer"), total: 0, count: 0, prev: prev.get(k) ?? 0, slot: null, unclassified: !r.poste, poste: r.poste ?? undefined, items: [], code: r.id ?? "" };
    p.total -= Number(r.total);
    p.count += Number(r.count);
    if (r.id && byCode(r.id, p.code) < 0) p.code = r.id;
    p.items.push({ id: r.id, name: r.name ?? tk("Sans catégorie"), total: r2(-Number(r.total)), count: Number(r.count) });
    map.set(k, p);
  }
  const parts = [...map.values()];
  const order = colored ?? pickColored(parts.filter((p) => !p.unclassified).map((p) => ({ poste: p.label, code: p.code, total: p.total })));
  return finish(
    parts.map(({ code: _code, ...p }) => ({
      ...p,
      slot: p.unclassified || !order.includes(p.label) ? null : order.indexOf(p.label) + 1,
      items: p.items.sort((a, b) => b.total - a.total),
    })),
  );
}

/** Entrées du mois par catégorie. */
export function incomeParts(rows: BreakdownRow[], previous: BreakdownRow[]): Part[] {
  const income = (list: BreakdownRow[]) => list.filter((r) => r.kind === "revenu");
  return finish(
    income(rows).map((r) => {
      const rank = Number(r.id?.match(/\d+/)?.[0] ?? 0);
      return {
        key: r.id ?? "a-classer",
        label: r.name ?? tk("Revenus non classés"),
        total: Number(r.total),
        count: Number(r.count),
        prev: Number(income(previous).find((x) => x.id === r.id)?.total ?? 0),
        slot: r.id && rank >= 1 && rank <= MAX_COLORED ? rank : null,
        unclassified: !r.id,
        category: r.id ?? undefined,
        items: [],
      };
    }),
  );
}

export type Arc = { key: string; label: string; value: number; slot: number | null; unclassified: boolean };

/** Parts de l'anneau, dans l'ordre fixe des couleurs ; « Autres » puis « à classer » ferment la marche. */
export function arcsOf(parts: Part[], othersLabel = tk("Autres postes")): Arc[] {
  const pos = parts.filter((p) => p.total > 0);
  const colored = pos.filter((p) => p.slot).sort((a, b) => a.slot! - b.slot!);
  const others = pos.filter((p) => p.arc === "autres");
  const unclassified = pos.filter((p) => p.unclassified);
  const sum = (list: Part[]) => r2(list.reduce((s, p) => s + p.total, 0));
  return [
    ...colored.map((p) => ({ key: p.arc, label: p.label, value: p.total, slot: p.slot, unclassified: false })),
    // Un seul poste gris : il garde son nom.
    ...(others.length ? [{ key: "autres", label: others.length === 1 ? others[0].label : othersLabel, value: sum(others), slot: null, unclassified: false }] : []),
    ...(unclassified.length ? [{ key: "a-classer", label: unclassified[0].label, value: sum(unclassified), slot: null, unclassified: true }] : []),
  ];
}
