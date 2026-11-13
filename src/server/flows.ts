import { householdDay } from "./region.ts";
import { q } from "./db.ts";
import { IS_EXPENSE, LINE_KIND, STAT_SCOPE } from "./stats.ts";
import { debitSeries } from "./debits.ts";
import { merchantName, natureSql } from "../lib/nature.ts";
import { pickColored } from "../lib/breakdown.ts";
import { tk } from "../lib/i18n.ts";
export { comparisonSpan, type CompareBase } from "../lib/periods.ts";

/*
 * Analyse des flux d'un mois : d'où vient l'argent (revenus par catégorie), par quel moyen il part
 * (achats carte, prélèvements, virements, espèces, frais) et vers quels postes ; tendance 12 mois par
 * nature ; calendrier des prélèvements ; marchands. Mêmes définitions que stats.ts : la nature
 * ventile les dépenses, elle ne change pas les totaux. Mouvements internes exclus.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const monthRange = "t.date >= ? AND t.date < DATE_ADD(?, INTERVAL 1 MONTH)";

export async function monthFlows(accountsSql: string, month: string) {
  const start = `${month}-01`;
  const base = `FROM tx_lines t JOIN transactions tr ON tr.id = t.id JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${STAT_SCOPE} AND ${monthRange}`;
  const [incomes, spend, savings] = await Promise.all([
    q<{ id: string | null; name: string | null; total: number }>(
      `SELECT c.id, c.name, ROUND(SUM(t.amount), 2) AS total ${base} AND ${LINE_KIND} = 'revenu' GROUP BY c.id, c.name HAVING total > 0 ORDER BY total DESC`,
      [start, start],
    ),
    // Dépenses brutes par nature et par poste (débits) ; les remboursements sont comptés à part.
    q<{ nature: string; poste: string | null; total: number; n: number }>(
      `SELECT ${natureSql("tr")} AS nature, c.poste, ROUND(-SUM(t.amount), 2) AS total, COUNT(*) AS n ${base} AND ${IS_EXPENSE} AND t.amount < 0
       GROUP BY nature, c.poste ORDER BY total DESC`,
      [start, start],
    ),
    q<{ total: number | null }>(`SELECT ROUND(-SUM(t.amount), 2) AS total ${base} AND c.kind = 'epargne'`, [start, start]),
  ]);
  const refunds = await q<{ total: number | null }>(`SELECT ROUND(SUM(t.amount), 2) AS total ${base} AND ${IS_EXPENSE} AND t.amount > 0`, [start, start]);
  const income = r2(incomes.reduce((s, i) => s + Number(i.total), 0));
  const gross = r2(spend.reduce((s, x) => s + Number(x.total), 0));
  const refund = r2(Number(refunds[0]?.total ?? 0));
  const saved = r2(Number(savings[0]?.total ?? 0));
  return {
    month,
    incomes: incomes.map((i) => ({ id: i.id, name: i.name ?? tk("Revenus non classés"), total: Number(i.total) })),
    flows: spend.map((x) => ({ nature: x.nature, poste: x.poste ?? tk("À classer"), total: Number(x.total), count: Number(x.n) })),
    totals: { income, grossSpend: gross, refunds: refund, netSpend: r2(gross - refund), savings: saved, balance: r2(income - (gross - refund) - saved) },
  };
}

/** Dépenses brutes par nature sur les 12 derniers mois (barres empilées). */
export async function natureTrend(accountsSql: string) {
  const rows = await q<{ month: string; nature: string; total: number }>(
    `SELECT DATE_FORMAT(t.date, '%Y-%m') AS month, ${natureSql("tr")} AS nature, ROUND(-SUM(t.amount), 2) AS total
     FROM tx_lines t JOIN transactions tr ON tr.id = t.id JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND ${IS_EXPENSE} AND t.amount < 0 AND t.date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
     GROUP BY month, nature ORDER BY month`,
  );
  const months = [...new Set(rows.map((r) => r.month))];
  return months.map((m) => {
    const row: Record<string, number | string> = { month: m };
    for (const r of rows.filter((x) => x.month === m)) row[r.nature] = Number(r.total);
    return row;
  });
}

/**
 * Prélèvements du mois (jour, montant, nom) et prélèvements attendus d'après les séries récurrentes
 * non encore passés ce mois-ci.
 */
export async function monthDebits(userId: number, accountsSql: string, month: string) {
  const start = `${month}-01`;
  const rows = await q<{ id: string; date: string; amount: number; label: string; merchant: string | null; category: string | null; poste: string | null }>(
    `SELECT tr.id, tr.date, tr.amount, tr.label, tr.merchant, c.name AS category, c.poste
     FROM transactions tr JOIN ${accountsSql} a ON a.id = tr.account_id LEFT JOIN categories c ON c.id = tr.category_id
     WHERE tr.status IN ('posted', 'pending') AND a.excluded = 0 AND tr.amount < 0 AND ${natureSql("tr")} = 'prelevement'
       AND tr.date >= ? AND tr.date < DATE_ADD(?, INTERVAL 1 MONTH) ORDER BY tr.date`,
    [start, start],
  );
  const series = (await debitSeries(userId)).filter((s) => s.count >= 3);
  const seen = new Set(rows.map((r) => r.label.trim().toLowerCase()));
  const today = householdDay();
  const isCurrent = today.startsWith(month);
  const expected = series
    .filter((s) => ![...seen].some((l) => new RegExp(s.regex).test(l)))
    .map((s) => ({ name: s.name ?? s.sampleLabel, day: s.typicalDay, amount: s.avgAmount, category: s.categoryName, late: isCurrent ? Number(today.slice(8, 10)) > s.typicalDay + 3 : true }));
  return {
    month,
    debits: rows.map((r) => ({ id: r.id, date: r.date, day: Number(r.date.slice(8, 10)), amount: -Number(r.amount), name: r.merchant || merchantName(r.label), category: r.category, poste: r.poste })),
    expected: isCurrent ? expected : expected.filter(() => false),
    missed: isCurrent ? [] : expected,
  };
}

