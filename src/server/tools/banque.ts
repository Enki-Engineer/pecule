import { z } from "zod";
import { IS_EXPENSE, LINE_KIND } from "../stats.ts";
import { one, q } from "../db.ts";
import { setTransactionCategory, setTransactionNote, userAccountsSql } from "../actions.ts";
import { syncBanks } from "../bank-sync.ts";
import { invoiceVisible } from "../invoices.ts";
import { monthDebits, monthFlows, monthMerchants } from "../flows.ts";
import { displayLabel } from "../../lib/labels.ts";
import { natureSql } from "../../lib/nature.ts";
import { ToolError, money, month, day, r2, readTool, shortDate, today, writeTool } from "./registry.ts";
import { t as tr, td, tk, tn } from "../../lib/i18n.ts";

/* Banque : comptes, opérations, catégories, synchronisation. */

const SCOPE = "t.status IN ('posted', 'pending') AND a.excluded = 0";
/** Ligne d'une opération dans un texte de confirmation : jour, marchand ou libellé, montant. */
const txLine = (r: { date: string; amount: number; label: string; merchant: string | null }) => `${shortDate(r.date)} · ${r.merchant || displayLabel(r.label)} · ${money(Number(r.amount))}`;

const getOverview = readTool({
  name: "get_overview",
  progress: tk("Lecture des soldes…"),
  description:
    "Vue d'ensemble : soldes des comptes visibles, dépenses du mois en cours et du mois précédent à la même date, nombre d'opérations à classer, dernière synchronisation.",
  input: z.object({}),
  async run({ userId }) {
    const A = userAccountsSql(userId);
    const accounts = await q(
      `SELECT a.id, COALESCE(a.display_name, a.name) AS name, a.owner, a.kind, a.balance, a.balance_at FROM accounts a
       LEFT JOIN account_prefs p ON p.account_id = a.id AND p.user_id = ?
       WHERE COALESCE(p.hidden, a.hidden) = 0 AND COALESCE(p.excluded, a.excluded) = 0 AND a.balance IS NOT NULL`,
      [userId],
    );
    const spend = async (from: string, to: string) =>
      (
        await one<{ t: number | null }>(
          `SELECT -SUM(t.amount) AS t FROM tx_lines t JOIN ${A} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
           WHERE ${SCOPE} AND ${IS_EXPENSE} AND t.date >= ? AND t.date <= ?`,
          [from, to],
        )
      )?.t ?? 0;
    const d = today();
    const m = d.slice(0, 7);
    const prev = new Date(`${m}-01T12:00:00Z`);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    const pm = prev.toISOString().slice(0, 7);
    const uncategorized = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM tx_lines t JOIN ${A} a ON a.id = t.account_id WHERE ${SCOPE} AND t.category_id IS NULL`);
    const lastSync = await one("SELECT status, finished_at FROM sync_runs ORDER BY id DESC LIMIT 1");
    return {
      accounts,
      spent_this_month: r2(await spend(`${m}-01`, d)),
      spent_previous_month_same_day: r2(await spend(`${pm}-01`, `${pm}-${d.slice(8, 10)}`)),
      uncategorized: uncategorized?.n ?? 0,
      last_sync: lastSync,
    };
  },
});

const listAccounts = readTool({
  name: "list_accounts",
  progress: tk("Lecture des comptes…"),
  description:
    "Comptes bancaires et cartes connus de Pécule, avec leur id, leur titulaire (« joint » pour un compte commun, « pro », « autre », sinon le prénom d'une personne du foyer en minuscules) et les réglages de l'utilisateur : hidden = masqué, excluded = hors statistiques. " +
    "Les recherches ignorent les comptes hors statistiques, sauf search_transactions avec account_id.",
  input: z.object({}),
  async run({ userId }) {
    const rows = await q<{ id: string; name: string; display_name: string | null; owner: string; kind: string; hidden: number; excluded: number; n: number; first: string | null; last: string | null }>(
      `SELECT a.id, a.name, a.display_name, a.owner, a.kind, a.hidden, a.excluded,
              (SELECT COUNT(*) FROM transactions t WHERE t.account_id = a.id AND t.status IN ('posted', 'pending')) AS n,
              (SELECT MIN(t.date) FROM transactions t WHERE t.account_id = a.id) AS first, (SELECT MAX(t.date) FROM transactions t WHERE t.account_id = a.id) AS last
       FROM ${userAccountsSql(userId)} a ORDER BY a.excluded, a.owner, a.kind, a.name`,
    );
    return { accounts: rows.map((a) => ({ account_id: a.id, name: a.display_name ?? a.name, owner: a.owner, kind: a.kind, hidden: !!a.hidden, excluded: !!a.excluded, transactions: Number(a.n), first_date: a.first, last_date: a.last })) };
  },
});

const searchTransactions = readTool({
  name: "search_transactions",
  progress: tk("Recherche des opérations…"),
  description:
    "Recherche des opérations bancaires (100 au plus ; tri par date ou par montant). Montants négatifs = débits. uncategorized=true pour les opérations à classer. " +
    "total_matching et sum_matching = nombre et somme de TOUTES les opérations qui correspondent (pas seulement celles renvoyées). " +
    "nature = carte, prelevement, virement, retrait, frais, interne, remboursement ou entree. " +
    "invoices = factures reliées avec leurs articles : c'est ce qui a été acheté (Amazon, Cdiscount…), à lire avant de dire qu'on ne sait pas ce qu'est un achat.",
  input: z.object({
    query: z.string().max(100).optional().describe("Texte cherché dans le libellé, le marchand ou la note"),
    month: month.optional().describe("Mois AAAA-MM"),
    date_from: day.optional().describe("Date de début AAAA-MM-JJ"),
    date_to: day.optional().describe("Date de fin AAAA-MM-JJ"),
    category_id: z.string().max(16).optional().describe("Code catégorie (référentiel)"),
    uncategorized: z.boolean().optional(),
    account_id: z.string().max(64).optional().describe("Un compte précis (id de list_accounts) : c'est la seule façon de chercher dans un compte masqué ou hors statistiques"),
    min_amount: z.number().optional(),
    max_amount: z.number().optional(),
    nature: z.enum(["carte", "prelevement", "virement", "retrait", "frais", "interne", "remboursement", "entree"]).optional(),
    sort: z.enum(["date_desc", "date_asc", "amount_asc", "amount_desc"]).optional().describe("amount_asc = plus gros débits d'abord ; défaut date_desc"),
    limit: z.number().int().min(1).max(100).optional().describe("1 à 100, défaut 40"),
  }),
  async run({ userId }, f) {
    // Compte demandé nommément : on y cherche même s'il est hors statistiques (comme l'écran des opérations).
    const where = [f.account_id ? "t.status IN ('posted', 'pending')" : SCOPE];
    const params: unknown[] = [];
    if (f.month) where.push("t.date >= ? AND t.date < DATE_ADD(?, INTERVAL 1 MONTH)"), params.push(`${f.month}-01`, `${f.month}-01`);
    if (f.date_from) where.push("t.date >= ?"), params.push(f.date_from);
    if (f.date_to) where.push("t.date <= ?"), params.push(f.date_to);
    if (f.category_id) where.push("t.category_id = ?"), params.push(f.category_id);
    if (f.uncategorized) where.push("t.category_id IS NULL");
    if (f.account_id) where.push("t.account_id = ?"), params.push(f.account_id);
    if (f.min_amount !== undefined) where.push("t.amount >= ?"), params.push(f.min_amount);
    if (f.max_amount !== undefined) where.push("t.amount <= ?"), params.push(f.max_amount);
    if (f.query) where.push("(t.label LIKE ? OR t.merchant LIKE ? OR t.bank_label LIKE ? OR t.note LIKE ?)"), params.push(...Array(4).fill(`%${f.query}%`));
    if (f.nature) where.push(`${natureSql("t")} = ?`), params.push(f.nature);
    const A = userAccountsSql(userId);
    const total = await one<{ n: number; s: number | null }>(
      `SELECT COUNT(*) AS n, SUM(t.amount) AS s FROM transactions t JOIN ${A} a ON a.id = t.account_id WHERE ${where.join(" AND ")}`,
      params,
    );
    const order = { date_desc: "t.date DESC, t.id", date_asc: "t.date, t.id", amount_asc: "t.amount, t.date DESC", amount_desc: "t.amount DESC, t.date DESC" }[f.sort ?? "date_desc"];
    const rows = await q<{ id: string; invoice_count: number } & Record<string, unknown>>(
      `SELECT t.id, t.date, t.amount, t.label, t.merchant, t.bank_label, t.category_id, c.name AS category, ${natureSql("t")} AS nature,
              COALESCE(a.display_name, a.name) AS account, t.note,
              (SELECT COUNT(*) FROM invoice_transactions it WHERE it.transaction_id = t.id) AS invoice_count
       FROM transactions t JOIN ${A} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`,
      [...params, f.limit ?? 40],
    );
    // Factures reliées (marchand, titre, articles) : ce qui a été acheté.
    const withInv = rows.filter((r) => Number(r.invoice_count) > 0).map((r) => r.id);
    const byTx = new Map<string, unknown[]>();
    if (withInv.length) {
      const inv = await q<{ transaction_id: string; id: number; merchant: string; title: string; invoice_date: string | null; total: number | null; items: string | null }>(
        `SELECT it.transaction_id, i.id, i.merchant, i.title, i.invoice_date, i.total,
                (SELECT GROUP_CONCAT(ii.label ORDER BY ii.id SEPARATOR ' | ') FROM invoice_items ii WHERE ii.invoice_id = i.id) AS items
         FROM invoice_transactions it JOIN invoices i ON i.id = it.invoice_id
         WHERE it.transaction_id IN (${withInv.map(() => "?").join(",")}) AND ${invoiceVisible(userId)}`,
        withInv,
      );
      for (const i of inv)
        byTx.set(i.transaction_id, [
          ...(byTx.get(i.transaction_id) ?? []),
          { invoice_id: i.id, merchant: i.merchant, title: i.title, date: i.invoice_date, total: i.total, items: i.items?.slice(0, 400) ?? null },
        ]);
    }
    return {
      total_matching: total?.n ?? rows.length,
      sum_matching: r2(Number(total?.s ?? 0)),
      returned: rows.length,
      transactions: rows.map((r) => (byTx.has(r.id) ? { ...r, invoices: byTx.get(r.id) } : r)),
    };
  },
});

const getTransaction = readTool({
  name: "get_transaction",
  progress: tk("Lecture de l'opération…"),
  description: "Détail d'une opération : catégorie, note, factures reliées (avec leurs articles) et ventilation éventuelle.",
  input: z.object({ transaction_id: z.string().max(160) }),
  async run({ userId }, { transaction_id }) {
    const tx = await one(
      `SELECT t.id, t.date, t.amount, t.original_amount, t.original_currency, t.label, t.merchant, t.bank_label, t.status, t.category_id, c.name AS category, t.category_source, t.note,
              COALESCE(a.display_name, a.name) AS account
       FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?`,
      [transaction_id],
    );
    if (!tx) throw new ToolError("Opération introuvable");
    const invoices = await q<{ id: number }>(
      `SELECT i.id, i.merchant, i.title, i.invoice_date, i.total, i.warranty_until, it.source AS link_source
       FROM invoice_transactions it JOIN invoices i ON i.id = it.invoice_id WHERE it.transaction_id = ? AND ${invoiceVisible(userId)}`,
      [transaction_id],
    );
    for (const inv of invoices as ({ id: number } & Record<string, unknown>)[])
      inv.items = await q("SELECT label, quantity, amount, category_id FROM invoice_items WHERE invoice_id = ? ORDER BY id", [inv.id]);
    const splits = await q(
      `SELECT s.amount, s.category_id, c.name AS category, s.label FROM transaction_splits s LEFT JOIN categories c ON c.id = s.category_id
       WHERE s.transaction_id = ? ORDER BY s.position`,
      [transaction_id],
    );
    return { transaction: tx, invoices, splits };
  },
});

const monthBreakdown = readTool({
  name: "month_breakdown",
  progress: tk("Analyse du mois…"),
  description: "Revenus, dépenses et épargne d'un mois par catégorie, avec le mois précédent pour comparaison.",
  input: z.object({ month: month.describe("AAAA-MM") }),
  async run({ userId }, { month: m }) {
    const byCat = (start: string) =>
      q(
        `SELECT c.id, c.name, c.poste, ${LINE_KIND} AS kind, ROUND(SUM(t.amount), 2) AS total, COUNT(*) AS n
         FROM tx_lines t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${SCOPE} AND t.date >= ? AND t.date < DATE_ADD(?, INTERVAL 1 MONTH)
         GROUP BY c.id, c.name, c.poste, ${LINE_KIND} ORDER BY total`,
        [start, start],
      );
    const prev = new Date(`${m}-01T12:00:00Z`);
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    return { month: m, categories: await byCat(`${m}-01`), previous_month: await byCat(prev.toISOString().slice(0, 10)) };
  },
});

const getTrend = readTool({
  name: "get_trend",
  progress: tk("Calcul de la tendance…"),
  description: "Revenus, dépenses et épargne par mois sur les 12 derniers mois.",
  input: z.object({}),
  run: ({ userId }) =>
    q(
      `SELECT DATE_FORMAT(t.date, '%Y-%m') AS month,
              ROUND(SUM(CASE WHEN ${LINE_KIND} = 'revenu' THEN t.amount ELSE 0 END), 2) AS revenus,
              ROUND(-SUM(CASE WHEN ${LINE_KIND} = 'depense' THEN t.amount ELSE 0 END), 2) AS depenses,
              ROUND(-SUM(CASE WHEN c.kind = 'epargne' THEN t.amount ELSE 0 END), 2) AS epargne
       FROM tx_lines t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${SCOPE} AND t.date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 11 MONTH) GROUP BY month ORDER BY month`,
    ),
});

const getFlows = readTool({
  name: "get_month_flows",
  progress: tk("Analyse des flux du mois…"),
  description:
    "Flux d'un mois : entrées par catégorie, sorties par nature (achats carte, prélèvements, virements, espèces, frais) et par poste, épargne, reste ; prélèvements passés et attendus (ou manqués) ; principaux marchands des achats carte.",
  input: z.object({ month: month.describe("AAAA-MM") }),
  async run({ userId }, { month: m }) {
    const A = userAccountsSql(userId);
    const [flows, debits, merchants] = await Promise.all([monthFlows(A, m), monthDebits(userId, A, m), monthMerchants(A, m)]);
    return { ...flows, debits, merchants: merchants.slice(0, 15) };
  },
});

const listCategories = readTool({
  name: "list_categories",
  progress: tk("Lecture du référentiel…"),
  description: "Référentiel des catégories : code, nom, poste, type (depense, revenu, epargne, interne).",
  input: z.object({}),
  run: () => q("SELECT id, name, poste, kind FROM categories ORDER BY sort_order, id"),
});

const categorize = writeTool({
  name: "categorize_transactions",
  description:
    "Classe une ou plusieurs opérations dans une catégorie. remember=true crée une règle sur le libellé et classe aussi les opérations semblables.",
  input: z.object({
    transaction_ids: z.array(z.string().max(160)).min(1).max(100).describe("Identifiants (champ id de search_transactions)"),
    category_id: z.string().max(16),
    remember: z.boolean(),
    note: z.string().max(500).optional().describe("Note facultative ajoutée aux opérations"),
  }),
  async describe({ userId }, i) {
    const cat = await one<{ name: string }>("SELECT name FROM categories WHERE id = ?", [i.category_id]);
    if (!cat) throw new ToolError(`Catégorie inconnue : ${i.category_id}`);
    const rows = await q<{ date: string; amount: number; label: string; merchant: string | null }>(
      `SELECT t.date, t.amount, t.label, t.merchant FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id
       WHERE t.id IN (${i.transaction_ids.map(() => "?").join(",")})`,
      i.transaction_ids,
    );
    if (!rows.length) throw new ToolError("Aucune des opérations indiquées n'est visible pour cet utilisateur");
    return {
      label: i.remember
        ? tn("Classer {n} opération en « {categorie} » et retenir la règle pour ce libellé", "Classer {n} opérations en « {categorie} » et retenir la règle pour ce libellé", rows.length, { categorie: td(cat.name) })
        : tn("Classer {n} opération en « {categorie} »", "Classer {n} opérations en « {categorie} »", rows.length, { categorie: td(cat.name) }),
      details: rows
        .slice(0, 8)
        .map(txLine)
        .concat(rows.length > 8 ? [tn("… et {n} autre", "… et {n} autres", rows.length - 8)] : [])
        .concat(i.note ? [tr("Note : « {note} »", { note: i.note })] : []),
    };
  },
  async run({ userId }, i) {
    const visible = await q<{ id: string }>(
      `SELECT t.id FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id WHERE t.id IN (${i.transaction_ids.map(() => "?").join(",")})`,
      i.transaction_ids,
    );
    let similar = 0;
    for (const [n, t] of visible.entries()) {
      const r = await setTransactionCategory(t.id, i.category_id, i.remember && n === 0);
      similar += r.similar;
      if (i.note) await setTransactionNote(t.id, i.note);
    }
    return `Fait : ${visible.length} opération(s) classée(s)${similar ? `, plus ${similar} opération(s) semblable(s) via la règle` : ""}.`;
  },
});

const setNote = writeTool({
  name: "set_transaction_note",
  description: "Ajoute, remplace ou efface (note vide) la note d'une ou plusieurs opérations, sans changer leur catégorie.",
  input: z.object({
    transaction_ids: z.array(z.string().max(160)).min(1).max(50),
    note: z.string().max(500).describe("Texte de la note ; chaîne vide pour l'effacer"),
  }),
  async describe({ userId }, i) {
    const rows = await q<{ date: string; amount: number; label: string; merchant: string | null }>(
      `SELECT t.date, t.amount, t.label, t.merchant FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id
       WHERE t.id IN (${i.transaction_ids.map(() => "?").join(",")})`,
      i.transaction_ids,
    );
    if (!rows.length) throw new ToolError("Aucune des opérations indiquées n'est visible pour cet utilisateur");
    return {
      label: i.note
        ? tn("Noter {n} opération : « {note} »", "Noter {n} opérations : « {note} »", rows.length, { note: i.note.slice(0, 80) })
        : tn("Effacer la note de {n} opération", "Effacer la note de {n} opérations", rows.length),
      details: rows.slice(0, 8).map(txLine),
    };
  },
  async run({ userId }, i) {
    const visible = await q<{ id: string }>(
      `SELECT t.id FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id WHERE t.id IN (${i.transaction_ids.map(() => "?").join(",")})`,
      i.transaction_ids,
    );
    for (const t of visible) await setTransactionNote(t.id, i.note || null);
    return `Fait : note ${i.note ? "posée" : "effacée"} sur ${visible.length} opération(s).`;
  },
});

const runSync = writeTool({
  name: "run_sync",
  description: "Lance une synchronisation des comptes bancaires (toutes les sources reliées).",
  input: z.object({}),
  describe: async () => ({ label: tr("Synchroniser les comptes bancaires"), details: [] }),
  async run() {
    const r = await syncBanks("assistant");
    return r ? `Fait : ${r.seen} opérations vues, ${r.inserted} nouvelles, ${r.auto} classées automatiquement.` : "Une synchronisation était déjà en cours.";
  },
});

export const banqueTools = [getOverview, listAccounts, searchTransactions, getTransaction, monthBreakdown, getTrend, getFlows, listCategories, categorize, setNote, runSync];
