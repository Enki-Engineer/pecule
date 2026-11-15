import { householdDay } from "./region.ts";
import { q } from "./db.ts";
import { IS_EXPENSE, LINE_KIND, STAT_DATE_JOIN, STAT_SCOPE, statDate } from "./stats.ts";
import { debitSeries } from "./debits.ts";
import { labelShape, merchantName, natureOf, natureSql } from "../lib/nature.ts";
import { txTitle } from "../lib/labels.ts";
import type { TimelinePoint } from "../lib/timeline.ts";
import { addMonths, FORECAST_MONTHS, periodRange } from "../lib/periods.ts";
import { expectedIn, recurringKey, recurringSeries, type Expected, type RecurringRow } from "../lib/recurring.ts";
import { mergeDebitRows } from "../lib/debit-rows.ts";
import { pickColored } from "../lib/breakdown.ts";
import { tk } from "../lib/i18n.ts";
export { comparisonSpan, type CompareBase } from "../lib/periods.ts";

/*
 * Analyse des flux d'une période (un mois « 2026-11 » ou une année « 2026 ») : d'où vient l'argent (revenus par
 * catégorie), par quel moyen il part (achats carte, prélèvements, virements, espèces, frais) et vers quels postes ;
 * tendance mois par mois ; frise ; calendrier des prélèvements ; marchands ; prévision des mois à venir. Mêmes
 * définitions que stats.ts : la nature ventile les dépenses, elle ne change pas les totaux. Mouvements internes
 * exclus. Le jour d'une opération est celui de la vue tx_lines (jour d'achat ou d'écriture, selon le foyer).
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const inRange = "t.date >= ? AND t.date < ?";

export async function monthFlows(accountsSql: string, period: string) {
  const { start, end } = periodRange(period);
  const base = `FROM tx_lines t JOIN transactions tr ON tr.id = t.id JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
    WHERE ${STAT_SCOPE} AND ${inRange}`;
  const [incomes, spend, savings] = await Promise.all([
    q<{ id: string | null; name: string | null; total: number }>(
      `SELECT c.id, c.name, ROUND(SUM(t.amount), 2) AS total ${base} AND ${LINE_KIND} = 'revenu' GROUP BY c.id, c.name HAVING total > 0 ORDER BY total DESC`,
      [start, end],
    ),
    // Dépenses brutes par nature et par poste (débits) ; les remboursements sont comptés à part.
    q<{ nature: string; poste: string | null; total: number; n: number }>(
      `SELECT ${natureSql("tr")} AS nature, c.poste, ROUND(-SUM(t.amount), 2) AS total, COUNT(*) AS n ${base} AND ${IS_EXPENSE} AND t.amount < 0
       GROUP BY nature, c.poste ORDER BY total DESC`,
      [start, end],
    ),
    q<{ total: number | null }>(`SELECT ROUND(-SUM(t.amount), 2) AS total ${base} AND c.kind = 'epargne'`, [start, end]),
  ]);
  const refunds = await q<{ total: number | null }>(`SELECT ROUND(SUM(t.amount), 2) AS total ${base} AND ${IS_EXPENSE} AND t.amount > 0`, [start, end]);
  const income = r2(incomes.reduce((s, i) => s + Number(i.total), 0));
  const gross = r2(spend.reduce((s, x) => s + Number(x.total), 0));
  const refund = r2(Number(refunds[0]?.total ?? 0));
  const saved = r2(Number(savings[0]?.total ?? 0));
  return {
    month: period,
    incomes: incomes.map((i) => ({ id: i.id, name: i.name ?? tk("Revenus non classés"), total: Number(i.total) })),
    flows: spend.map((x) => ({ nature: x.nature, poste: x.poste ?? tk("À classer"), total: Number(x.total), count: Number(x.n) })),
    totals: { income, grossSpend: gross, refunds: refund, netSpend: r2(gross - refund), savings: saved, balance: r2(income - (gross - refund) - saved) },
  };
}

/** Revenus, dépenses et épargne mois par mois, du mois `from` au mois `to` compris (un mois sans opération n'a pas de ligne). */
export async function monthlyTrend(accountsSql: string, from: string, to: string) {
  return q<{ month: string; revenus: number; depenses: number; epargne: number }>(
    `SELECT DATE_FORMAT(t.date, '%Y-%m') AS month,
            SUM(CASE WHEN ${LINE_KIND} = 'revenu' THEN t.amount ELSE 0 END) AS revenus,
            -SUM(CASE WHEN ${LINE_KIND} = 'depense' THEN t.amount ELSE 0 END) AS depenses,
            -SUM(CASE WHEN c.kind = 'epargne' THEN t.amount ELSE 0 END) AS epargne
     FROM tx_lines t JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND ${inRange}
     GROUP BY month ORDER BY month`,
    [`${from}-01`, `${addMonths(to, 1)}-01`],
  );
}

