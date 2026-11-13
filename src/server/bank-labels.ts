import { ActionError } from "./actions.ts";
import { exec, q } from "./db.ts";
import { guessCategory } from "./guess.ts";
import { bankCounterparty, matchBankRows, nameAddsInfo, parseBoursoCsv, shapeIsSpecific } from "../lib/bourso.ts";
import { t as tr } from "../lib/i18n.ts";
import { labelKey } from "../lib/labels.ts";
import { labelShape } from "../lib/nature.ts";

/*
 * Libellés de la banque (export CSV de BoursoBank, voir src/lib/bourso.ts).
 * - Le libellé de la banque est gardé sur l'opération (`bank_label`).
 * - Une opération sans nom dont le libellé de Finta ne dit pas la contrepartie prend ce nom
 *   (`merchant`) : titre à l'écran, logo, regroupement par marchand, et clé de libellé — donc
 *   catégorie reprise d'une opération de même nom, comme pour n'importe quel marchand.
 * - Les opérations de même forme (même compte, même sens) reçoivent ensuite le même nom sans
 *   nouvel export : le salaire du mois suivant est nommé dès la synchro.
 * Un nom déjà posé (Finta, engagement du Budget) n'est jamais remplacé, sauf le faux nom « Inconnu ».
 */

export type BankImportResult = {
  /** Lignes lues dans l'export. */
  rows: number;
  /** Opérations de Pécule retrouvées dans l'export. */
  matched: number;
  /** Dont celles qui n'avaient pas encore ce libellé. */
  labelled: number;
  /** Opérations nommées d'après la banque. */
  named: number;
  /** Opérations classées grâce à ce nom. */
  categorized: number;
  /** Opérations laissées de côté : plusieurs lignes possibles. */
  ambiguous: number;
  /** Opérations nommées par ressemblance (même forme de libellé). */
  propagated: number;
  from: string;
  to: string;
};

/** Faux noms hérités de la reprise Notion ou de Finta : à traiter comme une absence de nom. */
const PLACEHOLDERS = ["Inconnu", "Unknown"];
const NAMELESS = `(merchant IS NULL OR merchant IN (${PLACEHOLDERS.map((p) => `'${p}'`).join(", ")}))`;
const nameless = (merchant: string | null) => !merchant || PLACEHOLDERS.includes(merchant);

type Tx = { id: string; accountId: string; date: string; amount: number; label: string; merchant: string | null; bank_label: string | null; category_id: string | null };

/** Pose un nom sur une opération sans nom, recalcule sa clé et la classe si une opération de même nom l'a déjà été. */
async function nameTransaction(t: { id: string; label: string; category_id: string | null }, name: string): Promise<{ named: boolean; categorized: boolean }> {
  const key = labelKey(t.label, name);
  const res = await exec(`UPDATE transactions SET merchant = ?, label_key = ? WHERE id = ? AND ${NAMELESS}`, [name, key, t.id]);
  if (!res.affectedRows) return { named: false, categorized: false };
  if (t.category_id) return { named: true, categorized: false };
  const guess = await guessCategory(key);
  if (!guess) return { named: true, categorized: false };
  const done = await exec("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ? AND category_id IS NULL", [guess.categoryId, guess.source, t.id]);
  return { named: true, categorized: done.affectedRows > 0 };
}

/** Importe un export d'opérations de BoursoBank : libellés, noms, catégories. Peut être rejoué sans effet de bord. */
export async function importBankLabels(csv: string): Promise<BankImportResult> {
  const rows = parseBoursoCsv(csv);
  if (!rows.length) throw new ActionError(400, tr("Ce fichier n'est pas un export d'opérations de BoursoBank (CSV attendu)"));
  const days = rows.map((r) => r.date).sort();
  const from = days[0];
  const to = days[days.length - 1];
  // Un achat par carte à débit différé est daté du prélèvement, le mois suivant.
  const txs = (
    await q<Tx>(
      `SELECT id, account_id AS accountId, DATE_FORMAT(date, '%Y-%m-%d') AS date, amount, label, merchant, bank_label, category_id
       FROM transactions WHERE status <> 'deleted' AND date BETWEEN DATE_SUB(?, INTERVAL 5 DAY) AND DATE_ADD(?, INTERVAL 45 DAY)`,
      [from, to],
    )
  ).map((t) => ({ ...t, amount: Number(t.amount) }));
  const byId = new Map(txs.map((t) => [t.id, t]));
  const { matches, ambiguous } = matchBankRows(txs, rows);
  const out: BankImportResult = { rows: rows.length, matched: matches.length, labelled: 0, named: 0, categorized: 0, ambiguous, propagated: 0, from, to };
  for (const m of matches) {
    const t = byId.get(m.txId)!;
    const label = m.row.label.slice(0, 255);
    if (t.bank_label !== label) {
      await exec("UPDATE transactions SET bank_label = ? WHERE id = ?", [label, t.id]);
      out.labelled++;
    }
    const name = nameless(t.merchant) ? bankCounterparty(m.row.label, m.row.suggested) : null;
    if (!name || !nameAddsInfo(t.label, name)) continue;
    const r = await nameTransaction(t, name);
    if (r.named) out.named++;
    if (r.categorized) out.categorized++;
  }
  const spread = await nameFromBankLabels();
  out.propagated = spread.named;
  out.categorized += spread.categorized;
  return out;
}

/**
 * Nomme les opérations sans nom par ressemblance : même compte, même sens, même forme de libellé
 * qu'au moins deux opérations reconnues par la banque et toutes du même nom. Relancé après chaque
 * synchro : le virement de salaire ou le prélèvement d'énergie du mois est nommé et classé à
 * son arrivée, sans attendre un nouvel export.
 */
export async function nameFromBankLabels(): Promise<{ named: number; categorized: number }> {
  const known = await q<{ account_id: string; label: string; amount: number; merchant: string }>(
    `SELECT account_id, label, amount, merchant FROM transactions WHERE bank_label IS NOT NULL AND NOT ${NAMELESS} AND status <> 'deleted'`,
  );
  const keyOf = (t: { account_id: string; label: string; amount: number }, shape: string) => `${t.account_id}|${Number(t.amount) < 0 ? "-" : "+"}|${shape}`;
  // Les achats par carte ont déjà un libellé lisible : on ne leur prête pas de nom.
  const isCard = (label: string) => /^(carte|avoir)\s/i.test(label.trim());
  const seen = new Map<string, Map<string, number>>();
  for (const k of known) {
    const shape = labelShape(k.label);
    if (isCard(k.label) || !shapeIsSpecific(shape)) continue;
    const names = seen.get(keyOf(k, shape)) ?? new Map<string, number>();
    seen.set(keyOf(k, shape), names.set(k.merchant, (names.get(k.merchant) ?? 0) + 1));
  }
  const nameOf = new Map<string, string>();
  for (const [key, names] of seen) {
    const [[name, count]] = [...names];
    if (names.size === 1 && count >= 2) nameOf.set(key, name);
  }
  const out = { named: 0, categorized: 0 };
  if (!nameOf.size) return out;
  const todo = await q<{ id: string; account_id: string; label: string; amount: number; category_id: string | null }>(
    `SELECT id, account_id, label, amount, category_id FROM transactions WHERE ${NAMELESS} AND status <> 'deleted'`,
  );
  for (const t of todo) {
    const name = isCard(t.label) ? undefined : nameOf.get(keyOf(t, labelShape(t.label)));
    if (!name) continue;
    const r = await nameTransaction(t, name);
    if (r.named) out.named++;
    if (r.categorized) out.categorized++;
  }
  return out;
}
