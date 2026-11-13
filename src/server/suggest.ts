import { one, q } from "./db.ts";
import { userAccountsSql } from "./actions.ts";
import { merchantName, natureOf } from "../lib/nature.ts";
import { t, tn } from "../lib/i18n.ts";

/*
 * Catégories proposées pour une opération (fiche, mode tri, gestes) : de la plus sûre à la moins
 * sûre — règle du libellé, articles de la facture reliée, opérations de même libellé, même marchand,
 * enfin les catégories les plus fréquentes pour la même nature et un montant voisin.
 */

export type Suggestion = { categoryId: string; name: string; poste: string | null; reason: string; score: number };

type Row = { id: string; label: string; merchant: string | null; amount: number; label_key: string | null; category_id: string | null; category_source: string | null };

export async function suggestCategories(userId: number, txId: string, limit = 3): Promise<Suggestion[]> {
  const A = userAccountsSql(userId);
  const tx = await one<Row>(`SELECT t.id, t.label, t.merchant, t.amount, t.label_key, t.category_id, t.category_source FROM transactions t JOIN ${A} a ON a.id = t.account_id WHERE t.id = ?`, [txId]);
  if (!tx) return [];
  const cats = new Map((await q<{ id: string; name: string; poste: string | null }>("SELECT id, name, poste FROM categories")).map((c) => [c.id, c]));
  const out = new Map<string, Suggestion>();
  const add = (categoryId: string | null, reason: string, score: number) => {
    if (!categoryId || !cats.has(categoryId)) return;
    const prev = out.get(categoryId);
    if (prev && prev.score >= score) return;
    const c = cats.get(categoryId)!;
    out.set(categoryId, { categoryId, name: c.name, poste: c.poste, reason, score });
  };

  // 1. Règle de classement du libellé.
  if (tx.label_key) {
    const rule = await one<{ category_id: string }>("SELECT category_id FROM rules WHERE pattern = ?", [tx.label_key]);
    if (rule) add(rule.category_id, t("Règle de classement"), 100);
  }
  // 2. Articles de la facture reliée.
  const items = await q<{ category_id: string; n: number }>(
    `SELECT ii.category_id, COUNT(*) AS n FROM invoice_transactions it JOIN invoice_items ii ON ii.invoice_id = it.invoice_id
     WHERE it.transaction_id = ? AND ii.category_id IS NOT NULL GROUP BY ii.category_id ORDER BY n DESC`,
    [tx.id],
  );
  for (const i of items) add(i.category_id, t("D'après la facture"), 90);
  // 3. Opérations de même libellé, classées à la main ou par règle.
  if (tx.label_key) {
    const same = await q<{ category_id: string; n: number }>(
      `SELECT t.category_id, COUNT(*) AS n FROM transactions t JOIN ${A} a ON a.id = t.account_id
       WHERE t.label_key = ? AND t.id <> ? AND t.category_id IS NOT NULL AND t.category_source IN ('manuel', 'regle', 'notion', 'facture')
       GROUP BY t.category_id ORDER BY n DESC LIMIT 3`,
      [tx.label_key, tx.id],
    );
    for (const s of same) add(s.category_id, tn("Même libellé ({n} fois)", "Même libellé ({n} fois)", Number(s.n)), 70 + Math.min(10, s.n));
  }
  // 4. Même marchand (libellé nettoyé), sur l'historique classé.
  const name = merchantName(tx.label, tx.merchant).toLowerCase();
  if (name.length >= 3) {
    const recent = await q<Row>(
      `SELECT t.id, t.label, t.merchant, t.amount, t.label_key, t.category_id, t.category_source FROM transactions t JOIN ${A} a ON a.id = t.account_id
       WHERE t.category_id IS NOT NULL AND t.id <> ? AND t.category_source IN ('manuel', 'regle', 'notion', 'facture') ORDER BY t.date DESC LIMIT 3000`,
      [tx.id],
    );
    const counts = new Map<string, number>();
    for (const r of recent) if (merchantName(r.label, r.merchant).toLowerCase() === name) counts.set(r.category_id!, (counts.get(r.category_id!) ?? 0) + 1);
    for (const [c, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3)) add(c, tn("Même marchand ({n} fois)", "Même marchand ({n} fois)", n), 60 + Math.min(10, n));
  }
  // 5. Même nature et montant voisin : les catégories les plus fréquentes.
  if (out.size < limit) {
    const nature = natureOf(tx.label, Number(tx.amount));
    const amount = Math.abs(Number(tx.amount));
    const near = await q<Row>(
      `SELECT t.id, t.label, t.merchant, t.amount, t.label_key, t.category_id, t.category_source FROM transactions t JOIN ${A} a ON a.id = t.account_id
       WHERE t.category_id IS NOT NULL AND SIGN(t.amount) = SIGN(?) AND ABS(t.amount) BETWEEN ? AND ? ORDER BY t.date DESC LIMIT 400`,
      [tx.amount, amount * 0.5, amount * 1.6 + 5],
    );
    const counts = new Map<string, number>();
    for (const r of near) if (natureOf(r.label, Number(r.amount)) === nature) counts.set(r.category_id!, (counts.get(r.category_id!) ?? 0) + 1);
    for (const [c] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)) add(c, t("Habituel pour ce type d'opération"), 20);
  }
  return [...out.values()]
    .filter((s) => s.categoryId !== tx.category_id)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
