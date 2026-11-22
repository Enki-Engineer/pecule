import { one } from "./db.ts";

/**
 * Catégorie automatique : 1) règles explicites (motif contenu dans la clé de libellé),
 * 2) sinon la catégorie la plus récente choisie pour la même clé de libellé.
 */
export async function guessCategory(key: string): Promise<{ categoryId: string; source: "regle" | "auto" } | null> {
  if (!key) return null;
  const rule = await one<{ category_id: string }>(
    "SELECT category_id FROM rules WHERE ? LIKE CONCAT('%', pattern, '%') ORDER BY priority, CHAR_LENGTH(pattern) DESC LIMIT 1",
    [key],
  );
  if (rule) return { categoryId: rule.category_id, source: "regle" };
  const prev = await one<{ category_id: string }>(
    `SELECT category_id FROM transactions
     WHERE label_key = ? AND category_id IS NOT NULL AND category_source IN ('reprise', 'manuel', 'regle')
     ORDER BY date DESC LIMIT 1`,
    [key],
  );
  return prev ? { categoryId: prev.category_id, source: "auto" } : null;
}
