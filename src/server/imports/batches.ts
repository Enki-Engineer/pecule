import { createHash } from "node:crypto";
import { ActionError } from "../actions.ts";
import { aiEnabled, aiModel, meterCost, usageCostUsd, usdToEur } from "../ai.ts";
import { parseBankFile, fileAccounts } from "../../lib/bank-files.ts";
import { exec, one, q } from "../db.ts";
import { runReal } from "../demo-context.ts";
import { classifyDocument, documentVisible, extractText, saveDocument } from "../documents.ts";
import { createInvoiceFromFile } from "../invoices.ts";
import { logAudit, recordAlert, runAs } from "../journal.ts";
import { memberLang, runInLang } from "../lang.ts";
import { acceptFile, cleanPath, estimateUsd, isBankFile, isSafe, MAX_BATCH_FILES, MAX_FILE_SIZE, type Check, type ItemStatus } from "../../lib/imports.ts";
import { t } from "../../lib/i18n.ts";
import { extractorById, pickExtractor } from "./extractors/index.ts";
import type { BankFileData } from "./extractors/fichier-banque.ts";
import { readDocument } from "./read.ts";
import type { Ctx, Existing, Extractor, Field, Table } from "./registry.ts";
import { Tracker, undo, type Written } from "./track.ts";

/*
 * Import massif de documents : lots, lignes, file de lecture, relecture, validation et annulation.
 * Un fichier reçu est tout de suite rangé au coffre ; la file le reconnaît, le lit avec son extracteur et laisse
 * une proposition. Rien n'est écrit dans les écrans avant la validation, et toute validation peut être annulée.
 */

const PRIVATE_DOMAINS = new Set(["retraite", "revenus"]);
/** Commun au foyer, ou à ce membre. */
const mine = (row: { owner_user_id: number | null }, userId: number) => row.owner_user_id === null || row.owner_user_id === userId;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const json = <T>(text: string | null | undefined, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};

type BatchRow = { id: number; user_id: number; name: string; status: string; source: string; cost_cap_eur: number; created_at: string };
type ItemRow = {
  id: number;
  batch_id: number;
  rel_path: string;
  file_size: number;
  file_mime: string | null;
  file_sha256: string | null;
  status: ItemStatus;
  extractor: string | null;
  document_id: number | null;
  invoice_id: number | null;
  title: string | null;
  proposal: string | null;
  edits: string | null;
  checks: string | null;
  existing: string | null;
  confidence: string | null;
  result: string | null;
  error: string | null;
  cost_eur: number;
  attempts: number;
};
type Proposal = { data: Record<string, unknown>; doubts: string[] };
type Result = { log: Written[]; summary: string };

/* ---------- Lecture d'un lot ---------- */

async function ownBatch(userId: number, batchId: number): Promise<BatchRow> {
  const b = await one<BatchRow>("SELECT id, user_id, name, status, source, cost_cap_eur, created_at FROM import_batches WHERE id = ? AND user_id = ?", [batchId, userId]);
  if (!b) throw new ActionError(404, t("Lot introuvable"));
  return b;
}

async function ownItem(userId: number, itemId: number): Promise<ItemRow> {
  const i = await one<ItemRow>("SELECT i.* FROM import_items i JOIN import_batches b ON b.id = i.batch_id WHERE i.id = ? AND b.user_id = ?", [itemId, userId]);
  if (!i) throw new ActionError(404, t("Fichier introuvable dans ce lot"));
  return i;
}

const changesOf = (existing: string | null) => json<Existing>(existing, null)?.diffs.length ?? 0;

function itemSummary(i: ItemRow) {
  const checks = json<Check[] | null>(i.checks, null);
  const changes = changesOf(i.existing);
  return {
    id: i.id,
    path: i.rel_path,
    size: i.file_size,
    status: i.status,
    extractor: i.extractor,
    type: extractorById(i.extractor)?.label ?? null,
    title: i.title,
    documentId: i.document_id,
    invoiceId: i.invoice_id,
    confidence: i.confidence,
    checksOk: checks?.filter((c) => c.ok).length ?? 0,
    checksTotal: checks?.length ?? 0,
    changes,
    known: !!json<Existing>(i.existing, null),
    safe: isSafe({ status: i.status, checks, confidence: i.confidence, changes }),
    error: i.error,
    summary: json<Result | null>(i.result, null)?.summary ?? null,
    costEur: Number(i.cost_eur),
  };
}

