import { moneyIn } from "../region.ts";
import { z } from "zod";
import { exec, one, q } from "../db.ts";
import { userAccountsSql } from "../actions.ts";
import { invoiceDetail, invoiceVisible, linkInvoice, paymentCandidates, unlinkInvoice, updateInvoice } from "../invoices.ts";
import { displayLabel } from "../../lib/labels.ts";
import { ToolError, change, day, money, field, longDate, readTool, today, writeTool } from "./registry.ts";
import { t as tr, tk, tn } from "../../lib/i18n.ts";

/* Factures : recherche, détail, rapprochement avec les opérations, garantie. */

type InvoiceHead = { id: number; merchant: string; title: string; invoice_date: string | null; total: number | null; currency?: string | null; warranty_until: string | null; no_match: number };

async function visibleInvoice(userId: number, id: number) {
  const inv = await one<InvoiceHead>(
    `SELECT i.id, i.merchant, i.title, i.invoice_date, i.total, i.currency, i.warranty_until, i.no_match FROM invoices i WHERE i.id = ? AND ${invoiceVisible(userId)}`,
    [id],
  );
  if (!inv) throw new ToolError(`Facture n° ${id} introuvable`);
  return inv;
}

async function visibleTransaction(userId: number, id: string) {
  const tx = await one<{ id: string; date: string; amount: number; label: string; merchant: string | null }>(
    `SELECT t.id, t.date, t.amount, t.label, t.merchant FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id WHERE t.id = ?`,
    [id],
  );
  if (!tx) throw new ToolError("Opération introuvable");
  return tx;
}

/** Date d'un texte de confirmation, dans la langue du membre. */
const frDate = (d: string | null) => (d ? longDate(d) : tr("date inconnue"));
const invoiceLine = (i: InvoiceHead) => `${i.merchant} · ${i.title} · ${frDate(i.invoice_date)}${i.total != null ? ` · ${moneyIn(Number(i.total), i.currency)}` : ""}`;
const txLine = (t: { date: string; amount: number; label: string; merchant: string | null }) =>
  `${frDate(t.date)} · ${t.merchant || displayLabel(t.label)} · ${money(Number(t.amount))}`;

const searchInvoices = readTool({
  name: "search_invoices",
  progress: tk("Recherche des factures…"),
  description:
    "Recherche des factures (les plus récentes d'abord). filter : a_rapprocher (sans opération reliée), garantie (encore sous garantie), sans_fichier. tx_count = opérations reliées ; no_match = aucune opération attendue ; total_matching = nombre total de factures qui correspondent (au-delà de la liste renvoyée).",
  input: z.object({
    query: z.string().max(100).optional().describe("Texte cherché dans le marchand, le titre, les n° de commande/facture, les notes et les articles"),
    filter: z.enum(["a_rapprocher", "garantie", "sans_fichier"]).optional(),
    date_from: day.optional(),
    date_to: day.optional(),
    limit: z.number().int().min(1).max(50).optional().describe("1 à 50, défaut 20"),
  }),
  async run({ userId }, f) {
    const where = [invoiceVisible(userId)];
    const params: unknown[] = [];
    if (f.query) {
      where.push(
        "(i.merchant LIKE ? OR i.title LIKE ? OR i.order_ref LIKE ? OR i.invoice_number LIKE ? OR i.notes LIKE ? OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.label LIKE ?))",
      );
      params.push(...Array(6).fill(`%${f.query}%`));
    }
    // Même définition que l'écran Factures : les factures antérieures à l'historique bancaire ne comptent pas.
    if (f.filter === "a_rapprocher")
      where.push(
        "i.no_match = 0 AND NOT EXISTS (SELECT 1 FROM invoice_transactions it WHERE it.invoice_id = i.id) AND i.invoice_date >= (SELECT DATE_SUB(MIN(date), INTERVAL 7 DAY) FROM transactions)",
      );
    if (f.filter === "garantie") where.push("i.warranty_until >= CURDATE()");
    if (f.filter === "sans_fichier") where.push("i.file_sha256 IS NULL");
    if (f.date_from) where.push("i.invoice_date >= ?"), params.push(f.date_from);
    if (f.date_to) where.push("i.invoice_date <= ?"), params.push(f.date_to);
    const sqlWhere = where.map((w) => `(${w})`).join(" AND ");
    const total = await one<{ n: number }>(`SELECT COUNT(*) AS n FROM invoices i WHERE ${sqlWhere}`, params);
    const rows = await q(
      `SELECT i.id, i.merchant, i.title, i.invoice_date, i.total, i.currency, i.warranty_until, i.no_match, i.file_mime IS NOT NULL AS has_file,
              (SELECT COUNT(*) FROM invoice_transactions it WHERE it.invoice_id = i.id) AS tx_count,
              (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS item_count
       FROM invoices i WHERE ${sqlWhere}
       ORDER BY i.invoice_date IS NULL, i.invoice_date DESC, i.id DESC LIMIT ?`,
      [...params, f.limit ?? 20],
    );
    return { total_matching: total?.n ?? rows.length, returned: rows.length, invoices: rows };
  },
});

