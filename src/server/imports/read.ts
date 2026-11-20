import type Anthropic from "@anthropic-ai/sdk";
import { aiClient, aiModel, recordUsage } from "../ai.ts";
import { householdSummary } from "../household.ts";
import type { Confidence } from "../../lib/imports.ts";
import { splitPdf, type PdfPart } from "../documents.ts";
import type { Ctx, Extractor, Reading } from "./registry.ts";

/*
 * Lecture d'un document entier par l'IA, pour un extracteur : texte complet quand le fichier en a un, sinon le
 * PDF ou l'image lui-même. Sortie JSON structurée au schéma de l'extracteur, complété de deux champs communs :
 * la confiance de la lecture et ses doutes. Les consignes sont mises en cache (un lot = le même type lu en série),
 * le document aussi (une longue liste se lit en plusieurs demandes, un relevé de plusieurs comptes en plusieurs lectures).
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
export function documentBlock(doc: Source, pdfUpTo = 12): Anthropic.DocumentBlockParam | Anthropic.ImageBlockParam | Anthropic.TextBlockParam | null {
  const pdf = !!doc.content && doc.mime === "application/pdf";
  if (pdf && (doc.pages ?? 1) <= pdfUpTo && doc.content!.length <= 8 * 1024 * 1024) return { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.content!.toString("base64") } };
  if (doc.text.trim().length >= 200) return { type: "text", text: `Texte du document${doc.pages ? ` (${doc.pages} pages)` : ""} :\n\n${doc.text.slice(0, MAX_TEXT)}` };
  if (!doc.content || !doc.mime) return null;
  if (doc.mime === "application/pdf" && (doc.pages ?? 1) <= MAX_PDF_PAGES) return { type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.content.toString("base64") } };
  if (READABLE_IMAGES.has(doc.mime)) return { type: "image", source: { type: "base64", media_type: doc.mime as "image/jpeg", data: doc.content.toString("base64") } };
  return doc.text.trim() ? { type: "text", text: doc.text.slice(0, MAX_TEXT) } : null;
}

/** Réponses demandées au plus pour une liste longue (un relevé de plusieurs milliers d'opérations s'arrête là). */
const MAX_REPLIES = 16;
/** Une réponse qui n'arrive pas au bout dans ce délai est abandonnée (le flux, lui, n'est pas coupé par le délai du client). */
const REPLY_TIMEOUT_MS = 12 * 60_000;

const more = (perReply: number) =>
  `La liste des lignes peut être longue : rends-en au plus ${perReply} par réponse, dans l'ordre du document, sans en sauter ni en répéter. « suite » : true s'il reste des lignes à recopier après celles de cette réponse (on te demandera les suivantes), false quand la dernière ligne du document est rendue.`;

const ORDER: Confidence[] = ["basse", "moyenne", "haute"];
const lowest = (a: Confidence, b: Confidence) => (ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b);

/** Pages par tranche d'un long PDF, et nombre de tranches lues au plus (au-delà : le texte du document). */
const SEGMENT_PAGES = 25;
const MAX_SEGMENTS = 16;

/**
 * Lit le document avec l'extracteur. null si le fichier ne peut pas être montré à l'IA ou si la réponse est
 * inexploitable. Un PDF trop long pour être montré d'une pièce, quand l'extracteur y lit une liste (`rows` : les
 * opérations d'un relevé), est découpé en tranches de pages lues l'une après l'autre — plutôt que de se rabattre
 * sur son texte, où les colonnes d'un tableau se mêlent.
 */
export async function readDocument(x: Extractor, doc: Source, ctx: Ctx): Promise<Reading | null> {
  if (x.rows && doc.content && doc.mime === "application/pdf" && (doc.pages ?? 0) > (x.pdfUpTo ?? 12)) {
    const parts = await splitPdf(doc.content, SEGMENT_PAGES).catch((e) => {
      console.error("[import] découpe du PDF impossible", e instanceof Error ? e.message : e);
      return null;
    });
    if (parts && parts.length > 1 && parts.length <= MAX_SEGMENTS) return readSegments(x, doc, ctx, parts);
  }
  const block = documentBlock(doc, x.pdfUpTo);
  return block ? readBlock(x, block, doc.title, ctx) : null;
}

/** Réunit ce qu'une tranche apporte à ce que les précédentes ont lu (la liste, elle, est mise bout à bout à part). */
export function mergeSegment(before: Record<string, unknown>, next: Record<string, unknown>, rows: { key: string; atEnd?: string[] }): Record<string, unknown> {
  const out = { ...before };
  for (const [key, value] of Object.entries(next)) {
    if (key === rows.key) continue;
    const had = before[key];
    if (Array.isArray(value)) {
      // Autres listes (les autres comptes d'un relevé) : réunies, sans doublon.
      const seen = new Set((Array.isArray(had) ? had : []).map((v) => JSON.stringify(v)));
      out[key] = [...(Array.isArray(had) ? had : []), ...value.filter((v) => !seen.has(JSON.stringify(v)))];
    } else if (typeof value === "boolean" || typeof had === "boolean") out[key] = !!had || !!value;
    // Ce qui est imprimé à la fin du document (solde d'arrivée, totaux) : la dernière tranche qui le porte fait foi.
    else if (rows.atEnd?.includes(key)) out[key] = value ?? had ?? null;
    else out[key] = had ?? value ?? null;
  }
  return out;
}

