import Anthropic from "@anthropic-ai/sdk";
import { AI_PROVIDER_SPEC, connectorBase, type AiConnector, type AiModelChoice } from "../lib/ai-providers.ts";
import { usageModel } from "../lib/ai-usage.ts";
import { tk } from "../lib/i18n.ts";
import { type WireBlock, type WireEvent, type WireParams, type WireReader, type WireReply, WireError, roughInput, roughTokens, schemaOf } from "../lib/ai-wire.ts";
import { chatHeal, chatReader, chatRequest } from "../lib/ai-wire-chat.ts";
import { ollamaHeal, ollamaNoTools, ollamaReader, ollamaRequest, ollamaTooLong } from "../lib/ai-wire-ollama.ts";
import { responsesHeal, responsesReader, responsesRequest } from "../lib/ai-wire-responses.ts";
import { HttpError, HttpRefused, HttpTimeout, jsonOnce, jsonStream, type Destination } from "./ai-http.ts";
import { pdfTextIsolated } from "./pdf-text.ts";

/*
 * Client des fournisseurs qui ne parlent pas l'API Messages de Claude : OpenAI (API Responses), OpenRouter et les
 * services « compatibles OpenAI » (Chat Completions), Ollama (son API). Il se présente au reste de Pécule comme le
 * client de Claude — mêmes demandes, mêmes réponses, mêmes erreurs — et traduit dans les deux sens
 * (`src/lib/ai-wire*.ts`). Aucune dépendance sur la base : il s'essaie contre un faux serveur (`ai-wires.test.ts`).
 *
 * Ce qu'il fait de plus que traduire :
 * - toute demande part en flux, même quand l'appelant attend la réponse d'un bloc : un modèle local peut mettre des
 *   minutes à répondre, et seul un flux dit qu'il travaille encore ;
 * - un réglage facultatif que le modèle refuse (effort, plafond, schéma strict…) est retiré et la demande rejouée ;
 *   le retrait n'est retenu pour ce modèle (le temps que le serveur tourne) que si la demande est alors passée ;
 * - une réponse qui ne ressemble pas à celle du service (une page web, une autre API), ou qui s'arrête avant sa fin,
 *   est une erreur : jamais une réponse vide tenue pour bonne ;
 * - un PDF est donné par son texte à qui ne sait pas le lire tel quel (Ollama, les services compatibles) ;
 * - ce qui tient au réglage plutôt qu'à une panne — fenêtre de contexte trop petite, modèle sans outils, PDF sans
 *   texte — remonte en `AiNotice` : un message que le membre lit, dans sa langue.
 */

/** Ce que Pécule utilise d'une réponse en flux, quel que soit le fournisseur. */
export type AiStream = {
  on(event: "text" | "thinking", listener: (delta: string) => void): AiStream;
  abort(): void;
  finalMessage(): Promise<Anthropic.Message>;
  readonly currentMessage: Anthropic.Message | undefined;
};
type CallOptions = { signal?: AbortSignal };
/** Ce que Pécule utilise d'un client d'IA, quel que soit le fournisseur. */
export type AiClient = {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming, options?: CallOptions): Promise<Anthropic.Message>;
    stream(params: Anthropic.MessageStreamParams, options?: CallOptions): AiStream;
  };
};

/** Ce qui tient au réglage de l'IA, à dire au membre tel quel : `key` est un texte à traduire, `vars` ses variables. */
export class AiNotice extends Error {
  constructor(
    readonly key: string,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(key);
  }
}

export type WireTiming = { maxRetries: number; firstByteMs: number; idleMs: number };
/** Délais d'un service en ligne, et d'un serveur de modèles local (il charge le modèle, puis lit la demande, parfois longuement). */
export const WIRE_TIMING: Record<"ligne" | "locale", WireTiming> = {
  ligne: { maxRetries: 2, firstByteMs: 120_000, idleMs: 300_000 },
  locale: { maxRetries: 1, firstByteMs: 15 * 60_000, idleMs: 10 * 60_000 },
};
export const timingOf = (c: Pick<AiConnector, "provider">): WireTiming => WIRE_TIMING[AI_PROVIDER_SPEC[c.provider].address === "locale" ? "locale" : "ligne"];

/** Texte d'un PDF donné à un modèle qui ne lit pas les PDF, au plus (une quarantaine de pages). */
const MAX_PDF_TEXT = 120_000;

type Kit = {
  url: string;
  headers: Record<string, string>;
  rule: Destination;
  /** Le fournisseur lit un PDF joint tel quel ; sinon c'est son texte qui part. */
  pdf: boolean;
  request(params: WireParams, dropped: ReadonlySet<string>): Record<string, unknown>;
  reader(model: string, json: boolean): WireReader;
  heal(message: string, sent: Record<string, unknown>): string | null;
  /** Un refus qui tient au réglage, à dire au membre ; null sinon. */
  notice(message: string, c: AiConnector): AiNotice | null;
};

