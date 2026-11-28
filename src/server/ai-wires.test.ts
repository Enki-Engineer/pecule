import http from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAiConfig, type AiProvider } from "../lib/ai-providers.ts";
import { HttpRefused, destination } from "./ai-http.ts";
import { AiNotice, listModels, wireClient, type WireTiming } from "./ai-wires.ts";

/*
 * Le client des fournisseurs traduits, contre de faux serveurs qui répondent aux formes de leurs documentations
 * (flux « data: » de Chat Completions et de l'API Responses, lignes JSON d'Ollama). Aucun vrai service n'est appelé.
 */

type Seen = { url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> };
type Answer = (req: Seen, n: number) => { status?: number; type?: string; body: string } | "pendu";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise((done) => {
          s.closeAllConnections();
          s.close(done);
        }),
    ),
  );
});

/** Un faux fournisseur : rend ce que dit `answer` et garde ce qu'il a reçu. */
async function fake(answer: Answer): Promise<{ base: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const got = { url: req.url ?? "", headers: req.headers, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
      seen.push(got);
      const a = answer(got, seen.length);
      if (a === "pendu") return;
      res.writeHead(a.status ?? 200, { "Content-Type": a.type ?? "application/json" });
      res.end(a.body);
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const sse = (events: unknown[], done = true) => ({ type: "text/event-stream", body: `: en-tête ignoré\n\n${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}${done ? "data: [DONE]\n\n" : ""}` });
const ndjson = (lines: unknown[]) => ({ type: "application/x-ndjson", body: lines.map((l) => `${JSON.stringify(l)}\n`).join("") });
const QUICK: WireTiming = { maxRetries: 1, firstByteMs: 2000, idleMs: 2000 };

function client(provider: AiProvider, base: string, model = "modele-essai", key = "cle-essai") {
  const c = resolveAiConfig({ provider, connectors: { [provider]: { url: base, model, key: "ok" } } }, {}, () => key).connectors[provider];
  return { c, ai: wireClient(c, QUICK, { base, rule: "locale" }) };
}
const ASK = { model: "modele-essai", max_tokens: 200, messages: [{ role: "user" as const, content: "Bonjour" }] };
const SCHEMA = { type: "object", properties: { total: { type: ["number", "null"] } }, required: ["total"], additionalProperties: false };

describe("où une demande a le droit de partir", () => {
  it("un fournisseur en ligne : https, jamais vers la machine ni le réseau privé", async () => {
    await expect(destination(new URL("https://127.0.0.1/v1"), "publique")).rejects.toBeInstanceOf(HttpRefused);
    await expect(destination(new URL("https://169.254.169.254/"), "publique")).rejects.toBeInstanceOf(HttpRefused);
    await expect(destination(new URL("http://192.0.2.10/"), "publique")).rejects.toBeInstanceOf(HttpRefused);
  });
  it("un serveur de modèles : en clair seulement vers la machine ou le réseau local, jamais avec des identifiants", async () => {
    await expect(destination(new URL("http://127.0.0.1:11434"), "locale")).resolves.toMatchObject({ address: "127.0.0.1" });
    await expect(destination(new URL("http://192.168.1.20:11434"), "locale")).resolves.toMatchObject({ address: "192.168.1.20" });
    await expect(destination(new URL("https://192.168.1.20"), "locale")).resolves.toMatchObject({ address: "192.168.1.20" });
    await expect(destination(new URL("http://8.8.8.8:11434"), "locale")).rejects.toMatchObject({ reason: "clair" });
    await expect(destination(new URL("http://100.64.0.5:11434"), "locale")).resolves.toMatchObject({ address: "100.64.0.5" });
    // « Local » au sens strict : ni l'adresse où un hébergeur sert ses métadonnées, ni une plage réservée, ni une IPv6 qui porte une IPv4 publique.
    for (const far of ["http://169.254.169.254/", "http://192.0.78.24:11434", "http://224.0.0.251:11434", "http://[2002:c000:4e18::1]:11434", "http://[::ffff:808:808]:11434", "http://[fd00:ec2::254]/"]) {
      await expect(destination(new URL(far), "locale"), far).rejects.toMatchObject({ reason: "clair" });
    }
    await expect(destination(new URL("http://modele-absent.invalid:11434"), "locale")).rejects.toMatchObject({ reason: "introuvable", host: "modele-absent.invalid" });
    await expect(destination(new URL("http://alex:secret@127.0.0.1:11434"), "locale")).rejects.toBeInstanceOf(HttpRefused);
    await expect(destination(new URL("ftp://127.0.0.1"), "locale")).rejects.toBeInstanceOf(HttpRefused);
  });
});

describe("service compatible OpenAI (Chat Completions)", () => {
  it("envoie la clé, lit le flux et rend une réponse au format de Claude", async () => {
    const f = await fake(() =>
      sse([{ id: "c1", choices: [{ delta: { content: "Bonjour " } }] }, { choices: [{ delta: { content: "Alex" }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 12, completion_tokens: 4 } }]),
    );
    const { ai } = client("openai-compatible", f.base);
    const stream = ai.messages.stream(ASK);
    const text: string[] = [];
    stream.on("text", (d) => text.push(d));
    const reply = await stream.finalMessage();
    expect(text).toEqual(["Bonjour ", "Alex"]);
    expect(reply).toMatchObject({ role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Bonjour Alex" }], usage: { input_tokens: 12, output_tokens: 4, label: "modele-essai" } });
    expect(f.seen[0].url).toBe("/chat/completions");
    expect(f.seen[0].headers.authorization).toBe("Bearer cle-essai");
    expect(f.seen[0].body).toMatchObject({ model: "modele-essai", stream: true, messages: [{ role: "user", content: "Bonjour" }] });
  });
  it("retire un réglage que le service refuse, rejoue la demande, et s'en souvient", async () => {
    const f = await fake((req) =>
      "max_tokens" in req.body
        ? { status: 400, body: JSON.stringify({ error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model.", type: "invalid_request_error" } }) }
        : sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]),
    );
    const { ai } = client("openai-compatible", f.base);
    await expect(ai.messages.create(ASK)).resolves.toMatchObject({ content: [{ type: "text", text: "ok" }] });
    await ai.messages.create(ASK);
    expect(f.seen.map((s) => "max_tokens" in s.body)).toEqual([true, false, false]);
  });
  it("reprend après une panne passagère, et rend l'erreur du fournisseur quand elle dure", async () => {
    const flaky = await fake((_req, n) => (n === 1 ? { status: 503, body: "surcharge" } : sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }])));
    await expect(client("openai-compatible", flaky.base).ai.messages.create(ASK)).resolves.toMatchObject({ content: [{ type: "text", text: "ok" }] });
    expect(flaky.seen).toHaveLength(2);
    const refused = await fake(() => ({ status: 401, body: JSON.stringify({ error: { message: "Incorrect API key provided", code: "invalid_api_key" } }) }));
    const e = await client("openai-compatible", refused.base).ai.messages.create(ASK).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Anthropic.AuthenticationError);
    expect((e as Error).message).toContain("Incorrect API key provided");
    expect(refused.seen).toHaveLength(1);
  });
  it("lit une réponse rendue sans flux, compte ce qui n'a pas été compté, et nettoie le JSON demandé", async () => {
    const f = await fake(() => ({ body: JSON.stringify({ choices: [{ message: { role: "assistant", content: 'Voici : {"total": 3.6}' }, finish_reason: "stop" }] }) }));
    const reply = await client("openai-compatible", f.base).ai.messages.create({ ...ASK, output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } } } as never);
    expect(reply.content).toEqual([{ type: "text", text: '{"total": 3.6}', citations: null }]);
    expect(reply.usage.input_tokens).toBeGreaterThan(0);
    expect(reply.usage.output_tokens).toBeGreaterThan(0);
    expect(f.seen[0].body).toMatchObject({ response_format: { type: "json_schema" } });
  });
  it("une adresse qui répond autre chose que le service n'est pas une réponse vide réussie", async () => {
    const page = await fake(() => ({ type: "text/html", body: "<!doctype html><html><body>Bienvenue</body></html>" }));
    await expect(client("openai-compatible", page.base).ai.messages.create(ASK)).rejects.toBeInstanceOf(AiNotice);
    const other = await fake(() => ({ body: JSON.stringify({ status: "ok", version: "1.0" }) }));
    await expect(client("openai-compatible", other.base).ai.messages.create(ASK)).rejects.toBeInstanceOf(AiNotice);
    // Une erreur dont le corps n'est pas du JSON n'est pas recopiée.
    const wall = await fake(() => ({ status: 403, type: "text/html", body: "<html>console d'administration : accès refusé</html>" }));
    const e = await client("openai-compatible", wall.base).ai.messages.create(ASK).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Anthropic.PermissionDeniedError);
    expect((e as Error).message).not.toContain("administration");
  });
  it("lit un flux « data: » même annoncé comme du texte", async () => {
    const f = await fake(() => ({ ...sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }]), type: "text/plain" }));
    await expect(client("openai-compatible", f.base).ai.messages.create(ASK)).resolves.toMatchObject({ content: [{ type: "text", text: "ok" }] });
  });
  it("ne retient un retrait que s'il a fait passer la demande", async () => {
    // Le service refuse tout : retirer le plafond n'y change rien, la demande suivante le renvoie donc.
    const f = await fake(() => ({ status: 400, body: JSON.stringify({ error: { message: "max_tokens: valeur refusée" } }) }));
    const { ai } = client("openai-compatible", f.base);
    await expect(ai.messages.create(ASK)).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    await expect(ai.messages.create(ASK)).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(f.seen.map((s) => "max_tokens" in s.body)).toEqual([true, false, true, false]);
  });
  it("s'arrête à la demande, et abandonne un service qui ne répond pas", async () => {
    const slow = await fake(() => "pendu");
    const stream = client("openai-compatible", slow.base).ai.messages.stream(ASK);
    setTimeout(() => stream.abort(), 50);
    await expect(stream.finalMessage()).rejects.toBeInstanceOf(Anthropic.APIUserAbortError);
    const mute = await fake(() => "pendu");
    const c = resolveAiConfig({ connectors: { "openai-compatible": { url: mute.base, model: "m" } } }, {}, () => null).connectors["openai-compatible"];
    await expect(wireClient(c, { maxRetries: 0, firstByteMs: 80, idleMs: 80 }, { base: mute.base, rule: "locale" }).messages.create(ASK)).rejects.toBeInstanceOf(Anthropic.APIConnectionTimeoutError);
  });
  it("donne la liste des modèles du service", async () => {
    const f = await fake(() => ({ body: JSON.stringify({ object: "list", data: [{ id: "modele-a" }, { id: "modele-b", name: "Modèle B", context_length: 128000, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools"], pricing: { prompt: "0.000002", completion: "0.00001" } }] }) }));
    const c = resolveAiConfig({ connectors: { "openai-compatible": { url: `${f.base}/v1`, model: "modele-a" } } }, {}, () => null).connectors["openai-compatible"];
    expect(await listModels(c)).toEqual([{ id: "modele-a" }, { id: "modele-b", name: "Modèle B", tools: true, vision: true, context: 128000, price: { input: 2, output: 10 } }]);
    expect(f.seen[0].url).toBe("/v1/models");
  });
});

describe("OpenRouter", () => {
  it("compte le coût que rend OpenRouter, sous son nom", async () => {
    const f = await fake(() => sse([{ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5, cost: 0.00042 } }]));
    const reply = await client("openrouter", f.base, "editeur/modele").ai.messages.create({ ...ASK, model: "editeur/modele", output_config: { effort: "low" } } as never);
    expect(reply.usage).toMatchObject({ input_tokens: 100, output_tokens: 5, cost_usd: 0.00042, label: "openrouter/editeur/modele" });
    expect(f.seen[0].body).toMatchObject({ reasoning: { effort: "low" } });
    expect(f.seen[0].body).not.toHaveProperty("stream_options");
  });
});

describe("OpenAI (API Responses)", () => {
  it("parle l'API Responses et rend l'appel d'outil au format de Claude", async () => {
    const call = { type: "function_call", id: "fc_1", call_id: "call_7", name: "get_overview", arguments: '{"mois":"2026-10"}' };
    const f = await fake(() =>
      sse(
        [
          { type: "response.created", response: { id: "resp_1" } },
          { type: "response.output_item.done", output_index: 0, item: call },
          { type: "response.completed", response: { id: "resp_1", status: "completed", output: [call], usage: { input_tokens: 900, output_tokens: 40, input_tokens_details: { cached_tokens: 600 } } } },
        ],
        false,
      ),
    );
    const { ai } = client("openai", f.base, "gpt-essai");
    const reply = await ai.messages.create({ ...ASK, model: "gpt-essai", tools: [{ name: "get_overview", description: "Vue d'ensemble", input_schema: { type: "object", properties: {} } }] });
    expect(reply).toMatchObject({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "call_7", name: "get_overview", input: { mois: "2026-10" } }], usage: { input_tokens: 300, cache_read_input_tokens: 600, label: "gpt-essai" } });
    expect(f.seen[0].url).toBe("/responses");
    expect(f.seen[0].body).toMatchObject({ store: false, stream: true, tools: [{ type: "function", name: "get_overview", strict: false }] });
  });
  it("rend l'échec annoncé au milieu d'une réponse comme une erreur du fournisseur", async () => {
    const f = await fake(() => sse([{ type: "response.failed", response: { error: { code: "server_error", message: "Panne chez le fournisseur" } } }], false));
    const e = await wireClient(client("openai", f.base).c, { ...QUICK, maxRetries: 0 }, { base: f.base, rule: "locale" }).messages.create(ASK).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Anthropic.InternalServerError);
    expect((e as Error).message).toContain("Panne chez le fournisseur");
  });
});

describe("Ollama", () => {
  const done = { message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 20, eval_count: 6 };
  it("règle la fenêtre de contexte, lit les lignes du flux et ne compte rien à l'appel", async () => {
    const f = await fake(() => ndjson([{ message: { role: "assistant", content: "Bonjour" }, done: false }, done]));
    const c = resolveAiConfig({ connectors: { ollama: { url: f.base, model: "modele:4b", context: 16384 } } }, {}, () => null).connectors.ollama;
    const reply = await wireClient(c, QUICK).messages.create({ ...ASK, model: "modele:4b" });
    expect(reply).toMatchObject({ content: [{ type: "text", text: "Bonjour" }], usage: { input_tokens: 20, output_tokens: 6, label: "ollama/modele:4b" } });
    expect(f.seen[0].url).toBe("/api/chat");
    expect(f.seen[0].headers.authorization).toBeUndefined();
    expect(f.seen[0].body).toMatchObject({ options: { num_ctx: 16384, num_predict: 200 }, truncate: false, stream: true });
  });
  it("un flux qui s'arrête sans son dernier morceau est une erreur, pas une réponse", async () => {
    const f = await fake(() => ndjson([{ message: { role: "assistant", content: "Bonj" }, done: false }]));
    const c = resolveAiConfig({ connectors: { ollama: { url: f.base, model: "modele:4b" } } }, {}, () => null).connectors.ollama;
    await expect(wireClient(c, { ...QUICK, maxRetries: 0 }).messages.create(ASK)).rejects.toBeInstanceOf(Anthropic.APIConnectionError);
  });
  it("dit au membre ce qui tient au réglage : contexte trop petit, modèle sans outils", async () => {
    const small = await fake(() => ({ status: 400, body: JSON.stringify({ error: "request (6014 tokens) exceeds the available context size (4096 tokens), try increasing it" }) }));
    const c = resolveAiConfig({ connectors: { ollama: { url: small.base, model: "modele:4b", context: 4096 } } }, {}, () => null).connectors.ollama;
    const e = await wireClient(c, QUICK).messages.create(ASK).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiNotice);
    expect((e as AiNotice).vars).toEqual({ n: 4096 });
    const noTools = await fake(() => ({ status: 400, body: JSON.stringify({ error: "registry.ollama.ai/library/modele:4b does not support tools" }) }));
    const c2 = resolveAiConfig({ connectors: { ollama: { url: noTools.base, model: "modele:4b" } } }, {}, () => null).connectors.ollama;
    const e2 = await wireClient(c2, QUICK).messages.create(ASK).catch((x: unknown) => x);
    expect((e2 as AiNotice).vars).toEqual({ modele: "modele:4b" });
  });
  it("liste les modèles installés avec ce qu'ils savent faire, sans ceux qui ne servent qu'à indexer", async () => {
    const f = await fake(() => ({
      body: JSON.stringify({
        models: [
          { name: "modele-vision:4b", size: 3_300_000_000, capabilities: ["completion", "vision"], details: { parameter_size: "3.9B" } },
          { name: "modele-outils:4b", size: 2_500_000_000, capabilities: ["completion", "tools", "thinking"], details: { parameter_size: "4.0B" } },
          { name: "nomic-embed-text:latest", size: 270_000_000, capabilities: ["embedding"] },
          { name: "ancien:7b", size: 4_000_000_000 },
        ],
      }),
    }));
    const c = resolveAiConfig({ connectors: { ollama: { url: f.base, model: "modele-outils:4b" } } }, {}, () => null).connectors.ollama;
    expect(await listModels(c)).toEqual([
      { id: "ancien:7b", size: 4_000_000_000 },
      { id: "modele-outils:4b", tools: true, vision: false, size: 2_500_000_000, note: "4.0B" },
      { id: "modele-vision:4b", tools: false, vision: true, size: 3_300_000_000, note: "3.9B" },
    ]);
    expect(f.seen[0].url).toBe("/api/tags");
  });
  it("refuse de joindre en clair une adresse qui n'est pas locale", async () => {
    const c = resolveAiConfig({ connectors: { ollama: { url: "https://ollama.exemple.com", model: "modele:4b" } } }, {}, () => null).connectors.ollama;
    const e = await wireClient({ ...c, url: "http://8.8.8.8:11434" }, { ...QUICK, maxRetries: 0 }).messages.create(ASK).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Anthropic.APIConnectionError);
    expect((e as Error).cause).toMatchObject({ reason: "clair" });
  });
});
