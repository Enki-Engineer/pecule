import type Anthropic from "@anthropic-ai/sdk";
import { aiClient, aiModel, recordUsage } from "../ai.ts";
import { householdSummary } from "../household.ts";
import type { Confidence } from "../../lib/imports.ts";
import type { Ctx, Extractor, Reading } from "./registry.ts";

/*
 * Lecture d'un document entier par l'IA, pour un extracteur : texte complet quand le fichier en a un, sinon le
 * PDF ou l'image lui-même. Sortie JSON structurée au schéma de l'extracteur, complété de deux champs communs :
 * la confiance de la lecture et ses doutes. Les consignes sont mises en cache (un lot = le même type lu en série).
 */

const READABLE_IMAGES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_PDF_PAGES = 40;
const MAX_TEXT = 180_000;

const BASE = `Tu lis des documents administratifs et financiers d'un foyer pour en extraire des données exactes, qui seront relues puis enregistrées.
Règles :
- Recopie fidèlement les montants (tels qu'ils sont écrits, dans la devise du document, point décimal, sans séparateur de milliers) et les dates (AAAA-MM-JJ). N'invente rien, ne calcule rien qui ne soit pas écrit : null quand une information est absente ou illisible.
- Ne recopie jamais d'IBAN, de numéro de compte complet, de numéro de Sécurité sociale ni d'identifiant fiscal.
- « confiance » : elle porte sur les valeurs rendues, pas sur la difficulté de la lecture. « haute » si chaque valeur rendue est écrite telle quelle dans le document (une valeur absente rendue null ne baisse pas la confiance) ; « moyenne » si une valeur importante a dû être déduite ou choisie entre plusieurs ; « basse » si le document est partiel, illisible par endroits ou d'un autre type que prévu.
- « doutes » : une phrase courte par point incertain (liste vide si aucun).`;

export type Source = { content: Buffer | null; mime: string | null; text: string; pages: number | null; title: string };

/**
 * Ce qui est montré à l'IA. Un PDF court est lu tel quel, mise en page comprise : le texte extrait d'un tableau
 * (bulletin, avis, échéancier) mélange souvent ses colonnes. Un long document passe par son texte, moins coûteux.
 */
export function documentBlock(doc: Source, pdfUpTo = 12): Anthropic.ContentBlockParam | null {
  const pdf = !!doc.content && doc.mime === "application/pdf";
  if (pdf && (doc.pages ?? 1) <= pdfUpTo && doc.content!.length <= 8 * 1024 * 1024) return { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.content!.toString("base64") } };
  if (doc.text.trim().length >= 200) return { type: "text", text: `Texte du document${doc.pages ? ` (${doc.pages} pages)` : ""} :\n\n${doc.text.slice(0, MAX_TEXT)}` };
  if (!doc.content || !doc.mime) return null;
  if (doc.mime === "application/pdf" && (doc.pages ?? 1) <= MAX_PDF_PAGES) return { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.content.toString("base64") } };
  if (READABLE_IMAGES.has(doc.mime)) return { type: "image", source: { type: "base64", media_type: doc.mime as "image/jpeg", data: doc.content.toString("base64") } };
  return doc.text.trim() ? { type: "text", text: doc.text.slice(0, MAX_TEXT) } : null;
}

/** Lit le document avec l'extracteur. null si le fichier ne peut pas être montré à l'IA ou si la réponse est inexploitable. */
export async function readDocument(x: Extractor, doc: Source, ctx: Ctx): Promise<Reading | null> {
  const block = documentBlock(doc, x.pdfUpTo);
  if (!block) return null;
  const schema = {
    type: "object",
    properties: {
      ...x.schema.properties,
      confiance: { type: "string", enum: ["haute", "moyenne", "basse"] },
      doutes: { type: "array", items: { type: "string" } },
    },
    required: [...x.schema.required, "confiance", "doutes"],
    additionalProperties: false,
  };
  const context = [await householdSummary(ctx.userId).catch(() => ""), x.context ? await x.context(ctx) : ""].filter(Boolean).join("\n");
  const response = await aiClient().messages.create({
    model: aiModel(),
    max_tokens: x.maxTokens ?? 4000,
    system: [{ type: "text", text: `${BASE}\n\n${x.instructions}`, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: [block, { type: "text", text: `${context ? `${context}\n\n` : ""}Lis ce document. Fichier : ${ctx.relPath} · titre : ${doc.title}` }] }],
  });
  await recordUsage(`import : ${x.id}`, aiModel(), response.usage);
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const out = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!out) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(out) as Record<string, unknown>;
  } catch {
    return null;
  }
  const { confiance, doutes, ...rest } = raw;
  const parsed = x.parse.safeParse(rest);
  if (!parsed.success) return null;
  const confidence: Confidence = confiance === "haute" || confiance === "moyenne" ? confiance : "basse";
  return { data: parsed.data, confidence, doubts: Array.isArray(doutes) ? doutes.filter((d): d is string => typeof d === "string").slice(0, 8) : [] };
}
