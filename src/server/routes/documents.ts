import { today } from "../region.ts";
import { createHash } from "node:crypto";
import { Router, raw, type Request } from "express";
import { z } from "zod";
import { exec, one, q } from "../db.ts";
import { memberByName } from "../members.ts";
import { ActionError, userAccountsSql } from "../actions.ts";
import { createDepotToken } from "../auth.ts";
import { DOC_MIMES, DOMAINS, KINDS, MAX_DOC_SIZE, TOPICS, classifyDocument, deleteDocument, documentTopics, extractText, documentDetail, saveDocument, searchDocuments, updateDocument, visibleDocument } from "../documents.ts";
import { agenda, createTask, deleteTask, setTaskDone, updateTask } from "../agenda.ts";
import { ingestUpload } from "../inbox.ts";
import { env } from "../env.ts";
import { createCalendarToken } from "../ical.ts";
import { t as tr } from "../../lib/i18n.ts";
import { hourly } from "../limits.ts";

/** Coffre de documents, échéancier, dépôt et jetons personnels : montés sous /api après l'authentification. */
export const documentsApi = Router();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

function uploaded(req: Request) {
  const { name } = z.object({ name: z.string().min(1).max(255) }).parse(req.query);
  const content = req.body as Buffer;
  if (!Buffer.isBuffer(content) || !content.length) throw new ActionError(400, tr("Fichier vide"));
  let mime = (req.get("content-type") ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
  // Raccourci iPhone et navigateurs envoient parfois un type générique : on se fie à l'extension.
  if (mime === "application/octet-stream") {
    const ext = name.toLowerCase().split(".").pop() ?? "";
    mime =
      { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", webp: "image/webp", txt: "text/plain", md: "text/markdown", csv: "text/csv" }[ext] ??
      mime;
  }
  if (!DOC_MIMES.has(mime)) throw new ActionError(400, tr("Formats acceptés : PDF, photo (JPEG, PNG, HEIC), texte ou CSV"));
  return { name, mime, content };
}

/* ---------- Dépôt (assistant, Raccourci iPhone) ---------- */

documentsApi.post("/inbox", hourly(240), raw({ type: () => true, limit: MAX_DOC_SIZE }), async (req, res) => {
  const file = uploaded(req);
  const { force } = z.object({ force: z.enum(["invoice", "document"]).optional() }).parse(req.query);
  const source = req.user!.via === "depot" ? "raccourci" : "assistant";
  res.json(await ingestUpload(req.user!.id, file, source, { accountsSql: userAccountsSql(req.user!.id), force }));
});

/* ---------- Documents ---------- */

documentsApi.get("/documents", async (req, res) => {
  const f = z
    .object({
      q: z.string().max(100).optional(),
      domain: z.enum(DOMAINS).optional(),
      kind: z.enum(KINDS).optional(),
      topic: z.enum(TOPICS).optional(),
      entityType: z.string().max(16).optional(),
      entityId: z.string().max(64).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(60),
      offset: z.coerce.number().int().min(0).default(0),
    })
    .parse(req.query);
  res.json(await searchDocuments(req.user!.id, f));
});

/** Étiquettes du coffre : les natures de contrat qui y ont au moins un document. Avant « /documents/:id ». */
documentsApi.get("/documents/topics", async (req, res) => {
  res.json({ topics: await documentTopics(req.user!.id) });
});

documentsApi.get("/documents/:id", async (req, res) => {
  const d = await documentDetail(req.user!.id, z.coerce.number().int().parse(req.params.id));
  if (!d) throw new ActionError(404, tr("Document introuvable"));
  // Le texte complet peut être long : l'écran n'en reçoit que le début.
  res.json({ ...d, text: d.text ? d.text.slice(0, 20_000) : null });
});

documentsApi.get("/documents/:id/file", async (req, res) => {
  const d = await visibleDocument(req.user!.id, z.coerce.number().int().parse(req.params.id));
  const f = await one<{ content: Buffer; file_name: string; file_mime: string }>(
    "SELECT f.content, d.file_name, d.file_mime FROM document_files f JOIN documents d ON d.id = f.document_id WHERE f.document_id = ?",
    [d.id],
  );
  if (!f) return res.status(404).json({ error: tr("Pas de fichier pour ce document") });
  res.set({
    "Content-Type": f.file_mime.startsWith("text/") ? `${f.file_mime}; charset=utf-8` : f.file_mime,
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.file_name)}`,
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    "X-Content-Type-Options": "nosniff",
  });
  res.send(f.content);
});

documentsApi.post("/documents", hourly(240), raw({ type: () => true, limit: MAX_DOC_SIZE }), async (req, res) => {
  const file = uploaded(req);
  res.json(await ingestUpload(req.user!.id, file, "appli", { accountsSql: userAccountsSql(req.user!.id), force: "document" }));
});

const docPatch = z.object({
  title: z.string().min(1).max(255).optional(),
  kind: z.enum(KINDS).optional(),
  domain: z.enum(DOMAINS).optional(),
  topic: z.enum(TOPICS).nullable().optional(),
  docDate: day.nullable().optional(),
  expiresAt: day.nullable().optional(),
  summary: z.string().max(4000).nullable().optional(),
  entityType: z.string().max(16).nullable().optional(),
  entityId: z.string().max(64).nullable().optional(),
  private: z.boolean().optional(),
});

documentsApi.patch("/documents/:id", async (req, res) => {
  await updateDocument(req.user!.id, z.coerce.number().int().parse(req.params.id), docPatch.parse(req.body));
  res.json({ ok: true });
});

documentsApi.delete("/documents/:id", async (req, res) => {
  await deleteDocument(req.user!.id, z.coerce.number().int().parse(req.params.id));
  res.json({ ok: true });
});

/* ---------- Échéancier ---------- */

documentsApi.get("/agenda", async (req, res) => {
  // `faits` (écran Échéancier) : joint les tâches cochées depuis moins de N jours, pour pouvoir les remettre à faire.
  const f = z.object({ from: day.optional(), to: day.optional(), done: z.enum(["0", "1"]).optional(), faits: z.coerce.number().int().min(1).max(365).optional() }).parse(req.query);
  const from = f.from ?? today();
  res.json({ from, to: f.to ?? plusDays(from, 365), entries: await agenda(req.user!.id, from, f.to ?? plusDays(from, 365), { includeDone: f.done === "1", recentDone: f.faits }) });
});

const task = z.object({
  kind: z.enum(["tache", "jalon"]).optional(),
  title: z.string().min(1).max(255),
  notes: z.string().max(4000).nullable().optional(),
  dueDate: day.nullable().optional(),
  domain: z.enum(DOMAINS).optional(),
  entityType: z.string().max(16).nullable().optional(),
  entityId: z.string().max(64).nullable().optional(),
  amount: z.number().nullable().optional(),
  recurrence: z.enum(["mensuel", "trimestriel", "annuel"]).nullable().optional(),
  private: z.boolean().optional(),
});

documentsApi.post("/agenda", async (req, res) => {
  res.json({ id: await createTask(req.user!.id, task.parse(req.body)) });
});

documentsApi.patch("/agenda/:id", async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  const b = task.partial().extend({ done: z.boolean().optional() }).parse(req.body);
  const { done, ...rest } = b;
  if (Object.keys(rest).length) await updateTask(req.user!.id, id, rest);
  const r = done === undefined ? {} : await setTaskDone(req.user!.id, id, done);
  res.json({ ok: true, ...r });
});

documentsApi.delete("/agenda/:id", async (req, res) => {
  await deleteTask(req.user!.id, z.coerce.number().int().parse(req.params.id));
  res.json({ ok: true });
});

/* ---------- Jetons personnels (Raccourci iPhone) ---------- */

documentsApi.get("/tokens", async (req, res) => {
  res.json({
    tokens: await q("SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND scope = 'depot' AND revoked_at IS NULL ORDER BY id", [req.user!.id]),
  });
});

documentsApi.post("/tokens", async (req, res) => {
  if (req.user!.via !== "session") throw new ActionError(403, tr("Jeton à créer depuis l'appli"));
  const { name } = z.object({ name: z.string().min(1).max(80) }).parse(req.body);
  const n = await one<{ n: number }>("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND scope = 'depot' AND revoked_at IS NULL", [req.user!.id]);
  if ((n?.n ?? 0) >= 5) throw new ActionError(400, tr("5 jetons au plus : révoquez-en un d'abord"));
  res.json({ token: await createDepotToken(req.user!.id, name) });
});

/** Lien d'abonnement iCal à l'échéancier : un seul actif par membre, montré une seule fois. */
documentsApi.get("/calendar-link", async (req, res) => {
  const t = await one<{ created_at: string; last_used_at: string | null }>(
    "SELECT created_at, last_used_at FROM api_tokens WHERE user_id = ? AND scope = 'ical' AND revoked_at IS NULL ORDER BY id DESC LIMIT 1",
    [req.user!.id],
  );
  res.json({ link: t ?? null });
});

documentsApi.post("/calendar-link", async (req, res) => {
  if (req.user!.via !== "session") throw new ActionError(403, tr("Lien à créer depuis l'appli"));
  await exec("UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND scope = 'ical' AND revoked_at IS NULL", [req.user!.id]);
  const token = await createCalendarToken(req.user!.id);
  const base = (env.APP_URL ?? `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
  res.json({ url: `${base}/ical/${token}.ics` });
});

documentsApi.delete("/calendar-link", async (req, res) => {
  await exec("UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND scope = 'ical' AND revoked_at IS NULL", [req.user!.id]);
  res.json({ ok: true });
});

documentsApi.delete("/tokens/:id", async (req, res) => {
  await exec("UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND scope = 'depot'", [z.coerce.number().int().parse(req.params.id), req.user!.id]);
  res.json({ ok: true });
});

/* ---------- Administration (jeton d'API) : reprise Notion ---------- */

export const documentsAdmin = Router();

/** Import d'un document (fichier en base64 ou texte Markdown), idempotent par sourceRef ou empreinte. */
documentsAdmin.post("/documents", async (req, res) => {
  const b = z
    .object({
      owner: z.string().min(1).max(80).nullable().optional(),
      title: z.string().min(1).max(255),
      kind: z.enum(KINDS).optional(),
      domain: z.enum(DOMAINS).optional(),
      entityType: z.string().max(16).nullable().optional(),
      entityId: z.string().max(64).nullable().optional(),
      docDate: day.nullable().optional(),
      expiresAt: day.nullable().optional(),
      summary: z.string().max(4000).nullable().optional(),
      facts: z.array(z.object({ label: z.string(), value: z.string() })).max(30).nullable().optional(),
      text: z.string().nullable().optional(),
      file: z.object({ name: z.string().min(1).max(255), mime: z.string().max(80), base64: z.string().min(1) }).nullable().optional(),
      source: z.string().max(16).default("notion"),
      sourceRef: z.string().max(191).nullable().optional(),
      /** Faire reconnaître le document par Claude (type, titre, dates, résumé, faits) ; ce qui est fourni l'emporte. */
      classify: z.boolean().optional(),
      /** Indice pour Claude (chemin du fichier dans le dossier d'origine). */
      hint: z.string().max(400).optional(),
    })
    .parse(req.body);
  const owner = b.owner ? await memberByName(b.owner) : undefined;
  const file = b.file ? { name: b.file.name, mime: b.file.mime, content: Buffer.from(b.file.base64, "base64") } : null;
  if (file && file.content.length > MAX_DOC_SIZE) throw new ActionError(413, "Fichier trop gros (20 Mo au plus)");
  let text = b.text ?? null;
  let pages: number | null = null;
  if (!text && file) {
    const x = await extractText(file.content, file.mime);
    text = x.text || null;
    pages = x.pages;
  }
  // Déjà au coffre (même fichier ou même clé) : on complète sans refaire lire le document par Claude.
  const known =
    (b.sourceRef && (await one("SELECT id FROM documents WHERE source_ref = ?", [b.sourceRef]))) ||
    (file && (await one("SELECT id FROM documents WHERE file_sha256 = ?", [createHash("sha256").update(file.content).digest("hex")])));
  const c =
    b.classify && file && !known
      ? await classifyDocument(file.content, file.mime, text ?? "", pages, b.hint ?? file.name).catch((e) => {
          console.error("[documents] reconnaissance impossible", e);
          return null;
        })
      : null;
  res.json({
    ...(await saveDocument({
      ownerUserId: owner?.id ?? null,
      title: c?.title ?? b.title,
      kind: b.kind ?? c?.kind,
      domain: b.domain ?? c?.domain,
      // La nature lue par l'IA fait foi ; sans lecture, elle se devine au titre et au résumé.
      topic: c ? c.topic : undefined,
      entityType: b.entityType,
      entityId: b.entityId,
      docDate: b.docDate ?? c?.doc_date,
      expiresAt: b.expiresAt ?? c?.expires_at,
      summary: b.summary ?? c?.summary,
      facts: b.facts ?? c?.facts,
      contentText: text ?? c?.transcription ?? null,
      file,
      source: b.source,
      sourceRef: b.sourceRef,
    })),
    classified: !!c,
    known: !!known,
  });
});

/** Import de tâches et jalons (idempotent par sourceRef). */
documentsAdmin.post("/agenda", async (req, res) => {
  const list = z.array(task.extend({ owner: z.string().min(1).max(80).nullable().optional(), sourceRef: z.string().max(191), status: z.enum(["a_faire", "fait"]).optional() })).max(500).parse(req.body);
  for (const t of list) {
    const owner = t.owner ? await memberByName(t.owner) : undefined;
    await createTask(owner?.id ?? null, { ...t, private: !!owner, source: "notion" });
  }
  res.json({ imported: list.length });
});