/** Dépenses brutes par nature, mois par mois, du mois `from` au mois `to` compris (barres empilées). */
export async function natureTrend(accountsSql: string, from: string, to: string) {
  const rows = await q<{ month: string; nature: string; total: number }>(
    `SELECT DATE_FORMAT(t.date, '%Y-%m') AS month, ${natureSql("tr")} AS nature, ROUND(-SUM(t.amount), 2) AS total
     FROM tx_lines t JOIN transactions tr ON tr.id = t.id JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND ${IS_EXPENSE} AND t.amount < 0 AND ${inRange}
     GROUP BY month, nature ORDER BY month`,
    [`${from}-01`, `${addMonths(to, 1)}-01`],
  );
  const months = [...new Set(rows.map((r) => r.month))];
  return months.map((m) => {
    const row: Record<string, number | string> = { month: m };
    for (const r of rows.filter((x) => x.month === m)) row[r.nature] = Number(r.total);
    return row;
  });
}

/* ---------- Récurrences et prévision ---------- */

/** Opérations comptées depuis le mois `from`, avec la clé qui regroupe ce qui revient (forme du libellé d'un prélèvement sans nom, clé du marchand sinon). */
async function recurringRows(accountsSql: string, from: string): Promise<RecurringRow[]> {
  const rows = await q<{ date: string; amount: number; label: string; merchant: string | null; bank_label: string | null; label_key: string; category: string | null; kind: "depense" | "revenu" }>(
    `SELECT DATE_FORMAT(t.date, '%Y-%m-%d') AS date, ROUND(SUM(t.amount), 2) AS amount, tr.label, tr.merchant, tr.bank_label, tr.label_key, MIN(c.name) AS category, ${LINE_KIND} AS kind
     FROM tx_lines t JOIN transactions tr ON tr.id = t.id JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND t.date >= ? AND ${LINE_KIND} IN ('depense', 'revenu')
     GROUP BY tr.id, t.date, tr.label, tr.merchant, tr.bank_label, tr.label_key, kind`,
    [`${from}-01`],
  );
  return rows
    .map((r) => ({ ...r, amount: Number(r.amount) }))
    // Une dépense sort, un revenu entre : un remboursement ou une régularisation ne fait pas une récurrence.
    .filter((r) => (r.kind === "depense" ? r.amount < 0 : r.amount > 0))
    .map(recurringRow);
}

/** Une opération vue comme un passage possible d'une récurrence : sa clé de regroupement, son nom, son moyen de paiement. */
export function recurringRow(r: { date: string; amount: number; label: string; merchant: string | null; bank_label: string | null; label_key: string; category: string | null; kind: "depense" | "revenu" }): RecurringRow {
  const nature = natureOf(r.label, r.amount);
  return {
    date: r.date,
    amount: r.amount,
    key: nature === "prelevement" && !r.merchant ? `forme:${labelShape(r.label)}` : `nom:${recurringKey(r.label_key)}`,
    name: seriesName(txTitle({ merchant: r.merchant, label: r.label, bank_label: r.bank_label, category_name: r.category })),
    kind: r.kind,
    category: r.category,
    nature,
  };
}

