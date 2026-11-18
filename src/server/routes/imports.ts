import { raw, Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ActionError } from "../actions.ts";
import { readVaultDocument, batchReport, batchView, cancelBatch, createBatch, discardItem, editItem, itemView, listBatches, receiveFile, retryItem, revertItem, setCostCap, validateItem, validateSafe } from "../imports/batches.ts";
import { MAX_BATCH_FILES, MAX_FILE_SIZE } from "../../lib/imports.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Import massif de documents, sous /api/imports (interdit en démo). Un lot appartient au membre qui l'a ouvert.
 * Déroulé : annoncer les fichiers (POST /imports) → envoyer ceux qui sont demandés (POST …/items/:id/file) →
 * suivre la lecture (GET /imports/:id) → relire, corriger, valider ou écarter chaque fichier.
 */
export const importsApi = Router();

const id = (value: unknown) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new ActionError(400, t("Identifiant invalide"));
  return n;
};
const source = (via: string | undefined) => (via === "mcp" ? "mcp" : via === "api" ? "cli" : "ecran");

const uploads = rateLimit({ windowMs: 3600_000, limit: 3000, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req) => String(req.user?.id ?? "anonyme"), message: () => ({ error: t("Trop de fichiers envoyés cette heure-ci.") }) });

const value = z.union([z.string().max(500), z.number(), z.null()]);
const values = z.record(z.string().max(60), value);
/** Correction d'une ligne d'un fichier (une opération d'un relevé) : la changer, la retirer, en ajouter une. */
const rowEdit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), index: z.number().int().min(0), values }),
  z.object({ op: z.literal("remove"), index: z.number().int().min(0) }),
  z.object({ op: z.literal("add"), index: z.number().int().min(0).optional(), values }),
]);

importsApi.get("/imports", async (req, res) => {
  res.json({ batches: await listBatches(req.user!.id) });
});

importsApi.post("/imports", async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().max(160).default(""),
      costCapEur: z.number().min(0).max(200).optional(),
      files: z.array(z.object({ path: z.string().min(1).max(1000), size: z.number().int().min(0), sha256: z.string().max(64).nullable().optional() })).min(1).max(MAX_BATCH_FILES),
    })
    .parse(req.body);
  res.json(await createBatch(req.user!.id, { ...body, source: source(req.user!.via) }));
});

/** Lire un document déjà au coffre avec l'extracteur de son type (bouton « Extraire les données » de sa fiche). */
importsApi.post("/imports/from-document", async (req, res) => {
  const { documentId } = z.object({ documentId: z.number().int().positive() }).parse(req.body);
  res.json(await readVaultDocument(req.user!.id, documentId));
});

importsApi.get("/imports/:id", async (req, res) => {
  res.json(await batchView(req.user!.id, id(req.params.id)));
});

importsApi.patch("/imports/:id", async (req, res) => {
  const { costCapEur } = z.object({ costCapEur: z.number().min(0).max(200) }).parse(req.body);
  res.json(await setCostCap(req.user!.id, id(req.params.id), costCapEur));
});

importsApi.delete("/imports/:id", async (req, res) => {
  res.json(await cancelBatch(req.user!.id, id(req.params.id)));
});

importsApi.post("/imports/:id/validate-safe", async (req, res) => {
  res.json({ ...(await validateSafe(req.user!.id, id(req.params.id))), batch: await batchView(req.user!.id, id(req.params.id)) });
});

importsApi.get("/imports/:id/report", async (req, res) => {
  res.type("text/plain; charset=utf-8").set("Content-Disposition", `attachment; filename="pecule-import-${id(req.params.id)}.txt"`).send(await batchReport(req.user!.id, id(req.params.id)));
});

importsApi.post("/imports/items/:item/file", uploads, raw({ type: () => true, limit: MAX_FILE_SIZE }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ActionError(400, t("Fichier vide"));
  res.json(await receiveFile(req.user!.id, id(req.params.item), req.body));
});

importsApi.get("/imports/items/:item", async (req, res) => {
  res.json(await itemView(req.user!.id, id(req.params.item)));
});

importsApi.patch("/imports/items/:item", async (req, res) => {
  const { edits, rows } = z.object({ edits: z.record(z.string().max(60), value).default({}), rows: z.array(rowEdit).max(200).default([]) }).parse(req.body);
  res.json(await editItem(req.user!.id, id(req.params.item), edits, rows));
});

importsApi.post("/imports/items/:item/:action", async (req, res) => {
  const item = id(req.params.item);
  const action = z.enum(["validate", "revert", "discard", "retry"]).parse(req.params.action);
  const run = { validate: validateItem, revert: revertItem, discard: discardItem, retry: retryItem }[action];
  res.json(await run(req.user!.id, item));
});