const getInvoice = readTool({
  name: "get_invoice",
  progress: tk("Lecture de la facture…"),
  description: "Détail d'une facture : marchand, date, total, garantie, articles (avec catégorie) et opérations bancaires reliées.",
  input: z.object({ invoice_id: z.number().int() }),
  async run({ userId }, { invoice_id }) {
    const d = await invoiceDetail(userId, userAccountsSql(userId), invoice_id);
    if (!d) throw new ToolError(`Facture n° ${invoice_id} introuvable`);
    const { invoice: i } = d;
    return {
      invoice: {
        id: i.id,
        merchant: i.merchant,
        title: i.title,
        invoice_date: i.invoice_date,
        total: i.total,
        currency: i.currency,
        order_ref: i.order_ref,
        invoice_number: i.invoice_number,
        warranty_until: i.warranty_until,
        notes: i.notes,
        shared: i.owner_user_id == null,
        file: i.file_name ? { name: i.file_name, mime: i.file_mime } : null,
        payment: d.transactions.length ? "reliee" : i.no_match ? "aucune_operation_attendue" : "a_rapprocher",
      },
      items: d.items,
      transactions: d.transactions,
    };
  },
});

const findPayment = readTool({
  name: "find_payment_candidates",
  progress: tk("Recherche du paiement…"),
  description:
    "Opérations bancaires qui peuvent correspondre au paiement d'une facture, les plus probables d'abord, avec les critères (même montant, même marchand, écart en jours entre la date d'achat et la facture ; other_invoices = factures déjà reliées à l'opération). bank_history = période couverte par les relevés. Les cartes à débit différé sont prélevées le 1er du mois suivant : un achat récent peut ne pas encore apparaître.",
  input: z.object({ invoice_id: z.number().int() }),
  async run({ userId }, { invoice_id }) {
    const inv = await visibleInvoice(userId, invoice_id);
    if (!inv.invoice_date) return { invoice: inv, candidates: [], note: "Facture sans date : renseigner la date (update_invoice) pour chercher le paiement." };
    const candidates = await paymentCandidates(invoice_id, userAccountsSql(userId));
    const span = await one<{ first: string | null; last: string | null }>("SELECT MIN(date) AS first, MAX(date) AS last FROM transactions WHERE status IN ('posted', 'pending')");
    return {
      invoice: inv,
      candidates: candidates.map((c) => ({
        transaction_id: c.id,
        date: c.date,
        amount: c.amount,
        label: c.label,
        account: c.account_name,
        same_amount: c.same_amount,
        same_merchant: c.same_merchant,
        gap_days: c.gap,
        score: c.score,
        other_invoices: c.other_invoices,
      })),
      bank_history: { from: span?.first ?? null, to: span?.last ?? null },
      today: today(),
    };
  },
});

const linkTool = writeTool({
  name: "link_invoice",
  description: "Relie une facture à l'opération qui l'a payée ; les catégories des articles s'appliquent alors à l'opération (ou la ventilent).",
  input: z.object({ invoice_id: z.number().int(), transaction_id: z.string().max(160) }),
  async describe({ userId }, i) {
    const inv = await visibleInvoice(userId, i.invoice_id);
    const tx = await visibleTransaction(userId, i.transaction_id);
    return { label: tr("Relier la facture « {titre} » à l'opération du {date}", { titre: inv.title, date: frDate(tx.date) }), details: [field(tr("Facture"), invoiceLine(inv)), field(tr("Opération"), txLine(tx))] };
  },
  async run({ userId }, i) {
    await visibleInvoice(userId, i.invoice_id);
    await visibleTransaction(userId, i.transaction_id);
    await linkInvoice(i.invoice_id, i.transaction_id);
    const after = await one<{ category: string | null; splits: number }>(
      `SELECT c.name AS category, (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS splits
       FROM transactions t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ?`,
      [i.transaction_id],
    );
    const cat = after?.splits ? `ventilée en ${after.splits} catégories` : after?.category ? `catégorie : ${after.category}` : "sans catégorie";
    return `Fait : facture reliée (opération ${cat}).`;
  },
});

const unlinkTool = writeTool({
  name: "unlink_invoice",
  description: "Détache une facture d'une opération (lien erroné).",
  input: z.object({ invoice_id: z.number().int(), transaction_id: z.string().max(160) }),
  async describe({ userId }, i) {
    const inv = await visibleInvoice(userId, i.invoice_id);
    const tx = await visibleTransaction(userId, i.transaction_id);
    const linked = await one("SELECT 1 AS x FROM invoice_transactions WHERE invoice_id = ? AND transaction_id = ?", [i.invoice_id, i.transaction_id]);
    if (!linked) throw new ToolError("Cette facture n'est pas reliée à cette opération");
    return { label: tr("Détacher la facture « {titre} » de l'opération du {date}", { titre: inv.title, date: frDate(tx.date) }), details: [field(tr("Facture"), invoiceLine(inv)), field(tr("Opération"), txLine(tx))] };
  },
  async run({ userId }, i) {
    await visibleInvoice(userId, i.invoice_id);
    await visibleTransaction(userId, i.transaction_id);
    await unlinkInvoice(i.invoice_id, i.transaction_id);
    return "Fait : facture détachée.";
  },
});

