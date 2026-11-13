import { exec, one, q } from "./db.ts";
import { userAccountsSql } from "./actions.ts";
import { labelKey } from "../lib/labels.ts";
import { labelShape, natureSql, shapeRegex } from "../lib/nature.ts";

/*
 * Prélèvements SEPA : Finta ne donne que le code du créancier (« 2615685 Od0000027 Cdr… »).
 * On regroupe les débits de même forme en séries récurrentes, on relie chaque série à l'engagement
 * du Budget qui lui correspond (catégorie + montant), puis on nomme les opérations d'après lui :
 * « Échéance prêt Caisse d'Épargne » au lieu d'« Opération n° 2615685 ».
 */

type Debit = { id: string; date: string; amount: number; label: string; merchant: string | null; category_id: string | null; category_name: string | null };

export type DebitSeries = {
  key: string;
  shape: string;
  regex: string;
  count: number;
  avgAmount: number;
  lastAmount: number;
  lastDate: string;
  typicalDay: number;
  categoryId: string | null;
  categoryName: string | null;
  commitmentId: number | null;
  name: string | null;
  sampleLabel: string;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Regroupe des débits de même forme : un montant stable = une série ; des montants très différents = une série par montant. */
export function clusterDebits(rows: Debit[]): Debit[][] {
  const amounts = rows.map((r) => -r.amount);
  const med = median(amounts);
  if (amounts.every((a) => Math.abs(a - med) <= med * 0.3)) return [rows];
  const byAmount = new Map<number, Debit[]>();
  for (const r of rows) byAmount.set(Math.round(-r.amount), [...(byAmount.get(Math.round(-r.amount)) ?? []), r]);
  return [...byAmount.values()];
}

/** Séries de prélèvements des 13 derniers mois (vue du membre), les plus lourdes d'abord. */
export async function debitSeries(userId: number): Promise<DebitSeries[]> {
  const rows = await q<Debit>(
    `SELECT t.id, t.date, t.amount, t.label, t.merchant, t.category_id, c.name AS category_name
     FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.status IN ('posted', 'pending') AND a.excluded = 0 AND t.amount < 0 AND ${natureSql("t")} = 'prelevement'
       AND t.date >= DATE_SUB(CURDATE(), INTERVAL 13 MONTH)
     ORDER BY t.date`,
  );
  const commitments = await q<{ id: number; label: string; label_regex: string | null; monthly: number | null; annual: number | null }>(
    "SELECT id, label, label_regex, monthly, annual FROM commitments WHERE label_regex IS NOT NULL",
  );
  const byShape = new Map<string, Debit[]>();
  for (const r of rows) byShape.set(labelShape(r.label), [...(byShape.get(labelShape(r.label)) ?? []), r]);
  const out: DebitSeries[] = [];
  for (const [shape, list] of byShape)
    for (const cluster of clusterDebits(list)) {
      const amounts = cluster.map((r) => -r.amount);
      const last = cluster[cluster.length - 1];
      const cats = new Map<string, number>();
      for (const r of cluster) if (r.category_id) cats.set(r.category_id, (cats.get(r.category_id) ?? 0) + 1);
      const categoryId = [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const regex = shapeRegex(shape);
      const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
      const linked = pickCommitment(commitments.filter((c) => c.label_regex === regex), avg);
      out.push({
        key: `${shape}|${Math.round(median(amounts))}`,
        shape,
        regex,
        count: cluster.length,
        avgAmount: r2(avg),
        lastAmount: r2(-last.amount),
        lastDate: last.date,
        typicalDay: Math.round(median(cluster.map((r) => Number(r.date.slice(8, 10))))),
        categoryId,
        categoryName: cluster.find((r) => r.category_id === categoryId)?.category_name ?? null,
        commitmentId: linked?.id ?? null,
        name: linked?.label ?? (last.merchant || null),
        sampleLabel: last.label,
      });
    }
  return out.sort((a, b) => b.avgAmount * b.count - a.avgAmount * a.count);
}

/** Parmi des engagements de même motif, celui dont le montant (mensuel ou annuel) est le plus proche (deux prêts au même format de libellé). */
function pickCommitment<T extends { monthly: number | null; annual: number | null }>(list: T[], amount: number): T | undefined {
  if (list.length <= 1) return list[0];
  return [...list].sort((a, b) => amountGap(a, amount) - amountGap(b, amount))[0];
}

/** Écart relatif entre un débit et un engagement (le plus petit, au mois ou à l'année). */
function amountGap(c: { monthly: number | null; annual: number | null }, amount: number): number {
  const gaps = [c.monthly, c.annual].filter((v): v is number => v != null && Number(v) > 0).map((v) => Math.abs(Number(v) - amount) / Number(v));
  return gaps.length ? Math.min(...gaps) : Infinity;
}

/**
 * Relie automatiquement les séries de prélèvements aux engagements sans motif : catégorie compatible
 * et montant proche du mensuel ou de l'annuel. Attribution globale, l'écart le plus faible d'abord
 * (un 10,99 € exact passe avant un 12 €). Série récurrente : écart ≤ 15 % ; prélèvement annuel vu
 * une seule fois : écart ≤ 2 %. Ne touche jamais un motif déjà posé.
 */
export async function autoLinkCommitments(userId: number): Promise<number> {
  const series = (await debitSeries(userId)).filter((s) => !s.commitmentId);
  const commitments = await q<{ id: number; category_id: string | null; monthly: number | null; annual: number | null }>(
    "SELECT id, category_id, monthly, annual FROM commitments WHERE status IN ('actif', 'a_verifier', 'a_completer') AND label_regex IS NULL",
  );
  const pairs: { s: DebitSeries; c: (typeof commitments)[number]; gap: number }[] = [];
  for (const s of series)
    for (const c of commitments) {
      const compatible = s.categoryId ? c.category_id === s.categoryId : true;
      if (!compatible) continue;
      const gap = amountGap(c, s.avgAmount);
      const limit = s.count >= 2 ? 0.15 : 0.02;
      if (gap <= limit) pairs.push({ s, c, gap });
    }
  pairs.sort((a, b) => a.gap - b.gap);
  const usedSeries = new Set<string>();
  const usedCommitments = new Set<number>();
  let linked = 0;
  for (const p of pairs) {
    if (usedSeries.has(p.s.key) || usedCommitments.has(p.c.id)) continue;
    usedSeries.add(p.s.key);
    usedCommitments.add(p.c.id);
    await exec("UPDATE commitments SET label_regex = ? WHERE id = ? AND label_regex IS NULL", [p.s.regex, p.c.id]);
    linked++;
  }
  return linked;
}

/**
 * Nomme les opérations d'après les engagements (motif sur le libellé brut) : nom affiché, clé de
 * libellé recalculée, et catégorie de l'engagement si l'opération n'en a pas. Ne remplace jamais
 * un nom de marchand venu de la banque.
 */
export async function nameDebits(): Promise<number> {
  const commitments = await q<{ id: number; label: string; label_regex: string; category_id: string | null; monthly: number | null; annual: number | null }>(
    "SELECT id, label, label_regex, category_id, monthly, annual FROM commitments WHERE label_regex IS NOT NULL",
  );
  const labels = new Set(commitments.map((c) => c.label));
  const byRegex = new Map<string, typeof commitments>();
  for (const c of commitments) byRegex.set(c.label_regex, [...(byRegex.get(c.label_regex) ?? []), c]);
  let named = 0;
  for (const [regex, list] of byRegex) {
    const txs = await q<{ id: string; label: string; amount: number; merchant: string | null; category_id: string | null }>(
      "SELECT id, label, amount, merchant, category_id FROM transactions WHERE amount < 0 AND LOWER(TRIM(label)) REGEXP ?",
      [regex],
    );
    for (const t of txs) {
      if (t.merchant && !labels.has(t.merchant)) continue;
      const c = pickCommitment(list, -t.amount)!;
      if (t.merchant === c.label && (t.category_id || !c.category_id)) continue;
      await exec("UPDATE transactions SET merchant = ?, label_key = ? WHERE id = ?", [c.label, labelKey(t.label, c.label), t.id]);
      if (!t.category_id && c.category_id) await exec("UPDATE transactions SET category_id = ?, category_source = 'regle' WHERE id = ? AND category_id IS NULL", [c.category_id, t.id]);
      named++;
    }
  }
  return named;
}

/** Après une synchro ou un changement d'engagement : liaison automatique puis noms. */
export async function refreshDebitNames(): Promise<{ linked: number; named: number }> {
  const first = await one<{ id: number }>("SELECT id FROM users ORDER BY id LIMIT 1");
  const linked = first ? await autoLinkCommitments(first.id) : 0;
  return { linked, named: await nameDebits() };
}

/**
 * Annule les noms et catégories posés d'après les engagements (et les motifs reconnus
 * automatiquement), pour repartir d'une reconnaissance corrigée. Les catégories choisies à la
 * main ne sont jamais touchées.
 */
export async function resetDebitNames(): Promise<{ categories: number; names: number }> {
  const commitments = await q<{ label: string; category_id: string | null }>("SELECT label, category_id FROM commitments");
  let categories = 0;
  let names = 0;
  for (const c of commitments) {
    if (c.category_id) {
      const r = await exec("UPDATE transactions SET category_id = NULL, category_source = NULL WHERE merchant = ? AND category_source = 'regle' AND category_id = ?", [c.label, c.category_id]);
      categories += r.affectedRows;
    }
    const txs = await q<{ id: string; label: string }>("SELECT id, label FROM transactions WHERE merchant = ?", [c.label]);
    for (const t of txs) {
      await exec("UPDATE transactions SET merchant = NULL, label_key = ? WHERE id = ?", [labelKey(t.label, null), t.id]);
      names++;
    }
  }
  await exec("UPDATE commitments SET label_regex = NULL");
  return { categories, names };
}
