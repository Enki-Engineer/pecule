import { householdCurrency } from "./region.ts";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { exec, one, q } from "./db.ts";
import { aiClient, aiEnabled, aiModel, recordUsage } from "./ai.ts";
import { autoMatch, cardDate, labelMatchesMerchant, legalWarranty, scoreCandidate, type Candidate, type MatchTransaction } from "../lib/invoices.ts";

/*
 * Factures : enregistrement idempotent (collecteurs relançables), lecture des PDF et photos
 * par Claude, rapprochement avec les opérations et ventilation par article.
 */

export const MAX_FILE_SIZE = 12 * 1024 * 1024;

/** Factures visibles par un membre : communes ou à lui. */
export const invoiceVisible = (userId: number, alias = "i") => `(${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ${Number(userId)})`;

export type InvoiceItemInput = { label: string; quantity?: number | null; amount?: number | null; categoryId?: string | null; ref?: string | null; url?: string | null };

export type InvoiceInput = {
  ownerUserId?: number | null;
  merchant: string;
  title: string;
  invoiceDate?: string | null;
  orderRef?: string | null;
  invoiceNumber?: string | null;
  total?: number | null;
  currency?: string | null;
  warrantyUntil?: string | null;
  source: string;
  sourceRef?: string | null;
  notes?: string | null;
  noMatch?: boolean;
  file?: { name: string; mime: string; content: Buffer } | null;
  items?: InvoiceItemInput[];
  /** Opérations désignées par le site lui-même (ex. page des paiements Amazon). */
  transactionIds?: string[];
};

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Facture déjà enregistrée (même clé de collecteur ou même fichier) ? */
export async function knownInvoice(sourceRef: string | null | undefined, content: Buffer | null | undefined) {
  if (sourceRef && (await one("SELECT id FROM invoices WHERE source_ref = ?", [sourceRef]))) return true;
  return !!(content && (await one("SELECT id FROM invoices WHERE file_sha256 = ?", [sha256(content)])));
}

/**
 * Crée ou complète une facture. Déjà connue (même source_ref ou même fichier) : on ne fait que
 * combler les trous, sans écraser ce qu'un membre a corrigé à la main.
 */
