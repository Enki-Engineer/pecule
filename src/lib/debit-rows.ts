import { brandOf } from "./brands.ts";

/*
 * Prélèvements d'une année, une ligne par créancier. Le nom d'un même créancier change parfois en cours d'année
 * (nom donné par la banque, puis par un engagement du budget ; opérations venues d'une autre source) : deux lignes
 * qui ne se chevauchent sur aucun mois sont réunies quand elles désignent visiblement le même prélèvement — même
 * marque, ou même catégorie et même montant. Le nom le plus récent l'emporte. Pur et testé.
 */

export type DebitRow = { name: string; category: string | null; byMonth: number[]; count: number; total: number };

const months = (r: DebitRow) => r.byMonth.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
const overlap = (a: DebitRow, b: DebitRow) => a.byMonth.some((v, i) => v > 0 && b.byMonth[i] > 0);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const typical = (r: DebitRow) => median(r.byMonth.filter((v) => v > 0));

function same(a: DebitRow, b: DebitRow): boolean {
  if (overlap(a, b)) return false;
  const brandA = brandOf(a.name)?.domain;
  if (brandA && brandA === brandOf(b.name)?.domain) return true;
  const [x, y] = [typical(a), typical(b)];
  return !!a.category && a.category === b.category && x > 0 && Math.abs(x - y) <= Math.max(x, y) * 0.03;
}

/** Réunit les lignes qui désignent le même prélèvement sous deux noms, et trie par total décroissant. */
export function mergeDebitRows(rows: DebitRow[]): DebitRow[] {
  // Les plus récentes d'abord : c'est leur nom qui reste.
  const sorted = [...rows].sort((a, b) => Math.max(...months(b), -1) - Math.max(...months(a), -1) || b.total - a.total);
  const out: DebitRow[] = [];
  for (const r of sorted) {
    const host = out.find((o) => same(o, r));
    if (!host) {
      out.push({ ...r, byMonth: [...r.byMonth] });
      continue;
    }
    host.byMonth = host.byMonth.map((v, i) => Math.round((v + r.byMonth[i]) * 100) / 100);
    host.count += r.count;
    host.total = Math.round((host.total + r.total) * 100) / 100;
  }
  return out.sort((a, b) => b.total - a.total);
}
