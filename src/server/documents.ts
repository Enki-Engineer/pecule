import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { exec, one, q } from "./db.ts";
import { householdSummary } from "./household.ts";
import { aiClient, aiEnabled, aiModel, recordUsage } from "./ai.ts";
import { ActionError } from "./actions.ts";
import { redact, redactOrNull } from "../lib/redact.ts";
import { t } from "../lib/i18n.ts";

/*
 * Coffre de documents : enregistrement idempotent (empreinte du fichier ou clé d'import), texte
 * extrait pour la recherche (PDF lus localement, photos et scans lus par Claude), type, domaine,
 * date, échéance et résumé reconnus par Claude. Le texte indexé est masqué (IBAN, n° SS…) ; le
 * fichier d'origine reste intact.
 */

export const MAX_DOC_SIZE = 20 * 1024 * 1024;
export const DOC_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "text/plain",
  "text/markdown",
  "text/csv",
]);
export const KINDS = [
  "avis_impot",
  "taxe_fonciere",
  "contrat",
  "bail",
  "acte",
  "pret",
  "assurance",
  "releve",
  "diagnostic",
  "fiscal",
  "statuts",
  "devis",
  "facture",
  "prospectus",
  "bulletin",
  "export",
  "fiche",
  "note",
  "autre",
] as const;
export const DOMAINS = ["banque", "immobilier", "patrimoine", "crypto", "impots", "retraite", "revenus", "budget", "autre"] as const;
/** Domaines privés par défaut (visibles du seul déposant). */
const PRIVATE_DOMAINS = new Set(["retraite", "revenus"]);

const MAX_TEXT = 1_000_000;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Documents visibles par un membre : communs ou à lui. */
export const documentVisible = (userId: number, alias = "d") => `(${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ${Number(userId)})`;

/* ---------- Texte ---------- */

/*
 * Lecture du texte d'un PDF dans un fil à part, une à la fois, avec un délai et une mémoire bornés : un PDF piégé
 * (flux compressés géants, milliers de pages) ne doit ni figer ni faire tomber le serveur, qui n'a qu'un processus.
 * Au-delà des bornes, le document est gardé sans texte (il reste lisible par l'IA page par page, et à l'écran).
 */
