import { createHash } from "node:crypto";
import { ActionError } from "./actions.ts";
import { nameFromBankLabels } from "./bank-labels.ts";
import { exec, q } from "./db.ts";
import { isDemo } from "./demo-context.ts";
import { fxConverter } from "./fx.ts";
import { today } from "./region.ts";
import { matchInvoices } from "./invoices.ts";
import { dominant, historyDate, historyLabel, reconcileHistory, rowRanks, type HistoryRow } from "../lib/bank-history.ts";
import { bankCounterparty } from "../lib/bourso.ts";
import { labelKey } from "../lib/labels.ts";

/*
 * Historique de la banque (voir src/lib/bank-history.ts). Finta ne remonte qu'à trois mois ; les
 * relevés de la banque et ceux d'un agrégateur remontent à l'ouverture des comptes. Les lignes absentes de
 * Pécule y sont créées (`origin = 'banque'`), datées et libellées comme celles de Finta, puis
 * classées : règle ou même libellé déjà classé, sinon ce que les opérations déjà là apprennent
 * (même libellé de la banque, puis même catégorie de la banque), toujours en « deviné » (auto) ;
 * un débit ne reçoit jamais une catégorie de revenu.
 * Rejouable : une ligne déjà créée est retrouvée par le rapprochement, et son identifiant est
 * l'empreinte de la ligne. Les 45 derniers jours des comptes que Finta alimente lui sont laissés.
 */

/** Compte à créer (ou compte existant imposé par `force`) ; `like` = compte dont on reprend les réglages (masqué, hors statistiques, par défaut et par membre), `hidden` / `excluded` les imposent. */
export type HistoryAccount = { id: string; name: string; displayName?: string | null; owner: string; kind: string; like?: string | null; hidden?: boolean | null; excluded?: boolean | null; /** Ce compte de Pécule (existant ou à créer) est imposé pour ce compte de l'export, quoi qu'apprennent les couples. */ force?: boolean | null };

export type HistoryInput = {
  rows: (HistoryRow & { accountName?: string | null })[];
  /** Comptes à créer pour les comptes de l'export que Pécule ne connaît pas (cartes clôturées). */
  accounts?: Record<string, HistoryAccount>;
  /** Catégorie de la banque → catégorie du référentiel, quand rien de mieux n'est connu (prioritaire sur ce qui est appris). */
  bankCategories?: Record<string, string>;
  dryRun?: boolean;
};

type Line = { rows: number; present: number; created: number; recent: number; doubtful: number; unknown: number };

export type HistoryReport = {
  dryRun: boolean;
  rows: number;
  from: string;
  to: string;
  /** Opérations créées (ou à créer, à blanc). */
  created: number;
  /** Par compte de l'export puis par année. */
  accounts: { account: string; name: string; target: string | null; targetName: string | null; isNew: boolean; total: Line; years: Record<string, Line> }[];
  categories: { rule: number; sameLabel: number; bankLabel: number; bankCategory: number; none: number };
  /** Catégorie de la banque → catégorie de Pécule : correspondances fournies, complétées par celles apprises des opérations déjà classées. */
  bankCategories: Record<string, string>;
  /** Opérations de Pécule sans ligne dans les relevés, par compte. */
  orphans: Record<string, number>;
  /** Total des montants créés, par année (dépenses et entrées confondues, pour contrôle). */
  amounts: Record<string, { debits: number; credits: number }>;
  after?: { named: number; invoicesLinked: number };
};

/** Jours récents laissés à Finta : la synchro les apporte, avec ses propres identifiants. */
const RECENT_DAYS = 45;
/** Catégories choisies par quelqu'un (ou une règle) : les seules dont on apprend. */
const TRUSTED = new Set(["reprise", "manuel", "regle"]);

