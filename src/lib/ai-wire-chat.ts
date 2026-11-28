/*
 * API « Chat Completions » : celle d'OpenRouter et de presque tous les services qui se disent « compatibles OpenAI »
 * (LM Studio, Mistral, Groq, vLLM, llama.cpp…). Pur : la demande à envoyer, et le lecteur de la réponse en flux.
 *
 * Deux façons de la parler (`dialect`) :
 * - « openrouter » : ce qu'OpenRouter ajoute et documente — un PDF joint tel quel (il le fait lire au modèle, ou le
 *   convertit), l'effort de raisonnement, le raisonnement à lui rendre au tour suivant (`reasoning_details`), les
 *   points de cache de Claude, le coût exact de chaque appel (`usage.cost`) ;
 * - « generic » : le plus petit dénominateur commun. Rien que ce que tout serveur comprend ; un service strict
 *   refuse un champ qu'il ne connaît pas.
 * Ce qu'un service refuse quand même se retire à la volée (`CHAT_HEALS`, appliqué par `src/server/ai-wires.ts`).
 */

import {
  type ReplyParts,
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
  schemaPrompt,
  systemText,
  thinkSplitter,
  toolId,
  toolInput,
  usageFrom,
} from "./ai-wire.ts";

export type ChatDialect = "openrouter" | "generic";

/**
 * Ce qui a été retiré d'une demande parce que le service l'a refusé : le plafond de la réponse (« max »), le décompte
 * en fin de flux (« usage »), l'effort (« reasoning »), le schéma imposé (« schema », puis tout format : « format »),
 * les points de cache (« cache »).
 */
export type ChatDrop = "max" | "usage" | "reasoning" | "schema" | "format" | "cache";

/** Sortie réservée au moins : un modèle qui raisonne compte sa réflexion dans ce plafond, et rendrait sinon une réponse vide. */
const MIN_OUTPUT = 16_000;

type Part = { type: "text"; text: string; cache_control?: unknown } | { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { filename: string; file_data: string } };
type ChatMessage =
  | { role: "system" | "user"; content: string | Part[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; reasoning_details?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Les parties d'un message du membre ; un seul texte quand il n'y a que du texte (ce que tout serveur comprend). */
function userContent(blocks: WireBlock[], cache: boolean): string | Part[] | null {
  const parts: Part[] = [];
  for (const b of blocks) {
    if (b.type === "text" && b.text) parts.push({ type: "text", text: b.text, ...(cache && b.cache_control ? { cache_control: b.cache_control } : {}) });
    else if (b.type === "image") parts.push({ type: "image_url", image_url: { url: dataUrl(b.source) } });
    else if (b.type === "document") parts.push({ type: "file", file: { filename: b.title || "document.pdf", file_data: dataUrl(b.source) } });
  }
  if (!parts.length) return null;
  return parts.every((p) => p.type === "text" && !p.cache_control) ? parts.map((p) => (p as { text: string }).text).join("\n\n") : parts;
}

/** La demande à envoyer à « …/chat/completions », toujours en flux. */
export function chatRequest(params: WireParams, dialect: ChatDialect, dropped: ReadonlySet<ChatDrop> = new Set()): Record<string, unknown> {
  const or = dialect === "openrouter";
  const cache = or && !dropped.has("cache");
  const schema = schemaOf(params);
  const messages: ChatMessage[] = [];

  // Consignes : avec OpenRouter, les blocs gardent leur point de cache (lu par Claude et Gemini, ignoré des autres).
  const system = params.system;
  // Le schéma est toujours redit dans les consignes : tous les modèles ne suivent pas celui du réglage.
  const extra = schema ? schemaPrompt(schema) : "";
  if (cache && Array.isArray(system) && system.some((b) => b.cache_control)) {
    messages.push({ role: "system", content: [...system.map((b): Part => ({ type: "text", text: b.text, ...(b.cache_control ? { cache_control: b.cache_control } : {}) })), ...(extra ? [{ type: "text", text: extra } as Part] : [])] });
  } else {
    const text = [systemText(system), extra].filter(Boolean).join("\n\n");
    if (text) messages.push({ role: "system", content: text });
  }

  for (const m of params.messages) {
    const blocks = blocksOf(m.content);
    if (m.role === "assistant") {
      const text = blocks.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join("\n");
      const calls = blocks.flatMap((b) => (b.type === "tool_use" ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }] : []));
      const details = or ? blocks.map((b) => carried<unknown[]>(b, "chat")).find((d) => Array.isArray(d)) : null;
      if (!text && !calls.length) continue;
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}), ...(details ? { reasoning_details: details } : {}) });
      continue;
    }
    // Les résultats d'outils d'abord, chacun dans son message, puis ce que le membre a écrit ou joint.
    for (const b of blocks) if (b.type === "tool_result") messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: resultText(b.content) || "(vide)" });
    const content = userContent(blocks, cache);
    if (content) messages.push({ role: "user", content });
  }

  const body: Record<string, unknown> = { model: params.model, messages, stream: true };
  if (!dropped.has("max")) body.max_tokens = Math.max(params.max_tokens, MIN_OUTPUT);
  if (!or && !dropped.has("usage")) body.stream_options = { include_usage: true };
  if (params.tools?.length) body.tools = params.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } }));
  if (schema && !dropped.has("format")) {
    body.response_format = dropped.has("schema") ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "reponse", strict: isStrictSchema(schema), schema } };
  }
  const effort = effortOf(params);
  if (or && effort && !dropped.has("reasoning")) body.reasoning = { effort };
  // Cache tenu de lui-même par OpenRouter sur la conversation qui s'allonge, pour les fournisseurs qui le demandent.
  if (cache && params.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => "cache_control" in b && b.cache_control))) body.cache_control = { type: "ephemeral" };
  return body;
}

