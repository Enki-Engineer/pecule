import { describe, expect, it } from "vitest";
import { type WireParams, UNREADABLE_ARGS, WireError, buildReply, carried, carrier, emptyUsage, isStrictSchema, jsonText, roughInput, thinkSplitter, toolId, toolInput, unreadableArgs, usageFrom, withoutCarriers } from "./ai-wire.ts";
import { chatHeal, chatReader, chatRequest } from "./ai-wire-chat.ts";
import { ollamaHeal, ollamaNoTools, ollamaReader, ollamaRequest, ollamaTooLong } from "./ai-wire-ollama.ts";
import { responsesHeal, responsesReader, responsesRequest } from "./ai-wire-responses.ts";

/* Une conversation de l'assistant, au format de l'API Messages : question, appel d'outil, résultat, pièce jointe. */
const TOOLS = [{ name: "get_overview", description: "Vue d'ensemble du mois", input_schema: { type: "object", properties: { mois: { type: "string" } } } }];
const PDF = { type: "base64" as const, media_type: "application/pdf", data: "JVBERi0=" };
const PNG = { type: "base64" as const, media_type: "image/png", data: "iVBORw0=" };
const SCHEMA = { type: "object", properties: { marchand: { type: "string" }, total: { type: ["number", "null"] } }, required: ["marchand", "total"], additionalProperties: false };
const talk: WireParams = {
  model: "modele-essai",
  max_tokens: 32_000,
  system: [
    { type: "text", text: "Tu es l'assistant de Pécule.", cache_control: { type: "ephemeral" } },
    { type: "text", text: "Foyer : Alex et Camille, à Nantes." },
  ],
  tools: TOOLS,
  thinking: { type: "adaptive" },
  output_config: { effort: "medium" },
  messages: [
    { role: "user", content: "Où en est le mois ?" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "…", signature: "sig" },
        { type: "text", text: "Je regarde." },
        { type: "tool_use", id: "call_1", name: "get_overview", input: { mois: "2026-10" } },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_1", content: '{"depenses":2310.4}', cache_control: { type: "ephemeral" } },
        { type: "text", text: "Et cette facture ?" },
        { type: "image", source: PNG },
        { type: "document", source: PDF },
      ],
    },
  ],
};
const reading: WireParams = { model: "modele-essai", max_tokens: 4000, system: "Tu lis des factures.", output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } }, messages: [{ role: "user", content: "Lis ce ticket." }] };