export async function batchView(userId: number, batchId: number) {
  const b = await ownBatch(userId, batchId);
  const items = (await q<ItemRow>("SELECT * FROM import_items WHERE batch_id = ? ORDER BY rel_path, id", [batchId])).map(itemSummary);
  const counts: Partial<Record<ItemStatus, number>> = {};
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const costEur = Math.round(items.reduce((s, i) => s + i.costEur, 0) * 10_000) / 10_000;
  return {
    id: b.id,
    name: b.name,
    status: b.status,
    source: b.source,
    createdAt: b.created_at,
    costCapEur: Number(b.cost_cap_eur),
    costEur,
    /** Plafond atteint : des fichiers attendent, la lecture reprendra quand le plafond sera relevé. */
    capped: costEur >= Number(b.cost_cap_eur) && (counts.attente ?? 0) > 0,
    ai: aiEnabled(),
    counts,
    safe: items.filter((i) => i.safe).length,
    items,
  };
}

export async function listBatches(userId: number) {
  return q<{ id: number; name: string; status: string; created_at: string; files: number; to_review: number; done: number; cost_eur: number }>(
    `SELECT b.id, b.name, b.status, b.created_at, COUNT(i.id) AS files, COALESCE(SUM(i.status = 'a_relire'), 0) AS to_review,
       COALESCE(SUM(i.status IN ('valide', 'range')), 0) AS done, COALESCE(SUM(i.cost_eur), 0) AS cost_eur
     FROM import_batches b LEFT JOIN import_items i ON i.batch_id = b.id WHERE b.user_id = ? GROUP BY b.id ORDER BY b.id DESC LIMIT 50`,
    [userId],
  );
}

/* ---------- Création du lot et réception des fichiers ---------- */

export type Declared = { path: string; size: number; sha256?: string | null };

/**
 * Ouvre un lot à partir de la liste des fichiers d'un dossier (chemin, taille, empreinte calculée par l'appareil).
 * Un fichier déjà connu de Pécule n'est pas redemandé ; un fichier non pris en charge est noté pour le rapport.
 */
