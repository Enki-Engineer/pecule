import { Router, raw, type Request } from "express";
import { z } from "zod";
import { exec, one, q } from "../db.ts";
import { memberByName } from "../members.ts";
import { ActionError, userAccountsSql } from "../actions.ts";
import { t as tr } from "../../lib/i18n.ts";
import { hourly } from "../limits.ts";
import {
  MAX_FILE_SIZE,
  categorizeItems,
  chargeTransactions,
  extractInvoice,
  knownInvoice,
  invoiceDetail as invoiceDetailFor,
  invoiceSuggestions,
  invoiceVisible,
  linkInvoice,
  matchInvoices,
  replaceItems,
  saveInvoice,
  unlinkInvoice,
  updateInvoice,
  ventilateInvoice,
  createInvoiceFromFile,
  withExtraction,
  type Extraction,
  type InvoiceInput,
} from "../invoices.ts";

/** Factures (écrans) : montées sous /api après l'authentification. */
export const invoicesApi = Router();

const userAccounts = (req: Request) => userAccountsSql(req.user?.id ?? 0);
// Pas de SVG : le fichier est servi depuis notre domaine.
const ACCEPTED = new Set(["application/pdf", "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp", "image/gif"]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function visibleInvoice(req: Request, id: number) {
  const inv = await one<{ id: number }>(`SELECT i.id FROM invoices i WHERE i.id = ? AND ${invoiceVisible(req.user!.id)}`, [id]);
  if (!inv) throw new ActionError(404, tr("Facture introuvable"));
  return inv.id;
}

invoicesApi.get("/invoices", async (req, res) => {
  const f = z
    .object({
      q: z.string().max(100).optional(),
      filtre: z.enum(["a_rapprocher", "garantie", "sans_fichier"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query);
  const where = [invoiceVisible(req.user!.id)];
  const params: unknown[] = [];
  if (f.q) {
    where.push(
      "(i.merchant LIKE ? OR i.title LIKE ? OR i.order_ref LIKE ? OR i.invoice_number LIKE ? OR i.notes LIKE ? OR EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = i.id AND ii.label LIKE ?))",
    );
    params.push(...Array(6).fill(`%${f.q}%`));
  }
  if (f.filtre === "a_rapprocher")
    where.push(
      "i.no_match = 0 AND NOT EXISTS (SELECT 1 FROM invoice_transactions it WHERE it.invoice_id = i.id) AND i.invoice_date >= (SELECT DATE_SUB(MIN(date), INTERVAL 7 DAY) FROM transactions)",
    );
  if (f.filtre === "garantie") where.push("i.warranty_until >= CURDATE()");
  if (f.filtre === "sans_fichier") where.push("i.file_sha256 IS NULL");
  const rows = await q(
    `SELECT i.id, i.owner_user_id, i.merchant, i.title, i.invoice_date, i.total, i.currency, i.warranty_until, i.source, i.file_mime, i.no_match,
            (SELECT COUNT(*) FROM invoice_transactions it WHERE it.invoice_id = i.id) AS tx_count,
            (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.id) AS item_count
     FROM invoices i WHERE ${where.map((w) => `(${w})`).join(" AND ")}
     ORDER BY i.invoice_date IS NULL, i.invoice_date DESC, i.id DESC LIMIT ? OFFSET ?`,
    [...params, f.limit + 1, f.offset],
  );
  res.json({ invoices: rows.slice(0, f.limit), hasMore: rows.length > f.limit });
});

async function invoiceDetail(req: Request, id: number) {
  const d = await invoiceDetailFor(req.user!.id, userAccounts(req), id);
  if (!d) throw new ActionError(404, tr("Facture introuvable"));
  return d;
}

invoicesApi.get("/invoices/:id", async (req, res) => {
  res.json(await invoiceDetail(req, z.coerce.number().int().parse(req.params.id)));
});

invoicesApi.get("/invoices/:id/file", async (req, res) => {
  const id = await visibleInvoice(req, z.coerce.number().int().parse(req.params.id));
  const f = await one<{ content: Buffer; file_name: string; file_mime: string }>(
    "SELECT f.content, i.file_name, i.file_mime FROM invoice_files f JOIN invoices i ON i.id = f.invoice_id WHERE f.invoice_id = ?",
    [id],
  );
  if (!f) return res.status(404).json({ error: tr("Pas de fichier pour cette facture") });
  res.set({
    "Content-Type": f.file_mime,
    // ?download=1 : téléchargement (bouton « Télécharger ») ; sinon affichage dans le navigateur.
    "Content-Disposition": `${req.query.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
    "Cache-Control": "private, no-store",
    // Le PDF s'affiche dans le visualiseur du navigateur : on relâche la CSP pour cette seule réponse.
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
  });
  res.send(f.content);
});

invoicesApi.get("/invoices/:id/suggestions", async (req, res) => {
  const id = await visibleInvoice(req, z.coerce.number().int().parse(req.params.id));
  const ids = await invoiceSuggestions(id, userAccounts(req));
  if (!ids.length) return res.json({ transactions: [] });
  const rows = await q<{ id: string }>(
    `SELECT t.id, t.date, t.amount, t.label, t.merchant, COALESCE(a.display_name, a.name) AS account_name
     FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE t.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  res.json({ transactions: ids.map((i) => rows.find((r) => r.id === i)).filter(Boolean) });
});

/**
 * Envoi d'un fichier depuis l'appli (corps brut, type MIME du fichier) : Claude le lit, la facture
 * est créée puis rapprochée ; avec ?transaction=…, elle est reliée à cette opération.
 */
invoicesApi.post("/invoices", hourly(240), raw({ type: () => true, limit: MAX_FILE_SIZE }), async (req, res) => {
  const meta = z.object({ name: z.string().min(1).max(255), transaction: z.string().max(160).optional() }).parse(req.query);
  const content = req.body as Buffer;
  if (!Buffer.isBuffer(content) || !content.length) throw new ActionError(400, tr("Fichier vide"));
  const mime = (req.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  if (!ACCEPTED.has(mime)) throw new ActionError(400, tr("Formats acceptés : PDF ou photo (JPEG, PNG, HEIC)"));
  res.json(await createInvoiceFromFile({ name: meta.name, mime, content }, { accountsSql: userAccounts(req), transactionId: meta.transaction }));
});

invoicesApi.patch("/invoices/:id", async (req, res) => {
  const id = await visibleInvoice(req, z.coerce.number().int().parse(req.params.id));
  const b = z
    .object({
      merchant: z.string().min(1).max(120).optional(),
      title: z.string().min(1).max(255).optional(),
      invoiceDate: date.nullable().optional(),
      total: z.number().nullable().optional(),
      orderRef: z.string().max(80).nullable().optional(),
      invoiceNumber: z.string().max(80).nullable().optional(),
      warrantyUntil: date.nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      /** Aucune opération attendue dans Pécule (payée par un tiers, carte absente de l'historique). */
      noMatch: z.boolean().optional(),
      /** true = visible par moi seul ; false = commune. */
      private: z.boolean().optional(),
    })
    .parse(req.body);
  await updateInvoice(req.user!.id, id, b);
  res.json({ ok: true });
});

invoicesApi.put("/invoices/:id/items", async (req, res) => {
  const id = await visibleInvoice(req, z.coerce.number().int().parse(req.params.id));
  const items = z
    .array(
      z.object({
        label: z.string().min(1).max(512),
        quantity: z.number().nullable().optional(),
        amount: z.number().nullable().optional(),
        categoryId: z.string().max(16).nullable().optional(),
        ref: z.string().max(64).nullable().optional(),
        url: z.string().max(512).regex(/^https?:\/\//i).nullable().optional(),
      }),
    )
    .max(200)
    .parse(req.body);
  await replaceItems(id, items);
  res.json(await invoiceDetail(req, id));
});

invoicesApi.post("/invoices/:id/links", async (req, res) => {
  const id = await visibleInvoice(req, z.coerce.number().int().parse(req.params.id));
  const { transactionId } = z.object({ transactionId: z.string().max(160) }).parse(req.body);
  const tx = await one(`SELECT t.id FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE t.id = ?`, [transactionId]);
  if (!tx) throw new ActionError(404, tr("Opération introuvable"));
  await linkInvoice(id, transactionId);
  res.json({ ok: true });
});

invoicesApi.delete("/invoices/:id/links/:txId", async (req, res) => {
  const id = await visibleInvoice(req, z.coerce.number().int().parse(req.params.id));
  await unlinkInvoice(id, req.params.txId);
  res.json({ ok: true });
});

invoicesApi.delete("/invoices/:id", async (req, res) => {
  const id = await visibleInvoice(req, z.coerce.number().int().parse(req.params.id));
  const txs = await q<{ transaction_id: string }>("SELECT transaction_id FROM invoice_transactions WHERE invoice_id = ?", [id]);
  await exec("DELETE FROM invoices WHERE id = ?", [id]);
  for (const t of txs) await unlinkInvoice(id, t.transaction_id);
  res.json({ ok: true });
});

/** Factures, articles et ventilation d'une opération (feuille de détail). */
invoicesApi.get("/transactions/:id/details", async (req, res) => {
  const tx = await one(`SELECT t.id FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE t.id = ?`, [req.params.id]);
  if (!tx) throw new ActionError(404, tr("Opération introuvable"));
  const invoices = await q<{ id: number }>(
    `SELECT i.id, i.merchant, i.title, i.invoice_date, i.total, i.currency, i.file_mime, i.warranty_until, it.source AS link_source
     FROM invoice_transactions it JOIN invoices i ON i.id = it.invoice_id
     WHERE it.transaction_id = ? AND ${invoiceVisible(req.user!.id)} ORDER BY i.invoice_date, i.id`,
    [req.params.id],
  );
  const items = invoices.length
    ? await q(
        `SELECT ii.id, ii.invoice_id, ii.label, ii.quantity, ii.amount, ii.category_id, c.name AS category_name
         FROM invoice_items ii LEFT JOIN categories c ON c.id = ii.category_id
         WHERE ii.invoice_id IN (${invoices.map(() => "?").join(",")}) ORDER BY ii.invoice_id, ii.position`,
        invoices.map((i) => i.id),
      )
    : [];
  const splits = await q(
    `SELECT s.id, s.amount, s.category_id, c.name AS category_name, s.label FROM transaction_splits s
     LEFT JOIN categories c ON c.id = s.category_id WHERE s.transaction_id = ? ORDER BY s.position`,
    [req.params.id],
  );
  // Ventilation venue d'une facture privée d'un autre membre : les montants restent (ils font les statistiques du
  // foyer), les libellés d'articles ne sont pas servis.
  const hidden = await one(`SELECT i.id FROM invoice_transactions it JOIN invoices i ON i.id = it.invoice_id WHERE it.transaction_id = ? AND NOT ${invoiceVisible(req.user!.id)} LIMIT 1`, [req.params.id]);
  res.json({ invoices, items, splits: hidden ? (splits as { label: string | null }[]).map((s) => ({ ...s, label: null })) : splits });
});

/* ---------- Administration (jeton d'API) : imports des collecteurs ---------- */

export const invoicesAdmin = Router();

const itemSchema = z.object({
  label: z.string().min(1).max(512),
  quantity: z.number().nullable().optional(),
  amount: z.number().nullable().optional(),
  categoryId: z.string().max(16).nullable().optional(),
  ref: z.string().max(64).nullable().optional(),
  url: z.string().max(512).regex(/^https?:\/\//i).nullable().optional(),
});

/**
 * Import d'une facture par un collecteur (dossier, Amazon, Cdiscount, mail…). Idempotent :
 * sourceRef ou empreinte du fichier. extract=true fait lire le fichier par Claude pour les champs manquants.
 */
invoicesAdmin.post("/invoices", async (req, res) => {
  const b = z
    .object({
      owner: z.string().min(1).max(80).nullable().optional(),
      merchant: z.string().max(120).default(""),
      title: z.string().max(255).default(""),
      invoiceDate: date.nullable().optional(),
      orderRef: z.string().max(80).nullable().optional(),
      invoiceNumber: z.string().max(80).nullable().optional(),
      total: z.number().nullable().optional(),
      currency: z.string().length(3).nullable().optional(),
      warrantyUntil: date.nullable().optional(),
      source: z.string().max(16),
      sourceRef: z.string().max(160).nullable().optional(),
      notes: z.string().max(2000).nullable().optional(),
      noMatch: z.boolean().optional(),
      file: z.object({ name: z.string().min(1).max(255), mime: z.string().max(80), base64: z.string().min(1) }).nullable().optional(),
      items: z.array(itemSchema).max(200).optional(),
      transactionIds: z.array(z.string().max(160)).max(20).optional(),
      /** Débits annoncés par le site (montant signé comme à la banque) : reliés aux opérations correspondantes. */
      charges: z.array(z.object({ date, amount: z.number() })).max(20).optional(),
      extract: z.boolean().optional(),
      /** Fait classer par Claude les articles sans catégorie. */
      categorize: z.boolean().optional(),
      /** Facture déjà connue : remplace ses articles (catégories reprises pour les libellés identiques). */
      replaceItems: z.boolean().optional(),
    })
    .parse(req.body);
  const owner = b.owner ? await memberByName(b.owner) : undefined;
  const file = b.file ? { name: b.file.name, mime: b.file.mime, content: Buffer.from(b.file.base64, "base64") } : null;
  if (file && file.content.length > MAX_FILE_SIZE) throw new ActionError(413, "Fichier trop gros (12 Mo au plus)");
  if (file && !ACCEPTED.has(file.mime)) throw new ActionError(400, `Format refusé : ${file.mime}`);
  let input: InvoiceInput = {
    ownerUserId: owner?.id ?? null,
    merchant: b.merchant,
    title: b.title,
    invoiceDate: b.invoiceDate,
    orderRef: b.orderRef,
    invoiceNumber: b.invoiceNumber,
    total: b.total,
    currency: b.currency,
    warrantyUntil: b.warrantyUntil,
    source: b.source,
    sourceRef: b.sourceRef,
    notes: b.notes,
    noMatch: b.noMatch,
    file,
    items: b.items,
    transactionIds: b.transactionIds,
  };
  let extracted: Extraction | null = null;
  // Déjà connue : inutile de la refaire lire par Claude.
  if (b.extract && file && !(await knownInvoice(b.sourceRef, file.content))) {
    extracted = await extractInvoice(file.content, file.mime, file.name).catch((e) => {
      console.error("[factures] lecture impossible", e);
      return null;
    });
    input = withExtraction(input, extracted);
  }
  const known = await knownInvoice(b.sourceRef, null);
  if (b.replaceItems && known && input.items?.length) {
    const prev = await q<{ label: string; category_id: string | null }>(
      "SELECT ii.label, ii.category_id FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id WHERE i.source_ref = ?",
      [b.sourceRef],
    );
    const byLabel = new Map(prev.map((p) => [p.label, p.category_id]));
    input.items = input.items.map((it) => ({ ...it, categoryId: it.categoryId ?? byLabel.get(it.label.trim().slice(0, 512)) ?? null }));
  }
  if (b.categorize && input.items?.length && (!known || b.replaceItems))
    input.items = await categorizeItems(input.items, input.merchant).catch((e) => {
      console.error("[factures] classement impossible", e);
      return input.items;
    });
  if (b.charges?.length) input.transactionIds = [...new Set([...(input.transactionIds ?? []), ...(await chargeTransactions(input.merchant, b.charges))])];
  const saved = await saveInvoice({ ...input, merchant: input.merchant || "Inconnu", title: input.title || file?.name || "Facture" });
  if (b.replaceItems && known && input.items?.length) await replaceItems(saved.id, input.items);
  if (!input.transactionIds?.length) await matchInvoices(saved.id);
  res.json({ ...saved, extracted });
});

/** Clés de collecteur déjà connues, et celles qui ont déjà leur fichier (évite de retélécharger). */
invoicesAdmin.post("/invoices/known", async (req, res) => {
  const { sourceRefs } = z.object({ sourceRefs: z.array(z.string().max(160)).max(1000) }).parse(req.body);
  if (!sourceRefs.length) return res.json({ known: [], withFile: [] });
  const rows = await q<{ source_ref: string; has_file: number }>(
    `SELECT source_ref, file_sha256 IS NOT NULL AS has_file FROM invoices WHERE source_ref IN (${sourceRefs.map(() => "?").join(",")})`,
    sourceRefs,
  );
  res.json({ known: rows.map((r) => r.source_ref), withFile: rows.filter((r) => r.has_file).map((r) => r.source_ref) });
});

invoicesAdmin.post("/invoices/match", async (_req, res) => {
  res.json({ linked: await matchInvoices() });
});

invoicesAdmin.post("/invoices/:id/ventilate", async (req, res) => {
  await ventilateInvoice(z.coerce.number().int().parse(req.params.id));
  res.json({ ok: true });
});