const PDF_TIMEOUT_MS = 20_000;
const PDF_MAX_PAGES = 400;
const PDF_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { extractText, getDocumentProxy } = await import(workerData.unpdf);
  const pdf = await getDocumentProxy(new Uint8Array(workerData.content));
  if (pdf.numPages > workerData.maxPages) return parentPort.postMessage({ totalPages: pdf.numPages, text: "" });
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  parentPort.postMessage({ totalPages, text: String(text).slice(0, workerData.maxText) });
})().catch((e) => parentPort.postMessage({ error: String(e && e.message || e) }));
`;
// Adresse du paquet résolue ici (à côté du serveur) : le fil, lui, résoudrait depuis le dossier courant du processus.
const UNPDF = (() => {
  try {
    return import.meta.resolve("unpdf");
  } catch {
    return "unpdf";
  }
})();
let pdfQueue: Promise<unknown> = Promise.resolve();

function pdfTextIsolated(content: Buffer): Promise<{ totalPages: number; text: string }> {
  const run = () =>
    new Promise<{ totalPages: number; text: string }>((resolve, reject) => {
      const worker = new Worker(PDF_WORKER, { eval: true, workerData: { content, unpdf: UNPDF, maxPages: PDF_MAX_PAGES, maxText: MAX_TEXT }, resourceLimits: { maxOldGenerationSizeMb: 384 } });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("lecture trop longue, abandonnée"));
      }, PDF_TIMEOUT_MS);
      worker.once("message", (m: { totalPages?: number; text?: string; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (m.error || m.totalPages === undefined) reject(new Error(m.error ?? "réponse vide"));
        else resolve({ totalPages: m.totalPages, text: m.text ?? "" });
      });
      worker.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error("lecture interrompue (mémoire ou erreur)"));
      });
    });
  const next = pdfQueue.then(run, run);
  pdfQueue = next.catch(() => undefined);
  return next;
}

/** Texte d'un fichier : PDF lu localement (couche texte), fichiers texte tels quels ; rien pour une photo. */
export async function extractText(content: Buffer, mime: string): Promise<{ text: string; pages: number | null }> {
  if (mime.startsWith("text/")) return { text: content.toString("utf8").slice(0, MAX_TEXT), pages: null };
  if (mime !== "application/pdf") return { text: "", pages: null };
  try {
    const { totalPages, text } = await pdfTextIsolated(content);
    return { text: text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, MAX_TEXT), pages: totalPages };
  } catch (e) {
    console.error("[documents] lecture du PDF impossible", e instanceof Error ? e.message : e);
    return { text: "", pages: null };
  }
}

/* ---------- Reconnaissance par Claude ---------- */

const classification = z.object({
  is_invoice: z.boolean(),
  kind: z.enum(KINDS),
  domain: z.enum(DOMAINS),
  title: z.string().min(1),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  summary: z.string(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  transcription: z.string().nullable(),
});
export type Classification = z.infer<typeof classification>;

const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    is_invoice: { type: "boolean", description: "true pour une facture ou un ticket d'achat d'un bien ou d'un service (à ranger dans les factures)" },
    kind: { type: "string", enum: [...KINDS], description: "Type de document (facture = facture de travaux ou de service liée à un bien, conservée au coffre)" },
    domain: { type: "string", enum: [...DOMAINS], description: "Domaine des finances de la famille concerné" },
    title: { type: "string", description: "Titre court et parlant (« Avis d'impôt 2026 sur les revenus 2025 », « Bail meublé du studio », « DPE de l'appartement 2019 »)" },
    doc_date: { type: ["string", "null"], description: "Date du document AAAA-MM-JJ" },
    expires_at: { type: ["string", "null"], description: "Fin de validité ou échéance AAAA-MM-JJ (fin de bail, DPE + 10 ans, fin de contrat, date limite de paiement), sinon null" },
    summary: { type: "string", description: "2 à 4 phrases : de quoi il s'agit, montants et dates utiles. Jamais de numéro de compte, IBAN, n° de Sécurité sociale ou n° fiscal" },
    facts: {
      type: "array",
      description: "Au plus 12 faits clés (montant, taux, échéance, parties, bien concerné…), sans identifiant sensible",
      items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false },
    },
    transcription: { type: ["string", "null"], description: "Pour une photo ou un scan sans texte : transcription du texte utile (4 000 caractères au plus) ; sinon null" },
  },
  required: ["is_invoice", "kind", "domain", "title", "doc_date", "expires_at", "summary", "facts", "transcription"],
  additionalProperties: false,
};

const READABLE_IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_PDF_PAGES_FOR_CLAUDE = 40;

/**
 * Reconnaît un document. Avec une couche texte, Claude n'en lit que le début (coût maîtrisé) ;
 * sans texte (photo, scan), il lit le fichier lui-même. null si l'IA n'est pas configurée ou si
 * le fichier ne peut pas lui être montré.
 */
export async function classifyDocument(content: Buffer, mime: string, text: string, pages: number | null, hint: string, userId?: number): Promise<Classification | null> {
  if (!aiEnabled()) return null;
  let doc: Anthropic.ContentBlockParam;
  if (text.trim().length >= 200) {
    doc = { type: "text", text: `Texte du document${pages ? ` (${pages} pages)` : ""}, début :\n\n${text.slice(0, 15_000)}` };
  } else if (mime === "application/pdf" && (pages ?? 1) <= MAX_PDF_PAGES_FOR_CLAUDE) {
    doc = { type: "document", source: { type: "base64", media_type: "application/pdf", data: content.toString("base64") } };
  } else if (READABLE_IMAGES.has(mime)) {
    doc = { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: content.toString("base64") } };
  } else return null;
  const response = await aiClient().messages.create({
    model: aiModel(),
    max_tokens: 6000,
    system:
      `Tu ranges les documents administratifs et financiers d'un foyer : impôts, logement, crédits, placements, crypto, retraite, salaires, contrats. ${await householdSummary(userId).catch(() => "")} Réponds strictement au format demandé, en français. N'invente rien : null si une information est absente. Ne recopie jamais d'IBAN, de numéro de compte, de numéro de Sécurité sociale ni d'identifiant fiscal.`,
    output_config: { effort: "low", format: { type: "json_schema", schema: CLASSIFY_SCHEMA } },
    messages: [{ role: "user", content: [doc, { type: "text", text: `Range ce document. Nom du fichier : ${hint}` }] }],
  });
  await recordUsage("document", aiModel(), response.usage);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const out = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  const parsed = out ? classification.safeParse(JSON.parse(out)) : null;
  return parsed?.success ? parsed.data : null;
}

/* ---------- Enregistrement ---------- */

export type DocumentInput = {
  ownerUserId?: number | null;
  title: string;
  kind?: string;
  domain?: string;
  entityType?: string | null;
  entityId?: string | null;
  docDate?: string | null;
  expiresAt?: string | null;
  summary?: string | null;
  facts?: { label: string; value: string }[] | null;
  contentText?: string | null;
  file?: { name: string; mime: string; content: Buffer } | null;
  source: string;
  sourceRef?: string | null;
};

/**
 * Crée un document, ou complète celui qui existe déjà (même clé d'import ou même fichier) sans
 * écraser ce qui a été corrigé à la main.
 */
export async function saveDocument(input: DocumentInput): Promise<{ id: number; created: boolean }> {
  const hash = input.file ? sha256(input.file.content) : null;
  const existing =
    (input.sourceRef ? await one<{ id: number }>("SELECT id FROM documents WHERE source_ref = ?", [input.sourceRef]) : undefined) ??
    (hash ? await one<{ id: number }>("SELECT id FROM documents WHERE file_sha256 = ?", [hash]) : undefined);
  const text = redactOrNull(input.contentText)?.slice(0, MAX_TEXT) ?? null;
  const facts = input.facts?.length ? JSON.stringify(input.facts.map((f) => ({ label: f.label, value: redact(f.value) })).slice(0, 20)) : null;
  if (existing) {
    await exec(
      `UPDATE documents SET summary = COALESCE(summary, ?), facts = COALESCE(facts, ?), content_text = COALESCE(content_text, ?),
         doc_date = COALESCE(doc_date, ?), expires_at = COALESCE(expires_at, ?), entity_type = COALESCE(entity_type, ?), entity_id = COALESCE(entity_id, ?),
         source_ref = COALESCE(source_ref, ?) WHERE id = ?`,
      [redactOrNull(input.summary), facts, text, input.docDate ?? null, input.expiresAt ?? null, input.entityType ?? null, input.entityId ?? null, input.sourceRef ?? null, existing.id],
    );
    if (input.file && hash) {
      const hasFile = await one("SELECT document_id FROM document_files WHERE document_id = ?", [existing.id]);
      if (!hasFile) {
        await exec("UPDATE documents SET file_name = ?, file_mime = ?, file_size = ?, file_sha256 = ? WHERE id = ?", [input.file.name, input.file.mime, input.file.content.length, hash, existing.id]);
        await exec("INSERT INTO document_files (document_id, content) VALUES (?, ?)", [existing.id, input.file.content]);
      }
    }
    return { id: existing.id, created: false };
  }
  const r = await exec(
    `INSERT INTO documents (owner_user_id, title, kind, domain, entity_type, entity_id, doc_date, expires_at, summary, facts, content_text,
       file_name, file_mime, file_size, file_sha256, source, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerUserId ?? null,
      input.title.slice(0, 255),
      (KINDS as readonly string[]).includes(input.kind ?? "") ? input.kind : "autre",
      (DOMAINS as readonly string[]).includes(input.domain ?? "") ? input.domain : "autre",
      input.entityType ?? null,
      input.entityId ?? null,
      input.docDate ?? null,
      input.expiresAt ?? null,
      redactOrNull(input.summary),
      facts,
      text,
      input.file?.name.slice(0, 255) ?? null,
      input.file?.mime ?? null,
      input.file?.content.length ?? null,
      hash,
      input.source,
      input.sourceRef ?? null,
    ],
  );
  if (input.file) await exec("INSERT INTO document_files (document_id, content) VALUES (?, ?)", [r.insertId, input.file.content]);
  return { id: r.insertId, created: true };
}