/** Achats carte du mois par marchand, comparés au mois précédent. */
export async function monthMerchants(accountsSql: string, month: string) {
  const start = `${month}-01`;
  const rows = await q<{ label: string; merchant: string | null; amount: number; prev: number; poste: string | null }>(
    `SELECT tr.label, tr.merchant, tr.amount, tr.date >= ? AS prev, c.poste
     FROM transactions tr JOIN ${accountsSql} a ON a.id = tr.account_id LEFT JOIN categories c ON c.id = tr.category_id
     WHERE tr.status IN ('posted', 'pending') AND a.excluded = 0 AND tr.amount < 0 AND ${natureSql("tr")} = 'carte'
       AND tr.date >= DATE_SUB(?, INTERVAL 1 MONTH) AND tr.date < DATE_ADD(?, INTERVAL 1 MONTH)`,
    [start, start, start],
  );
  const map = new Map<string, { name: string; total: number; count: number; previous: number; poste: string | null }>();
  for (const r of rows) {
    const name = merchantName(r.label, r.merchant);
    const m = map.get(name) ?? { name, total: 0, count: 0, previous: 0, poste: r.poste };
    if (Number(r.prev)) {
      m.total += -Number(r.amount);
      m.count++;
    } else m.previous += -Number(r.amount);
    map.set(name, m);
  }
  return [...map.values()]
    .filter((m) => m.total > 0)
    .map((m) => ({ ...m, total: r2(m.total), previous: r2(m.previous) }))
    .sort((a, b) => b.total - a.total);
}

/* ---------- Répartition : postes colorés ---------- */

/**
 * Postes de dépense qui portent une couleur dans les donuts de l'Analyse : les plus lourds des
 * 12 derniers mois (fenêtre indépendante du mois affiché : un poste garde sa couleur en changeant
 * de mois), rangés dans l'ordre du référentiel.
 */
export async function coloredPostes(accountsSql: string) {
  const rows = await q<{ poste: string; code: string; total: number }>(
    `SELECT c.poste, MIN(c.id) AS code, -SUM(t.amount) AS total
     FROM tx_lines t JOIN ${accountsSql} a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND c.kind = 'depense' AND c.poste IS NOT NULL
       AND t.date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH)
     GROUP BY c.poste`,
  );
  return pickColored(rows);
}

/* ---------- Comparer deux périodes ---------- */

/** Dépenses par poste, revenus et épargne de deux périodes (b divisée pour une moyenne). */
export async function comparePeriods(accountsSql: string, a: { from: string; to: string }, b: { from: string; to: string; divisor: number }) {
  const sums = async (s: { from: string; to: string }) => {
    const rows = await q<{ poste: string; kind: string; total: number }>(
      `SELECT COALESCE(c.poste, IF(t.amount < 0, 'À classer', 'Revenus non classés')) AS poste, ${LINE_KIND} AS kind, SUM(t.amount) AS total
       FROM tx_lines t JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${STAT_SCOPE} AND t.date >= ? AND t.date <= ? GROUP BY poste, kind`,
      [s.from, s.to],
    );
    return rows;
  };
  const [ra, rb] = await Promise.all([sums(a), sums(b)]);
  const total = (rows: typeof ra, kind: string, sign: number, div = 1) => r2((sign * rows.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.total), 0)) / div);
  const postes = new Map<string, { poste: string; a: number; b: number }>();
  for (const [rows, key, div] of [
    [ra, "a", 1],
    [rb, "b", b.divisor],
  ] as const)
    for (const r of rows.filter((x) => x.kind === "depense")) {
      const p = postes.get(r.poste) ?? { poste: r.poste, a: 0, b: 0 };
      p[key] += -Number(r.total) / div;
      postes.set(r.poste, p);
    }
  return {
    a: { ...a, depenses: total(ra, "depense", -1), revenus: total(ra, "revenu", 1), epargne: total(ra, "epargne", -1) },
    b: { from: b.from, to: b.to, depenses: total(rb, "depense", -1, b.divisor), revenus: total(rb, "revenu", 1, b.divisor), epargne: total(rb, "epargne", -1, b.divisor) },
    postes: [...postes.values()]
      .map((p) => ({ poste: p.poste, a: r2(p.a), b: r2(p.b), diff: r2(p.a - p.b), pct: p.b > 0 ? r2(((p.a - p.b) / p.b) * 100) : null }))
      .filter((p) => Math.abs(p.a) >= 1 || Math.abs(p.b) >= 1)
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b)),
  };
}