/** Nom d'une série : celui de sa dernière opération, sans ce qui change à chaque fois (numéro de commande, cours d'une devise). */
function seriesName(title: string): string {
  const words = title.split(/\s+/);
  const cut = words.findIndex((w, i) => i > 0 && (w.match(/\d/g) ?? []).length >= 2);
  const kept = (cut > 0 ? words.slice(0, cut) : words).join(" ").replace(/[\s·,;:/(-]+$/, "");
  // « Opération n° 2615685 » : le numéro est tout ce qui la nomme.
  return /\p{L}{3}/u.test(kept.replace(/^Opération\b/i, "")) ? kept : title;
}

/**
 * Ce qui est attendu pendant ces mois (le mois en cours et les suivants), d'après ce qui revient chaque mois :
 * prélèvements, abonnements, virements, salaire, loyers. Une série déjà passée dans un mois n'y est plus attendue.
 */
export async function expectedOperations(accountsSql: string, months: string[]): Promise<(Expected & { nature: string })[]> {
  const current = householdDay().slice(0, 7);
  const rows = await recurringRows(accountsSql, addMonths(current, -5));
  return expectedIn(recurringSeries(rows, current), rows, months.filter((m) => m >= current)).map((e) => ({ ...e, nature: e.nature ?? (e.amount < 0 ? "prelevement" : "entree") }));
}

/**
 * Prévision : pour le mois en cours et les trois suivants, ce qui est déjà écrit (`known`, dont les achats par carte
 * en attente de prélèvement) et ce qui est attendu d'après les récurrences (`expected`), en entrées et en sorties.
 */
export async function forecast(accountsSql: string) {
  const current = householdDay().slice(0, 7);
  const months = Array.from({ length: FORECAST_MONTHS + 1 }, (_, i) => addMonths(current, i));
  const [known, expected] = await Promise.all([monthlyTrend(accountsSql, current, months.at(-1)!), expectedOperations(accountsSql, months)]);
  return {
    current,
    months: months.map((month) => {
      const k = known.find((r) => r.month === month);
      const items = expected.filter((e) => e.month === month).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
      return {
        month,
        known: { revenus: r2(Number(k?.revenus ?? 0)), depenses: r2(Number(k?.depenses ?? 0)) },
        expected: { revenus: r2(items.filter((e) => e.amount > 0).reduce((t, e) => t + e.amount, 0)), depenses: r2(-items.filter((e) => e.amount < 0).reduce((t, e) => t + e.amount, 0)) },
        items: items.slice(0, 14).map(({ day, name, amount, category }) => ({ day, name, amount, category })),
        count: items.length,
      };
    }),
  };
}

/**
 * Prélèvements du mois (jour, montant, nom) et prélèvements attendus d'après les séries récurrentes
 * non encore passés ce mois-ci.
 */
export async function monthDebits(userId: number, accountsSql: string, month: string) {
  const start = `${month}-01`;
  const rows = await q<{ id: string; date: string; amount: number; label: string; merchant: string | null; category: string | null; poste: string | null }>(
    `SELECT tr.id, DATE_FORMAT(${statDate("tr")}, '%Y-%m-%d') AS date, tr.amount, tr.label, tr.merchant, c.name AS category, c.poste
     FROM transactions tr JOIN ${accountsSql} a ON a.id = tr.account_id LEFT JOIN categories c ON c.id = tr.category_id ${STAT_DATE_JOIN}
     WHERE tr.status IN ('posted', 'pending') AND a.excluded = 0 AND tr.amount < 0 AND ${natureSql("tr")} = 'prelevement'
       AND ${statDate("tr")} >= ? AND ${statDate("tr")} < DATE_ADD(?, INTERVAL 1 MONTH) ORDER BY date`,
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

/**
 * Frise d'une période : chaque opération à son jour, avec sa nature et son sens, pour lire les paiements dans le
 * temps. Mêmes définitions que les flux (mouvements internes exclus) : une opération ventilée donne un point par
 * sens (ses lignes de dépense, ses lignes d'épargne). Montants signés : positif quand l'argent entre. `slot` est le
 * rang du point dans la période : le jour pour un mois, le mois pour une année. Pour la période en cours, ce qui est
 * attendu d'après les récurrences est joint (`upcoming` : à venir ; `overdue` : jour habituel passé).
 */
export async function monthTimeline(accountsSql: string, period: string) {
  const { start, end, year } = periodRange(period);
  const today = householdDay();
  const current = today.slice(0, 7);
  const slotOf = (date: string) => Number(year ? date.slice(5, 7) : date.slice(8, 10));
  const rows = await q<{ id: string; date: string; booked: string; status: string; label: string; merchant: string | null; bank_label: string | null; nature: string; kind: TimelinePoint["kind"]; amount: number; category: string | null; poste: string | null }>(
    `SELECT tr.id, DATE_FORMAT(t.date, '%Y-%m-%d') AS date, DATE_FORMAT(tr.date, '%Y-%m-%d') AS booked, tr.status, tr.label, tr.merchant, tr.bank_label, ${natureSql("tr")} AS nature, ${LINE_KIND} AS kind,
            ROUND(SUM(t.amount), 2) AS amount, MIN(c.name) AS category, MIN(c.poste) AS poste
     FROM tx_lines t JOIN transactions tr ON tr.id = t.id JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND ${inRange} AND ${LINE_KIND} IN ('depense', 'revenu', 'epargne')
     GROUP BY tr.id, t.date, tr.date, tr.status, tr.label, tr.merchant, tr.bank_label, nature, kind
     HAVING amount <> 0 ORDER BY t.date, amount`,
    [start, end],
  );
  const points: TimelinePoint[] = rows.map((r) => ({
    id: r.id,
    date: r.date,
    slot: slotOf(r.date),
    amount: Number(r.amount),
    kind: r.kind,
    nature: r.nature,
    name: txTitle({ merchant: r.merchant, label: r.label, bank_label: r.bank_label, category_name: r.category }),
    category: r.category,
    poste: r.poste,
    // Achat par carte pas encore prélevé : la banque l'a annoncé, elle l'écrira le jour du prélèvement.
    ...(r.status === "pending" ? { pending: true, booked: r.booked } : r.booked !== r.date ? { booked: r.booked } : {}),
  }));
  // Période en cours : ce qui reste attendu (le mois en cours pour un mois ; jusqu'à trois mois plus loin pour l'année).
  const live = year ? period === current.slice(0, 4) : period === current;
  const months = !live ? [] : year ? Array.from({ length: FORECAST_MONTHS + 1 }, (_, i) => addMonths(current, i)).filter((m) => m.startsWith(period)) : [current];
  const expected = (months.length ? await expectedOperations(accountsSql, months) : []).map((e) => ({
    name: e.name,
    slot: year ? Number(e.month.slice(5, 7)) : e.day,
    amount: e.amount,
    category: e.category,
    nature: e.nature,
    kind: e.kind,
    late: e.month === current && e.day < Number(today.slice(8, 10)),
  }));
  return {
    period,
    unit: year ? ("mois" as const) : ("jour" as const),
    /** Rang d'aujourd'hui dans la période (jour du mois, ou mois de l'année) ; null pour une période passée. */
    today: !live ? null : year ? Number(current.slice(5, 7)) : Number(today.slice(8, 10)),
    points,
    upcoming: expected.filter((e) => !e.late),
    overdue: expected.filter((e) => e.late),
  };
}

/** Prélèvements d'une année : une ligne par créancier, un montant par mois (ce qui est passé, mois après mois). */
export async function yearDebits(accountsSql: string, year: string) {
  const { start, end } = periodRange(year);
  const rows = await q<{ month: number; amount: number; label: string; merchant: string | null; bank_label: string | null; category: string | null }>(
    `SELECT MONTH(${statDate("tr")}) AS month, tr.amount, tr.label, tr.merchant, tr.bank_label, c.name AS category
     FROM transactions tr JOIN ${accountsSql} a ON a.id = tr.account_id LEFT JOIN categories c ON c.id = tr.category_id ${STAT_DATE_JOIN}
     WHERE tr.status IN ('posted', 'pending') AND a.excluded = 0 AND tr.amount < 0 AND ${natureSql("tr")} = 'prelevement'
       AND ${statDate("tr")} >= ? AND ${statDate("tr")} < ? ORDER BY ${statDate("tr")}`,
    [start, end],
  );
  const series = new Map<string, { name: string; category: string | null; byMonth: number[]; count: number; total: number }>();
  for (const r of rows) {
    const name = txTitle({ merchant: r.merchant, label: r.label, bank_label: r.bank_label, category_name: r.category });
    const s = series.get(name) ?? { name, category: r.category, byMonth: new Array<number>(12).fill(0), count: 0, total: 0 };
    s.byMonth[Number(r.month) - 1] = r2(s.byMonth[Number(r.month) - 1] - Number(r.amount));
    s.count++;
    s.total = r2(s.total - Number(r.amount));
    series.set(name, s);
  }
  // Un même créancier sous deux noms dans l'année (renommé, ou venu d'une autre source) ne fait qu'une ligne.
  const list = mergeDebitRows([...series.values()]);
  return { year, series: list, totals: Array.from({ length: 12 }, (_, i) => r2(list.reduce((t, s) => t + s.byMonth[i], 0))) };
}

/** Achats carte d'une période par marchand, comparés à la période précédente. */
export async function monthMerchants(accountsSql: string, period: string) {
  const { start, end, prevStart } = periodRange(period);
  const day = statDate("tr");
  const rows = await q<{ label: string; merchant: string | null; amount: number; prev: number; poste: string | null }>(
    `SELECT tr.label, tr.merchant, tr.amount, ${day} >= ? AS prev, c.poste
     FROM transactions tr JOIN ${accountsSql} a ON a.id = tr.account_id LEFT JOIN categories c ON c.id = tr.category_id ${STAT_DATE_JOIN}
     WHERE tr.status IN ('posted', 'pending') AND a.excluded = 0 AND tr.amount < 0 AND ${natureSql("tr")} = 'carte'
       AND ${day} >= ? AND ${day} < ?`,
    [start, prevStart, end],
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