export async function createBatch(userId: number, input: { name: string; source: "ecran" | "cli" | "mcp"; files: Declared[]; costCapEur?: number }) {
  if (!input.files.length) throw new ActionError(400, t("Aucun fichier dans ce dossier."));
  if (input.files.length > MAX_BATCH_FILES) throw new ActionError(400, t("Un lot contient au plus {n} fichiers : dépose le dossier en plusieurs fois.", { n: MAX_BATCH_FILES }));
  const created = await exec("INSERT INTO import_batches (user_id, name, source, cost_cap_eur) VALUES (?, ?, ?, ?)", [userId, input.name.trim().slice(0, 160) || t("Dossier"), input.source, Math.min(200, Math.max(0, input.costCapEur ?? 5))]);
  const batchId = created.insertId;
  const model = aiModel();
  const price = { input: usageCostUsd(model, { input_tokens: 1_000_000, output_tokens: 0 }), output: usageCostUsd(model, { input_tokens: 0, output_tokens: 1_000_000 }) };
  const seen = new Set<string>();
  let estimateUsdTotal = 0;
  for (const f of input.files) {
    const path = cleanPath(f.path);
    const verdict = acceptFile(path, f.size);
    const hash = f.sha256 && /^[0-9a-f]{64}$/.test(f.sha256) ? f.sha256 : null;
    let status: ItemStatus = "envoi";
    let error: string | null = null;
    let documentId: number | null = null;
    let invoiceId: number | null = null;
    if (!verdict.ok) {
      status = "ignore";
      error = verdict.reason;
    } else if (hash) {
      const doc = await one<{ id: number; owner_user_id: number | null }>("SELECT id, owner_user_id FROM documents WHERE file_sha256 = ?", [hash]);
      const inv = doc ? undefined : await one<{ id: number; owner_user_id: number | null }>("SELECT id, owner_user_id FROM invoices WHERE file_sha256 = ?", [hash]);
      if (doc || inv || seen.has(hash)) {
        status = "doublon";
        // Le fichier d'un autre membre, privé : « déjà connu », sans dire lequel.
        documentId = doc && mine(doc, userId) ? doc.id : null;
        invoiceId = inv && mine(inv, userId) ? inv.id : null;
      }
      seen.add(hash);
    }
    if (status === "envoi" && verdict.ok && aiEnabled()) estimateUsdTotal += estimateUsd(f.size, verdict.mime, price);
    await exec("INSERT INTO import_items (batch_id, rel_path, file_size, file_mime, file_sha256, status, error, document_id, invoice_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [batchId, path, f.size, verdict.ok ? verdict.mime : null, hash, status, error, documentId, invoiceId]);
  }
  await logAudit("import massif : lot ouvert", batchId, { fichiers: input.files.length });
  return { ...(await batchView(userId, batchId)), estimateEur: Math.round(estimateUsdTotal * (await usdToEur()) * 100) / 100 };
}

/** Reçoit le contenu d'un fichier annoncé : il est rangé au coffre tout de suite, puis attend sa lecture. */
export async function receiveFile(userId: number, itemId: number, content: Buffer) {
  const item = await ownItem(userId, itemId);
  if (item.status !== "envoi") return itemSummary(item);
  if (!content.length || content.length > MAX_FILE_SIZE) throw new ActionError(400, t("Fichier vide ou de plus de 20 Mo"));
  const hash = sha256(content);
  if (item.file_sha256 && item.file_sha256 !== hash) throw new ActionError(400, t("Le fichier reçu n'est pas celui qui était annoncé."));
  const name = item.rel_path.split("/").pop() ?? item.rel_path;
  const known = (await one<{ id: number; owner_user_id: number | null }>("SELECT id, owner_user_id FROM documents WHERE file_sha256 = ?", [hash])) ?? null;
  const invoice = known ? null : ((await one<{ id: number; owner_user_id: number | null }>("SELECT id, owner_user_id FROM invoices WHERE file_sha256 = ?", [hash])) ?? null);
  if (known || invoice) {
    await exec("UPDATE import_items SET status = 'doublon', file_sha256 = ?, document_id = ?, invoice_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [hash, known && mine(known, userId) ? known.id : null, invoice && mine(invoice, userId) ? invoice.id : null, item.id]);
    return itemSummary(await ownItem(userId, itemId));
  }
  // Privé tant qu'il n'est pas reconnu : c'est son domaine qui dira s'il est commun au foyer.
  const doc = await saveDocument({ ownerUserId: userId, title: name.replace(/\.[a-z0-9]+$/i, ""), file: { name, mime: item.file_mime ?? "application/octet-stream", content }, source: "lot", sourceRef: `lot:${item.batch_id}:${item.id}` });
  await exec("UPDATE import_items SET status = 'attente', file_sha256 = ?, file_size = ?, document_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [hash, content.length, doc.id, item.id]);
  kick();
  return itemSummary(await ownItem(userId, itemId));
}

/**
 * Lit un document déjà au coffre avec l'extracteur de son type : une ligne de plus dans le lot « Documents du coffre »
 * du membre. Le document n'est ni reclassé ni déplacé ; annuler le lot ne le retire pas du coffre.
 */
export async function readVaultDocument(userId: number, documentId: number) {
  const doc = await one<{ id: number; title: string; kind: string; domain: string; file_name: string | null; file_mime: string | null; file_size: number | null; file_sha256: string | null }>(
    `SELECT d.id, d.title, d.kind, d.domain, d.file_name, d.file_mime, d.file_size, d.file_sha256 FROM documents d WHERE d.id = ? AND ${documentVisible(userId)}`,
    [documentId],
  );
  if (!doc) throw new ActionError(404, t("Document introuvable"));
  if (!doc.file_mime) throw new ActionError(400, t("Ce document n'a pas de fichier à lire."));
  if (!aiEnabled()) throw new ActionError(400, t("L'IA n'est pas réglée : Réglages → Comptes et connexions."));
  if (!pickExtractor(doc)) throw new ActionError(400, t("Pécule ne sait pas encore tirer de données de ce type de document."));
  const open = await one<{ id: number }>("SELECT id FROM import_batches WHERE user_id = ? AND source = 'coffre' AND status = 'ouvert' ORDER BY id DESC LIMIT 1", [userId]);
  const batchId = open?.id ?? (await exec("INSERT INTO import_batches (user_id, name, source) VALUES (?, ?, 'coffre')", [userId, t("Documents du coffre")])).insertId;
  const known = await one<{ id: number; status: ItemStatus }>("SELECT id, status FROM import_items WHERE batch_id = ? AND document_id = ? ORDER BY id DESC LIMIT 1", [batchId, doc.id]);
  if (known && ["attente", "lecture", "a_relire", "valide"].includes(known.status)) return { batchId, itemId: known.id };
  const item = await exec("INSERT INTO import_items (batch_id, rel_path, file_size, file_mime, file_sha256, status, document_id, title) VALUES (?, ?, ?, ?, ?, 'attente', ?, ?)", [batchId, (doc.file_name ?? doc.title).slice(0, 500), doc.file_size ?? 0, doc.file_mime, doc.file_sha256, doc.id, doc.title]);
  kick();
  return { batchId, itemId: item.insertId };
}

/* ---------- File de lecture ---------- */

const CONCURRENCY = 2;
let running = 0;

/** Réveille la file : au plus deux lectures à la fois, dans l'ordre d'arrivée. */
export function kick() {
  while (running < CONCURRENCY) {
    running++;
    void next()
      .catch((e) => console.error("[import]", e))
      .finally(() => {
        running--;
      });
  }
}

/** Au démarrage : une lecture interrompue par un arrêt du serveur reprend. */
export async function resumeImports() {
  await exec("UPDATE import_items SET status = 'attente' WHERE status = 'lecture'");
  kick();
}

async function next(): Promise<void> {
  for (;;) {
    // Un lot qui a atteint son plafond de dépense attend ; les autres avancent.
    const item = await runReal(() =>
      one<ItemRow & { user_id: number }>(
        `SELECT i.*, b.user_id FROM import_items i JOIN import_batches b ON b.id = i.batch_id
         WHERE i.status = 'attente' AND b.status = 'ouvert'
           AND (SELECT COALESCE(SUM(x.cost_eur), 0) FROM import_items x WHERE x.batch_id = b.id) < b.cost_cap_eur
         ORDER BY i.id LIMIT 1`,
      ),
    );
    if (!item) return;
    const taken = await runReal(() => exec("UPDATE import_items SET status = 'lecture', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'attente'", [item.id]));
    if (!taken.affectedRows) continue;
    const lang = await runReal(() => memberLang(item.user_id));
    await runReal(() => runAs({ userId: item.user_id, via: "systeme" }, () => runInLang(lang, () => readItem(item, item.user_id))));
  }
}

const transient = (e: unknown) => {
  const status = (e as { status?: number } | null)?.status;
  return status === 429 || status === 529 || status === 503 || status === 500;
};

async function readItem(item: ItemRow, userId: number) {
  const { value, error, eur } = await meterCost(() => process(item, userId));
  await exec("UPDATE import_items SET cost_eur = cost_eur + ? WHERE id = ?", [eur, item.id]);
  if (!error) return void value;
  if (transient(error) && item.attempts < 3) {
    // Fournisseur d'IA saturé : le fichier retourne dans la file après une pause.
    await new Promise((r) => setTimeout(r, 4000 * (item.attempts + 1)));
    await exec("UPDATE import_items SET status = 'attente', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'lecture'", [item.id]);
    return;
  }
  console.error("[import] lecture impossible", item.rel_path, error);
  const message = error instanceof ActionError ? error.message : t("Lecture impossible : {raison}", { raison: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200) });
  await exec("UPDATE import_items SET status = 'erreur', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [message, item.id]);
}

const settle = (id: number, status: ItemStatus, cols: Partial<Record<"extractor" | "title" | "proposal" | "edits" | "checks" | "existing" | "confidence" | "error" | "invoice_id" | "document_id", string | number | null>> = {}) => {
  const names = Object.keys(cols);
  return exec(`UPDATE import_items SET status = ?, ${names.map((c) => `${c} = ?, `).join("")}updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, ...Object.values(cols), id]);
};

/** Reconnaît le fichier, le range, et prépare la proposition de son extracteur. */
async function process(item: ItemRow, userId: number) {
  const doc = item.document_id ? await one<{ id: number; title: string; file_mime: string | null; kind: string; domain: string; source_ref: string | null; content_text: string | null }>("SELECT id, title, file_mime, kind, domain, source_ref, content_text FROM documents WHERE id = ?", [item.document_id]) : null;
  const file = doc ? await one<{ content: Buffer }>("SELECT content FROM document_files WHERE document_id = ?", [doc.id]) : null;
  if (!doc || !file) throw new ActionError(404, t("Le fichier n'est plus au coffre."));
  const mime = item.file_mime ?? doc.file_mime ?? "application/octet-stream";
  const name = item.rel_path.split("/").pop() ?? item.rel_path;
  const ctx: Ctx = { userId, documentId: doc.id, relPath: item.rel_path };

  // Document qui était déjà au coffre (lecture demandée depuis sa fiche) : son rangement n'est pas refait, seul son
  // extracteur le lit.
  if (doc.source_ref !== `lot:${item.batch_id}:${item.id}`) {
    const x = pickExtractor(doc);
    if (!x || !aiEnabled()) return settle(item.id, "range", { title: doc.title });
    const { text, pages } = await extractText(file.content, mime);
    const reading = await readDocument(x, { content: file.content, mime, text: text.trim() ? text : (doc.content_text ?? ""), pages, title: doc.title }, ctx);
    if (!reading) return settle(item.id, "range", { title: doc.title, error: t("Les données de ce document n'ont pas pu être lues.") });
    if (x.rejected?.(reading.data)) return settle(item.id, "range", { title: doc.title, error: reading.doubts.join(" ").slice(0, 500) || null });
    return propose(item, x, { data: reading.data, doubts: reading.doubts }, reading.confidence, ctx);
  }

  // 1. Export de la banque : parseur exact, jamais l'IA.
  if (isBankFile(mime)) {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
    } catch {
      text = new TextDecoder("windows-1252").decode(file.content);
    }
    const parsed = parseBankFile(text);
    if (parsed.rows.length) {
      const days = parsed.rows.map((r) => r.date).sort();
      const data: BankFileData = { account_id: null, name: name.replace(/\.[a-z0-9]+$/i, ""), kind: "courant", owner: "joint", file_account: null, format: parsed.format, rows: parsed.rows.length, skipped: parsed.skipped, from: days[0] ?? null, to: days.at(-1) ?? null, accounts: fileAccounts(parsed), sample: parsed.rows.slice(0, 8).map((r) => ({ date: r.date, label: r.label, amount: r.amount })) };
      await exec("UPDATE documents SET kind = 'export', domain = 'banque', owner_user_id = NULL WHERE id = ?", [doc.id]);
      return propose(item, extractorById("fichier_banque")!, { data, doubts: [] }, "haute", ctx);
    }
  }

  // 2. Sans IA : le fichier reste rangé au coffre, à classer à la main.
  if (!aiEnabled()) return settle(item.id, "range", { title: doc.title });

  // 3. Reconnaissance : type, domaine, titre, résumé (le chemin dans le dossier sert d'indice).
  const { text, pages } = await extractText(file.content, mime);
  const c = await classifyDocument(file.content, mime, text, pages, item.rel_path, userId);
  if (!c) return settle(item.id, "range", { title: doc.title, error: t("Document non reconnu : rangé au coffre tel quel.") });
  if (c.is_invoice) {
    // Une facture d'achat rejoint les factures (articles, rapprochement) et quitte le coffre.
    const inv = await createInvoiceFromFile({ name, mime, content: file.content }, { accountsSql: "accounts", source: "lot" });
    await exec("DELETE FROM documents WHERE id = ?", [doc.id]);
    const title = (await one<{ title: string }>("SELECT title FROM invoices WHERE id = ?", [inv.id]))?.title ?? c.title;
    return settle(item.id, "range", { title, invoice_id: inv.id, document_id: null, extractor: "facture" });
  }
  const x = pickExtractor(c);
  await exec(
    "UPDATE documents SET title = ?, kind = ?, domain = ?, topic = ?, doc_date = ?, expires_at = ?, summary = ?, facts = ?, content_text = COALESCE(content_text, ?), owner_user_id = ? WHERE id = ?",
    [c.title.slice(0, 255), c.kind, c.domain, c.topic, c.doc_date, c.expires_at, c.summary, c.facts.length ? JSON.stringify(c.facts.slice(0, 20)) : null, (text.trim() ? text : c.transcription)?.slice(0, 1_000_000) ?? null, PRIVATE_DOMAINS.has(c.domain) || x?.private ? userId : null, doc.id],
  );
  if (!x) return settle(item.id, "range", { title: c.title });

  // 4. Lecture complète par l'extracteur du type reconnu.
  const reading = await readDocument(x, { content: file.content, mime, text, pages, title: c.title }, ctx);
  if (!reading) return settle(item.id, "range", { title: c.title, error: t("Le document a été rangé, mais ses données n'ont pas pu être lues.") });
  // Reconnu d'après son début, mais sa lecture complète dit autre chose : il reste rangé, avec ce qu'en dit la lecture.
  if (x.rejected?.(reading.data)) return settle(item.id, "range", { title: c.title, error: reading.doubts.join(" ").slice(0, 500) || null });
  return propose(item, x, { data: reading.data, doubts: reading.doubts }, reading.confidence, ctx);
}

async function propose(item: ItemRow, x: Extractor, proposal: Proposal, confidence: string, ctx: Ctx) {
  const existing = await x.existing(proposal.data, ctx);
  return settle(item.id, "a_relire", { extractor: x.id, title: x.title(proposal.data).slice(0, 255), proposal: JSON.stringify(proposal), edits: null, checks: JSON.stringify(x.checks(proposal.data)), existing: existing ? JSON.stringify(existing) : null, confidence, error: null });
}

/* ---------- Relecture ---------- */

function merged(item: ItemRow, x: Extractor): { data: Record<string, unknown>; doubts: string[] } {
  const p = json<Proposal | null>(item.proposal, null);
  if (!p) throw new ActionError(400, t("Ce fichier n'a pas de proposition à relire."));
  const data = x.parse.safeParse({ ...p.data, ...json<Record<string, unknown>>(item.edits, {}) });
  if (!data.success) throw new ActionError(400, t("Une valeur corrigée n'est pas valide."));
  return { data: data.data, doubts: p.doubts };
}

export async function itemView(userId: number, itemId: number) {
  const item = await ownItem(userId, itemId);
  const x = extractorById(item.extractor);
  const base = { ...itemSummary(item), doubts: [] as string[], fields: [] as Field[], edited: [] as string[], table: null as Table | null, checks: json<Check[]>(item.checks, []), existing: json<Existing>(item.existing, null) };
  if (!x || !item.proposal) return base;
  const { data, doubts } = merged(item, x);
  const ctx: Ctx = { userId, documentId: item.document_id, relPath: item.rel_path };
  return { ...base, doubts, fields: await x.fields(data, ctx), edited: Object.keys(json<Record<string, unknown>>(item.edits, {})), table: x.table?.(data) ?? null };
}

/** Corrections de relecture : gardées à part de la lecture d'origine, puis contrôles et écarts recalculés. */
export async function editItem(userId: number, itemId: number, edits: Record<string, unknown>) {
  const item = await ownItem(userId, itemId);
  const x = extractorById(item.extractor);
  if (item.status !== "a_relire" || !x) throw new ActionError(400, t("Ce fichier n'est pas en relecture."));
  const ctx: Ctx = { userId, documentId: item.document_id, relPath: item.rel_path };
  const before = merged(item, x);
  const fields = await x.fields(before.data, ctx);
  const next = { ...json<Record<string, unknown>>(item.edits, {}) };
  for (const [key, raw] of Object.entries(edits)) {
    const f = fields.find((x) => x.key === key);
    if (!f) continue;
    next[key] = coerce(f, raw);
  }
  const data = x.parse.safeParse({ ...json<Proposal>(item.proposal, { data: {}, doubts: [] }).data, ...next });
  if (!data.success) throw new ActionError(400, t("Une valeur corrigée n'est pas valide."));
  const existing = await x.existing(data.data, ctx);
  await exec("UPDATE import_items SET edits = ?, checks = ?, existing = ?, title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [JSON.stringify(next), JSON.stringify(x.checks(data.data)), existing ? JSON.stringify(existing) : null, x.title(data.data).slice(0, 255), item.id]);
  return itemView(userId, itemId);
}

function coerce(f: Field, raw: unknown): string | number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (f.type === "montant" || f.type === "nombre" || f.type === "pourcent" || f.type === "annee") {
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(n)) throw new ActionError(400, t("« {champ} » : nombre attendu.", { champ: t(f.label) }));
    return f.type === "annee" ? Math.round(n) : n;
  }
  const text = String(raw).trim().slice(0, 500);
  if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ActionError(400, t("« {champ} » : date attendue.", { champ: t(f.label) }));
  if (f.type === "mois" && !/^\d{4}-\d{2}$/.test(text)) throw new ActionError(400, t("« {champ} » : mois attendu.", { champ: t(f.label) }));
  if (f.type === "choix" && !f.options?.some((o) => o.value === text)) throw new ActionError(400, t("« {champ} » : choix inconnu.", { champ: t(f.label) }));
  return text;
}

/* ---------- Validation, annulation ---------- */

/** Écrit la proposition (corrections comprises) dans les écrans. En cas d'échec, tout ce qui a été écrit est défait. */
export async function validateItem(userId: number, itemId: number) {
  const item = await ownItem(userId, itemId);
  const x = extractorById(item.extractor);
  if (item.status !== "a_relire" || !x) throw new ActionError(400, t("Ce fichier n'est pas en relecture."));
  const { data } = merged(item, x);
  const taken = await exec("UPDATE import_items SET status = 'lecture' WHERE id = ? AND status = 'a_relire'", [item.id]);
  if (!taken.affectedRows) throw new ActionError(409, t("Ce fichier est déjà en cours de validation."));
  const track = new Tracker();
  try {
    const summary = await x.apply(data, { userId, documentId: item.document_id, relPath: item.rel_path }, track);
    await exec("UPDATE import_items SET status = 'valide', result = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [JSON.stringify({ log: track.log, summary } satisfies Result), item.id]);
    await logAudit("import massif : fichier validé", item.id, { type: x.id, fichier: item.rel_path });
  } catch (e) {
    await undo(track.log).catch((err) => recordAlert("import", `Annulation incomplète après un échec de validation (fichier ${item.id})`, err));
    await exec("UPDATE import_items SET status = 'a_relire' WHERE id = ?", [item.id]);
    throw e;
  }
  return itemSummary(await ownItem(userId, itemId));
}

/** Valide d'un coup tout ce qui est sûr : contrôles passés, lecture sans doute, rien de changé à l'existant. */
export async function validateSafe(userId: number, batchId: number) {
  await ownBatch(userId, batchId);
  const items = await q<ItemRow>("SELECT * FROM import_items WHERE batch_id = ? AND status = 'a_relire' ORDER BY rel_path, id", [batchId]);
  let done = 0;
  const failed: { id: number; error: string }[] = [];
  for (const row of items) {
    // Relu juste avant d'écrire : un fichier validé avant lui a pu changer ce que Pécule contient.
    const item = await ownItem(userId, row.id);
    const x = extractorById(item.extractor);
    if (!x || item.status !== "a_relire") continue;
    const { data } = merged(item, x);
    const existing = await x.existing(data, { userId, documentId: item.document_id, relPath: item.rel_path });
    if (!isSafe({ status: item.status, checks: x.checks(data), confidence: item.confidence, changes: existing?.diffs.length ?? 0 })) continue;
    try {
      await validateItem(userId, item.id);
      done++;
    } catch (e) {
      failed.push({ id: item.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { validated: done, failed };
}

/** Défait la validation d'un fichier : ce qu'elle a créé est supprimé, ce qu'elle a modifié retrouve sa valeur. */
export async function revertItem(userId: number, itemId: number) {
  const item = await ownItem(userId, itemId);
  if (item.status !== "valide") throw new ActionError(400, t("Ce fichier n'a pas été validé."));
  await undo(json<Result>(item.result, { log: [], summary: "" }).log);
  await exec("UPDATE import_items SET status = 'a_relire', result = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
  await logAudit("import massif : validation annulée", item.id, { fichier: item.rel_path });
  return itemSummary(await ownItem(userId, itemId));
}

export async function discardItem(userId: number, itemId: number) {
  const item = await ownItem(userId, itemId);
  if (!["a_relire", "erreur", "range"].includes(item.status)) throw new ActionError(400, t("Ce fichier ne peut pas être écarté dans son état actuel."));
  await exec("UPDATE import_items SET status = 'ecarte', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
  return itemSummary(await ownItem(userId, itemId));
}

/** Relance la lecture d'un fichier (erreur passagère, document mal reconnu) : la proposition précédente est oubliée. */
export async function retryItem(userId: number, itemId: number) {
  const item = await ownItem(userId, itemId);
  if (!["a_relire", "erreur", "range", "ecarte"].includes(item.status) || !item.document_id) throw new ActionError(400, t("Ce fichier ne peut pas être relu."));
  await exec("UPDATE import_items SET status = 'attente', attempts = 0, proposal = NULL, edits = NULL, checks = NULL, existing = NULL, confidence = NULL, error = NULL, extractor = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
  kick();
  return itemSummary(await ownItem(userId, itemId));
}

export async function setCostCap(userId: number, batchId: number, costCapEur: number) {
  await ownBatch(userId, batchId);
  await exec("UPDATE import_batches SET cost_cap_eur = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [Math.min(200, Math.max(0, costCapEur)), batchId]);
  kick();
  return batchView(userId, batchId);
}

/**
 * Annule un lot en entier : chaque validation est défaite, puis les documents et factures que le lot a apportés
 * sont retirés. Les fichiers que Pécule connaissait avant le lot ne sont pas touchés.
 */
export async function cancelBatch(userId: number, batchId: number) {
  const b = await ownBatch(userId, batchId);
  if (b.status === "annule") return batchView(userId, batchId);
  await exec("UPDATE import_batches SET status = 'annule', updated_at = CURRENT_TIMESTAMP WHERE id = ?", [batchId]);
  const items = await q<ItemRow>("SELECT * FROM import_items WHERE batch_id = ? ORDER BY id DESC", [batchId]);
  for (const item of items) {
    if (item.status === "valide") await undo(json<Result>(item.result, { log: [], summary: "" }).log).catch((e) => recordAlert("import", `Annulation incomplète du fichier ${item.id}`, e));
    if (item.status === "doublon" || item.status === "ignore") continue;
    if (item.document_id) await exec("DELETE FROM documents WHERE id = ? AND source_ref = ?", [item.document_id, `lot:${batchId}:${item.id}`]);
    if (item.invoice_id) await exec("DELETE FROM invoices WHERE id = ? AND source = 'lot'", [item.invoice_id]);
    await exec("UPDATE import_items SET status = 'ecarte', result = NULL, document_id = NULL, invoice_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [item.id]);
  }
  await logAudit("import massif : lot annulé", batchId, { fichiers: items.length });
  return batchView(userId, batchId);
}

/** Rapport des fichiers qui n'ont rien apporté : non pris en charge, déjà connus, en erreur, écartés. */
export async function batchReport(userId: number, batchId: number): Promise<string> {
  const b = await ownBatch(userId, batchId);
  const items = await q<ItemRow>("SELECT * FROM import_items WHERE batch_id = ? AND status IN ('ignore', 'doublon', 'erreur', 'ecarte') ORDER BY status, rel_path", [batchId]);
  const reason = (i: ItemRow) => (i.status === "doublon" ? t("déjà dans Pécule") : i.status === "ecarte" ? t("écarté à la relecture") : i.error ? t(i.error) : t("non importé"));
  return [t("Lot « {nom} » — fichiers non importés : {n}", { nom: b.name, n: items.length }), "", ...items.map((i) => `${i.rel_path}\t${reason(i)}`)].join("\n");
}
