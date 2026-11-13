import { createHash, randomBytes } from "node:crypto";
import { ActionError } from "./actions.ts";
import { afterBankSync } from "./bank-sync.ts";
import { exec, one, q } from "./db.ts";
import { fxConverter } from "./fx.ts";
import { guessCategory } from "./guess.ts";
import { householdCurrency, today } from "./region.ts";
import { isCurrency } from "../lib/currencies.ts";
import { listMembers } from "./members.ts";
import { fileAccounts, parseBankFile, type FileRow } from "../lib/bank-files.ts";
import { historyLabel } from "../lib/bank-history.ts";
import { reconcile, type RecTx } from "../lib/bank-reconcile.ts";
import { t } from "../lib/i18n.ts";
import { labelKey, ownerKey } from "../lib/labels.ts";

/*
 * Import d'un fichier d'opérations (OFX, QIF, CSV) dans un compte, existant ou créé pour l'occasion. Rejouable :
 * une opération déjà connue du compte (même date, même montant, une ligne pour une ligne) n'est pas recréée.
 * À blanc par défaut : l'écran montre d'abord ce qui serait ajouté.
 */

/** `currency` : devise du compte (celle du foyer par défaut) ; ses montants et son solde s'y saisissent. */
export type NewAccount = { name: string; kind: "courant" | "carte" | "epargne"; owner: string; institution?: string | null; currency?: string | null };

export type FileImport = {
  format: "ofx" | "qif" | "csv";
  rows: number;
  skipped: number;
  from: string | null;
  to: string | null;
  /** Comptes mêlés dans le fichier : il faut alors dire lequel importer (`fileAccount`). */
  accounts: { account: string; rows: number }[];
  needsFileAccount: boolean;
  target: { id: string; name: string } | null;
  /** Opérations qui seraient ajoutées, et celles que le compte connaît déjà. */
  fresh: number;
  known: number;
  sample: FileRow[];
  balance: { amount: number; date: string | null } | null;
  /** Devise dans laquelle les montants du fichier sont lus : celle du compte qui les reçoit. */
  currency?: string;
  applied: boolean;
  categorized: number;
  /** Après écriture : opérations créées et compte créé pour l'occasion (pour pouvoir annuler). */
  ids?: string[];
  createdAccount?: string | null;
};

/** Compte saisi à la main (ou créé pour un import de fichier) : aucune source ne l'alimente. */
export async function createManualAccount(a: NewAccount, balance?: number | null): Promise<{ id: string; name: string }> {
  const name = a.name.trim().slice(0, 255);
  if (!name) throw new ActionError(400, t("Donne un nom au compte."));
  // Titulaire : compte commun, professionnel, autre, ou le prénom d'un membre du foyer.
  const reserved = ["joint", "pro", "autre"];
  const owner = reserved.includes(a.owner) ? a.owner : ownerKey(a.owner);
  if (!reserved.includes(owner) && !(await listMembers()).some((m) => ownerKey(m.name) === owner)) throw new ActionError(400, t("Titulaire inconnu."));
  const id = `m:${randomBytes(12).toString("hex")}`;
  const currency = a.currency ?? householdCurrency();
  if (!isCurrency(currency)) throw new ActionError(400, t("Devise non prise en charge : {devise}", { devise: currency }));
  const held = balance == null ? null : (await fxConverter([currency], today()))(Math.round(balance * 100) / 100, currency, today());
  await exec("INSERT INTO accounts (id, name, institution, owner, kind, currency, balance, balance_original, balance_at, hidden, excluded, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, IF(? IS NULL, NULL, UTC_TIMESTAMP()), 0, 0, 'manuel')", [id, name, a.institution?.trim().slice(0, 120) || null, owner, a.kind, currency, held?.amount ?? null, held?.originalAmount ?? null, held?.amount ?? null]);
  return { id, name };
}

