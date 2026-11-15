import { exec, one, q } from "./db.ts";
import { userAccountsSql } from "./actions.ts";
import { isDemo } from "./demo-context.ts";
import { ebCards } from "./enable-banking.ts";
import { recurringRow } from "./flows.ts";
import { householdDay } from "./region.ts";
import { STAT_DATE_JOIN, statDate } from "./stats.ts";
import { addMonths } from "../lib/periods.ts";
import { expectedIn, recurringSeries } from "../lib/recurring.ts";
import { accountRule, addDays, cleanBalanceRule, DEFAULT_BALANCE_RULE, firstLow, lowestPoint, MAX_BALANCE_DAYS, projectBalance, type BalancePoint, type BalanceRule, type LowPoint, type Movement } from "../lib/balance.ts";
import { t } from "../lib/i18n.ts";

/*
 * Solde bas : la règle de chaque membre (app_kv, « solde:regle:<membre> ») et la prévision de ses comptes.
 * La prévision part du solde connu de chaque compte et y ajoute ce qui est attendu sur ce compte-là : ce qui y revient
 * chaque mois — reconnu dans ses cinq derniers mois, mouvements entre comptes compris (un virement mensuel vers le
 * compte commun compte autant qu'un prélèvement) — et le prélèvement des cartes à débit différé, lu à la banque. Les
 * achats du quotidien ne sont pas devinés : la prévision dit où mènent les engagements connus, pas plus.
 */

const key = (userId: number) => `solde:regle:${userId}`;

/** Règle du membre ; tant qu'il n'a rien réglé : la règle d'origine, au seuil qu'il avait donné à ses appareils. */
export async function balanceRule(userId: number): Promise<BalanceRule> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key(userId)]);
  if (row) {
    try {
      return cleanBalanceRule(JSON.parse(row.value));
    } catch {
      return DEFAULT_BALANCE_RULE;
    }
  }
  // Avant la règle par membre, le seuil était un réglage de chaque appareil abonné aux notifications.
  const devices = await q<{ prefs: string | null }>("SELECT prefs FROM push_subscriptions WHERE user_id = ?", [userId]);
  const old = devices.map((d) => (d.prefs ? (JSON.parse(d.prefs) as { lowBalance?: number }).lowBalance : undefined)).filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  return old.length ? cleanBalanceRule({ threshold: Math.max(...old) }) : DEFAULT_BALANCE_RULE;
}

/** Change une partie de la règle (le reste est gardé) ; `accounts` fusionne compte par compte. */
export async function saveBalanceRule(userId: number, patch: Partial<Omit<BalanceRule, "accounts">> & { accounts?: BalanceRule["accounts"] }): Promise<BalanceRule> {
  const current = await balanceRule(userId);
  const accounts = { ...current.accounts };
  for (const [id, a] of Object.entries(patch.accounts ?? {})) accounts[id] = { ...accounts[id], ...a };
  const next = cleanBalanceRule({ ...current, ...patch, accounts }, current);
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key(userId), JSON.stringify(next)]);
  return next;
}

export type AccountForecast = {
  id: string;
  name: string;
  kind: string;
  balance: number;
  watched: boolean;
  threshold: number;
  /** Premier jour sous le seuil dans le délai de prévenance de la règle (aujourd'hui compris) ; null : rien à signaler. */
  low: LowPoint | null;
  /** Point le plus bas des `horizon` jours à venir. */
  min: BalancePoint | null;
  points: BalancePoint[];
  movements: Movement[];
};

type TxRow = { account_id: string; date: string; amount: number; label: string; merchant: string | null; bank_label: string | null; label_key: string; category: string | null };

/** Le relevé mensuel d'une carte à débit différé : son montant change chaque mois, l'encours lu à la banque le donne. */
const CARD_STATEMENT = /^relev[eé] diff[eé]r[eé]/i;
/** Un prélèvement en retard de plus que cela n'est plus attendu : la série s'est sans doute arrêtée. */
const LATE_DAYS = 5;

