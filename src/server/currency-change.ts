import type { PoolConnection } from "mysql2/promise";
import { one, pool, q, withLock } from "./db.ts";
import { ActionError } from "./actions.ts";
import { t } from "../lib/i18n.ts";
import { isDemo, runReal } from "./demo-context.ts";
import { fxConverter, type Converter } from "./fx.ts";
import { householdCurrency, setRegion, region, today } from "./region.ts";
import { cleanRegion } from "../lib/countries.ts";
import { roundMoney } from "../lib/currencies.ts";

/*
 * Changer une devise après coup.
 *  - Devise du foyer : chaque opération est recalculée à partir de son montant d'origine (celui du compte), au cours
 *    de son jour ; les soldes au cours du jour ; l'historique des soldes et du patrimoine au cours de chaque date.
 *    Les montants saisis à la main (budgets, objectifs, biens, placements, crédits, bulletins) gardent leur chiffre :
 *    ils n'ont pas de devise propre, c'est à leur auteur de les revoir.
 *  - Devise d'un compte (créé dans la mauvaise devise) : ses montants tels que la banque les a écrits sont relus
 *    dans la nouvelle devise, puis ramenés à celle du foyer.
 * Tout se fait dans une transaction : en cas d'échec (cours introuvable), rien n'est modifié.
 */

type TxRow = { id: string; date: string; amount: number; original_amount: number | null; original_currency: string | null };
type AccountRow = { id: string; currency: string; balance: number | null; balance_original: number | null };

const CHUNK = 200;

/** Ce que la banque a écrit : le montant d'origine s'il est gardé, sinon le montant (alors dans la devise du foyer). */
const sourceOf = (t: TxRow, home: string) => (t.original_currency ? { amount: Number(t.original_amount), currency: t.original_currency } : { amount: Number(t.amount), currency: home });

async function rows<T>(conn: PoolConnection, sql: string, params: unknown[] = []): Promise<T[]> {
  const [result] = await conn.query(sql, params);
  return result as T[];
}

/** Réécrit le montant d'un lot d'opérations (et leurs ventilations, à proportion). */
async function rewriteTransactions(conn: PoolConnection, txs: TxRow[], next: (t: TxRow) => { amount: number; originalAmount: number | null; originalCurrency: string | null }) {
  let changed = 0;
  for (let i = 0; i < txs.length; i += CHUNK) {
    const chunk = txs.slice(i, i + CHUNK);
    const values = chunk.map((t) => ({ id: t.id, before: Number(t.amount), ...next(t) }));
    const cases = (pick: (v: (typeof values)[number]) => unknown) => ({ sql: `CASE id ${values.map(() => "WHEN ? THEN ?").join(" ")} END`, params: values.flatMap((v) => [v.id, pick(v)]) });
    const amount = cases((v) => v.amount);
    const originalAmount = cases((v) => v.originalAmount);
    const originalCurrency = cases((v) => v.originalCurrency);
    await conn.query(
      `UPDATE transactions SET amount = ${amount.sql}, original_amount = ${originalAmount.sql}, original_currency = ${originalCurrency.sql}, updated_at = updated_at
       WHERE id IN (${values.map(() => "?").join(", ")})`,
      [...amount.params, ...originalAmount.params, ...originalCurrency.params, ...values.map((v) => v.id)],
    );
    changed += values.filter((v) => v.amount !== v.before).length;
    // Ventilations : même proportion, le dernier article absorbe l'arrondi pour que la somme reste le montant.
    const splits = await rows<{ id: number; transaction_id: string; amount: number }>(
      conn,
      `SELECT id, transaction_id, amount FROM transaction_splits WHERE transaction_id IN (${values.map(() => "?").join(", ")}) ORDER BY transaction_id, position, id`,
      values.map((v) => v.id),
    );
    const byTx = new Map<string, { id: number; amount: number }[]>();
    for (const s of splits) byTx.set(s.transaction_id, [...(byTx.get(s.transaction_id) ?? []), { id: s.id, amount: Number(s.amount) }]);
    for (const v of values) {
      const lines = byTx.get(v.id);
      if (!lines || !v.before || v.amount === v.before) continue;
      const whole = Math.abs(lines.reduce((s, l) => s + l.amount, 0) - v.before) < 0.005;
      let rest = v.amount;
      for (const [k, l] of lines.entries()) {
        const scaled = whole && k === lines.length - 1 ? Math.round(rest * 100) / 100 : Math.round(((l.amount * v.amount) / v.before) * 100) / 100;
        rest -= scaled;
        await conn.query("UPDATE transaction_splits SET amount = ? WHERE id = ?", [scaled, l.id]);
      }
    }
  }
  return changed;
}