describe("ce qui est commun aux traductions", () => {
  it("tire le JSON d'une réponse qu'un modèle a entourée", () => {
    expect(jsonText('{"a":1}')).toBe('{"a":1}');
    expect(jsonText('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(jsonText('Voici la fiche :\n{"a":{"b":2}}\nBonne journée.')).toBe('{"a":{"b":2}}');
    expect(jsonText("rien à lire")).toBe("rien à lire");
  });
  it("reconnaît un schéma qu'OpenAI peut imposer strictement", () => {
    expect(isStrictSchema(SCHEMA)).toBe(true);
    expect(isStrictSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } }, required: ["a"], additionalProperties: false })).toBe(false);
    expect(isStrictSchema({ type: "object", properties: { lignes: { type: "array", items: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } } }, required: ["lignes"], additionalProperties: false })).toBe(false);
  });
  it("lit les arguments d'un outil, écrits ou déjà lus, et rend un identifiant que toutes les API acceptent", () => {
    expect(toolInput('{"mois":"2026-10"}')).toEqual({ mois: "2026-10" });
    expect(toolInput({ mois: "2026-10" })).toEqual({ mois: "2026-10" });
    expect(toolInput("")).toEqual({});
    // Un JSON presque juste est repris : bloc de code autour, virgule en trop.
    expect(toolInput('```json\n{"mois":"2026-10"}\n```')).toEqual({ mois: "2026-10" });
    expect(toolInput('{"mois":"2026-10","comptes":[1,2,],}')).toEqual({ mois: "2026-10", comptes: [1, 2] });
    // Illisible : jamais un objet vide (l'outil répondrait sans ses filtres), mais un objet marqué.
    expect(toolInput('{"mois":')).toEqual({ [UNREADABLE_ARGS]: '{"mois":' });
    expect(unreadableArgs(toolInput("{'mois': '2026-10'}"))).toBe(true);
    expect(unreadableArgs(toolInput("[1]"))).toBe(true);
    expect(unreadableArgs(toolInput('{"mois":"2026-10"}'))).toBe(false);
    expect(unreadableArgs({})).toBe(false);
    expect(toolId("call_abc-1")).toBe("call_abc-1");
    expect(toolId("functions.get_overview:0")).toBe("functions_get_overview_0");
    expect(toolId(undefined)).toMatch(/^call_[a-z0-9]+$/);
    expect(toolId("")).not.toBe(toolId(""));
  });
  it("sépare la réflexion écrite dans le texte, même coupée entre deux morceaux", () => {
    const s = thinkSplitter();
    const events = [...s.push("<thi"), ...s.push("nk>je cherche</th"), ...s.push("ink>Bonjour "), ...s.push("Alex <"), ...s.flush()];
    expect(events).toEqual([{ thinking: "je cherche" }, { text: "Bonjour " }, { text: "Alex " }, { text: "<" }]);
  });
  it("une réponse coupée par son plafond ne rend pas ses appels d'outils, peut-être écrits à moitié", () => {
    const calls = [{ id: "call_1", name: "get_overview", input: { mois: "2026-10" } }];
    const keep = carrier("ollama", { thinking: "…" });
    expect(buildReply({ model: "m", text: "Je regarde.", calls, stop: "end_turn", usage: emptyUsage(), keep })).toMatchObject({ stop_reason: "tool_use", content: [{ type: "redacted_thinking" }, { type: "text" }, { type: "tool_use" }] });
    expect(buildReply({ model: "m", text: "Je regarde.", calls, stop: "max_tokens", usage: emptyUsage(), keep })).toMatchObject({ stop_reason: "max_tokens", content: [{ type: "text", text: "Je regarde." }] });
    expect(buildReply({ model: "m", text: "", calls, stop: "max_tokens", usage: emptyUsage(), keep }).content).toEqual([]);
  });
  it("compte l'entrée sans ce qui vient du cache", () => {
    expect(usageFrom(1000, 50, 800, 100)).toEqual({ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 100, cache_read_input_tokens: 800 });
    expect(usageFrom(undefined, undefined, undefined, undefined)).toEqual({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
    expect(roughInput(talk)).toBeGreaterThan(30);
  });
  it("un bloc opaque n'est relu que par son API, et ne part jamais chez Claude", () => {
    const block = carrier("responses", [{ type: "reasoning", id: "rs_1" }]);
    expect(carried(block, "responses")).toEqual([{ type: "reasoning", id: "rs_1" }]);
    expect(carried(block, "chat")).toBeNull();
    expect(carried({ type: "redacted_thinking", data: "celle de Claude" }, "responses")).toBeNull();
    const messages = [
      { role: "user", content: "Bonjour" },
      { role: "assistant", content: [block, { type: "text", text: "Bonjour Alex" }, { type: "redacted_thinking", data: "celle de Claude" }] },
      { role: "assistant", content: [block] },
    ];
    const clean = withoutCarriers(messages);
    expect(clean[1].content).toEqual([{ type: "text", text: "Bonjour Alex" }, { type: "redacted_thinking", data: "celle de Claude" }]);
    expect(clean[2].content).toEqual([{ type: "text", text: "…" }]);
    const same = [{ role: "user", content: "Bonjour" }];
    expect(withoutCarriers(same)).toBe(same);
  });
});