async function readSegments(x: Extractor, doc: Source, ctx: Ctx, parts: PdfPart[]): Promise<Reading | null> {
  const rows = x.rows!;
  let data: Record<string, unknown> | null = null;
  let list: unknown[] = [];
  let confidence: Confidence = "haute";
  const doubts: string[] = [];
  // La première tranche dit quel objet est lu (le compte d'un relevé) : les suivantes lisent le même.
  let focus = ctx.part ?? null;
  for (const part of parts) {
    const block = { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: part.content.toString("base64") } };
    const r = await readBlock(x, block, doc.title, { ...ctx, part: focus, segment: { from: part.from, to: part.to, pages: doc.pages ?? parts.at(-1)!.to } });
    if (!r) return null;
    confidence = lowest(confidence, r.confidence);
    for (const d of r.doubts) if (!doubts.includes(d)) doubts.push(d);
    list = [...list, ...(Array.isArray(r.data[rows.key]) ? (r.data[rows.key] as unknown[]) : [])];
    data = data ? mergeSegment(data, r.data, rows) : r.data;
    focus ??= rows.focus?.(r.data) ?? null;
  }
  const parsed = x.parse.safeParse({ ...data, [rows.key]: list });
  return parsed.success ? { data: parsed.data, confidence, doubts: doubts.slice(0, 8) } : null;
}

/**
 * Lit ce qui est montré (un document entier, ou une tranche). La réponse arrive en flux : une longue liste n'est pas
 * coupée par le délai d'une demande. Une liste déclarée par l'extracteur (`rows`) est lue en plusieurs réponses, le
 * document restant en cache d'une demande à l'autre.
 */
async function readBlock(x: Extractor, block: NonNullable<ReturnType<typeof documentBlock>>, title: string, ctx: Ctx): Promise<Reading | null> {
  const rows = x.rows;
  const schema = {
    type: "object",
    properties: {
      ...x.schema.properties,
      ...(rows ? { suite: { type: "boolean", description: "true s'il reste des lignes à recopier après celles de cette réponse" } } : {}),
      confiance: { type: "string", enum: ["haute", "moyenne", "basse"] },
      doutes: { type: "array", items: { type: "string" } },
    },
    required: [...x.schema.required, ...(rows ? ["suite"] : []), "confiance", "doutes"],
    additionalProperties: false,
  };
  const extract = ctx.segment
    ? `Ce fichier est un extrait : les pages ${ctx.segment.from} à ${ctx.segment.to} d'un document de ${ctx.segment.pages} pages, lu en plusieurs fois. Ne rends que ce qui est imprimé sur ces pages : ce qui n'y figure pas (un solde de début ou de fin de période, un total) vaut null, et une liste sans ligne sur ces pages est vide. C'est attendu : ni un doute, ni une raison de baisser la confiance.`
    : "";
  const context = [await householdSummary(ctx.userId).catch(() => ""), x.context ? await x.context(ctx) : "", extract].filter(Boolean).join("\n");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: [{ ...block, cache_control: { type: "ephemeral" } }, { type: "text", text: `${context ? `${context}\n\n` : ""}Lis ce document. Fichier : ${ctx.relPath} · titre : ${title}` }] }];
  let data: Record<string, unknown> | null = null;
  let list: unknown[] = [];
  let confidence: Confidence = "haute";
  const doubts: string[] = [];
  for (let reply = 0; ; reply++) {
    const response = await aiClient()
      .messages.stream(
        {
          model: aiModel(),
          max_tokens: x.maxTokens ?? 4000,
          system: [{ type: "text", text: `${BASE}\n\n${x.instructions}${rows ? `\n\n${more(rows.perReply)}` : ""}`, cache_control: { type: "ephemeral" } }],
          output_config: { effort: "low", format: { type: "json_schema", schema } },
          messages,
        },
        { signal: AbortSignal.timeout(REPLY_TIMEOUT_MS) },
      )
      .finalMessage();
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
    const { confiance, doutes, suite, ...rest } = raw;
    confidence = lowest(confidence, confiance === "haute" || confiance === "moyenne" ? confiance : "basse");
    for (const d of Array.isArray(doutes) ? doutes : []) if (typeof d === "string" && !doubts.includes(d)) doubts.push(d);
    // L'en-tête (compte, période, soldes) est celui de la première réponse ; les suivantes n'apportent que des lignes.
    data ??= rest;
    if (!rows) break;
    const part = Array.isArray(rest[rows.key]) ? (rest[rows.key] as unknown[]) : [];
    list = reply === 0 ? part : [...list, ...part];
    if (suite !== true || !part.length) break;
    if (reply + 1 >= MAX_REPLIES) {
      // Liste plus longue que ce qui est lu d'un fichier : dit, et la lecture n'est pas donnée pour sûre.
      confidence = "basse";
      doubts.unshift(`La liste est trop longue pour être lue en entier : les ${list.length} premières lignes seulement.`);
      break;
    }
    messages.push({ role: "assistant", content: out }, { role: "user", content: `Continue : les lignes qui suivent la dernière que tu viens de rendre (${JSON.stringify(part.at(-1))}), au même format. Les autres champs : comme dans ta première réponse.` });
  }
  if (rows) data = { ...data, [rows.key]: list };
  const parsed = x.parse.safeParse(data);
  if (!parsed.success) return null;
  return { data: parsed.data, confidence, doubts: doubts.slice(0, 8) };
}
