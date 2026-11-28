import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { exec, one, q } from "./db.ts";
import { householdSummary } from "./household.ts";
import { aiClient, aiEnabled, aiModel, recordUsage } from "./ai.ts";
import { aiPaused } from "./ai-cost.ts";
import { ActionError } from "./actions.ts";
import { redact, redactOrNull } from "../lib/redact.ts";
import { TOPICS, guessTopic, isTopic } from "../lib/contracts.ts";
import { t } from "../lib/i18n.ts";
import { MAX_TEXT, PDF_TIMEOUT_MS, pdfTextIsolated, queued } from "./pdf-text.ts";

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
export { TOPICS };
/** Domaines privés par défaut (visibles du seul déposant). */
const PRIVATE_DOMAINS = new Set(["retraite", "revenus"]);

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Documents visibles par un membre : communs ou à lui. */
export const documentVisible = (userId: number, alias = "d") => `(${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ${Number(userId)})`;

/* ---------- Texte ---------- */

/*
 * Découpe d'un long PDF en tranches de pages, pour le montrer à l'IA en plusieurs fois (un relevé de plus de 40
 * pages). Même précaution que pour le texte : un fil à part, un délai, une mémoire bornée. Un PDF chiffré ou abîmé
 * ne se découpe pas : l'appelant se rabat sur son texte.
 */
