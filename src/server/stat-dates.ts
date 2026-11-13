import { exec, one, q } from "./db.ts";
import { purchaseDateFor } from "../lib/bank-reconcile.ts";

/*
 * Jour d'une opération pour les statistiques. La banque écrit un achat par carte le jour où elle le prélève : le
 * lendemain pour une carte à débit immédiat, le mois suivant pour une carte à débit différé. Le foyer choisit de
 * compter ses achats au jour de l'achat (« achat ») ou au jour d'écriture de la banque (« debit », par défaut).
 * Ce choix est une ligne d'app_kv, lue par la vue `tx_lines` et par `statDate()` (src/server/stats.ts) : en changer
 * ne réécrit aucune opération, et tous les écrans suivent d'un coup. `transactions.date` reste le jour d'écriture.
 */

export type DateBasis = "achat" | "debit";
const KEY = "stats:date_basis";

/** Réglage du foyer (celui de la démo en mode démo : la requête suit la base du moment). */
export async function dateBasis(): Promise<DateBasis> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [KEY]);
  return row?.value === "achat" ? "achat" : "debit";
}

export async function setDateBasis(basis: DateBasis): Promise<DateBasis> {
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KEY, basis]);
  return basis;
}

/**
 * Renseigne le jour d'achat des opérations de carte qui ne l'ont pas encore, d'après leur libellé (« Carte 30 04 26
 * … », « Avoir … »). Relancé après chaque arrivée d'opérations : une source qui donne elle-même le jour d'achat
 * l'a déjà écrit, les autres sont complétées ici. Les libellés sans jour plausible sont laissés tels quels.
 */
export async function fillPurchaseDates(): Promise<number> {
  const rows = await q<{ id: string; label: string; date: string }>(
    "SELECT id, label, DATE_FORMAT(date, '%Y-%m-%d') AS date FROM transactions WHERE purchase_date IS NULL AND (label LIKE 'Carte %' OR label LIKE 'Avoir %')",
  );
  const found = rows.map((r) => ({ id: r.id, day: purchaseDateFor(r.label, r.date) })).filter((r): r is { id: string; day: string } => !!r.day);
  for (let i = 0; i < found.length; i += 400) {
    const part = found.slice(i, i + 400);
    await exec(
      `UPDATE transactions SET purchase_date = CASE id ${part.map(() => "WHEN ? THEN ?").join(" ")} END WHERE id IN (${part.map(() => "?").join(",")}) AND purchase_date IS NULL`,
      [...part.flatMap((r) => [r.id, r.day]), ...part.map((r) => r.id)],
    );
  }
  return found.length;
}