/** Fichier déposé (écran, assistant, Raccourci) : lu, reconnu et rangé comme document. */
export async function createDocumentFromFile(
  userId: number,
  file: { name: string; mime: string; content: Buffer },
  source: string,
  prepared?: { text: string; pages: number | null; classification: Classification | null },
): Promise<{ id: number; created: boolean; title: string }> {
  const known = await one<{ id: number; title: string }>("SELECT id, title FROM documents WHERE file_sha256 = ?", [sha256(file.content)]);
  if (known) return { id: known.id, created: false, title: known.title };
  const { text, pages } = prepared ?? (await extractText(file.content, file.mime));
  const c =
    prepared?.classification ??
    (await classifyDocument(file.content, file.mime, text, pages, file.name, userId).catch((e) => {
      console.error("[documents] reconnaissance impossible", e);
      return null;
    }));
  const title = c?.title ?? file.name.replace(/\.[a-z0-9]+$/i, "");
  const { id, created } = await saveDocument({
    ownerUserId: c && PRIVATE_DOMAINS.has(c.domain) ? userId : null,
    title,
    kind: c?.kind,
    domain: c?.domain,
    docDate: c?.doc_date,
    expiresAt: c?.expires_at,
    summary: c?.summary,
    facts: c?.facts,
    contentText: text.trim() ? text : c?.transcription,
    file,
    source,
  });
  return { id, created, title };
}