export async function saveInvoice(input: InvoiceInput): Promise<{ id: number; created: boolean }> {
  const hash = input.file ? sha256(input.file.content) : null;
  const existing =
    (input.sourceRef ? await one<{ id: number }>("SELECT id FROM invoices WHERE source_ref = ?", [input.sourceRef]) : undefined) ??
    (hash ? await one<{ id: number }>("SELECT id FROM invoices WHERE file_sha256 = ?", [hash]) : undefined) ??
    // Même facture déposée deux fois (dossier nommé d'après la marque + espace client du vendeur) :
    // même n° de facture, ou même date et même montant venant d'une autre source — parmi les factures communes
    // ou celles du même membre (jamais fusionnée avec la facture privée d'un autre).
    (input.invoiceNumber
      ? await one<{ id: number }>("SELECT id FROM invoices WHERE REPLACE(invoice_number, ' ', '') = ? AND (owner_user_id IS NULL OR owner_user_id <=> ?)", [input.invoiceNumber.replace(/\s/g, ""), input.ownerUserId ?? null])
      : undefined) ??
    (input.invoiceDate && input.total
      ? await one<{ id: number }>("SELECT id FROM invoices WHERE invoice_date = ? AND total = ? AND currency = ? AND source <> ? AND (owner_user_id IS NULL OR owner_user_id <=> ?)", [
          input.invoiceDate,
          input.total,
          input.currency ?? householdCurrency(),
          input.source,
          input.ownerUserId ?? null,
        ])
      : undefined);

  const known = new Set((await q<{ id: string }>("SELECT id FROM categories")).map((c) => c.id));
  const items = (input.items ?? []).filter((it) => it.label?.trim()).map((it) => ({ ...it, categoryId: it.categoryId && known.has(it.categoryId) ? it.categoryId : null }));

  let id: number;
  let created = false;
  if (existing) {
    id = existing.id;
    await exec(
      `UPDATE invoices SET invoice_date = COALESCE(invoice_date, ?), order_ref = COALESCE(order_ref, ?), invoice_number = COALESCE(invoice_number, ?),
         total = COALESCE(total, ?), warranty_until = COALESCE(warranty_until, ?), source_ref = COALESCE(source_ref, ?), notes = COALESCE(notes, ?)
       WHERE id = ?`,
      [input.invoiceDate ?? null, input.orderRef ?? null, input.invoiceNumber ?? null, input.total ?? null, input.warrantyUntil ?? null, input.sourceRef ?? null, input.notes ?? null, id],
    );
  } else {
    const res = await exec(
      `INSERT INTO invoices (owner_user_id, merchant, title, invoice_date, order_ref, invoice_number, total, currency, warranty_until, source, source_ref, notes, no_match)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.ownerUserId ?? null,
        input.merchant.slice(0, 120),
        input.title.slice(0, 255),
        input.invoiceDate ?? null,
        input.orderRef ?? null,
        input.invoiceNumber ?? null,
        input.total ?? null,
        input.currency ?? householdCurrency(),
        input.warrantyUntil ?? null,
        input.source,
        input.sourceRef ?? null,
        input.notes ?? null,
        input.noMatch ? 1 : 0,
      ],
    );
    id = res.insertId;
    created = true;
  }

  if (input.file && hash) {
    const hasFile = await one("SELECT invoice_id FROM invoice_files WHERE invoice_id = ?", [id]);
    const taken = await one<{ id: number }>("SELECT id FROM invoices WHERE file_sha256 = ? AND id <> ?", [hash, id]);
    if (!hasFile && !taken) {
      await exec("INSERT INTO invoice_files (invoice_id, content) VALUES (?, ?)", [id, input.file.content]);
      await exec("UPDATE invoices SET file_name = ?, file_mime = ?, file_size = ?, file_sha256 = ? WHERE id = ?", [
        input.file.name.slice(0, 255),
        input.file.mime,
        input.file.content.length,
        hash,
        id,
      ]);
    }
  }

  if (items.length && !(await one("SELECT id FROM invoice_items WHERE invoice_id = ? LIMIT 1", [id]))) await insertItems(id, items);

  for (const txId of input.transactionIds ?? []) {
    if (await one("SELECT id FROM transactions WHERE id = ?", [txId])) {
      await exec("INSERT IGNORE INTO invoice_transactions (invoice_id, transaction_id, source) VALUES (?, ?, 'collecteur')", [id, txId]);
      await ventilate(txId);
    }
  }
  return { id, created };
}

async function insertItems(invoiceId: number, items: InvoiceItemInput[]) {
  let pos = 0;
  for (const it of items)
    await exec("INSERT INTO invoice_items (invoice_id, position, label, quantity, amount, category_id, ref, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      invoiceId,
      pos++,
      it.label.trim().slice(0, 512),
      it.quantity ?? 1,
      it.amount ?? null,
      it.categoryId ?? null,
      it.ref?.slice(0, 64) ?? null,
      it.url?.slice(0, 512) ?? null,
    ]);
}

/** Remplace les articles d'une facture puis met à jour la ventilation des opérations reliées. */
export async function replaceItems(invoiceId: number, items: InvoiceItemInput[]) {
  await exec("DELETE FROM invoice_items WHERE invoice_id = ?", [invoiceId]);
  await insertItems(invoiceId, items);
  await ventilateInvoice(invoiceId);
}

/* ---------- Lecture par Claude ---------- */

const extraction = z.object({
  merchant: z.string().min(1),
  title: z.string().min(1),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  order_ref: z.string().nullable(),
  invoice_number: z.string().nullable(),
  total: z.number().nullable(),
  currency: z.string().length(3).nullable(),
  warranty_months: z.number().int().min(0).max(240).nullable(),
  items: z.array(z.object({ label: z.string(), quantity: z.number().nullable(), amount: z.number().nullable(), category_id: z.string().nullable() })),
});
export type Extraction = z.infer<typeof extraction>;

/** Schéma de la réponse (sortie structurée : Opus 5.5 n'accepte plus l'appel d'outil forcé). */
const EXTRACT_SCHEMA = {
    type: "object",
    properties: {
      merchant: { type: "string", description: "Enseigne ou site vendeur, nom court et propre (Amazon, Cdiscount, Boulanger, Apple…)" },
      title: { type: "string", description: "Ce qui a été acheté, en quelques mots (« Lave-linge Samsung », « Nettoyeur vapeur + accessoires »)" },
      invoice_date: {
        type: ["string", "null"],
        description: "Date de l'achat (commande, vente ou livraison), AAAA-MM-JJ — pas la date d'édition d'un duplicata ou justificatif réimprimé plus tard",
      },
      order_ref: { type: ["string", "null"], description: "Numéro de commande" },
      invoice_number: { type: ["string", "null"], description: "Numéro de facture" },
      total: { type: ["number", "null"], description: "Total TTC payé (positif ; négatif pour un avoir)" },
      currency: { type: ["string", "null"], description: "Code ISO de la devise écrite sur la facture (EUR, CHF, USD…), sinon null" },
      warranty_months: {
        type: ["integer", "null"],
        description: "Garantie applicable en mois : 24 pour un bien durable neuf en France (garantie légale), plus si la facture l'indique ; null pour un consommable, un service ou de la nourriture",
      },
      items: {
        type: "array",
        description: "Lignes d'articles (hors frais de port, sauf s'ils sont facturés à part, alors une ligne « Frais de port »)",
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Désignation lisible de l'article" },
            quantity: { type: ["number", "null"] },
            amount: { type: ["number", "null"], description: "Montant TTC de la ligne, quantité comprise" },
            category_id: { type: ["string", "null"], description: "Code de catégorie du référentiel le plus adapté à l'article" },
          },
          required: ["label", "quantity", "amount", "category_id"],
          additionalProperties: false,
        },
      },
    },
    required: ["merchant", "title", "invoice_date", "order_ref", "invoice_number", "total", "currency", "warranty_months", "items"],
    additionalProperties: false,
};

const READABLE_IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
export const canExtract = (mime: string) => aiEnabled() && (mime === "application/pdf" || READABLE_IMAGES.has(mime));

/** Lit une facture (PDF ou photo) avec Claude ; null si le format n'est pas lisible ou l'assistant non configuré. */
export async function extractInvoice(content: Buffer, mime: string, hint?: string): Promise<Extraction | null> {
  if (!canExtract(mime)) return null;
  const categories = await q<{ id: string; name: string; poste: string | null }>("SELECT id, name, poste FROM categories WHERE kind = 'depense' ORDER BY sort_order, id");
  const data = content.toString("base64");
  const doc: Anthropic.ContentBlockParam =
    mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data } };
  const response = await aiClient().messages.create({
    model: aiModel(),
    max_tokens: 4000,
    system:
      "Tu lis des factures et tickets de caisse d'une famille française pour son appli de budget. Recopie fidèlement les montants, n'invente rien : null si une information est absente.\n" +
      `Référentiel des catégories de dépense (code — nom — poste) :\n${categories.map((c) => `${c.id} — ${c.name} — ${c.poste ?? ""}`).join("\n")}`,
    output_config: { effort: "low", format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
    messages: [{ role: "user", content: [doc, { type: "text", text: `Lis ce document.${hint ? ` Indice (nom du fichier) : ${hint}` : ""}` }] }],
  });
  await recordUsage("facture", aiModel(), response.usage);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!text) return null;
  const parsed = extraction.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}

const categorization = z.object({ items: z.array(z.object({ index: z.number().int(), category_id: z.string().nullable() })) });

/** Catégorise des articles d'après leur libellé (collecteurs qui ne fournissent pas de fichier lisible). */
export async function categorizeItems(items: InvoiceItemInput[], merchant: string): Promise<InvoiceItemInput[]> {
  const todo = items.map((it, index) => ({ it, index })).filter(({ it }) => !it.categoryId);
  if (!todo.length || !aiEnabled()) return items;
  const categories = await q<{ id: string; name: string; poste: string | null }>("SELECT id, name, poste FROM categories WHERE kind = 'depense' ORDER BY sort_order, id");
  const response = await aiClient().messages.create({
    model: aiModel(),
    max_tokens: 4000,
    system:
      "Tu classes les articles achetés par une famille française dans son référentiel de budget. Un code par article, null si aucun ne convient.\n" +
      `Référentiel (code — nom — poste) :\n${categories.map((c) => `${c.id} — ${c.name} — ${c.poste ?? ""}`).join("\n")}`,
    output_config: {
      effort: "low",
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: { type: "object", properties: { index: { type: "integer" }, category_id: { type: ["string", "null"] } }, required: ["index", "category_id"], additionalProperties: false },
            },
          },
          required: ["items"],
          additionalProperties: false,
        },
      },
    },
    messages: [{ role: "user", content: `Marchand : ${merchant}\n${todo.map(({ it, index }) => `${index}. ${it.label}`).join("\n")}` }],
  });
  await recordUsage("classement", aiModel(), response.usage);
  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  const parsed = text ? categorization.safeParse(JSON.parse(text)) : null;
  if (!parsed?.success) return items;
  const byIndex = new Map(parsed.data.items.map((i) => [i.index, i.category_id]));
  return items.map((it, i) => (it.categoryId ? it : { ...it, categoryId: byIndex.get(i) ?? null }));
}

/**
 * Opérations correspondant aux débits annoncés par le site (ex. page des paiements Amazon) :
 * même montant, même marchand, date d'achat du libellé carte à ±4 jours du débit.
 */
export async function chargeTransactions(merchant: string, charges: { date: string; amount: number }[]): Promise<string[]> {
  const ids: string[] = [];
  for (const c of charges) {
    const txs = await q<MatchTransaction>(
      `SELECT id, date, amount, label FROM transactions
       WHERE status IN ('posted', 'pending') AND amount = ? AND date BETWEEN DATE_SUB(?, INTERVAL 5 DAY) AND DATE_ADD(?, INTERVAL 45 DAY)`,
      [c.amount, c.date, c.date],
    );
    const best = txs
      // Deux débits identiques (même jour, même montant) vont à deux opérations distinctes.
      .filter((t) => labelMatchesMerchant(t.label, merchant) && !ids.includes(t.id))
      .map((t) => ({ t, gap: Math.abs(Date.parse(cardDate(t.label) ?? t.date) - Date.parse(c.date)) / 86400_000 }))
      .filter((x) => x.gap <= 4)
      .sort((a, b) => a.gap - b.gap)[0];
    if (best) ids.push(best.t.id);
  }
  return ids;
}

/* ---------- Rapprochement ---------- */

type InvoiceRow = { id: number; invoice_date: string | null; total: number | null; merchant: string };

const candidateTxs = (date: string) =>
  q<MatchTransaction>(
    `SELECT id, date, amount, label FROM transactions
     WHERE status IN ('posted', 'pending') AND amount < 0 AND date BETWEEN DATE_SUB(?, INTERVAL 25 DAY) AND DATE_ADD(?, INTERVAL 45 DAY)
       AND id NOT IN (SELECT transaction_id FROM invoice_transactions)
       -- Comptes en observation (seconde source bancaire lue à part) : leurs opérations doublent celles des comptes en service.
       AND account_id NOT IN (SELECT id FROM accounts WHERE source = 'enablebanking' AND hidden = 1 AND excluded = 1)`,
    [date, date],
  );

export type PaymentCandidate = {
  id: string;
  date: string;
  amount: number;
  label: string;
  merchant: string | null;
  account_name: string;
  other_invoices: number;
  score: number;
  same_amount: boolean;
  same_merchant: boolean;
  /** Écart en jours entre la date d'achat (libellé carte) et la facture. */
  gap: number;
};

/**
 * Opérations candidates pour une facture (vue du membre), les plus probables d'abord : montant
 * identique, même marchand, date d'achat proche. other_invoices = factures déjà reliées à l'opération.
 */
export async function paymentCandidates(invoiceId: number, accountsSql: string, limit = 8): Promise<PaymentCandidate[]> {
  const inv = await one<InvoiceRow>("SELECT id, invoice_date, total, merchant FROM invoices WHERE id = ?", [invoiceId]);
  if (!inv?.invoice_date) return [];
  const txs = await q<MatchTransaction & { merchant: string | null; account_name: string; other_invoices: number }>(
    `SELECT t.id, t.date, t.amount, t.label, t.merchant, COALESCE(a.display_name, a.name) AS account_name,
            (SELECT COUNT(*) FROM invoice_transactions o WHERE o.transaction_id = t.id) AS other_invoices
     FROM transactions t JOIN ${accountsSql} a ON a.id = t.account_id
     WHERE t.status IN ('posted', 'pending') AND t.amount < 0 AND t.date BETWEEN DATE_SUB(?, INTERVAL 25 DAY) AND DATE_ADD(?, INTERVAL 45 DAY)
       AND t.id NOT IN (SELECT transaction_id FROM invoice_transactions WHERE invoice_id = ?)`,
    [inv.invoice_date, inv.invoice_date, invoiceId],
  );
  return txs
    .map((t) => ({ t, c: scoreCandidate(inv, t) }))
    .filter((x): x is { t: (typeof txs)[number]; c: Candidate } => !!x.c)
    .sort((a, b) => b.c.score - a.c.score)
    .slice(0, limit)
    .map(({ t, c }) => ({
      id: t.id,
      date: t.date,
      amount: Number(t.amount),
      label: t.label,
      merchant: t.merchant,
      account_name: t.account_name,
      other_invoices: Number(t.other_invoices),
      score: c.score,
      same_amount: c.amount,
      same_merchant: c.merchant,
      gap: c.gap,
    }));
}

/** Identifiants des opérations candidates (écran de la facture). */
export const invoiceSuggestions = async (invoiceId: number, accountsSql: string) => (await paymentCandidates(invoiceId, accountsSql)).map((c) => c.id);

/** Relie automatiquement les factures sans opération quand une seule opération colle (montant + marchand + date). */
export async function matchInvoices(onlyId?: number): Promise<number> {
  const invoices = await q<InvoiceRow>(
    `SELECT i.id, i.invoice_date, i.total, i.merchant FROM invoices i
     WHERE i.invoice_date IS NOT NULL AND i.total IS NOT NULL AND i.currency = ? AND i.no_match = 0
       AND i.invoice_date >= (SELECT DATE_SUB(MIN(date), INTERVAL 7 DAY) FROM transactions)
       AND NOT EXISTS (SELECT 1 FROM invoice_transactions it WHERE it.invoice_id = i.id) ${onlyId ? "AND i.id = ?" : ""}`,
    // Seules les factures dans la devise du foyer se rapprochent d'elles-mêmes : le montant d'une opération est dans cette devise.
    onlyId ? [householdCurrency(), onlyId] : [householdCurrency()],
  );
  let linked = 0;
  for (const inv of invoices) {
    const txId = autoMatch(inv, await candidateTxs(inv.invoice_date!));
    if (!txId) continue;
    await exec("INSERT IGNORE INTO invoice_transactions (invoice_id, transaction_id, source) VALUES (?, ?, 'auto')", [inv.id, txId]);
    await ventilate(txId);
    linked++;
  }
  return linked;
}

export async function linkInvoice(invoiceId: number, txId: string) {
  await exec("INSERT IGNORE INTO invoice_transactions (invoice_id, transaction_id, source) VALUES (?, ?, 'manuel')", [invoiceId, txId]);
  await ventilate(txId);
}

export async function unlinkInvoice(invoiceId: number, txId: string) {
  await exec("DELETE FROM invoice_transactions WHERE invoice_id = ? AND transaction_id = ?", [invoiceId, txId]);
  await ventilate(txId);
}

/* ---------- Ventilation ---------- */

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Les catégories venues des factures ne remplacent ni un choix manuel ni l'historique Notion (sauf « Divers »). */
const OVERRIDABLE = "(category_id IS NULL OR category_source IN ('auto', 'regle', 'facture') OR category_id = 'B12-02')";

/**
 * Catégorise une opération d'après les articles de ses factures : une seule catégorie → l'opération
 * la prend ; plusieurs → ventilation au prorata des montants des articles (lignes regroupées par
 * catégorie, l'arrondi sur la plus grosse). Sans article catégorisé, rien ne change.
 */
export async function ventilate(txId: string) {
  const tx = await one<{ id: string; amount: number; category_source: string | null; overridable: number }>(
    `SELECT id, amount, category_source, ${OVERRIDABLE} AS overridable FROM transactions WHERE id = ?`,
    [txId],
  );
  if (!tx) return;
  const items = await q<{ label: string; amount: number | null; category_id: string | null }>(
    `SELECT ii.label, ii.amount, ii.category_id FROM invoice_items ii JOIN invoice_transactions it ON it.invoice_id = ii.invoice_id
     WHERE it.transaction_id = ? ORDER BY ii.invoice_id, ii.position`,
    [txId],
  );
  const hadSplits = !!(await one("SELECT id FROM transaction_splits WHERE transaction_id = ? LIMIT 1", [txId]));
  const usable = items.filter((i) => i.category_id);
  if (!usable.length || usable.length < items.length || !tx.overridable) {
    // Facture détachée ou articles incomplets : on retire une ventilation devenue fausse.
    if (hadSplits && tx.category_source === "facture") await exec("DELETE FROM transaction_splits WHERE transaction_id = ?", [txId]);
    return;
  }
  const byCat = new Map<string, { total: number; labels: string[] }>();
  for (const i of usable) {
    const g = byCat.get(i.category_id!) ?? { total: 0, labels: [] };
    g.total += Math.abs(i.amount ?? 0);
    g.labels.push(i.label);
    byCat.set(i.category_id!, g);
  }
  const groups = [...byCat.entries()].sort((a, b) => b[1].total - a[1].total);
  await exec("DELETE FROM transaction_splits WHERE transaction_id = ?", [txId]);
  await exec("UPDATE transactions SET category_id = ?, category_source = 'facture' WHERE id = ?", [groups[0][0], txId]);
  const sum = groups.reduce((s, [, g]) => s + g.total, 0);
  if (groups.length < 2 || sum <= 0) return;
  const parts = groups.map(([cat, g]) => ({ cat, label: g.labels.join(" · ").slice(0, 255), amount: r2((tx.amount * g.total) / sum) }));
  parts[0].amount = r2(parts[0].amount + tx.amount - parts.reduce((s, p) => s + p.amount, 0));
  let pos = 0;
  for (const p of parts)
    await exec("INSERT INTO transaction_splits (transaction_id, position, amount, category_id, label) VALUES (?, ?, ?, ?, ?)", [txId, pos++, p.amount, p.cat, p.label]);
}

export async function ventilateInvoice(invoiceId: number) {
  for (const { transaction_id } of await q<{ transaction_id: string }>("SELECT transaction_id FROM invoice_transactions WHERE invoice_id = ?", [invoiceId]))
    await ventilate(transaction_id);
}

/* ---------- Lecture et mise à jour (écrans, assistant, MCP) ---------- */

/** Facture complète telle que la voit un membre (articles, opérations reliées) ; null si invisible. */
export async function invoiceDetail(userId: number, accountsSql: string, id: number) {
  const invoice = await one<Record<string, unknown>>(
    `SELECT i.*     FROM invoices i WHERE i.id = ? AND ${invoiceVisible(userId)}`,
    [id],
  );
  if (!invoice) return null;
  const items = await q(
    `SELECT ii.id, ii.label, ii.quantity, ii.amount, ii.category_id, c.name AS category_name, ii.ref, ii.url
     FROM invoice_items ii LEFT JOIN categories c ON c.id = ii.category_id WHERE ii.invoice_id = ? ORDER BY ii.position, ii.id`,
    [id],
  );
  const transactions = await q(
    `SELECT t.id, t.date, t.amount, t.label, t.merchant, it.source AS link_source, COALESCE(a.display_name, a.name) AS account_name
     FROM invoice_transactions it JOIN transactions t ON t.id = it.transaction_id JOIN ${accountsSql} a ON a.id = t.account_id
     WHERE it.invoice_id = ? ORDER BY t.date`,
    [id],
  );
  return { invoice, items, transactions };
}

export type InvoicePatch = {
  merchant?: string;
  title?: string;
  invoiceDate?: string | null;
  total?: number | null;
  orderRef?: string | null;
  invoiceNumber?: string | null;
  warrantyUntil?: string | null;
  notes?: string | null;
  /** Aucune opération attendue dans Pécule (payée par un tiers, carte absente de l'historique). */
  noMatch?: boolean;
  /** true = visible par le seul membre ; false = commune. */
  private?: boolean;
};

export async function updateInvoice(userId: number, id: number, b: InvoicePatch) {
  const cols: Record<string, unknown> = {
    merchant: b.merchant,
    title: b.title,
    invoice_date: b.invoiceDate,
    total: b.total,
    order_ref: b.orderRef,
    invoice_number: b.invoiceNumber,
    warranty_until: b.warrantyUntil,
    notes: b.notes,
    no_match: b.noMatch === undefined ? undefined : b.noMatch ? 1 : 0,
    owner_user_id: b.private === undefined ? undefined : b.private ? userId : null,
  };
  const sets = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (sets.length) await exec(`UPDATE invoices SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...sets.map(([, v]) => v), id]);
}