const SPLIT_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { PDFDocument } = await import(workerData.pdflib);
  const source = await PDFDocument.load(new Uint8Array(workerData.content));
  const total = source.getPageCount();
  const parts = [];
  for (let from = 0; from < total; from += workerData.size) {
    const to = Math.min(total, from + workerData.size);
    const out = await PDFDocument.create();
    const pages = await out.copyPages(source, Array.from({ length: to - from }, (_, i) => from + i));
    for (const p of pages) out.addPage(p);
    parts.push({ from: from + 1, to, content: await out.save() });
  }
  parentPort.postMessage({ total, parts });
})().catch((e) => parentPort.postMessage({ error: String(e && e.message || e) }));
`;
const PDFLIB = (() => {
  try {
    return import.meta.resolve("pdf-lib");
  } catch {
    return "pdf-lib";
  }
})();

export type PdfPart = { from: number; to: number; content: Buffer };

/** Tranches de `size` pages d'un PDF (pages comptées à partir de 1). Rejette si le PDF ne peut pas être découpé. */
export function splitPdf(content: Buffer, size: number): Promise<PdfPart[]> {
  const run = () =>
    new Promise<PdfPart[]>((resolve, reject) => {
      const worker = new Worker(SPLIT_WORKER, { eval: true, workerData: { content, pdflib: PDFLIB, size }, resourceLimits: { maxOldGenerationSizeMb: 512 } });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("découpe trop longue, abandonnée"));
      }, PDF_TIMEOUT_MS * 2);
      worker.once("message", (m: { parts?: { from: number; to: number; content: Uint8Array }[]; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (m.error || !m.parts?.length) reject(new Error(m.error ?? "réponse vide"));
        else resolve(m.parts.map((p) => ({ from: p.from, to: p.to, content: Buffer.from(p.content) })));
      });
      worker.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error("découpe interrompue (mémoire ou erreur)"));
      });
    });
  return queued(run);
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
  topic: z.enum(TOPICS).nullable(),
  title: z.string().min(1),
  doc_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  summary: z.string(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
  transcription: z.string().nullable(),
});
export type Classification = z.infer<typeof classification>;

/** Schéma de la reconnaissance, tel qu'il part au fournisseur d'IA (un test en vérifie la forme). */
export const CLASSIFY_SCHEMA = {
  type: "object",
  properties: {
    is_invoice: { type: "boolean", description: "true pour une facture ou un ticket d'achat d'un bien ou d'un service (à ranger dans les factures) ; false pour un devis, une offre ou une proposition de contrat, qui ne sont pas encore payés" },
    kind: { type: "string", enum: [...KINDS], description: "Type de document (facture = facture de travaux ou de service liée à un bien, conservée au coffre ; devis = devis, offre ou proposition de contrat pas encore acceptés, d'un fournisseur d'énergie, d'un assureur, d'un opérateur, d'un artisan…)" },
    domain: { type: "string", enum: [...DOMAINS], description: "Domaine des finances de la famille concerné" },
    topic: {
      // Une liste de valeurs ou rien : deux branches (le fournisseur refuse « enum » sur un type double).
      anyOf: [{ type: "string", enum: [...TOPICS] }, { type: "null" }],
      description:
        "Nature du contrat, pour un contrat, un avenant, une attestation, un avis d'échéance, un devis ou une offre qui s'y rapporte : assurance_auto (auto, moto), assurance_habitation (habitation, propriétaire non occupant, copropriété, loyers impayés), assurance_emprunteur, assurance_sante (mutuelle, complémentaire santé), assurance_autre (prévoyance, scolaire, animaux, protection juridique…), energie (électricité, gaz), internet (box, fibre), mobile (forfait), vehicule (crédit, location avec option d'achat ou longue durée d'un véhicule). null pour tout le reste (impôts, paie, actes, placements, travaux…).",
    },
    title: { type: "string", description: "Titre court et parlant (« Avis d'impôt 2026 sur les revenus 2025 », « Bail meublé du studio », « DPE de l'appartement 2019 »)" },
    doc_date: { type: ["string", "null"], description: "Date du document AAAA-MM-JJ" },
    expires_at: { type: ["string", "null"], description: "Fin de validité ou échéance AAAA-MM-JJ (fin de bail, DPE + 10 ans, fin de contrat, date limite de paiement), sinon null" },
    summary: { type: "string", description: "2 à 4 phrases : de quoi il s'agit, montants et dates utiles. Jamais de numéro de compte, IBAN, n° de Sécurité sociale ou n° fiscal" },
    facts: {
      type: "array",
      description: "Au plus 12 faits clés (montant, taux, échéance, parties, bien concerné… ; pour un contrat ou un devis : prix par mois et par an, prix unitaires, garanties et franchises, durée d'engagement, préavis), sans identifiant sensible",
      items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false },
    },
    transcription: { type: ["string", "null"], description: "Pour une photo ou un scan sans texte : transcription du texte utile (4 000 caractères au plus) ; sinon null" },
  },
  required: ["is_invoice", "kind", "domain", "topic", "title", "doc_date", "expires_at", "summary", "facts", "transcription"],
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
  // IA en pause (plafond du mois) : le fichier est rangé sans être lu, comme sans IA — privé à celui qui le dépose.
  if (!aiEnabled() || (await aiPaused())) return null;
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
  /** Nature du contrat ; absente : devinée au titre et au résumé (null = aucune, sans deviner). */
  topic?: string | null;
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
  const topic = input.topic === undefined ? guessTopic({ title: input.title, summary: input.summary, kind: input.kind }) : isTopic(input.topic) ? input.topic : null;
  if (existing) {
    await exec(
      `UPDATE documents SET summary = COALESCE(summary, ?), facts = COALESCE(facts, ?), content_text = COALESCE(content_text, ?),
         doc_date = COALESCE(doc_date, ?), expires_at = COALESCE(expires_at, ?), entity_type = COALESCE(entity_type, ?), entity_id = COALESCE(entity_id, ?),
         source_ref = COALESCE(source_ref, ?), topic = COALESCE(topic, ?) WHERE id = ?`,
      [redactOrNull(input.summary), facts, text, input.docDate ?? null, input.expiresAt ?? null, input.entityType ?? null, input.entityId ?? null, input.sourceRef ?? null, topic, existing.id],
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
    `INSERT INTO documents (owner_user_id, title, kind, domain, topic, entity_type, entity_id, doc_date, expires_at, summary, facts, content_text,
       file_name, file_mime, file_size, file_sha256, source, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerUserId ?? null,
      input.title.slice(0, 255),
      (KINDS as readonly string[]).includes(input.kind ?? "") ? input.kind : "autre",
      (DOMAINS as readonly string[]).includes(input.domain ?? "") ? input.domain : "autre",
      topic,
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
    // Privé tant qu'il n'est pas reconnu (IA absente ou en panne) : seul un domaine lu peut dire qu'il est commun au
    // foyer — un bulletin de paie resté sans classement ne doit pas s'ouvrir à tous. Le membre le partage dans sa fiche.
    ownerUserId: !c || PRIVATE_DOMAINS.has(c.domain) ? userId : null,
    title,
    kind: c?.kind,
    domain: c?.domain,
    // La nature lue par l'IA fait foi, « aucune » comprise ; sans IA, celle que disent le titre et le résumé.
    topic: c ? c.topic : undefined,
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

const LIST_COLS = `d.id, d.owner_user_id, d.title, d.kind, d.domain, d.topic, d.entity_type, d.entity_id, d.doc_date, d.expires_at, d.summary,
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
  f: { q?: string; domain?: string; kind?: string; topic?: string; entityType?: string; entityId?: string; limit?: number; offset?: number },
) {
  const where = [documentVisible(userId)];
  const params: unknown[] = [];
  if (f.domain) where.push("d.domain = ?"), params.push(f.domain);
  if (f.kind) where.push("d.kind = ?"), params.push(f.kind);
  if (f.topic) where.push("d.topic = ?"), params.push(f.topic);
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
       ORDER BY score DESC, d.id DESC LIMIT ? OFFSET ?`,
      [ft, ...params, ft, limit + 1, offset],
    );
    // Mots trop courts ou absents de l'index : on se rabat sur le titre.
    if (!rows.length)
      rows = await q(`SELECT ${LIST_COLS}, d.content_text FROM documents d WHERE ${where.join(" AND ")} AND (d.title LIKE ? OR d.summary LIKE ?) ORDER BY d.doc_date IS NULL, d.doc_date DESC, d.id DESC LIMIT ? OFFSET ?`, [
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
  topic: string | null;
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
  topic?: string | null;
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
    topic: b.topic === undefined ? undefined : isTopic(b.topic) ? b.topic : null,
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

/* ---------- Nature des contrats (étiquettes du coffre) ---------- */

/** Natures présentes dans le coffre du membre, avec le nombre de documents : ce sont les étiquettes proposées. */
export async function documentTopics(userId: number): Promise<{ topic: string; count: number }[]> {
  const rows = await q<{ topic: string; n: number }>(`SELECT d.topic, COUNT(*) AS n FROM documents d WHERE d.topic IS NOT NULL AND ${documentVisible(userId)} GROUP BY d.topic`);
  const order = TOPICS as readonly string[];
  return rows
    .filter((r) => isTopic(r.topic))
    .map((r) => ({ topic: r.topic, count: Number(r.n) }))
    .sort((a, b) => order.indexOf(a.topic) - order.indexOf(b.topic));
}

const TOPICS_DONE = "documents:topics";

/**
 * Donne leur nature aux documents déjà au coffre, d'après leur titre et leur résumé (sans IA) : une fois, à la
 * première ouverture après la migration ; ensuite sans effet, pour ne pas remettre une nature retirée à la main.
 */
export async function fillDocumentTopics(): Promise<number> {
  if (await one("SELECT 1 AS x FROM app_kv WHERE `key` = ?", [TOPICS_DONE])) return 0;
  const rows = await q<{ id: number; title: string; summary: string | null; kind: string }>("SELECT id, title, summary, kind FROM documents WHERE topic IS NULL");
  let n = 0;
  for (const r of rows) {
    const topic = guessTopic(r);
    if (!topic) continue;
    await exec("UPDATE documents SET topic = ?, updated_at = updated_at WHERE id = ? AND topic IS NULL", [topic, r.id]);
    n++;
  }
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [TOPICS_DONE, String(n)]);
  return n;
}
