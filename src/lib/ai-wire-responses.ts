/*
 * API « Responses » d'OpenAI. Pur : la demande à envoyer, et le lecteur de la réponse en flux.
 *
 * C'est elle, et non « Chat Completions », que Pécule parle à OpenAI : ses modèles actuels n'acceptent les appels
 * d'outils que par elle. Rien n'est gardé chez OpenAI (`store: false`) : la conversation repart en entier à chaque
 * tour, avec le raisonnement chiffré que le modèle a rendu et qu'il demande de lui redonner tel quel entre un appel
 * d'outil et son résultat (`carrier`).
 */

import {
  type WireBlock,
  type WireEvent,
  type WireParams,
  type WireReader,
  type WireStop,
  WireError,
  blocksOf,
  buildReply,
  carried,
  carrier,
  dataUrl,
  effortOf,
  emptyUsage,
  isStrictSchema,
  resultText,
  schemaOf,
  systemText,
  toolId,
  toolInput,
  usageFrom,
} from "./ai-wire.ts";

/** Ce qui a été retiré d'une demande parce que le modèle l'a refusé : l'effort, le plafond, le schéma strict, le raisonnement chiffré. */
export type ResponsesDrop = "reasoning" | "max" | "strict" | "include";

/**
 * Sortie réservée au moins : le plafond compte aussi le raisonnement, et OpenAI conseille d'en réserver 25 000 jetons
 * — en dessous, une lecture de facture peut revenir vide, tout son plafond passé à réfléchir.
 */
const MIN_OUTPUT = 25_000;

type Item = Record<string, unknown> & { type?: string };

function userParts(blocks: WireBlock[]): Item[] {
  const parts: Item[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) parts.push({ type: "input_text", text: b.text });
    else if (b.type === "image") parts.push({ type: "input_image", image_url: dataUrl(b.source), detail: "auto" });
    else if (b.type === "document") parts.push({ type: "input_file", filename: b.title || "document.pdf", file_data: dataUrl(b.source) });
  }
  return parts;
}

/** La demande à envoyer à « …/responses », toujours en flux. */
export function responsesRequest(params: WireParams, dropped: ReadonlySet<ResponsesDrop> = new Set()): Record<string, unknown> {
  const input: Item[] = [];
  for (const m of params.messages) {
    const blocks = blocksOf(m.content);
    if (m.role === "assistant") {
      // Ce qu'OpenAI avait rendu à ce tour (raisonnement, texte, appels d'outils) repart tel quel, dans son ordre —
      // au modèle qui l'avait écrit : un autre ne saurait pas relire ce raisonnement chiffré.
      const kept = blocks.map((b) => carried<{ model?: string; items?: Item[] }>(b, "responses")).find((k) => k && Array.isArray(k.items));
      if (kept?.items && kept.model === params.model) {
        input.push(...kept.items);
        continue;
      }
      const text = blocks.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
      if (text) input.push({ role: "assistant", content: text });
      for (const b of blocks) if (b.type === "tool_use") input.push({ type: "function_call", call_id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) });
      continue;
    }
    for (const b of blocks) if (b.type === "tool_result") input.push({ type: "function_call_output", call_id: b.tool_use_id, output: resultText(b.content) || "(vide)" });
    const parts = userParts(blocks);
    if (parts.length) input.push({ role: "user", content: parts.every((p) => p.type === "input_text") ? parts.map((p) => p.text as string).join("\n\n") : parts });
  }

  const body: Record<string, unknown> = { model: params.model, input, stream: true, store: false };
  if (!dropped.has("include")) body.include = ["reasoning.encrypted_content"];
  const system = systemText(params.system);
  if (system) body.instructions = system;
  if (!dropped.has("max")) body.max_output_tokens = Math.max(params.max_tokens, MIN_OUTPUT);
  // Schéma des outils donné sans mode strict : leurs paramètres facultatifs ne le permettent pas.
  if (params.tools?.length) body.tools = params.tools.map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: t.input_schema, strict: false }));
  const effort = effortOf(params);
  if (effort && !dropped.has("reasoning")) body.reasoning = { effort };
  const schema = schemaOf(params);
  if (schema) body.text = { format: { type: "json_schema", name: "reponse", schema, strict: !dropped.has("strict") && isStrictSchema(schema) } };
  return body;
}

/** Ce qu'il faut retirer d'une demande refusée (réponse 400), d'après le message d'OpenAI ; null si rien de facultatif n'est en cause. */
export function responsesHeal(message: string, sent: Record<string, unknown>): ResponsesDrop | null {
  const m = message.toLowerCase();
  if (sent.reasoning && /reasoning\.effort|reasoning_effort|'reasoning'|reasoning is not supported|does not support reasoning/.test(m)) return "reasoning";
  if (sent.include && /encrypted_content|'include'|include\[/.test(m)) return "include";
  if (sent.max_output_tokens && /max_output_tokens/.test(m)) return "max";
  // Le refus doit porter sur le format de la réponse, pas sur le schéma d'un outil.
  if ((sent.text as { format?: { strict?: boolean } } | undefined)?.format?.strict && /text\.format|response_format/.test(m)) return "strict";
  return null;
}

type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null };
type Response = { id?: string; status?: string; output?: Item[]; usage?: Usage | null; error?: { message?: string; code?: string } | null; incomplete_details?: { reason?: string } | null };
type Event = { type?: string; delta?: unknown; item?: Item; output_index?: number; response?: Response; message?: string; code?: string | null; object?: string } & Response;