const updateTool = writeTool({
  name: "update_invoice",
  description:
    "Corrige ou complète une facture : marchand, titre, date d'achat, total TTC, fin de garantie, notes ; no_payment_expected=true quand aucune opération n'apparaîtra dans Pécule (payée par un tiers, carte absente de l'historique) ; private=true pour la réserver à l'utilisateur, false pour la rendre commune.",
  input: z.object({
    invoice_id: z.number().int(),
    merchant: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(255).optional(),
    invoice_date: day.nullable().optional(),
    total: z.number().nullable().optional(),
    warranty_until: day.nullable().optional().describe("Fin de garantie AAAA-MM-JJ (garantie légale : 2 ans après l'achat pour un bien neuf)"),
    notes: z.string().max(2000).nullable().optional(),
    no_payment_expected: z.boolean().optional(),
    private: z.boolean().optional(),
  }),
  async describe({ userId }, i) {
    const inv = await one<InvoiceHead & { notes: string | null; owner_user_id: number | null }>(
      `SELECT i.id, i.merchant, i.title, i.invoice_date, i.total, i.currency, i.warranty_until, i.no_match, i.notes, i.owner_user_id FROM invoices i WHERE i.id = ? AND ${invoiceVisible(userId)}`,
      [i.invoice_id],
    );
    if (!inv) throw new ToolError(`Facture n° ${i.invoice_id} introuvable`);
    const details: string[] = [];
    const show = (v: unknown) => (v == null || v === "" ? "—" : String(v));
    if (i.merchant !== undefined) details.push(change(tr("Marchand"), inv.merchant, i.merchant));
    if (i.title !== undefined) details.push(change(tr("Titre"), inv.title, i.title));
    if (i.invoice_date !== undefined) details.push(change(tr("Date"), frDate(inv.invoice_date), frDate(i.invoice_date)));
    if (i.total !== undefined) details.push(change(tr("Total"), inv.total != null ? moneyIn(Number(inv.total), inv.currency) : "—", i.total != null ? moneyIn(i.total, inv.currency) : "—"));
    if (i.warranty_until !== undefined) details.push(change(tr("Garantie jusqu'au"), frDate(inv.warranty_until), frDate(i.warranty_until)));
    if (i.notes !== undefined) details.push(change(tr("Notes"), show(inv.notes), show(i.notes)));
    if (i.no_payment_expected !== undefined) details.push(i.no_payment_expected ? tr("Aucune opération attendue dans Pécule") : tr("Opération attendue (rapprochement réactivé)"));
    if (i.private !== undefined) details.push(i.private ? tr("Visible par moi seul") : tr("Commune à la famille"));
    if (!details.length) throw new ToolError("Aucune modification demandée");
    return { label: tr("Modifier la facture « {titre} »", { titre: inv.title }), details };
  },
  async run({ userId }, i) {
    await visibleInvoice(userId, i.invoice_id);
    await updateInvoice(userId, i.invoice_id, {
      merchant: i.merchant,
      title: i.title,
      invoiceDate: i.invoice_date,
      total: i.total,
      warrantyUntil: i.warranty_until,
      notes: i.notes,
      noMatch: i.no_payment_expected,
      private: i.private,
    });
    return "Fait : facture mise à jour.";
  },
});

const deleteTool = writeTool({
  name: "delete_invoice",
  description: "Supprime définitivement une facture (fichier et articles compris) : doublon, facture importée par erreur, facture qui ne concerne pas le foyer. Les opérations reliées sont détachées et retrouvent leur classement d'avant.",
  input: z.object({ invoice_id: z.number().int() }),
  async describe({ userId }, i) {
    const inv = await visibleInvoice(userId, i.invoice_id);
    const links = await q<{ transaction_id: string }>("SELECT transaction_id FROM invoice_transactions WHERE invoice_id = ?", [inv.id]);
    return {
      label: tr("Supprimer la facture « {nom} »", { nom: `${inv.merchant}${inv.title ? ` — ${inv.title}` : ""}` }),
      details: [
        `${frDate(inv.invoice_date)}${inv.total != null ? ` · ${moneyIn(Number(inv.total), inv.currency)}` : ""}`,
        links.length ? tn("{n} opération reliée sera détachée", "{n} opérations reliées seront détachées", links.length) : tr("Aucune opération reliée"),
        tr("Suppression définitive, fichier compris"),
      ],
    };
  },
  async run({ userId }, i) {
    const inv = await visibleInvoice(userId, i.invoice_id);
    const links = await q<{ transaction_id: string }>("SELECT transaction_id FROM invoice_transactions WHERE invoice_id = ?", [inv.id]);
    await exec("DELETE FROM invoices WHERE id = ?", [inv.id]);
    for (const l of links) await unlinkInvoice(inv.id, l.transaction_id);
    return `Fait : facture n° ${inv.id} supprimée.`;
  },
});

export const facturesTools = [searchInvoices, getInvoice, findPayment, linkTool, unlinkTool, updateTool, deleteTool];
