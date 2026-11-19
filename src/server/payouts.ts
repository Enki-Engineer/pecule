import { exec, q } from "./db.ts";
import { userAccountsSql } from "./actions.ts";
import { STAT_DATE_JOIN, STAT_SCOPE, statDate } from "./stats.ts";
import { likeText, type Payout } from "../lib/payouts.ts";

/*
 * Versements reçus d'un placement : les entrées d'argent dont le libellé, le marchand ou le libellé de la banque
 * porte le texte indiqué sur le placement (`assets.payout_match`) — coupons d'une obligation, intérêts, ce qu'une
 * plateforme reverse. Rien n'est recopié : ce sont les opérations elles-mêmes, lues dans les comptes du membre,
 * au jour retenu par le foyer. Pour un placement dont la valeur suit ses versements (`valuation = 'versements'`),
 * la valeur enregistrée est le dernier versement reçu.
 */

export type PayoutRow = Payout & { id: string; label: string; merchant: string | null };

/** Les versements qui portent `match`, du plus récent au plus ancien. `accounts` : les comptes du membre (userAccountsSql). */
export function payouts(accounts: string, match: string, limit = 1000): Promise<PayoutRow[]> {
  const day = statDate("t");
  const like = likeText(match.trim());
  return q<PayoutRow>(
    `SELECT t.id, DATE_FORMAT(${day}, '%Y-%m-%d') AS date, t.amount, t.label, t.merchant
     FROM transactions t JOIN ${accounts} a ON a.id = t.account_id ${STAT_DATE_JOIN}
     WHERE ${STAT_SCOPE} AND a.hidden = 0 AND t.amount > 0 AND (t.label LIKE ? OR t.merchant LIKE ? OR t.bank_label LIKE ?)
     ORDER BY ${day} DESC, t.id DESC LIMIT ${Math.trunc(limit)}`,
    [like, like, like],
  ).then((rows) => rows.map((r) => ({ ...r, amount: Number(r.amount) })));
}

/**
 * Met à la valeur du dernier versement reçu les placements qui suivent leurs versements (un seul si `only`). Sans
 * versement trouvé, la valeur en place est gardée. Le placement d'un membre lit ses comptes ; un bien commun, les
 * comptes tels que le foyer les a réglés.
 */
export async function refreshPayoutValues(only?: number): Promise<number> {
  const rows = await q<{ id: number; owner_user_id: number | null; payout_match: string }>(
    `SELECT id, owner_user_id, payout_match FROM assets WHERE valuation = 'versements' AND closed = 0 AND payout_match IS NOT NULL${only ? " AND id = ?" : ""}`,
    only ? [only] : [],
  );
  let changed = 0;
  for (const a of rows) {
    const [last] = await payouts(userAccountsSql(a.owner_user_id ?? 0), a.payout_match, 1);
    if (!last) continue;
    const res = await exec("UPDATE assets SET value = ?, value_date = ? WHERE id = ? AND NOT (value <=> ? AND value_date <=> ?)", [last.amount, last.date, a.id, last.amount, last.date]);
    changed += res.affectedRows;
  }
  return changed;
}