/** Ce qui est gardé d'un élément rendu, pour le redonner au tour suivant : rien de ce que seul l'affichage lit. */
function keepItem(item: Item): Item | null {
  if (item.type === "reasoning") return { type: "reasoning", id: item.id, summary: item.summary ?? [], ...(item.content ? { content: item.content } : {}), ...(item.encrypted_content ? { encrypted_content: item.encrypted_content } : {}) };
  if (item.type === "function_call") return { type: "function_call", ...(item.id ? { id: item.id } : {}), call_id: item.call_id, name: item.name, arguments: item.arguments };
  if (item.type === "message") {
    const content = (Array.isArray(item.content) ? (item.content as Item[]) : []).map((c) => (c.type === "output_text" ? { type: "output_text", text: c.text, annotations: [] } : c));
    return { type: "message", ...(item.id ? { id: item.id } : {}), role: "assistant", status: "completed", content, ...(item.phase ? { phase: item.phase } : {}) };
  }
  return null;
}

const FAILED: Record<string, number> = { rate_limit_exceeded: 429, server_error: 500 };

/** Lecteur d'une réponse en flux (un événement par ligne « data: ») ; lit aussi une réponse rendue d'un bloc. */
export function responsesReader(model: string, opts: { json: boolean }): WireReader {
  let streamed = "";
  let seen = false;
  let final: Response | null = null;
  const items = new Map<number, Item>();

  return {
    push(raw) {
      const e = raw as Event;
      const out: WireEvent[] = [];
      if (!e || typeof e !== "object") return out;
      if ((typeof e.type === "string" && e.type.startsWith("response.")) || e.object === "response") seen = true;
      switch (e.type) {
        case "error":
          throw new WireError(e.message ?? "erreur du fournisseur", e.code ? (FAILED[e.code] ?? null) : null);
        case "response.failed": {
          const err = e.response?.error;
          throw new WireError(err?.message ?? "la réponse a échoué", err?.code ? (FAILED[err.code] ?? 500) : 500);
        }
        case "response.output_item.added":
          if (e.item?.type === "reasoning") out.push({ thinking: "" });
          break;
        case "response.reasoning_summary_text.delta":
        case "response.reasoning_text.delta":
          if (typeof e.delta === "string" && e.delta) out.push({ thinking: e.delta });
          break;
        case "response.output_text.delta":
          if (typeof e.delta === "string" && e.delta) {
            streamed += e.delta;
            out.push({ text: e.delta });
          }
          break;
        case "response.output_item.done":
          if (e.item) items.set(e.output_index ?? items.size, e.item);
          break;
        case "response.completed":
        case "response.incomplete":
          final = e.response ?? null;
          break;
        default:
          // Réponse rendue d'un bloc (un service qui n'a pas ouvert de flux).
          if (e.object === "response") final = e;
      }
      return out;
    },
    reply() {
      const output = final?.output?.length ? final.output : [...items.entries()].sort((a, b) => a[0] - b[0]).map(([, item]) => item);
      const texts: string[] = [];
      let refused = false;
      for (const item of output) {
        if (item.type !== "message") continue;
        for (const c of Array.isArray(item.content) ? (item.content as Item[]) : []) {
          if (c.type === "output_text" && typeof c.text === "string") texts.push(c.text);
          else if (c.type === "refusal") refused = true;
        }
      }
      // Tant que la réponse n'est pas finie, le texte est celui reçu au fil de l'eau.
      const text = texts.length ? texts.join("\n") : streamed;
      const calls = output.filter((i) => i.type === "function_call" && typeof i.name === "string").map((i) => ({ id: toolId(i.call_id), name: i.name as string, input: toolInput(i.arguments) }));
      const reason = final?.incomplete_details?.reason;
      const stop: WireStop = reason === "max_output_tokens" ? "max_tokens" : reason === "content_filter" || (refused && !text.trim()) ? "refusal" : "end_turn";
      const u = final?.usage;
      // Un identifiant d'appel qu'il a fallu réécrire ne correspondrait plus à celui de l'élément gardé : rien n'est alors rendu tel quel.
      const sameIds = output.every((i) => i.type !== "function_call" || calls.some((c) => c.id === i.call_id));
      const kept = sameIds ? output.map(keepItem).filter((i): i is Item => i !== null) : [];
      // Un raisonnement rendu sans son contenu chiffré ne pourrait pas être relu : rien n'est alors gardé, le tour se récrira d'après son texte.
      const replayable = kept.some((i) => i.type === "reasoning") && kept.every((i) => i.type !== "reasoning" || typeof i.encrypted_content === "string");
      return buildReply({
        model,
        id: final?.id,
        text,
        calls,
        stop,
        usage: u ? usageFrom(u.input_tokens, u.output_tokens, u.input_tokens_details?.cached_tokens, u.input_tokens_details?.cache_write_tokens) : emptyUsage(),
        // Seul un tour où le modèle a raisonné doit lui être rendu tel quel ; les autres se réécrivent d'après leur texte.
        keep: replayable ? carrier("responses", { model, items: kept }) : null,
        json: opts.json,
      });
    },
    state: () => (final ? "finie" : seen ? "coupee" : "vide"),
  };
}