/* ---------- Création depuis un fichier (écran, assistant, Raccourci) ---------- */

/** Fusionne la lecture de Claude avec ce qui est déjà connu (le connu l'emporte). */
export function withExtraction(input: InvoiceInput, x: Extraction | null): InvoiceInput {
  if (!x) return input;
  const invoiceDate = input.invoiceDate ?? x.invoice_date;
  return {
    ...input,
    merchant: input.merchant || x.merchant,
    title: input.title || x.title,
    invoiceDate,
    orderRef: input.orderRef ?? x.order_ref,
    invoiceNumber: input.invoiceNumber ?? x.invoice_number,
    total: input.total ?? x.total,
    currency: input.currency ?? x.currency,
    warrantyUntil: input.warrantyUntil ?? (x.warranty_months && invoiceDate ? legalWarranty(invoiceDate, x.warranty_months) : null),
    items: input.items?.length ? input.items : x.items.map((i) => ({ label: i.label, quantity: i.quantity, amount: i.amount, categoryId: i.category_id })),
  };
}

/**
 * Fichier envoyé depuis l'appli : Claude le lit (sauf s'il est déjà enregistré), la facture est créée
 * puis rapprochée ; avec transactionId, elle est reliée à cette opération si le membre la voit.
 */
export async function createInvoiceFromFile(
  file: { name: string; mime: string; content: Buffer },
  opts: { accountsSql: string; transactionId?: string; source?: string },
): Promise<{ id: number; created: boolean; read: boolean }> {
  const known = await knownInvoice(null, file.content);
  const extracted = known
    ? null
    : await extractInvoice(file.content, file.mime, file.name).catch((e) => {
        console.error("[factures] lecture impossible", e);
        return null;
      });
  const base = file.name.replace(/\.[a-z0-9]+$/i, "");
  const input = withExtraction({ merchant: "", title: "", source: opts.source ?? "appli", file }, extracted);
  const { id, created } = await saveInvoice({ ...input, merchant: input.merchant || "Inconnu", title: input.title || base });
  if (opts.transactionId) {
    const tx = await one(`SELECT t.id FROM transactions t JOIN ${opts.accountsSql} a ON a.id = t.account_id WHERE t.id = ?`, [opts.transactionId]);
    if (tx) await linkInvoice(id, opts.transactionId);
  } else await matchInvoices(id);
  return { id, created, read: !!extracted || known };
}