/**
 * Ce qu'il faut retirer d'une demande refusée (réponse 400 ou 422), d'après le message du service ; null si le refus
 * ne porte sur rien de facultatif. `sent` : la demande refusée — on ne retire que ce qu'elle contenait.
 */
export function chatHeal(message: string, sent: Record<string, unknown>): ChatDrop | null {
  const m = message.toLowerCase();
  // Le refus doit nommer le réglage : un message qui parle seulement de « tokens » ou de « schema » (une demande trop
  // longue, un outil mal décrit) ne fait rien retirer.
  if (sent.stream_options && /stream_options|include_usage/.test(m)) return "usage";
  if (sent.reasoning && /\breasoning\b/.test(m) && /unsupported|not supported|unknown|unrecognized|extra|invalid|not permitted|unexpected/.test(m)) return "reasoning";
  if (sent.cache_control && /cache_control/.test(m)) return "cache";
  if (sent.response_format && /response_format|json_schema|json_object|structured output/.test(m)) return (sent.response_format as { type?: string }).type === "json_schema" ? "schema" : "format";
  if (sent.max_tokens && /max_tokens|max_completion_tokens/.test(m)) return "max";
  return null;
}

type Delta = {
  content?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  reasoning_details?: unknown;
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: unknown } }[];
};
type Chunk = {
  id?: string;
  error?: { message?: string; code?: unknown } | string;
  choices?: { delta?: Delta; message?: Delta; finish_reason?: string | null; error?: { message?: string; code?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: unknown; prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null } | null;
};

type Detail = Record<string, unknown> & { type?: string; index?: number };
/** Réunit les morceaux d'un raisonnement rendu en flux : même rang et même genre, les textes se suivent. */
function mergeDetails(all: Detail[], more: unknown): void {
  if (!Array.isArray(more)) return;
  for (const d of more as Detail[]) {
    if (!d || typeof d !== "object") continue;
    const last = all.at(-1);
    if (last && last.type === d.type && (last.index ?? 0) === (d.index ?? 0)) {
      for (const [k, v] of Object.entries(d)) {
        if ((k === "text" || k === "summary" || k === "data") && typeof v === "string") last[k] = (typeof last[k] === "string" ? (last[k] as string) : "") + v;
        else if (v != null) last[k] = v;
      }
    } else all.push({ ...d });
  }
}

const STOPS: Record<string, WireStop> = { length: "max_tokens", content_filter: "refusal" };

/** Lecteur d'une réponse en flux (un objet par ligne « data: ») ; lit aussi une réponse rendue d'un bloc. */
export function chatReader(model: string, opts: { dialect: ChatDialect; json: boolean }): WireReader {
  const split = thinkSplitter();
  let text = "";
  let id = "";
  let finish = "";
  let seen = false;
  let usage = emptyUsage();
  const calls: { id: string; name: string; args: string }[] = [];
  const byIndex = new Map<number, number>();
  const details: Detail[] = [];

  const fail = (e: { message?: string; code?: unknown } | string): never => {
    const message = typeof e === "string" ? e : (e.message ?? "erreur du fournisseur");
    const code = typeof e === "string" ? null : typeof e.code === "number" ? e.code : null;
    throw new WireError(message, code);
  };

  return {
    push(raw) {
      const chunk = raw as Chunk;
      const out: WireEvent[] = [];
      if (!chunk || typeof chunk !== "object") return out;
      if (chunk.error) fail(chunk.error);
      if (chunk.id) id = chunk.id;
      if (chunk.usage) {
        const u = chunk.usage;
        usage = usageFrom(u.prompt_tokens, u.completion_tokens, u.prompt_tokens_details?.cached_tokens, u.prompt_tokens_details?.cache_write_tokens);
        // OpenRouter rend le coût de l'appel, en dollars : c'est lui qui est compté, pas une estimation.
        if (opts.dialect === "openrouter" && typeof u.cost === "number" && Number.isFinite(u.cost) && u.cost >= 0) usage.cost_usd = u.cost;
      }
      if (Array.isArray(chunk.choices) || chunk.usage) seen = true;
      const choice = chunk.choices?.[0];
      if (!choice) return out;
      if (choice.error) fail(choice.error);
      const d = choice.delta ?? choice.message;
      if (d) {
        const thought = typeof d.reasoning === "string" ? d.reasoning : typeof d.reasoning_content === "string" ? d.reasoning_content : "";
        if (thought) out.push({ thinking: thought });
        mergeDetails(details, d.reasoning_details);
        if (Array.isArray(d.reasoning_details) && d.reasoning_details.length && !thought) out.push({ thinking: "" });
        if (typeof d.content === "string" && d.content) {
          for (const e of split.push(d.content)) {
            if ("text" in e) text += e.text;
            out.push(e);
          }
        }
        for (const c of d.tool_calls ?? []) {
          // Un appel arrive en morceaux, rangés par leur rang. Sans rang (un serveur qui rend l'appel d'un bloc), un
          // identifiant ou un nom ouvre un nouvel appel ; un même rang repris avec un autre identifiant aussi.
          let at: number;
          if (typeof c.index === "number") {
            const known = byIndex.get(c.index);
            at = known === undefined || (c.id && calls[known].id && calls[known].id !== c.id) ? calls.length : known;
            byIndex.set(c.index, at);
          } else if (c.id && calls.some((k) => k.id === c.id)) at = calls.findIndex((k) => k.id === c.id);
          else at = c.id || c.function?.name || !calls.length ? calls.length : calls.length - 1;
          const call = (calls[at] ??= { id: "", name: "", args: "" });
          if (c.id) call.id = c.id;
          if (c.function?.name) call.name = c.function.name;
          const a = c.function?.arguments;
          if (typeof a === "string") call.args += a;
          else if (a && typeof a === "object") call.args = JSON.stringify(a);
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
      return out;
    },
    reply() {
      for (const e of split.flush()) if ("text" in e) text += e.text;
      const parts: ReplyParts = {
        model,
        id,
        text,
        calls: calls.filter((c) => c.name).map((c) => ({ id: toolId(c.id), name: c.name, input: toolInput(c.args) })),
        stop: STOPS[finish] ?? "end_turn",
        usage,
        // Le raisonnement n'est rendu au fournisseur qu'entre un appel d'outil et son résultat : c'est là qu'il le demande.
        keep: opts.dialect === "openrouter" && details.length && calls.some((c) => c.name) ? carrier("chat", details) : null,
        json: opts.json,
      };
      return buildReply(parts);
    },
    // Tous les services ne marquent pas la fin de leur réponse : une réponse commencée est tenue pour finie.
    state: () => (seen ? "finie" : "vide"),
  };
}
