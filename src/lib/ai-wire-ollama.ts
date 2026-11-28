/*
 * API d'Ollama (« /api/chat »). Pur : la demande à envoyer, et le lecteur de la réponse en flux.
 *
 * Pécule parle à Ollama par son API à lui plutôt que par sa façade « compatible OpenAI » : c'est la seule où la
 * fenêtre de contexte se règle à chaque demande (`num_ctx`). Sans cela, Ollama n'en donne que 4 000 jetons sur une
 * machine modeste — bien moins que les consignes et les outils de l'assistant, qu'il couperait sans rien dire.
 * `truncate: false` : une demande qui ne tient pas dans la fenêtre est refusée, et Pécule le dit, plutôt que
 * raccourcie en silence.
 */

import {
  type ReplyParts,
  type WireEvent,
  type WireParams,
  type WireReader,
  WireError,
  blocksOf,
  buildReply,
  carried,
  carrier,
  emptyUsage,
  resultText,
  schemaOf,
  schemaPrompt,
  systemText,
  toolId,
  toolInput,
  usageFrom,
} from "./ai-wire.ts";

/**
 * Ce qui a été retiré d'une demande parce que le modèle l'a refusé : le réglage de la réflexion, le refus de couper,
 * le schéma imposé (les modèles en ligne d'Ollama ne le prennent pas : il reste redit dans les consignes).
 */
export type OllamaDrop = "think" | "truncate" | "format";

type Call = { id?: string; type?: "function"; function: { index?: number; name: string; arguments: Record<string, unknown> } };
type Message = { role: "system" | "user" | "assistant" | "tool"; content: string; images?: string[]; thinking?: string; tool_calls?: Call[]; tool_name?: string; tool_call_id?: string };

/** La demande à envoyer à « …/api/chat », toujours en flux. `context` : la fenêtre de contexte, en jetons. */
export function ollamaRequest(params: WireParams, opts: { context: number | null }, dropped: ReadonlySet<OllamaDrop> = new Set()): Record<string, unknown> {
  const schema = schemaOf(params);
  const messages: Message[] = [];
  // Le schéma est redit dans les consignes, comme Ollama le conseille, en plus d'être imposé par « format ».
  const system = [systemText(params.system), schema ? schemaPrompt(schema) : ""].filter(Boolean).join("\n\n");
  if (system) messages.push({ role: "system", content: system });
  /** Nom de l'outil de chaque appel : Ollama le demande avec le résultat. */
  const names = new Map<string, string>();

  for (const m of params.messages) {
    const blocks = blocksOf(m.content);
    if (m.role === "assistant") {
      const text = blocks.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
      const calls: Call[] = [];
      for (const b of blocks) {
        if (b.type !== "tool_use") continue;
        names.set(b.id, b.name);
        calls.push({ id: b.id, type: "function", function: { index: calls.length, name: b.name, arguments: toolInput(b.input) } });
      }
      const thinking = blocks.map((b) => carried<{ thinking?: string }>(b, "ollama")?.thinking).find((t) => typeof t === "string");
      if (!text && !calls.length) continue;
      messages.push({ role: "assistant", content: text, ...(thinking ? { thinking } : {}), ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const b of blocks) {
      if (b.type === "tool_result") messages.push({ role: "tool", content: resultText(b.content) || "(vide)", tool_name: names.get(b.tool_use_id) ?? "", tool_call_id: b.tool_use_id });
    }
    const text = blocks.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n\n");
    const images = blocks.flatMap((b) => (b.type === "image" ? [b.source.data] : []));
    if (text || images.length) messages.push({ role: "user", content: text, ...(images.length ? { images } : {}) });
  }

  const body: Record<string, unknown> = {
    model: params.model,
    messages,
    stream: true,
    options: { ...(opts.context ? { num_ctx: opts.context } : {}), num_predict: params.max_tokens },
  };
  if (!dropped.has("truncate")) body.truncate = false;
  if (params.tools?.length) body.tools = params.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));
  if (schema) {
    if (!dropped.has("format")) body.format = schema;
    // Une lecture de document n'a pas besoin de réflexion : sur une machine modeste, elle doublerait l'attente.
    if (!dropped.has("think")) body.think = false;
  }
  return body;
}

/** Ce qu'il faut retirer d'une demande refusée, d'après le message d'Ollama ; null si rien de facultatif n'est en cause. */
export function ollamaHeal(message: string, sent: Record<string, unknown>): OllamaDrop | null {
  const m = message.toLowerCase();
  // Le refus doit porter sur le réglage lui-même : le nom d'un modèle peut contenir « think », un message « format ».
  if ("think" in sent && /does not support thinking|think(ing)? (is |value )?(not supported|unsupported|invalid)|invalid think/.test(m)) return "think";
  if ("truncate" in sent && /truncate/.test(m) && /unknown|invalid|unsupported|cannot unmarshal/.test(m)) return "truncate";
  if ("format" in sent && /structured outputs?/.test(m) && /not support|unsupported|unavailable/.test(m)) return "format";
  return null;
}

/** Ollama refuse la demande parce que le modèle ne sait pas appeler d'outils. */
export const ollamaNoTools = (message: string) => /does not support tools/i.test(message);
/** Ollama refuse la demande parce qu'elle ne tient pas dans la fenêtre de contexte. */
export const ollamaTooLong = (message: string) => /context (length|window|size)|exceeds? .*context|too long|prompt is too/i.test(message);

type Chunk = {
  error?: string;
  message?: { content?: string; thinking?: string; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  prompt_eval_cached_count?: number;
  eval_count?: number;
};

/** Lecteur d'une réponse en flux (un objet JSON par ligne) ; lit aussi une réponse rendue d'un bloc. */
export function ollamaReader(model: string, opts: { json: boolean }): WireReader {
  let text = "";
  let thinking = "";
  let reason = "";
  let seen = false;
  let done = false;
  let usage = emptyUsage();
  const calls: ReplyParts["calls"] = [];

  return {
    push(raw) {
      const chunk = raw as Chunk;
      const out: WireEvent[] = [];
      if (!chunk || typeof chunk !== "object") return out;
      if (typeof chunk.error === "string") throw new WireError(chunk.error);
      const m = chunk.message;
      if (m && typeof m === "object") seen = true;
      if (m?.thinking) {
        thinking += m.thinking;
        out.push({ thinking: m.thinking });
      }
      if (m?.content) {
        text += m.content;
        out.push({ text: m.content });
      }
      // Un appel d'outil arrive entier, arguments déjà lus.
      for (const c of m?.tool_calls ?? []) if (c.function?.name) calls.push({ id: toolId(c.id), name: c.function.name, input: toolInput(c.function.arguments) });
      if (chunk.done) {
        seen = true;
        done = true;
        reason = chunk.done_reason ?? "";
        // Le décompte d'Ollama ne distingue pas ce qui a été relu de son cache : tout compte en entrée (et rien ne coûte).
        usage = usageFrom(chunk.prompt_eval_count, chunk.eval_count, 0, 0);
      }
      return out;
    },
    reply() {
      return buildReply({
        model,
        text,
        calls,
        stop: reason === "length" ? "max_tokens" : "end_turn",
        usage,
        // La réflexion n'est rendue au modèle qu'entre un appel d'outil et son résultat.
        keep: thinking && calls.length ? carrier("ollama", { thinking }) : null,
        json: opts.json,
      });
    },
    state: () => (done ? "finie" : seen ? "coupee" : "vide"),
  };
}