const TOO_LONG = tk("La demande ne tient pas dans la fenêtre de contexte réglée pour Ollama ({n} jetons) : augmente-la dans Réglages → Comptes et connexions → Intelligence artificielle, ou pose une question plus courte.");
const NO_TOOLS = tk("Le modèle « {modele} » ne sait pas appeler d'outils : l'assistant en a besoin pour lire tes comptes. Choisis un modèle qui porte la mention « outils ».");
const NO_TEXT = tk("Ce PDF n'a pas de texte à lire (un scan, sans doute), et le modèle choisi ne lit pas les PDF tels quels : dépose-le en photo, ou confie l'IA à un fournisseur qui lit les PDF.");
const UNEXPECTED = tk("Cette adresse ne répond pas comme le service attendu : vérifie-la.");

/** Où joindre un fournisseur à la place de son adresse : pour l'essayer contre un faux serveur. */
export type WireTarget = { base: string; rule: Destination };

function kitOf(c: AiConnector, at?: WireTarget): Kit {
  const spec = AI_PROVIDER_SPEC[c.provider];
  const base = at?.base ?? connectorBase(c);
  if (!base) throw new Error("IA non configurée : aucune adresse pour ce fournisseur");
  const headers: Record<string, string> = c.key ? { Authorization: `Bearer ${c.key}` } : {};
  const rule: Destination = at?.rule ?? (spec.address === "locale" ? "locale" : "publique");
  if (spec.wire === "responses") {
    return {
      url: `${base}/responses`,
      headers,
      rule,
      pdf: true,
      request: (p, d) => responsesRequest(p, d as ReadonlySet<never>),
      reader: (model, json) => responsesReader(model, { json }),
      heal: responsesHeal,
      notice: () => null,
    };
  }
  if (spec.wire === "ollama") {
    return {
      url: `${base}/api/chat`,
      headers,
      rule,
      pdf: false,
      request: (p, d) => ollamaRequest(p, { context: c.context }, d as ReadonlySet<never>),
      reader: (model, json) => ollamaReader(model, { json }),
      heal: ollamaHeal,
      notice: (message, k) => (ollamaNoTools(message) ? new AiNotice(NO_TOOLS, { modele: k.model }) : ollamaTooLong(message) ? new AiNotice(TOO_LONG, { n: k.context ?? 0 }) : null),
    };
  }
  const dialect = c.provider === "openrouter" ? "openrouter" : "generic";
  return {
    url: `${base}/chat/completions`,
    headers,
    rule,
    pdf: dialect === "openrouter",
    request: (p, d) => chatRequest(p, dialect, d as ReadonlySet<never>),
    reader: (model, json) => chatReader(model, { dialect, json }),
    heal: chatHeal,
    notice: () => null,
  };
}

/** Les PDF de la demande, remplacés par leur texte : pour un modèle qui ne les lit pas tels quels. */
async function pdfAsText(params: WireParams): Promise<WireParams> {
  const has = (m: WireParams["messages"][number]) => Array.isArray(m.content) && m.content.some((b) => b.type === "document");
  if (!params.messages.some(has)) return params;
  const messages = await Promise.all(
    params.messages.map(async (m) => {
      if (!has(m)) return m;
      const content = await Promise.all(
        (m.content as WireBlock[]).map(async (b): Promise<WireBlock> => {
          if (b.type !== "document") return b;
          const read = b.source.media_type === "application/pdf" ? await pdfTextIsolated(Buffer.from(b.source.data, "base64")).catch(() => null) : null;
          const text = read?.text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() ?? "";
          if (text.length < 80) throw new AiNotice(NO_TEXT);
          return { type: "text", text: `Document PDF${read?.totalPages ? ` (${read.totalPages} pages)` : ""}, texte extrait :\n\n${text.slice(0, MAX_PDF_TEXT)}` };
        }),
      );
      return { ...m, content };
    }),
  );
  return { ...params, messages };
}

/**
 * Message d'erreur d'un fournisseur, tiré du corps de sa réponse (chacun a sa forme). Un corps qui n'est pas du JSON
 * n'est pas recopié : une adresse du réseau local qui n'est pas un serveur de modèles ne se lit pas par ses erreurs.
 */
