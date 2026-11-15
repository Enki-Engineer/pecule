import { exec, one } from "./db.ts";
import { snapshotWealth } from "./wealth.ts";
import { t } from "../lib/i18n.ts";

/**
 * Actions d'écriture partagées par l'API (écrans) et l'assistant IA : une seule
 * implémentation, mêmes contrôles de droits.
 */

/** Comptes tels que les voit un membre (ses réglages priment sur les valeurs par défaut). */
export const userAccountsSql = (userId: number, scope: "foyer" | "moi" = "foyer") => `(SELECT a0.id, a0.name, a0.display_name, a0.owner, a0.kind,
    COALESCE(p.hidden, a0.hidden) AS hidden, COALESCE(p.excluded, a0.excluded) AS excluded
  FROM accounts a0 LEFT JOIN account_prefs p ON p.account_id = a0.id AND p.user_id = ${Number(userId)}${
    // Périmètre « Moi » : les seuls comptes du membre (ni le compte commun, ni ceux des autres).
    scope === "moi" ? ` WHERE a0.owner = (SELECT LOWER(u.name) FROM users u WHERE u.id = ${Number(userId)})` : ""
  })`;

export class ActionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type AccountSettings = { id: string; name: string; displayName: string | null; hidden: boolean; excluded: boolean };

/** Un compte et ses réglages tels que les voit un membre ; undefined s'il n'existe pas. */
export async function accountSettings(userId: number, id: string): Promise<AccountSettings | undefined> {
  const row = await one<{ id: string; name: string; display_name: string | null; hidden: number; excluded: number }>(
    `SELECT a.id, a.name, a.display_name, COALESCE(p.hidden, a.hidden) AS hidden, COALESCE(p.excluded, a.excluded) AS excluded
     FROM accounts a LEFT JOIN account_prefs p ON p.account_id = a.id AND p.user_id = ? WHERE a.id = ?`,
    [userId, id],
  );
  return row && { id: row.id, name: row.name, displayName: row.display_name, hidden: !!row.hidden, excluded: !!row.excluded };
}

/**
 * Règle un compte : le nom affiché est commun au foyer (null ou vide : celui de la banque) ; masquer le compte ou
 * le sortir des statistiques ne vaut que pour le membre.
 */
export async function saveAccountSettings(userId: number, id: string, patch: { displayName?: string | null; hidden?: boolean; excluded?: boolean }) {
  const current = await accountSettings(userId, id);
  if (!current) throw new ActionError(404, t("Compte introuvable"));
  if (patch.displayName !== undefined) await exec("UPDATE accounts SET display_name = ? WHERE id = ?", [patch.displayName?.trim() || null, id]);
  if (patch.hidden !== undefined || patch.excluded !== undefined)
    await exec(
      `INSERT INTO account_prefs (user_id, account_id, hidden, excluded) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE hidden = VALUES(hidden), excluded = VALUES(excluded)`,
      [userId, id, (patch.hidden ?? current.hidden) ? 1 : 0, (patch.excluded ?? current.excluded) ? 1 : 0],
    );
}

/** Classe une opération ; `remember` crée une règle sur le libellé et l'applique aux opérations semblables. */
export async function setTransactionCategory(id: string, categoryId: string | null, remember = false) {
  const tx = await one<{ id: string; label_key: string }>("SELECT id, label_key FROM transactions WHERE id = ?", [id]);
  if (!tx) throw new ActionError(404, t("Opération introuvable"));
  if (categoryId && !(await one("SELECT id FROM categories WHERE id = ?", [categoryId]))) throw new ActionError(400, t("Catégorie inconnue"));
  await exec("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?", [categoryId, categoryId ? "manuel" : null, tx.id]);
  // Un choix manuel remplace la ventilation par article.
  await exec("DELETE FROM transaction_splits WHERE transaction_id = ?", [tx.id]);
  let similar = 0;
  if (remember && categoryId && tx.label_key) {
    await exec("INSERT INTO rules (pattern, category_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE category_id = VALUES(category_id)", [
      tx.label_key,
      categoryId,
    ]);
    const res = await exec(
      "UPDATE transactions SET category_id = ?, category_source = 'regle' WHERE label_key = ? AND id <> ? AND (category_id IS NULL OR category_source IN ('auto', 'regle'))",
      [categoryId, tx.label_key, tx.id],
    );
    similar = res.affectedRows;
  }
  return { similar };
}

export async function setTransactionNote(id: string, note: string | null) {
  const res = await exec("UPDATE transactions SET note = ? WHERE id = ?", [note || null, id]);
  if (!res.affectedRows) throw new ActionError(404, t("Opération introuvable"));
}

export async function updateAsset(
  userId: number,
  id: number,
  body: { value?: number | null; quantity?: number | null; cash?: number | null; name?: string; closed?: boolean },
) {
  const asset = await one("SELECT id FROM assets WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [id, userId]);
  if (!asset) throw new ActionError(404, t("Élément introuvable"));
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.value !== undefined) sets.push("value = ?", "value_date = CURDATE()"), params.push(body.value);
  if (body.quantity !== undefined) sets.push("quantity = ?"), params.push(body.quantity);
  if (body.cash !== undefined) sets.push("cash = ?"), params.push(body.cash);
  if (body.name !== undefined) sets.push("name = ?"), params.push(body.name);
  if (body.closed !== undefined) sets.push("closed = ?"), params.push(body.closed ? 1 : 0);
  if (sets.length) await exec(`UPDATE assets SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  await snapshotWealth(userId);
}

export async function updateCryptoPosition(userId: number, id: number, body: { quantity?: number; manualValue?: number | null }) {
  const pos = await one<{ source: string }>("SELECT id, source FROM crypto_positions WHERE id = ? AND owner_user_id = ?", [id, userId]);
  if (!pos) throw new ActionError(404, t("Position introuvable"));
  if (pos.source !== "manuel") throw new ActionError(400, t("Cette position est synchronisée depuis CoinStats : la modifier dans l'appli CoinStats"));
  if (body.quantity !== undefined) await exec("UPDATE crypto_positions SET quantity = ?, updated_at = CURDATE() WHERE id = ?", [body.quantity, id]);
  if (body.manualValue !== undefined) await exec("UPDATE crypto_positions SET manual_value = ?, updated_at = CURDATE() WHERE id = ?", [body.manualValue, id]);
  await snapshotWealth(userId);
}