export type CurrencyChangePreview = { from: string; to: string; transactions: number; accounts: number; since: string | null };

/** Ce que changerait une nouvelle devise du foyer (rien n'est écrit). */
export async function currencyChangePreview(to: string): Promise<CurrencyChangePreview> {
  const from = householdCurrency();
  const counts = await one<{ transactions: number; accounts: number; since: string | null }>(
    `SELECT (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM accounts) AS accounts,
            (SELECT DATE_FORMAT(MIN(date), '%Y-%m-%d') FROM transactions) AS since`,
  );
  return { from, to, transactions: Number(counts?.transactions ?? 0), accounts: Number(counts?.accounts ?? 0), since: counts?.since ?? null };
}

/**
 * Le recalcul ne se fait pas pendant une lecture des banques (elle écrirait des montants dans l'ancienne devise), ni
 * deux fois à la fois : il prend les verrous des synchros, et renonce s'ils sont pris.
 */
async function alone<T>(fn: () => Promise<T>): Promise<T> {
  const busy = () => new ActionError(409, t("Une synchronisation est en cours : réessaie dans un instant."));
  const done = await withLock("pecule:devise", () => withLock("pecule:sync", () => withLock("pecule:sync-enablebanking", async () => ({ value: await fn() }))));
  if (!done) throw busy();
  return done.value;
}

/** Change la devise du foyer et recalcule opérations, soldes et historiques. */
export const changeHouseholdCurrency = (to: string) => alone(() => recalcHousehold(to));

async function recalcHousehold(to: string): Promise<{ changed: boolean; transactions: number; accounts: number }> {
  if (isDemo()) throw new Error("Indisponible en mode démo");
  const home = householdCurrency();
  if (to === home) return { changed: false, transactions: 0, accounts: 0 };
  const day = today();
  const accounts = await q<AccountRow>("SELECT id, currency, balance, balance_original FROM accounts");
  const bounds = await one<{ first: string | null }>(
    `SELECT DATE_FORMAT(LEAST(COALESCE((SELECT MIN(date) FROM transactions), CURRENT_DATE), COALESCE((SELECT MIN(date) FROM balances), CURRENT_DATE),
                              COALESCE((SELECT MIN(date) FROM wealth_snapshots), CURRENT_DATE)), '%Y-%m-%d') AS first`,
  );
  const used = await q<{ c: string }>("SELECT DISTINCT original_currency AS c FROM transactions WHERE original_currency IS NOT NULL");
  // Cours demandés avant d'ouvrir la transaction : un cours introuvable arrête tout sans rien avoir écrit.
  const convert: Converter = await fxConverter([home, ...accounts.map((a) => a.currency), ...used.map((u) => u.c)], bounds?.first ?? day, to);
  convert(1, home, day);

  const conn = await runReal(() => pool.getConnection());
  let transactions = 0;
  try {
    await conn.beginTransaction();
    // Opérations, page par page (clé primaire).
    for (let after = ""; ; ) {
      const page = await rows<TxRow>(conn, "SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS date, amount, original_amount, original_currency FROM transactions WHERE id > ? ORDER BY id LIMIT 2000", [after]);
      if (!page.length) break;
      after = page[page.length - 1].id;
      transactions += await rewriteTransactions(conn, page, (t) => {
        const src = sourceOf(t, home);
        return convert(src.amount, src.currency, t.date);
      });
    }
    // Soldes : celui du compte dans sa devise, ramené à la nouvelle devise du foyer au cours du jour.
    for (const a of accounts) {
      const source = a.currency === home ? a.balance : a.balance_original;
      if (source == null) {
        if (a.currency === to) await conn.query("UPDATE accounts SET balance_original = NULL WHERE id = ?", [a.id]);
        continue;
      }
      const next = convert(Number(source), a.currency, day);
      await conn.query("UPDATE accounts SET balance = ?, balance_original = ? WHERE id = ?", [next.amount, next.originalAmount, a.id]);
    }
    // Historiques (gardés dans la devise du foyer) : convertis au cours de chaque date.
    const history = await rows<{ account_id: string; date: string; balance: number }>(conn, "SELECT account_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, balance FROM balances");
    for (const b of history) await conn.query("UPDATE balances SET balance = ? WHERE account_id = ? AND date = ?", [convert(Number(b.balance), home, b.date).amount, b.account_id, b.date]);
    const snapshots = await rows<{ user_id: number; date: string; gross: number; debts: number; net: number; breakdown: string | null }>(
      conn,
      "SELECT user_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, gross, debts, net, breakdown FROM wealth_snapshots",
    );
    for (const s of snapshots) {
      const c = (n: number) => convert(Number(n), home, s.date).amount;
      let breakdown = s.breakdown;
      try {
        const parts = s.breakdown ? (JSON.parse(s.breakdown) as Record<string, unknown>) : null;
        if (parts) breakdown = JSON.stringify(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, typeof v === "number" ? c(v) : v])));
      } catch {
        /* détail illisible : gardé tel quel */
      }
      await conn.query("UPDATE wealth_snapshots SET gross = ?, debts = ?, net = ?, breakdown = ? WHERE user_id = ? AND date = ?", [c(s.gross), c(s.debts), c(s.net), breakdown, s.user_id, s.date]);
    }
    // Le réglage, dans la même transaction.
    const [kv] = await rows<{ value: string }>(conn, "SELECT value FROM app_kv WHERE `key` = 'household' FOR UPDATE");
    let saved: Record<string, unknown> = {};
    try {
      saved = kv ? (JSON.parse(kv.value) as Record<string, unknown>) : {};
    } catch {
      saved = {};
    }
    const next = { ...saved, ...cleanRegion({ ...region(), currency: to }) };
    await conn.query("INSERT INTO app_kv (`key`, value) VALUES ('household', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify(next)]);
    await conn.query("INSERT INTO audit_log (user_id, via, action, target, details) VALUES (NULL, 'systeme', 'devise du foyer', ?, ?)", [to, JSON.stringify({ avant: home, operations: transactions, comptes: accounts.length })]);
    await conn.commit();
    setRegion(cleanRegion({ ...region(), currency: to }));
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return { changed: true, transactions, accounts: accounts.length };
}