function errorMessage(body: string): string {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return "";
  }
  const o = v as { error?: unknown; message?: unknown; detail?: unknown } | null;
  const e = o?.error;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const x = e as { message?: unknown; metadata?: { raw?: unknown } | null };
    // OpenRouter : le message du fournisseur d'origine est dans « metadata.raw ».
    const raw = typeof x.metadata?.raw === "string" ? x.metadata.raw : "";
    return [typeof x.message === "string" ? x.message : "", raw].filter(Boolean).join(" — ").slice(0, 700) || JSON.stringify(e).slice(0, 500);
  }
  if (typeof o?.message === "string") return o.message.slice(0, 700);
  if (typeof o?.detail === "string") return o.detail.slice(0, 700);
  return "";
}

const apiError = (status: number, message: string) => Anthropic.APIError.generate(status, { message }, message, new Headers());

/** L'erreur d'une demande, sous la forme de celles du client de Claude : le reste de Pécule n'en connaît pas d'autres. */
function translate(e: unknown): Error {
  if (e instanceof AiNotice || e instanceof Anthropic.APIError) return e;
  if (e instanceof HttpError) return apiError(e.status, errorMessage(e.body) || `réponse ${e.status}`);
  if (e instanceof WireError) return apiError(e.status ?? 502, e.message);
  if (e instanceof HttpTimeout) return new Anthropic.APIConnectionTimeoutError();
  if (e instanceof HttpRefused) return new Anthropic.APIConnectionError({ message: e.message, cause: e });
  return new Anthropic.APIConnectionError({ message: e instanceof Error ? e.message : "connexion impossible", cause: e instanceof Error ? e : undefined });
}

const retryable = (e: Error) => (e instanceof Anthropic.APIError && typeof e.status === "number" ? e.status === 408 || e.status === 409 || e.status === 429 || e.status >= 500 : e instanceof Anthropic.APIConnectionError && !(e instanceof Anthropic.APIConnectionTimeoutError) && !(e.cause instanceof HttpRefused));

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

/** Client d'un fournisseur traduit. `timing` : ses délais et ses reprises (ceux de son genre par défaut). */
export function wireClient(c: AiConnector, timing: WireTiming = timingOf(c), at?: WireTarget): AiClient {
  const kit = kitOf(c, at);
  /** Ce que chaque modèle a refusé, retiré de ses demandes suivantes. */
  const refused = new Map<string, Set<string>>();

  function stream(raw: Anthropic.MessageStreamParams | Anthropic.MessageCreateParamsNonStreaming, options?: CallOptions): AiStream {
    const params = raw as unknown as WireParams;
    const listeners = { text: [] as ((d: string) => void)[], thinking: [] as ((d: string) => void)[] };
    const controller = new AbortController();
    const signal = options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    let reader: WireReader | null = null;
    let emitted = false;
    const emit = (e: WireEvent) => {
      emitted = true;
      if ("text" in e) for (const l of listeners.text) l(e.text);
      else for (const l of listeners.thinking) l(e.thinking);
    };
    /** Décompte et libellé du modèle : ce que le fournisseur n'a pas compté est estimé, plutôt que compté pour rien. */
    const settle = (reply: WireReply, done: boolean): WireReply => {
      const u = reply.usage;
      if (!u.input_tokens && !u.cache_read_input_tokens && !u.cache_creation_input_tokens) u.input_tokens = roughInput(params);
      if (done && !u.output_tokens) u.output_tokens = roughTokens(reply.content.reduce((n, b) => n + (b.type === "text" ? b.text.length : b.type === "tool_use" ? JSON.stringify(b.input).length : 0), 0));
      u.label = usageModel(c.provider, c.model);
      return reply;
    };

    const run = async (): Promise<Anthropic.Message> => {
      const known = refused.get(params.model) ?? new Set<string>();
      // Ce que cette demande a retiré en plus : retenu pour la suite seulement si elle passe alors.
      const dropped = new Set(known);
      let retries = 0;
      try {
        const prepared = kit.pdf ? params : await pdfAsText(params);
        for (;;) {
          const body = kit.request(prepared, dropped);
          reader = kit.reader(params.model, schemaOf(params) !== null);
          try {
            for await (const chunk of jsonStream(kit.url, { headers: kit.headers, body, signal, rule: kit.rule, firstByteMs: timing.firstByteMs, idleMs: timing.idleMs })) {
              for (const e of reader.push(chunk)) emit(e);
            }
            const state = reader.state();
            if (state === "vide") throw new AiNotice(UNEXPECTED);
            if (state === "coupee") throw new Anthropic.APIConnectionError({ message: "réponse interrompue avant sa fin" });
            if (dropped.size > known.size) refused.set(params.model, dropped);
            return settle(reader.reply(), true) as unknown as Anthropic.Message;
          } catch (cause) {
            if (signal.aborted) throw new Anthropic.APIUserAbortError();
            const e = translate(cause);
            // Rien n'a encore été montré au membre : la demande peut repartir, corrigée ou telle quelle.
            if (!emitted && e instanceof Anthropic.APIError && (e.status === 400 || e.status === 422)) {
              const drop = kit.heal(e.message, body);
              if (drop && !dropped.has(drop)) {
                dropped.add(drop);
                continue;
              }
            }
            const notice = e instanceof Anthropic.APIError && typeof e.status === "number" && e.status < 500 ? kit.notice(e.message, c) : null;
            if (notice) throw notice;
            if (!emitted && retries < timing.maxRetries && retryable(e)) {
              await wait(500 * 4 ** retries++, signal);
              if (signal.aborted) throw new Anthropic.APIUserAbortError();
              continue;
            }
            throw e;
          }
        }
      } catch (e) {
        throw translate(e);
      }
    };

    // Lancée au tour suivant : l'appelant a le temps de poser ses écouteurs, comme avec le client de Claude.
    const done = Promise.resolve().then(run);
    done.catch(() => undefined);
    const self: AiStream = {
      on(event, listener) {
        listeners[event].push(listener);
        return self;
      },
      abort: () => controller.abort(),
      finalMessage: () => done,
      get currentMessage() {
        return reader ? (settle(reader.reply(), false) as unknown as Anthropic.Message) : undefined;
      },
    };
    return self;
  }

  return { messages: { create: (params, options) => stream(params, options).finalMessage(), stream } };
}