describe("Chat Completions", () => {
  it("écrit la conversation : consignes, appel d'outil, résultat dans son message, pièces jointes", () => {
    const body = chatRequest(talk, "generic") as { messages: Record<string, unknown>[]; tools: unknown[]; max_tokens: number; stream: boolean; stream_options: unknown; reasoning?: unknown; cache_control?: unknown };
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.max_tokens).toBe(32_000);
    expect(body.reasoning).toBeUndefined();
    expect(body.cache_control).toBeUndefined();
    expect(body.tools).toEqual([{ type: "function", function: { name: "get_overview", description: "Vue d'ensemble du mois", parameters: TOOLS[0].input_schema } }]);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(body.messages[0].content).toBe("Tu es l'assistant de Pécule.\n\nFoyer : Alex et Camille, à Nantes.");
    expect(body.messages[2]).toEqual({ role: "assistant", content: "Je regarde.", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_overview", arguments: '{"mois":"2026-10"}' } }] });
    expect(body.messages[3]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"depenses":2310.4}' });
    expect(body.messages[4].content).toEqual([
      { type: "text", text: "Et cette facture ?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0=" } },
      { type: "file", file: { filename: "document.pdf", file_data: "data:application/pdf;base64,JVBERi0=" } },
    ]);
  });
  it("avec OpenRouter : effort, points de cache, pas de réglage du décompte", () => {
    const body = chatRequest(talk, "openrouter") as { messages: { content: unknown }[]; reasoning: unknown; cache_control: unknown; stream_options?: unknown };
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.cache_control).toEqual({ type: "ephemeral" });
    expect(body.stream_options).toBeUndefined();
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Tu es l'assistant de Pécule.", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Foyer : Alex et Camille, à Nantes." },
    ]);
  });
  it("demande une réponse structurée, redit le schéma, et réserve assez de sortie", () => {
    const body = chatRequest(reading, "generic") as { messages: { content: string }[]; response_format: unknown; max_tokens: number };
    expect(body.response_format).toEqual({ type: "json_schema", json_schema: { name: "reponse", strict: true, schema: SCHEMA } });
    expect(body.messages[0].content).toContain("Tu lis des factures.");
    expect(body.messages[0].content).toContain(JSON.stringify(SCHEMA));
    expect(body.max_tokens).toBe(16_000);
  });
  it("retire ce qu'un service refuse, un réglage à la fois", () => {
    const sent = chatRequest(reading, "generic");
    expect(chatHeal("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", sent)).toBe("max");
    expect(chatHeal("Extra inputs are not permitted: stream_options", sent)).toBe("usage");
    expect(chatHeal("response_format.type must be json_object or text", sent)).toBe("schema");
    expect(chatHeal("model not found", sent)).toBeNull();
    // Un refus qui ne nomme pas le réglage ne fait rien retirer : une demande trop longue, un outil mal décrit.
    expect(chatHeal("This model's maximum context length is 8192 tokens. However, you requested 20000 tokens.", sent)).toBeNull();
    expect(chatHeal("Invalid schema for function 'get_overview'", sent)).toBeNull();
    expect(chatHeal("The reasoning model is overloaded", chatRequest(talk, "openrouter"))).toBeNull();
    const dropped = new Set(["max", "usage", "schema"] as const);
    const lighter = chatRequest(reading, "generic", dropped);
    expect(lighter).toMatchObject({ response_format: { type: "json_object" } });
    expect(lighter).not.toHaveProperty("max_tokens");
    expect(lighter).not.toHaveProperty("stream_options");
    expect(chatHeal("json_object is not supported", lighter)).toBe("format");
    expect(chatRequest(reading, "generic", new Set(["format"] as const))).not.toHaveProperty("response_format");
    expect(chatHeal("reasoning is not supported", chatRequest(talk, "openrouter"))).toBe("reasoning");
  });
  it("lit une réponse en flux : texte, appel d'outil reçu en morceaux, décompte en fin de flux", () => {
    const r = chatReader("modele-essai", { dialect: "generic", json: false });
    const events = [
      { id: "chatcmpl-1", choices: [{ delta: { role: "assistant", content: "" } }] },
      { choices: [{ delta: { content: "Je " } }] },
      { choices: [{ delta: { content: "regarde." } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_9", type: "function", function: { name: "get_overview", arguments: "" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"mois":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"2026-10"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
      { choices: [], usage: { prompt_tokens: 1200, completion_tokens: 30, prompt_tokens_details: { cached_tokens: 1000 } } },
    ].flatMap((e) => r.push(e));
    expect(events).toEqual([{ text: "Je " }, { text: "regarde." }]);
    expect(r.reply()).toMatchObject({
      id: "chatcmpl-1",
      role: "assistant",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Je regarde." },
        { type: "tool_use", id: "call_9", name: "get_overview", input: { mois: "2026-10" } },
      ],
      usage: { input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 1000 },
    });
  });
  it("garde deux appels rendus d'un bloc sous le même rang, et lit une réponse rendue sans flux", () => {
    const r = chatReader("modele-essai", { dialect: "generic", json: false });
    r.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "get_overview", arguments: '{"mois":"2026-09"}' } }] } }] });
    r.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "b", function: { name: "get_overview", arguments: { mois: "2026-10" } } }] } }] });
    expect(r.reply().content.map((b) => (b.type === "tool_use" ? b.input : null))).toEqual([{ mois: "2026-09" }, { mois: "2026-10" }]);
    const whole = chatReader("modele-essai", { dialect: "generic", json: true });
    whole.push({ choices: [{ message: { role: "assistant", content: '```json\n{"marchand":"Boulangerie","total":3.6}\n```' }, finish_reason: "stop" }], usage: { prompt_tokens: 40, completion_tokens: 12 } });
    expect(whole.reply()).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: '{"marchand":"Boulangerie","total":3.6}' }], usage: { input_tokens: 40, output_tokens: 12 } });
  });
  it("met à part la réflexion, qu'elle arrive dans son champ ou dans le texte, et dit une réponse coupée", () => {
    const r = chatReader("modele-essai", { dialect: "generic", json: false });
    const events = [{ choices: [{ delta: { reasoning_content: "voyons" } }] }, { choices: [{ delta: { content: "<think>encore</think>Voilà" } }] }, { choices: [{ delta: {}, finish_reason: "length" }] }].flatMap((e) => r.push(e));
    expect(events).toEqual([{ thinking: "voyons" }, { thinking: "encore" }, { text: "Voilà" }]);
    expect(r.reply()).toMatchObject({ stop_reason: "max_tokens", content: [{ type: "text", text: "Voilà" }] });
  });
  it("avec OpenRouter : compte le coût rendu, et garde le raisonnement à rendre avec un appel d'outil", () => {
    const r = chatReader("fournisseur/modele", { dialect: "openrouter", json: false });
    r.push({ choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "Il faut ", format: "anthropic-claude-v1", index: 0 }] } }] });
    r.push({ choices: [{ delta: { reasoning_details: [{ type: "reasoning.text", text: "le mois.", signature: "sig", format: "anthropic-claude-v1", index: 0 }] } }] });
    r.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "get_overview", arguments: "{}" } }] }, finish_reason: "tool_calls" }] });
    r.push({ choices: [], usage: { prompt_tokens: 500, completion_tokens: 20, cost: 0.00123, prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 400 } } });
    const reply = r.reply();
    expect(reply.usage).toMatchObject({ input_tokens: 100, cache_creation_input_tokens: 400, cost_usd: 0.00123 });
    expect(carried(reply.content[0] as never, "chat")).toEqual([{ type: "reasoning.text", text: "Il faut le mois.", signature: "sig", format: "anthropic-claude-v1", index: 0 }]);
    // Au tour suivant, le raisonnement repart tel quel avec l'appel.
    const next = chatRequest({ ...talk, messages: [{ role: "user", content: "Où en est le mois ?" }, { role: "assistant", content: reply.content as never }] }, "openrouter") as { messages: Record<string, unknown>[] };
    expect(next.messages[2].reasoning_details).toEqual([{ type: "reasoning.text", text: "Il faut le mois.", signature: "sig", format: "anthropic-claude-v1", index: 0 }]);
    expect(chatRequest({ ...talk, messages: [{ role: "assistant", content: reply.content as never }] }, "generic").messages).not.toEqual(expect.arrayContaining([expect.objectContaining({ reasoning_details: expect.anything() })]));
  });
  it("lève l'erreur annoncée au milieu d'une réponse", () => {
    const r = chatReader("modele-essai", { dialect: "openrouter", json: false });
    expect(() => r.push({ error: { code: 502, message: "Provider returned error" } })).toThrowError(WireError);
    try {
      r.push({ choices: [{ error: { code: 429, message: "Rate limited" } }] });
    } catch (e) {
      expect((e as WireError).status).toBe(429);
    }
  });
});