const daysBefore = (day: string, n: number) => new Date(Date.parse(day) - n * 86400_000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const emptyLine = (): Line => ({ rows: 0, present: 0, created: 0, recent: 0, doubtful: 0, unknown: 0 });

type Tx = { id: string; accountId: string; date: string; amount: number; label: string; label_key: string; category_id: string | null; category_source: string | null };

export async function importBankHistory(input: HistoryInput): Promise<HistoryReport> {
  if (isDemo()) throw new ActionError(403, "Import indisponible en mode démo");
  const rows = input.rows;
  if (!rows.length) throw new ActionError(400, "Aucune ligne à importer");
  const dryRun = input.dryRun !== false;

  // Les doublons de carte écartés comptent aussi : ils couvrent leur ligne.
  const txs = (
    await q<Tx>(
      // Montant tel que la banque l'a écrit (celui d'origine pour un compte qui n'est pas dans la devise du foyer).
      `SELECT id, account_id AS accountId, DATE_FORMAT(date, '%Y-%m-%d') AS date, COALESCE(original_amount, amount) AS amount, label, label_key, category_id, category_source
       FROM transactions WHERE status <> 'deleted' ORDER BY date DESC`,
    )
  ).map((t) => ({ ...t, amount: Number(t.amount) }));
  const txById = new Map(txs.map((t) => [t.id, t]));
  const known = await q<{ id: string; name: string; source: string }>("SELECT id, name, source FROM accounts");
  const accountName = new Map(known.map((a) => [a.id, a.name]));
  /** Comptes que Finta alimente : leurs derniers jours lui sont laissés. Un livret ou une carte clôturée ne viendra jamais par lui. */
  const fedByFinta = new Set(known.filter((a) => a.source === "finta").map((a) => a.id));
  const categoryKind = new Map((await q<{ id: string; kind: string }>("SELECT id, kind FROM categories")).map((c) => [c.id, c.kind]));
  const categoryIds = new Set(categoryKind.keys());
  const rules = await q<{ pattern: string; category_id: string }>("SELECT pattern, category_id FROM rules ORDER BY priority, CHAR_LENGTH(pattern) DESC");

  const forced = new Map(Object.entries(input.accounts ?? {}).filter(([, a]) => a.force).map(([account, a]) => [account, a.id]));
  const rec = reconcileHistory(txs, rows, forced);
  const ranks = rowRanks(rows);

  /** Libellé, nom et clé qu'aurait la ligne une fois dans Pécule. */
  const shape = (r: HistoryRow) => {
    const label = historyLabel(r.label).slice(0, 512);
    const merchant = bankCounterparty(r.label, r.suggested);
    return { label, merchant, key: labelKey(label, merchant) };
  };

  // Ce que les opérations déjà classées apprennent : par clé de libellé (la plus récente), par libellé de la banque, par catégorie de la banque.
  const byKey = new Map<string, string>();
  for (const t of txs) if (t.category_id && TRUSTED.has(t.category_source ?? "") && t.label_key && !byKey.has(t.label_key)) byKey.set(t.label_key, t.category_id);
  const byBankLabel = new Map<string, Map<string, number>>();
  const bump = (map: Map<string, Map<string, number>>, key: string | null | undefined, category: string) => {
    if (!key) return;
    const counts = map.get(key) ?? new Map<string, number>();
    map.set(key, counts.set(category, (counts.get(category) ?? 0) + 1));
  };
  /** Catégorie de la banque → libellés distincts qui la portent (un marchand fréquent ne vote qu'une fois). */
  const labelsOfBankCategory = new Map<string, Set<string>>();
  for (const p of rec.pairs) {
    const t = txById.get(p.txId)!;
    if (!t.category_id || !TRUSTED.has(t.category_source ?? "")) continue;
    const key = shape(p.row).key;
    bump(byBankLabel, key, t.category_id);
    if (key && p.row.category) labelsOfBankCategory.set(p.row.category, (labelsOfBankCategory.get(p.row.category) ?? new Set()).add(key));
  }
  const bankCategories: Record<string, string> = {};
  for (const [name, keys] of labelsOfBankCategory) {
    const counts = new Map<string, number>();
    for (const key of keys) {
      const c = dominant(byBankLabel.get(key), 0.6, 1);
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const c = dominant(counts, 0.7, 3);
    if (c) bankCategories[name] = c;
  }
  for (const [name, c] of Object.entries(input.bankCategories ?? {})) if (categoryIds.has(c)) bankCategories[name] = c;

  const lines = new Map<string, HistoryReport["accounts"][number]>();
  const line = (r: HistoryRow & { accountName?: string | null }) => {
    let a = lines.get(r.account);
    if (!a) {
      const target = rec.accounts.get(r.account) ?? input.accounts?.[r.account]?.id ?? null;
      // Un compte imposé qui n'existe pas encore reste « à créer ».
      const isNew = target != null && (!rec.accounts.has(r.account) || (forced.has(r.account) && !accountName.has(target)));
      a = { account: r.account, name: r.accountName ?? r.account, target, targetName: target ? (accountName.get(target) ?? input.accounts?.[r.account]?.name ?? null) : null, isNew, total: emptyLine(), years: {} };
      lines.set(r.account, a);
    }
    return a;
  };
  const count = (r: HistoryRow, field: keyof Line) => {
    const a = line(r);
    const year = historyDate(r).slice(0, 4);
    a.years[year] ??= emptyLine();
    for (const l of [a.total, a.years[year]]) {
      l.rows++;
      l[field]++;
    }
  };
  for (const p of rec.pairs) count(p.row, "present");
  for (const r of rec.doubtful) count(r, "doubtful");

  const now = today();
  const recentFrom = daysBefore(now, RECENT_DAYS);
  const categories = { rule: 0, sameLabel: 0, bankLabel: 0, bankCategory: 0, none: 0 };
  const amounts: HistoryReport["amounts"] = {};
  const values: unknown[][] = [];
  // L'export est en euros : pour un foyer dans une autre devise, chaque montant est converti au cours de son jour.
  const convert = dryRun ? null : await fxConverter(["EUR"], rec.missing.reduce((min, r) => (r.date < min ? r.date : min), now));
  const newAccounts = new Map<string, HistoryAccount>();
  for (const r of rec.missing) {
    const a = line(r);
    const date = historyDate(r);
    if (!a.target) {
      count(r, "unknown");
      continue;
    }
    if (date > now || (r.date >= recentFrom && fedByFinta.has(a.target))) {
      count(r, "recent");
      continue;
    }
    // Un compte reconnu ne reçoit rien d'un autre export tant qu'il n'est pas déclaré : seul un compte déclaré est créé.
    if (a.isNew) newAccounts.set(r.account, input.accounts![r.account]);
    count(r, "created");
    const s = shape(r);
    const cat: { id: string | null; source: string | null } = { id: null, source: null };
    const rule = s.key ? rules.find((x) => s.key.includes(x.pattern)) : undefined;
    const tryCategory = (id: string | null | undefined, kind: keyof typeof categories, src: string) => {
      if (cat.id || !id || !categoryIds.has(id)) return;
      // Un même nom peut verser un revenu et recevoir un placement : un débit ne prend jamais une catégorie de revenu.
      if (r.amount < 0 && categoryKind.get(id) === "revenu") return;
      cat.id = id;
      cat.source = src;
      categories[kind]++;
    };
    tryCategory(rule?.category_id, "rule", "regle");
    tryCategory(s.key ? byKey.get(s.key) : null, "sameLabel", "auto");
    tryCategory(s.key ? dominant(byBankLabel.get(s.key), 0.6, 1) : null, "bankLabel", "auto");
    tryCategory(r.category ? bankCategories[r.category] : null, "bankCategory", "auto");
    if (!cat.id) categories.none++;
    const id = `banque:${createHash("sha1").update(`${r.account}|${r.date}|${Math.round(r.amount * 100)}|${r.label}|${ranks.get(r)}`).digest("hex")}`;
    const money = convert ? convert(r.amount, "EUR", date) : { amount: r.amount, originalAmount: null, originalCurrency: null };
    values.push([id, a.target, date, money.amount, money.originalAmount, money.originalCurrency, s.label, s.merchant, r.label.slice(0, 255), s.key, cat.id, cat.source]);
    const y = (amounts[date.slice(0, 4)] ??= { debits: 0, credits: 0 });
    if (r.amount < 0) y.debits = r2(y.debits + r.amount);
    else y.credits = r2(y.credits + r.amount);
  }

  const days = rows.map((r) => r.date).sort();
  const report: HistoryReport = {
    dryRun,
    rows: rows.length,
    from: days[0],
    to: days[days.length - 1],
    created: values.length,
    accounts: [...lines.values()].sort((a, b) => b.total.rows - a.total.rows),
    categories,
    bankCategories,
    orphans: Object.fromEntries([...rec.orphans].map(([id, n]) => [`${accountName.get(id) ?? "?"} (${id.slice(0, 8)})`, n])),
    amounts,
  };
  if (dryRun) return report;

  for (const a of newAccounts.values()) {
    // Mêmes réglages (masqué, hors statistiques, par défaut et par membre) que le compte qui lui ressemble.
    await exec(
      `INSERT IGNORE INTO accounts (id, name, display_name, institution, owner, kind, currency, hidden, excluded, source)
       SELECT ?, ?, ?, 'BoursoBank', ?, ?, 'EUR', COALESCE(?, MAX(l.hidden), 1), COALESCE(?, MAX(l.excluded), 0), 'banque' FROM (SELECT 1 AS n) x LEFT JOIN accounts l ON l.id = ?`,
      [a.id, a.name, a.displayName ?? null, a.owner, a.kind, a.hidden == null ? null : Number(a.hidden), a.excluded == null ? null : Number(a.excluded), a.like ?? null],
    );
    if (a.like) await exec("INSERT IGNORE INTO account_prefs (user_id, account_id, hidden, excluded) SELECT user_id, ?, hidden, excluded FROM account_prefs WHERE account_id = ?", [a.id, a.like]);
  }
  let inserted = 0;
  for (let i = 0; i < values.length; i += 200) {
    const chunk = values.slice(i, i + 200);
    const res = await exec(
      `INSERT IGNORE INTO transactions (id, account_id, date, amount, original_amount, original_currency, label, merchant, bank_label, label_key, status, category_id, category_source, origin)
       VALUES ${chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, 'banque')").join(", ")}`,
      chunk.flat(),
    );
    inserted += res.affectedRows;
  }
  report.created = inserted;
  // Comme après une synchro : noms appris des libellés de la banque, factures enfin rapprochées de leur paiement.
  const named = await nameFromBankLabels();
  report.after = { named: named.named, invoicesLinked: await matchInvoices() };
  return report;
}

/**
 * Retour en arrière : supprime les opérations créées par l'import (avec leurs liens de facture et
 * leurs ventilations) et les comptes créés pour elles. Les catégories posées depuis sur ces
 * opérations sont perdues ; le reste de Pécule n'est pas touché.
 */
export async function removeBankHistory(): Promise<{ transactions: number; accounts: number }> {
  if (isDemo()) throw new ActionError(403, "Indisponible en mode démo");
  await exec("DELETE it FROM invoice_transactions it JOIN transactions t ON t.id = it.transaction_id WHERE t.origin = 'banque'");
  await exec("DELETE s FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id WHERE t.origin = 'banque'");
  const tx = await exec("DELETE FROM transactions WHERE origin = 'banque'");
  await exec("DELETE p FROM account_prefs p JOIN accounts a ON a.id = p.account_id WHERE a.source = 'banque'");
  const acc = await exec("DELETE a FROM accounts a WHERE a.source = 'banque' AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = a.id)");
  return { transactions: tx.affectedRows, accounts: acc.affectedRows };
}
