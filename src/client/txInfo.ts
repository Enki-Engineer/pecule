import type { Transaction } from "./api.ts";
import type { AssistantEntity } from "./assistantContext.ts";
import { dateFr, money } from "./format.ts";
import { bankMotif, txTitle } from "../lib/labels.ts";
import { t } from "../lib/i18n.ts";

/*
 * Ce qu'une ligne d'opération dit en plus de son titre : le texte du créancier (lu dans le libellé de la banque), et
 * l'autre date d'un achat par carte — le jour du prélèvement quand l'opération est datée de l'achat, le jour de
 * l'achat quand elle est datée de son écriture.
 */

type Dated = Pick<Transaction, "date" | "booked_date" | "purchase_date" | "status">;

const days = (a: string, b: string) => Math.abs(Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86_400_000;

/**
 * L'autre date d'une opération, ou « en attente » pour un achat annoncé par la banque et pas encore écrit. Un écart
 * d'un jour ou deux (carte à débit immédiat : la banque écrit l'achat le lendemain) ne vaut pas une ligne de plus.
 */
export function txDateHint(tx: Dated): string | null {
  const pending = tx.status === "pending";
  if (tx.booked_date && tx.booked_date !== tx.date && (pending || days(tx.booked_date, tx.date) > 3))
    return pending ? t("sera prélevé le {date}", { date: dateFr(tx.booked_date) }) : t("prélevé le {date}", { date: dateFr(tx.booked_date) });
  if (tx.purchase_date && tx.purchase_date !== tx.date && (pending || days(tx.purchase_date, tx.date) > 3))
    return pending ? t("achat du {date}, en attente", { date: dateFr(tx.purchase_date) }) : t("achat du {date}", { date: dateFr(tx.purchase_date) });
  return pending ? t("en attente") : null;
}

/** Seconde ligne d'une opération : le texte du créancier, puis l'autre date. Null s'il n'y a rien à ajouter. */
export function txSubline(tx: Dated & Pick<Transaction, "bank_label">): string | null {
  return [bankMotif(tx.bank_label), txDateHint(tx)].filter(Boolean).join(" · ") || null;
}

/** Une opération telle que l'assistant la reçoit : son identifiant, et le texte de la pastille « À propos de ». */
export const operationEntity = (tx: Transaction): AssistantEntity => ({
  type: "operation",
  id: tx.id,
  label: t("Opération du {date} · {titre} · {montant}", { date: dateFr(tx.date), titre: txTitle(tx), montant: money(tx.amount) }),
});