/**
 * Change la devise d'un compte créé dans la mauvaise : ce que la banque a écrit (montants et solde) est relu dans la
 * nouvelle devise. L'historique des soldes, gardé dans la devise du foyer, est ramené à l'ancienne devise puis relu.
 */
export const changeAccountCurrency = (accountId: string, to: string) => alone(() => recalcAccount(accountId, to));

async function recalcAccount(accountId: string, to: string): Promise<{ changed: boolean; transactions: number }> {
  if (isDemo()) throw new Error("Indisponible en mode démo");
  const home = householdCurrency();
  const account = await one<AccountRow>("SELECT id, currency, balance, balance_original FROM accounts WHERE id = ?", [accountId]);
  if (!account) throw new Error("Compte inconnu");
  const old = account.currency;
  if (old === to) return { changed: false, transactions: 0 };
  const day = today();
  const first = await one<{ first: string | null }>(
    `SELECT DATE_FORMAT(LEAST(COALESCE((SELECT MIN(date) FROM transactions WHERE account_id = ?), CURRENT_DATE),
                              COALESCE((SELECT MIN(date) FROM balances WHERE account_id = ?), CURRENT_DATE)), '%Y-%m-%d') AS first`,
    [accountId, accountId],
  );
  const from = first?.first ?? day;
  const toHome = await fxConverter([to], from, home);
  const backToOld = await fxConverter([home], from, old);
  toHome(1, to, day);

  const conn = await runReal(() => pool.getConnection());
  let transactions = 0;
  try {
    await conn.beginTransaction();
    for (let after = ""; ; ) {
      const page = await rows<TxRow>(
        conn,
        "SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS date, amount, original_amount, original_currency FROM transactions WHERE account_id = ? AND id > ? ORDER BY id LIMIT 2000",
        [accountId, after],
      );
      if (!page.length) break;
      after = page[page.length - 1].id;
      transactions += await rewriteTransactions(conn, page, (t) => toHome(sourceOf(t, home).amount, to, t.date));
    }
    const source = old === home ? account.balance : account.balance_original;
    if (source == null) await conn.query("UPDATE accounts SET currency = ?, balance_original = NULL WHERE id = ?", [to, accountId]);
    else {
      const next = toHome(Number(source), to, day);
      await conn.query("UPDATE accounts SET currency = ?, balance = ?, balance_original = ? WHERE id = ?", [to, next.amount, next.originalAmount, accountId]);
    }
    const history = await rows<{ date: string; balance: number }>(conn, "SELECT DATE_FORMAT(date, '%Y-%m-%d') AS date, balance FROM balances WHERE account_id = ?", [accountId]);
    for (const b of history) {
      const written = old === home ? Number(b.balance) : backToOld(Number(b.balance), home, b.date).amount;
      await conn.query("UPDATE balances SET balance = ? WHERE account_id = ? AND date = ?", [toHome(roundMoney(written, to), to, b.date).amount, accountId, b.date]);
    }
    await conn.query("INSERT INTO audit_log (user_id, via, action, target, details) VALUES (NULL, 'systeme', 'devise du compte', ?, ?)", [accountId, JSON.stringify({ avant: old, apres: to, operations: transactions })]);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return { changed: true, transactions };
}
