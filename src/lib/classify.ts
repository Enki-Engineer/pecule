/*
 * Classement en lot des opérations sans catégorie : règles pures. Les opérations sont réunies par libellé (même clé
 * de libellé, même sens) : c'est un libellé, pas une opération, que l'IA classe — un historique de plusieurs
 * milliers d'opérations tient en quelques centaines de libellés.
 */

export type UnclassedRow = { id: string; label: string; label_key: string | null; amount: number; date: string };
export type LabelGroup = {
  /** Clé de libellé commune (src/lib/labels.ts). */
  key: string;
  credit: boolean;
  /** Le libellé le plus récent du groupe, tel que la banque l'écrit. */
  label: string;
  count: number;
  total: number;
  /** Montant médian : ce que coûte « d'habitude » ce libellé. */
  typical: number;
  last: string;
  ids: string[];
};

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Groupes de libellés, les plus fréquents d'abord (puis les plus gros montants) : classer les premiers classe le
 * plus d'opérations. Une opération sans clé de libellé (libellé fait de seuls chiffres) n'entre dans aucun groupe.
 */
export function groupLabels(rows: UnclassedRow[]): LabelGroup[] {
  const groups = new Map<string, { key: string; credit: boolean; rows: UnclassedRow[] }>();
  for (const r of rows) {
    if (!r.label_key) continue;
    const credit = Number(r.amount) > 0;
    const id = `${credit ? "+" : "-"}${r.label_key}`;
    const g = groups.get(id) ?? { key: r.label_key, credit, rows: [] };
    g.rows.push(r);
    groups.set(id, g);
  }
  return [...groups.values()]
    .map((g) => {
      const amounts = g.rows.map((r) => Number(r.amount)).sort((a, b) => a - b);
      const latest = g.rows.reduce((a, b) => (b.date > a.date ? b : a));
      return { key: g.key, credit: g.credit, label: latest.label, count: g.rows.length, total: round(amounts.reduce((s, a) => s + a, 0)), typical: amounts[Math.floor((amounts.length - 1) / 2)], last: latest.date, ids: g.rows.map((r) => r.id) };
    })
    .sort((a, b) => b.count - a.count || Math.abs(b.total) - Math.abs(a.total) || a.key.localeCompare(b.key));
}

/** Une clé trop courte (« cheque n ») réunit des opérations sans rapport : on n'en fait pas une règle. */
export const ruleWorthy = (key: string) => key.replace(/\s/g, "").length >= 8 && key.split(" ").some((w) => w.length >= 4);

export type ClassConfidence = "haute" | "moyenne" | "basse";
/** Une proposition se coche d'office quand l'IA nomme une catégorie sans la donner pour une supposition. */
export const preselected = (p: { categoryId: string | null; confidence: ClassConfidence }) => !!p.categoryId && p.confidence !== "basse";