/* ---------- Modèles d'un service ---------- */

type Listed = { models?: { name?: string; size?: number; capabilities?: string[]; details?: { parameter_size?: string } }[]; data?: OpenListed[] };
type OpenListed = { id?: string; name?: string; context_length?: number; architecture?: { input_modalities?: string[] } | null; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } | null };

const perMillion = (v: unknown): number | null => {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e9) / 1000 : null;
};

/**
 * Les modèles qu'un service propose, avec ce qu'il dit de chacun (outils, images, taille, tarif) : ceux installés
 * dans un Ollama, le catalogue d'OpenRouter, la liste d'un service compatible. Vide pour un fournisseur qui n'en
 * donne pas. `timeoutMs` : on n'attend pas une liste comme une réponse.
 */
export async function listModels(c: AiConnector, timeoutMs = 15_000): Promise<AiModelChoice[]> {
  const spec = AI_PROVIDER_SPEC[c.provider];
  const base = connectorBase(c);
  if (!spec.lists || !base) return [];
  const ollama = spec.wire === "ollama";
  let listed: Listed;
  try {
    listed = ((await jsonOnce(`${base}${ollama ? "/api/tags" : "/models"}`, {
      headers: c.key ? { Authorization: `Bearer ${c.key}` } : {},
      rule: spec.address === "locale" ? "locale" : "publique",
      firstByteMs: timeoutMs,
      idleMs: timeoutMs,
      signal: AbortSignal.timeout(timeoutMs * 2),
    })) ?? {}) as Listed;
  } catch (e) {
    throw translate(e);
  }
  if (ollama) {
    return (listed.models ?? [])
      .filter((m) => typeof m.name === "string" && m.name)
      .map((m) => {
        // Un Ollama ancien ne dit pas ce que sait faire un modèle : on ne l'invente pas.
        const caps = Array.isArray(m.capabilities) ? m.capabilities : null;
        return { id: m.name!, ...(caps ? { tools: caps.includes("tools"), vision: caps.includes("vision") } : {}), ...(typeof m.size === "number" ? { size: m.size } : {}), ...(m.details?.parameter_size ? { note: m.details.parameter_size } : {}) };
      })
      .filter((m) => !/embed/i.test(m.id))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  return (Array.isArray(listed.data) ? listed.data : [])
    .filter((m) => typeof m.id === "string" && m.id)
    .slice(0, 1000)
    .map((m) => {
      const input = perMillion(m.pricing?.prompt);
      const output = perMillion(m.pricing?.completion);
      return {
        id: m.id!,
        ...(typeof m.name === "string" && m.name !== m.id ? { name: m.name } : {}),
        ...(Array.isArray(m.supported_parameters) ? { tools: m.supported_parameters.includes("tools") } : {}),
        ...(Array.isArray(m.architecture?.input_modalities) ? { vision: m.architecture.input_modalities.includes("image") } : {}),
        ...(typeof m.context_length === "number" ? { context: m.context_length } : {}),
        ...(input !== null && output !== null ? { price: { input, output } } : {}),
      };
    });
}

/** Ce que le service dit du modèle choisi ; null s'il ne le connaît pas ou ne donne pas de liste. */
export async function modelTraits(c: AiConnector): Promise<AiModelChoice | null> {
  const models = await listModels(c, 8_000).catch(() => []);
  const wanted = c.model.toLowerCase();
  return models.find((m) => m.id.toLowerCase() === wanted) ?? models.find((m) => m.id.toLowerCase() === `${wanted}:latest`) ?? null;
}
