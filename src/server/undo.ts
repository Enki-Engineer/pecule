import { randomUUID } from "node:crypto";
import { exec, q } from "./db.ts";

/*
 * « Annuler » : avant un classement (ou une note), on photographie l'état des opérations touchées —
 * catégorie, source, note, ventilation, règle créée et opérations semblables reclassées par la règle —
 * et on garde la fonction inverse 5 minutes en mémoire. L'écran affiche « Annuler » pendant ce temps.
 */

type Entry = { userId: number; expires: number; label: string; run: () => Promise<void> };
const store = new Map<string, Entry>();
const TTL = 5 * 60_000;

function purge() {
  const now = Date.now();
  for (const [k, v] of store) if (v.expires < now) store.delete(k);
}

export function registerUndo(userId: number, label: string, run: () => Promise<void>): string {
  purge();
  const id = randomUUID();
  store.set(id, { userId, label, run, expires: Date.now() + TTL });
  return id;
}

/** Exécute l'annulation (une seule fois) ; null si expirée ou d'un autre membre. */
export async function runUndo(userId: number, id: string): Promise<string | null> {
  purge();
  const e = store.get(id);
  if (!e || e.userId !== userId) return null;
  store.delete(id);
  await e.run();
  return e.label;
}

type TxState = { id: string; category_id: string | null; category_source: string | null; note: string | null; label_key: string | null };
type Split = Record<string, unknown> & { transaction_id: string };

/**
 * Photographie avant classement : renvoie la fonction qui remet tout en place. `remember` : la règle
 * créée sur le libellé et les opérations semblables qu'elle va reclasser sont aussi photographiées.
 */
export async function snapshotTransactions(ids: string[], remember = false): Promise<() => Promise<void>> {
  if (!ids.length) return async () => {};
  const marks = ids.map(() => "?").join(",");
  const rows = await q<TxState>(`SELECT id, category_id, category_source, note, label_key FROM transactions WHERE id IN (${marks})`, ids);
  const splits = await q<Split>(`SELECT * FROM transaction_splits WHERE transaction_id IN (${marks})`, ids);
  const keys = remember ? [...new Set(rows.map((r) => r.label_key).filter((k): k is string => !!k))] : [];
  const rules = keys.length ? await q<{ pattern: string; category_id: string }>(`SELECT pattern, category_id FROM rules WHERE pattern IN (${keys.map(() => "?").join(",")})`, keys) : [];
  const similar = keys.length
    ? await q<TxState>(
        `SELECT id, category_id, category_source, note, label_key FROM transactions
         WHERE label_key IN (${keys.map(() => "?").join(",")}) AND id NOT IN (${marks}) AND (category_id IS NULL OR category_source IN ('auto', 'regle'))`,
        [...keys, ...ids],
      )
    : [];
  return async () => {
    for (const r of [...rows, ...similar]) await exec("UPDATE transactions SET category_id = ?, category_source = ?, note = ? WHERE id = ?", [r.category_id, r.category_source, r.note, r.id]);
    await exec(`DELETE FROM transaction_splits WHERE transaction_id IN (${marks})`, ids);
    for (const s of splits) {
      const cols = Object.keys(s);
      await exec(`INSERT INTO transaction_splits (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, cols.map((c) => s[c]));
    }
    for (const k of keys) {
      const before = rules.find((r) => r.pattern === k);
      if (before) await exec("UPDATE rules SET category_id = ? WHERE pattern = ?", [before.category_id, k]);
      else await exec("DELETE FROM rules WHERE pattern = ?", [k]);
    }
  };
}