/* ---------- Lecture, recherche, mise à jour ---------- */

const LIST_COLS = `d.id, d.owner_user_id, d.title, d.kind, d.domain, d.entity_type, d.entity_id, d.doc_date, d.expires_at, d.summary,
  d.file_name, d.file_mime, d.file_size, d.source, d.created_at`;

/** Requête plein texte (mode booléen, préfixes) : « avis impot 2025 » → « +avis* +impot* +2025* ». */
export function fulltextQuery(q: string): string {
  const words = q
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3)
    .slice(0, 8);
  return words.map((w) => `+${w}*`).join(" ");
}

/** Extrait autour du premier mot cherché trouvé dans le texte. */
export function snippet(text: string | null, q: string, width = 160): string | null {
  if (!text) return null;
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const lower = text.toLowerCase();
  const at = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return null;
  const start = Math.max(0, at - width / 2);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + width).replace(/\s+/g, " ").trim()}…`;
}

export async function searchDocuments(
  userId: number,
  f: { q?: string; domain?: string; kind?: string; entityType?: string; entityId?: string; limit?: number; offset?: number },
) {
  const where = [documentVisible(userId)];
  const params: unknown[] = [];
  if (f.domain) where.push("d.domain = ?"), params.push(f.domain);
  if (f.kind) where.push("d.kind = ?"), params.push(f.kind);
  if (f.entityType) where.push("d.entity_type = ?"), params.push(f.entityType);
  if (f.entityId) where.push("d.entity_id = ?"), params.push(f.entityId);
  const limit = f.limit ?? 50;
  const offset = f.offset ?? 0;
  const ft = f.q ? fulltextQuery(f.q) : "";
  let rows: (Record<string, unknown> & { content_text?: string | null })[];
  if (f.q && ft) {
    rows = await q(
      `SELECT ${LIST_COLS}, d.content_text, MATCH(d.title, d.summary, d.content_text) AGAINST (? IN BOOLEAN MODE) AS score
       FROM documents d WHERE ${where.join(" AND ")} AND MATCH(d.title, d.summary, d.content_text) AGAINST (? IN BOOLEAN MODE)
       ORDER BY score DESC LIMIT ? OFFSET ?`,
      [ft, ...params, ft, limit + 1, offset],
    );
    // Mots trop courts ou absents de l'index : on se rabat sur le titre.
    if (!rows.length)
      rows = await q(`SELECT ${LIST_COLS}, d.content_text FROM documents d WHERE ${where.join(" AND ")} AND (d.title LIKE ? OR d.summary LIKE ?) ORDER BY d.doc_date DESC LIMIT ? OFFSET ?`, [
        ...params,
        `%${f.q}%`,
        `%${f.q}%`,
        limit + 1,
        offset,
      ]);
  } else {
    rows = await q(`SELECT ${LIST_COLS} FROM documents d WHERE ${where.join(" AND ")} ORDER BY d.doc_date IS NULL, d.doc_date DESC, d.id DESC LIMIT ? OFFSET ?`, [
      ...params,
      limit + 1,
      offset,
    ]);
  }
  const out = rows.slice(0, limit).map(({ content_text, score: _score, ...r }) => ({ ...r, snippet: f.q ? snippet(content_text ?? null, f.q) : null }));
  return { documents: out, hasMore: rows.length > limit };
}

export type DocumentRow = {
  id: number;
  owner_user_id: number | null;
  title: string;
  kind: string;
  domain: string;
  entity_type: string | null;
  entity_id: string | null;
  doc_date: string | null;
  expires_at: string | null;
  summary: string | null;
  file_name: string | null;
  file_mime: string | null;
  file_size: number | null;
  file_sha256: string | null;
  source: string;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
  has_file: number | null;
};

export async function documentDetail(userId: number, id: number) {
  const d = await one<DocumentRow & { facts: string | null; content_text: string | null }>(
    `SELECT d.*, (SELECT 1 FROM document_files f WHERE f.document_id = d.id) AS has_file FROM documents d WHERE d.id = ? AND ${documentVisible(userId)}`,
    [id],
  );
  if (!d) return null;
  const { content_text, facts, ...rest } = d;
  return { ...rest, facts: facts ? (JSON.parse(facts) as { label: string; value: string }[]) : [], text_length: content_text?.length ?? 0, text: content_text };
}

export async function visibleDocument(userId: number, id: number) {
  const d = await one<{ id: number; title: string }>(`SELECT d.id, d.title FROM documents d WHERE d.id = ? AND ${documentVisible(userId)}`, [id]);
  if (!d) throw new ActionError(404, t("Document introuvable"));
  return d;
}

export type DocumentPatch = {
  title?: string;
  kind?: string;
  domain?: string;
  docDate?: string | null;
  expiresAt?: string | null;
  summary?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  private?: boolean;
};

export async function updateDocument(userId: number, id: number, b: DocumentPatch) {
  await visibleDocument(userId, id);
  const cols: Record<string, unknown> = {
    title: b.title,
    kind: b.kind,
    domain: b.domain,
    doc_date: b.docDate,
    expires_at: b.expiresAt,
    summary: b.summary === undefined ? undefined : redactOrNull(b.summary),
    entity_type: b.entityType,
    entity_id: b.entityId,
    owner_user_id: b.private === undefined ? undefined : b.private ? userId : null,
  };
  const sets = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (sets.length) await exec(`UPDATE documents SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...sets.map(([, v]) => v), id]);
}

export async function deleteDocument(userId: number, id: number) {
  await visibleDocument(userId, id);
  await exec("DELETE FROM documents WHERE id = ?", [id]);
}