describe("API Responses d'OpenAI", () => {
  it("écrit la conversation en éléments : appel d'outil, résultat, pièces jointes, sans rien garder chez OpenAI", () => {
    const body = responsesRequest(talk) as { input: Record<string, unknown>[]; instructions: string; store: boolean; include: string[]; tools: unknown[]; reasoning: unknown; max_output_tokens: number };
    expect(body.store).toBe(false);
    expect(body.include).toEqual(["reasoning.encrypted_content"]);
    expect(body.instructions).toBe("Tu es l'assistant de Pécule.\n\nFoyer : Alex et Camille, à Nantes.");
    expect(body.reasoning).toEqual({ effort: "medium" });
    expect(body.max_output_tokens).toBe(32_000);
    expect(body.tools).toEqual([{ type: "function", name: "get_overview", description: "Vue d'ensemble du mois", parameters: TOOLS[0].input_schema, strict: false }]);
    expect(body.input).toEqual([
      { role: "user", content: "Où en est le mois ?" },
      { role: "assistant", content: "Je regarde." },
      { type: "function_call", call_id: "call_1", name: "get_overview", arguments: '{"mois":"2026-10"}' },
      { type: "function_call_output", call_id: "call_1", output: '{"depenses":2310.4}' },
      {
        role: "user",
        content: [
          { type: "input_text", text: "Et cette facture ?" },
          { type: "input_image", image_url: "data:image/png;base64,iVBORw0=", detail: "auto" },
          { type: "input_file", filename: "document.pdf", file_data: "data:application/pdf;base64,JVBERi0=" },
        ],
      },
    ]);
  });
  it("demande une réponse structurée stricte, et réserve de quoi raisonner", () => {
    const body = responsesRequest(reading) as { text: unknown; max_output_tokens: number; reasoning: unknown };
    expect(body.text).toEqual({ format: { type: "json_schema", name: "reponse", schema: SCHEMA, strict: true } });
    expect(body.max_output_tokens).toBe(25_000);
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(responsesHeal("Unsupported parameter: 'reasoning.effort' is not supported with this model.", body as never)).toBe("reasoning");
    expect(responsesHeal("Invalid schema for response_format 'reponse'", body as never)).toBe("strict");
    expect(responsesRequest(reading, new Set(["reasoning", "strict"] as const))).toMatchObject({ text: { format: { strict: false } } });
    expect(responsesRequest(reading, new Set(["reasoning"] as const))).not.toHaveProperty("reasoning");
    expect(responsesHeal("The model `gpt-inconnu` does not exist", body as never)).toBeNull();
    expect(responsesHeal("Invalid schema for function 'get_overview': strict mode", body as never)).toBeNull();
  });
  it("lit une réponse en flux et rend au tour suivant ce que le modèle a raisonné", () => {
    const reasoning = { id: "rs_1", type: "reasoning", summary: [], encrypted_content: "gAAAA…" };
    const call = { id: "fc_1", type: "function_call", call_id: "call_7", name: "get_overview", arguments: '{"mois":"2026-10"}', status: "completed" };
    const message = { id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Je regarde.", annotations: [], logprobs: [] }] };
    const r = responsesReader("gpt-essai", { json: false });
    const events = [
      { type: "response.created", response: { id: "resp_1", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 0, item: { id: "rs_1", type: "reasoning", summary: [] } },
      { type: "response.output_item.done", output_index: 0, item: reasoning },
      { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "Je " },
      { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "regarde." },
      { type: "response.output_item.done", output_index: 1, item: message },
      { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"mois":' },
      { type: "response.output_item.done", output_index: 2, item: call },
      { type: "response.completed", response: { id: "resp_1", status: "completed", output: [reasoning, message, call], usage: { input_tokens: 2000, output_tokens: 120, input_tokens_details: { cached_tokens: 1500, cache_write_tokens: 300 }, output_tokens_details: { reasoning_tokens: 64 } } } },
    ].flatMap((e) => r.push(e));
    expect(events).toEqual([{ thinking: "" }, { text: "Je " }, { text: "regarde." }]);
    const reply = r.reply();
    expect(reply).toMatchObject({ id: "resp_1", stop_reason: "tool_use", usage: { input_tokens: 200, output_tokens: 120, cache_read_input_tokens: 1500, cache_creation_input_tokens: 300 } });
    expect(reply.content.slice(1)).toEqual([
      { type: "text", text: "Je regarde.", citations: null },
      { type: "tool_use", id: "call_7", name: "get_overview", input: { mois: "2026-10" } },
    ]);
    const turn = [{ role: "user" as const, content: "Où en est le mois ?" }, { role: "assistant" as const, content: reply.content as never }, { role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: "call_7", content: "{}" }] }];
    // Un autre modèle ne saurait pas relire ce raisonnement chiffré : le tour lui est récrit d'après son texte.
    expect((responsesRequest({ ...talk, messages: turn }) as { input: Record<string, unknown>[] }).input.map((i) => i.type ?? i.role)).toEqual(["user", "assistant", "function_call", "function_call_output"]);
    const next = responsesRequest({ ...talk, model: "gpt-essai", messages: turn }) as { input: Record<string, unknown>[] };
    expect(next.input).toEqual([
      { role: "user", content: "Où en est le mois ?" },
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA…" },
      { type: "message", id: "msg_1", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Je regarde.", annotations: [] }] },
      { type: "function_call", id: "fc_1", call_id: "call_7", name: "get_overview", arguments: '{"mois":"2026-10"}' },
      { type: "function_call_output", call_id: "call_7", output: "{}" },
    ]);
  });
  it("sans raisonnement, rien n'est gardé ; une réponse coupée, refusée ou en échec se dit", () => {
    const plain = responsesReader("gpt-essai", { json: true });
    plain.push({ type: "response.completed", response: { id: "resp_2", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"marchand":"Boulangerie","total":3.6}' }] }], usage: { input_tokens: 80, output_tokens: 20 } } });
    expect(plain.reply().content).toEqual([{ type: "text", text: '{"marchand":"Boulangerie","total":3.6}', citations: null }]);
    // Un raisonnement rendu sans son contenu chiffré ne se rejoue pas : rien n'est gardé.
    const bare = responsesReader("gpt-essai", { json: false });
    bare.push({ type: "response.completed", response: { status: "completed", output: [{ type: "reasoning", id: "rs_9", summary: [] }, { type: "function_call", call_id: "call_9", name: "get_overview", arguments: "{}" }] } });
    expect(bare.reply().content).toEqual([{ type: "tool_use", id: "call_9", name: "get_overview", input: {} }]);
    const cut = responsesReader("gpt-essai", { json: false });
    expect(cut.state()).toBe("vide");
    cut.push({ type: "response.output_text.delta", delta: "Début" });
    expect(cut.state()).toBe("coupee");
    expect(cut.reply()).toMatchObject({ stop_reason: "end_turn", content: [{ type: "text", text: "Début" }] });
    cut.push({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [], usage: { input_tokens: 10, output_tokens: 25000 } } });
    expect(cut.reply().stop_reason).toBe("max_tokens");
    expect(cut.state()).toBe("finie");
    const refused = responsesReader("gpt-essai", { json: false });
    refused.push({ object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Je ne peux pas." }] }] });
    expect(refused.reply().stop_reason).toBe("refusal");
    const failed = responsesReader("gpt-essai", { json: false });
    expect(() => failed.push({ type: "response.failed", response: { error: { code: "rate_limit_exceeded", message: "Trop de demandes" } } })).toThrowError("Trop de demandes");
    expect(() => failed.push({ type: "error", code: "server_error", message: "Panne" })).toThrowError("Panne");
  });
});

describe("API d'Ollama", () => {
  it("écrit la conversation : fenêtre de contexte, refus de couper, images à part, nom de l'outil avec son résultat", () => {
    const body = ollamaRequest(talk, { context: 32_768 }) as { messages: Record<string, unknown>[]; options: unknown; truncate: boolean; tools: unknown[]; think?: unknown; format?: unknown };
    expect(body.options).toEqual({ num_ctx: 32_768, num_predict: 32_000 });
    expect(body.truncate).toBe(false);
    expect(body.think).toBeUndefined();
    expect(body.format).toBeUndefined();
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(body.messages[2]).toEqual({ role: "assistant", content: "Je regarde.", tool_calls: [{ id: "call_1", type: "function", function: { index: 0, name: "get_overview", arguments: { mois: "2026-10" } } }] });
    expect(body.messages[3]).toEqual({ role: "tool", content: '{"depenses":2310.4}', tool_name: "get_overview", tool_call_id: "call_1" });
    expect(body.messages[4]).toEqual({ role: "user", content: "Et cette facture ?", images: ["iVBORw0="] });
  });
  it("impose le schéma d'une lecture, sans réflexion", () => {
    const body = ollamaRequest(reading, { context: null }) as { format: unknown; think: unknown; options: unknown; messages: { content: string }[] };
    expect(body.format).toEqual(SCHEMA);
    expect(body.think).toBe(false);
    expect(body.options).toEqual({ num_predict: 4000 });
    expect(body.messages[0].content).toContain(JSON.stringify(SCHEMA));
    expect(ollamaRequest(reading, { context: null }, new Set(["think"] as const))).not.toHaveProperty("think");
  });
  it("reconnaît les refus d'Ollama, tels qu'il les écrit", () => {
    const sent = ollamaRequest(reading, { context: 4096 });
    expect(ollamaHeal('registry.ollama.ai/library/modele:4b does not support thinking', sent)).toBe("think");
    expect(ollamaHeal("model 'modele:4b' not found", sent)).toBeNull();
    // Le nom d'un modèle peut contenir « think », un message quelconque « format » : rien n'est retiré pour si peu.
    expect(ollamaHeal("model 'deepthink:8b' not found", sent)).toBeNull();
    expect(ollamaHeal("invalid format: unexpected end of JSON input", sent)).toBeNull();
    // Un modèle en ligne d'Ollama ne prend pas le schéma imposé : il reste redit dans les consignes.
    expect(ollamaHeal("structured outputs are not supported for this model", sent)).toBe("format");
    const loose = ollamaRequest(reading, { context: 4096 }, new Set(["format"] as const)) as { messages: { content: string }[] };
    expect(loose).not.toHaveProperty("format");
    expect(loose.messages[0].content).toContain(JSON.stringify(SCHEMA));
    expect(ollamaNoTools("registry.ollama.ai/library/modele:4b does not support tools")).toBe(true);
    expect(ollamaTooLong("request (6014 tokens) exceeds the available context size (4096 tokens), try increasing it")).toBe(true);
    expect(ollamaTooLong("model 'modele:4b' not found")).toBe(false);
  });
  it("lit une réponse en flux : réflexion, appels d'outils entiers, décompte du dernier morceau", () => {
    const r = ollamaReader("modele:4b", { json: false });
    const events = [
      { message: { role: "assistant", content: "", thinking: "Il faut " }, done: false },
      { message: { role: "assistant", content: "", thinking: "le mois." }, done: false },
      { message: { role: "assistant", content: "", tool_calls: [{ id: "call_a1", function: { index: 0, name: "get_overview", arguments: { mois: "2026-10" } } }] }, done: false },
      { message: { role: "assistant", content: "", tool_calls: [{ function: { index: 1, name: "get_overview", arguments: { mois: "2026-09" } } }] }, done: false },
      { message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 153, eval_count: 718 },
    ].flatMap((e) => r.push(e));
    expect(events).toEqual([{ thinking: "Il faut " }, { thinking: "le mois." }]);
    const reply = r.reply();
    expect(reply).toMatchObject({ stop_reason: "tool_use", usage: { input_tokens: 153, output_tokens: 718 } });
    expect(carried(reply.content[0] as never, "ollama")).toEqual({ thinking: "Il faut le mois." });
    expect(reply.content[1]).toEqual({ type: "tool_use", id: "call_a1", name: "get_overview", input: { mois: "2026-10" } });
    expect(reply.content[2]).toMatchObject({ type: "tool_use", name: "get_overview", input: { mois: "2026-09" } });
    const next = ollamaRequest({ ...talk, messages: [{ role: "assistant", content: reply.content as never }] }, { context: 8192 }) as { messages: Record<string, unknown>[] };
    expect(next.messages[1].thinking).toBe("Il faut le mois.");
  });
  it("dit une réponse coupée, et lève l'erreur annoncée au milieu du flux", () => {
    const r = ollamaReader("modele:4b", { json: true });
    r.push({ message: { content: '{"marchand":"Boulangerie",' }, done: false });
    r.push({ message: { content: '"total":3.6}' }, done: true, done_reason: "length", prompt_eval_count: 30, eval_count: 24 });
    expect(r.reply()).toMatchObject({ stop_reason: "max_tokens", content: [{ type: "text", text: '{"marchand":"Boulangerie","total":3.6}' }] });
    expect(r.state()).toBe("finie");
    expect(() => ollamaReader("modele:4b", { json: false }).push({ error: "an error was encountered while running the model" })).toThrowError(WireError);
    // Une page web, ou un flux qui s'arrête sans son dernier morceau, ne sont pas des réponses.
    const other = ollamaReader("modele:4b", { json: false });
    other.push({ status: "ok" });
    expect(other.state()).toBe("vide");
    other.push({ message: { content: "Bonj" }, done: false });
    expect(other.state()).toBe("coupee");
    const chat = chatReader("modele-essai", { dialect: "generic", json: false });
    chat.push({ status: "ok" });
    expect(chat.state()).toBe("vide");
    chat.push({ choices: [{ delta: { content: "Bonjour" } }] });
    expect(chat.state()).toBe("finie");
  });
});