/** Prévision des comptes du membre (comptes visibles, comptés dans ses statistiques, hors cartes) sur `horizon` jours. */
export async function balanceForecast(userId: number, horizon = MAX_BALANCE_DAYS): Promise<{ rule: BalanceRule; today: string; horizon: number; accounts: AccountForecast[] }> {
  const rule = await balanceRule(userId);
  const today = householdDay();
  const current = today.slice(0, 7);
  const A = userAccountsSql(userId);
  const accounts = await q<{ id: string; name: string; kind: string; balance: number }>(
    `SELECT acc.id, COALESCE(acc.display_name, acc.name) AS name, acc.kind, acc.balance FROM ${A} a JOIN accounts acc ON acc.id = a.id
     WHERE a.excluded = 0 AND a.hidden = 0 AND a.kind <> 'carte' AND acc.balance IS NOT NULL ORDER BY acc.sort_order, acc.name`,
  );
  if (!accounts.length) return { rule, today, horizon, accounts: [] };
  const rows = await q<TxRow>(
    `SELECT t.account_id, DATE_FORMAT(${statDate("t")}, '%Y-%m-%d') AS date, t.amount, t.label, t.merchant, t.bank_label, t.label_key, c.name AS category
     FROM transactions t JOIN ${A} a ON a.id = t.account_id ${STAT_DATE_JOIN} LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.status IN ('posted', 'pending') AND a.excluded = 0 AND a.hidden = 0 AND a.kind <> 'carte' AND ${statDate("t")} >= ?`,
    [`${addMonths(current, -5)}-01`],
  );
  const cards = await cardDebits(A, today, horizon);
  const months = [current, addMonths(current, 1), addMonths(current, 2)];
  const end = addDays(today, horizon);

  return {
    rule,
    today,
    horizon,
    accounts: accounts.map((acc) => {
      const own = rows
        .filter((r) => r.account_id === acc.id && !CARD_STATEMENT.test(r.label))
        .map((r) => recurringRow({ ...r, amount: Number(r.amount), kind: Number(r.amount) < 0 ? "depense" : "revenu" }));
      const expected: Movement[] = expectedIn(recurringSeries(own, current), own, months)
        .map((e) => ({ date: `${e.month}-${String(e.day).padStart(2, "0")}`, amount: e.amount, name: e.name, source: "recurrence" as const }))
        // En retard : une sortie reste attendue quelques jours (elle peut tomber d'un moment à l'autre) ; une entrée
        // qui n'est pas arrivée n'est pas comptée — on ne prévoit pas avec de l'argent qui manque.
        .filter((m) => (m.date >= today ? m.date <= end : m.amount < 0 && m.date >= addDays(today, -LATE_DAYS)))
        .map((m) => (m.date < today ? { ...m, late: true } : m));
      const movements = [...expected, ...cards.filter((c) => c.accountId === acc.id).map((c) => c.movement)].sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
      const { watched, threshold } = accountRule(rule, acc.id);
      const balance = Number(acc.balance);
      const points = projectBalance(balance, movements, today, horizon);
      return { id: acc.id, name: acc.name, kind: acc.kind, balance, watched, threshold, low: watched ? firstLow(points.slice(0, rule.days + 1), movements, threshold) : null, min: lowestPoint(points), points, movements };
    }),
  };
}

/**
 * Prélèvements à venir des cartes à débit différé, chacun sur le compte qui a reçu le dernier relevé de cette carte
 * (son libellé porte les derniers chiffres de la carte). Sans relevé passé pour désigner le compte, l'encours n'est
 * pas compté : mieux vaut une prévision qui ne dit rien qu'une prévision sur le mauvais compte.
 */
async function cardDebits(A: string, today: string, horizon: number): Promise<{ accountId: string; movement: Movement }[]> {
  // L'encours des cartes vient de la banque reliée du foyer : rien de tel en mode démo.
  if (isDemo()) return [];
  const mine = new Set((await q<{ id: string }>(`SELECT a.id FROM ${A} a WHERE a.kind = 'carte'`)).map((r) => r.id));
  const cards = (await ebCards()).filter((c) => mine.has(c.accountId) && c.outstanding.amount < 0 && c.outstanding.debitDate && c.outstanding.debitDate >= today && c.outstanding.debitDate <= addDays(today, horizon));
  if (!cards.length) return [];
  const statements = await q<{ account_id: string; label: string }>(
    `SELECT t.account_id, t.label FROM transactions t JOIN ${A} a ON a.id = t.account_id
     WHERE a.kind <> 'carte' AND t.amount < 0 AND t.label LIKE 'relev%' AND t.date >= DATE_SUB(?, INTERVAL 4 MONTH) ORDER BY t.date DESC`,
    [today],
  );
  const out: { accountId: string; movement: Movement }[] = [];
  for (const c of cards) {
    const target = c.tail ? statements.find((s) => CARD_STATEMENT.test(s.label) && s.label.includes(c.tail!)) : undefined;
    if (target) out.push({ accountId: target.account_id, movement: { date: c.outstanding.debitDate!, amount: c.outstanding.amount, name: t("Relevé de la carte {nom}", { nom: c.name }), source: "carte" } });
  }
  return out;
}