export async function importBankFile(text: string, opts: { accountId?: string; create?: NewAccount; fileAccount?: string; apply?: boolean }): Promise<FileImport> {
  const parsed = parseBankFile(text);
  if (!parsed.rows.length) throw new ActionError(400, t("Ce fichier n'a pas été reconnu : il faut un export OFX, QIF ou CSV avec une date, un libellé et un montant par ligne."));
  const accounts = fileAccounts(parsed);
  const needsFileAccount = accounts.length > 1 && !opts.fileAccount;
  const rows = accounts.length > 1 && opts.fileAccount ? parsed.rows.filter((r) => r.account === opts.fileAccount) : parsed.rows;
  const days = rows.map((r) => r.date).sort();
  const base: FileImport = { format: parsed.format, rows: rows.length, skipped: parsed.skipped, from: days[0] ?? null, to: days.at(-1) ?? null, accounts, needsFileAccount, target: null, fresh: 0, known: 0, sample: [], balance: parsed.balance, applied: false, categorized: 0 };
  if (needsFileAccount || !rows.length) return base;

  let target = opts.accountId ? await one<{ id: string; name: string; currency: string }>("SELECT id, COALESCE(display_name, name) AS name, currency FROM accounts WHERE id = ?", [opts.accountId]) : undefined;
  if (opts.accountId && !target) throw new ActionError(404, t("Compte introuvable"));
  if (!target && !opts.create) throw new ActionError(400, t("Choisis le compte qui reçoit ces opérations."));

  // Ce que le compte connaît déjà : une ligne du fichier pour une opération (même date, même montant).
  const incoming: RecTx[] = rows.map((r, i) => ({ id: String(i), date: r.date, amount: r.amount, label: r.label, status: "posted" }));
  const existing = target
    ? // Montants comparés dans la devise du compte, celle du fichier.
      await q<RecTx>("SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS date, COALESCE(original_amount, amount) AS amount, label, status FROM transactions WHERE account_id = ? AND status <> 'deleted' AND date BETWEEN DATE_SUB(?, INTERVAL 5 DAY) AND DATE_ADD(?, INTERVAL 5 DAY)", [target.id, days[0], days.at(-1)])
    : [];
  const r = reconcile(incoming, existing, { nearDays: 0 });
  const fresh = r.onlyIncoming.map((x) => rows[Number(x.id)]);
  // Devise des montants du fichier : celle du compte qui les reçoit (pour un compte créé ici : celle choisie, sinon celle du fichier).
  const currency = target?.currency ?? opts.create?.currency ?? (isCurrency(parsed.currency) ? parsed.currency : householdCurrency());
  const result: FileImport = { ...base, target: target ? { id: target.id, name: target.name } : null, fresh: fresh.length, known: r.pairs.length, sample: fresh.slice(0, 8), currency };
  if (!opts.apply) return result;

  const convert = await fxConverter([currency], days[0]);
  const createdAccount = target ? null : (target = { ...(await createManualAccount({ ...opts.create!, currency })), currency }).id;
  const seen = new Map<string, number>();
  const ids: string[] = [];
  let categorized = 0;
  for (const row of fresh) {
    // Deux lignes identiques le même jour sont deux opérations : leur rang les distingue.
    const base = `${row.date}|${row.amount}|${row.label}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const id = `f:${createHash("sha1").update(`${target.id}|${row.ref ?? base}|${row.ref ? "" : n}`).digest("hex").slice(0, 32)}`;
    const label = historyLabel(row.label);
    const key = labelKey(label);
    const money = convert(row.amount, currency, row.date);
    const done = await exec("INSERT IGNORE INTO transactions (id, account_id, date, amount, original_amount, original_currency, label, bank_label, label_key, status, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'posted', 'fichier')", [id, target.id, row.date, money.amount, money.originalAmount, money.originalCurrency, label, row.label.slice(0, 255), key]);
    if (!done.affectedRows) continue;
    ids.push(id);
    const guess = await guessCategory(key);
    if (guess) {
      await exec("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ? AND category_id IS NULL", [guess.categoryId, guess.source, id]);
      categorized++;
    }
  }
  // Le solde lu dans le fichier ne vaut que pour un compte tenu à la main : celui d'un compte alimenté par une banque vient d'elle.
  if (parsed.balance && (await one("SELECT id FROM accounts WHERE id = ? AND source = 'manuel'", [target.id]))) {
    const day = parsed.balance.date ?? days.at(-1)!;
    const now = convert(parsed.balance.amount, currency, today());
    await exec("UPDATE accounts SET balance = ?, balance_original = ?, balance_at = UTC_TIMESTAMP() WHERE id = ?", [now.amount, now.originalAmount, target.id]);
    await exec("INSERT INTO balances (account_id, date, balance) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)", [target.id, day, convert(parsed.balance.amount, currency, day).amount]);
  }
  await afterBankSync();
  return { ...result, target: { id: target.id, name: target.name }, applied: true, categorized, ids, createdAccount };
}

/* ---------- Compte saisi à la main : une opération, son solde ---------- */

/** `balance` : le solde dans la devise du compte (celle où son titulaire le saisit). */
type ManualAccount = { id: string; currency: string; balance: number | null };

async function manualAccount(id: string): Promise<ManualAccount> {
  const a = await one<{ id: string; source: string; currency: string; balance: number | null }>("SELECT id, source, currency, COALESCE(balance_original, balance) AS balance FROM accounts WHERE id = ?", [id]);
  if (!a) throw new ActionError(404, t("Compte introuvable"));
  // Un compte alimenté par une banque reçoit ses opérations d'elle : y saisir à la main ferait des doublons.
  if (a.source !== "manuel") throw new ActionError(400, t("Ce compte est alimenté par une banque : la saisie à la main est réservée aux comptes créés à la main."));
  return { id: a.id, currency: a.currency, balance: a.balance === null ? null : Number(a.balance) };
}

/** Écrit le solde d'un compte, donné dans sa devise : gardé tel quel, et ramené à la devise du foyer au cours du jour. */
async function writeBalance(a: ManualAccount, balance: number) {
  const held = (await fxConverter([a.currency], today()))(balance, a.currency, today());
  await exec("UPDATE accounts SET balance = ?, balance_original = ?, balance_at = UTC_TIMESTAMP() WHERE id = ?", [held.amount, held.originalAmount, a.id]);
  await exec("INSERT INTO balances (account_id, date, balance) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)", [a.id, today(), held.amount]);
}

/** Solde d'un compte saisi à la main, donné par son titulaire (null : solde inconnu, le compte ne compte plus dans le disponible). */
export async function setManualBalance(accountId: string, balance: number | null): Promise<{ id: string; balance: number | null }> {
  const a = await manualAccount(accountId);
  if (balance === null) await exec("UPDATE accounts SET balance = NULL, balance_original = NULL, balance_at = NULL WHERE id = ?", [a.id]);
  else await writeBalance(a, Math.round(balance * 100) / 100);
  return { id: a.id, balance };
}

/**
 * Opération saisie à la main dans un compte saisi à la main (`origin = 'saisie'`). Classée comme les autres
 * (catégorie donnée, sinon règles et libellés déjà classés). Si le compte a un solde, il suit l'opération.
 */
export async function addManualTransaction(input: { accountId: string; date: string; amount: number; label: string; categoryId?: string | null }): Promise<{ id: string; categoryId: string | null; balance: number | null }> {
  const a = await manualAccount(input.accountId);
  const amount = Math.round(input.amount * 100) / 100;
  if (!amount) throw new ActionError(400, t("Le montant ne peut pas être nul."));
  if (input.date > today()) throw new ActionError(400, t("La date ne peut pas être dans le futur."));
  const label = input.label.trim().replace(/\s+/g, " ").slice(0, 255);
  if (!label) throw new ActionError(400, t("Donne un libellé à l'opération."));
  if (input.categoryId && !(await one("SELECT id FROM categories WHERE id = ?", [input.categoryId]))) throw new ActionError(400, t("Catégorie inconnue"));
  const id = `s:${randomBytes(16).toString("hex")}`;
  const key = labelKey(label);
  const guess = input.categoryId ? { categoryId: input.categoryId, source: "manuel" } : await guessCategory(key);
  // Le montant se saisit dans la devise du compte ; il est ramené à celle du foyer au cours du jour de l'opération.
  const money = (await fxConverter([a.currency], input.date))(amount, a.currency, input.date);
  await exec("INSERT INTO transactions (id, account_id, date, amount, original_amount, original_currency, label, label_key, status, origin, category_id, category_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'posted', 'saisie', ?, ?)", [id, a.id, input.date, money.amount, money.originalAmount, money.originalCurrency, label, key, guess?.categoryId ?? null, guess?.source ?? null]);
  const balance = a.balance === null ? null : Math.round((a.balance + amount) * 100) / 100;
  if (balance !== null) await writeBalance(a, balance);
  await afterBankSync();
  return { id, categoryId: guess?.categoryId ?? null, balance };
}

/** Supprime une opération saisie à la main (jamais une opération venue d'une banque ou d'un fichier) ; le solde du compte la suit. */
export async function deleteManualTransaction(id: string): Promise<{ id: string; balance: number | null }> {
  const tx = await one<{ id: string; account_id: string; amount: number; origin: string }>("SELECT id, account_id, COALESCE(original_amount, amount) AS amount, origin FROM transactions WHERE id = ?", [id]);
  if (!tx) throw new ActionError(404, t("Opération introuvable"));
  if (tx.origin !== "saisie") throw new ActionError(400, t("Seule une opération saisie à la main peut être supprimée."));
  await exec("DELETE FROM transaction_splits WHERE transaction_id = ?", [id]);
  await exec("DELETE FROM invoice_transactions WHERE transaction_id = ?", [id]);
  await exec("DELETE FROM transactions WHERE id = ? AND origin = 'saisie'", [id]);
  // Solde et montant dans la devise du compte.
  const a = await one<{ id: string; currency: string; balance: number | null }>("SELECT id, currency, COALESCE(balance_original, balance) AS balance FROM accounts WHERE id = ?", [tx.account_id]);
  const balance = a?.balance == null ? null : Math.round((Number(a.balance) - Number(tx.amount)) * 100) / 100;
  if (a && balance !== null) await writeBalance({ ...a, balance }, balance);
  return { id, balance };
}
