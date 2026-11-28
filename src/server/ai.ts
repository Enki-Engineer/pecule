import { fxRate } from "./fx.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { isDemo, runReal } from "./demo-context.ts";
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicFoundry } from "@anthropic-ai/foundry-sdk";
import { activeConnector, aiConfig } from "./ai-config.ts";
import { addSpent, customPrices } from "./ai-cost.ts";
import { exec, one } from "./db.ts";
import { currentActor } from "./journal.ts";
import { ActionError } from "./actions.ts";
import { HttpRefused } from "./ai-http.ts";
import { AiNotice, modelTraits, timingOf, wireClient, type AiClient, type AiStream } from "./ai-wires.ts";
import { AI_PROVIDER_INFO, AI_PROVIDER_SPEC, foundryResource, type AiConnector } from "../lib/ai-providers.ts";
import { DEMO_SUFFIX, usageCostUsd, usageModel, type Usage } from "../lib/ai-usage.ts";
import { withoutCarriers } from "../lib/ai-wire.ts";
import { currentLang, t as tr } from "../lib/i18n.ts";
import { resolvesPublic } from "./net.ts";

/*
 * L'IA de Pécule : assistant, lecture des factures, des documents et des bulletins. Le fournisseur qui répond
 * (Microsoft Foundry par défaut), son adresse, son modèle et sa clé se règlent dans Réglages → Comptes et connexions
 * (`ai-config.ts`). Le reste du code ne voit que `aiClient()` et `aiModel()`, et écrit toutes ses demandes au format
 * de l'API Messages de Claude : un fournisseur qui parle une autre API passe par une traduction (`ai-wires.ts`).
 */

/** Le fournisseur choisi a tout ce qu'il faut pour répondre. */
export const aiEnabled = () => activeConnector().ready;
/** Modèle (ou déploiement) du fournisseur choisi. */
export const aiModel = () => activeConnector().model;
/** Le modèle du fournisseur choisi, tel que ses appels sont comptés (`usageModel` : Ollama et OpenRouter y laissent leur nom). */
export const aiUsageModel = () => usageModel(activeConnector().provider, activeConnector().model);

export type { AiClient, AiStream } from "./ai-wires.ts";

/** `localTimeout` : délai laissé à un serveur de modèles local, qui charge d'abord son modèle. */
type ClientOptions = { maxRetries: number; timeout: number; localTimeout?: number };
const CLIENT: ClientOptions = { maxRetries: 2, timeout: 120_000 };

/**
 * `fetch` d'un fournisseur dont l'adresse a été saisie dans les réglages. Elle a été contrôlée à l'enregistrement, mais
 * un nom public peut être repointé ensuite vers le réseau du serveur : la destination est recontrôlée à chaque appel
 * (même règle qu'à la saisie : un nom de domaine doit mener à une adresse publique). Aucune redirection n'est suivie :
 * elle emporterait la clé et les données du foyer vers une autre adresse que celle que l'administrateur a donnée.
 */
const guardedFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.protocol !== "https:" || (url.hostname.includes(".") && !(await resolvesPublic(url.hostname)))) throw new Error("Adresse du fournisseur d'IA refusée : elle ne mène pas à un service public en https.");
  return fetch(input, { ...init, redirect: "error" });
};

/**
 * Client de Claude, tel que le reste de Pécule l'utilise. Les blocs que d'autres fournisseurs ont laissés dans une
 * conversation (leur raisonnement, à leur rendre) n'en partent pas : Claude refuserait une réflexion qui n'est pas la sienne.
 */
function claudeClient(sdk: { messages: Pick<Anthropic["messages"], "create" | "stream"> }): AiClient {
  return {
    messages: {
      create: (p, o) => sdk.messages.create({ ...p, messages: withoutCarriers(p.messages) }, o),
      stream: (p, o) => sdk.messages.stream({ ...p, messages: withoutCarriers(p.messages) }, o) as unknown as AiStream,
    },
  };
}

/** Ce qui tient au réglage (contexte trop petit, modèle sans outils, PDF sans texte) est dit au membre, dans sa langue. */
const told = <T>(p: Promise<T>): Promise<T> =>
  p.catch((e: unknown) => {
    throw e instanceof AiNotice ? new ActionError(422, tr(e.key, e.vars)) : e;
  });

/** Client d'un fournisseur traduit, dont les refus de réglage deviennent des messages lisibles. */
function translatedClient(c: AiConnector, opts?: ClientOptions): AiClient {
  const base = timingOf(c);
  const limit = AI_PROVIDER_SPEC[c.provider].address === "locale" ? (opts?.localTimeout ?? opts?.timeout) : opts?.timeout;
  const wire = wireClient(c, opts && limit ? { maxRetries: Math.min(base.maxRetries, opts.maxRetries), firstByteMs: Math.min(base.firstByteMs, limit), idleMs: base.idleMs } : base);
  return {
    messages: {
      create: (p, o) => told(wire.messages.create(p, o)),
      stream: (p, o) => {
        const s = wire.messages.stream(p, o);
        const self: AiStream = {
          on: (event, listener) => {
            s.on(event, listener);
            return self;
          },
          abort: () => s.abort(),
          finalMessage: () => told(s.finalMessage()),
          get currentMessage() {
            return s.currentMessage;
          },
        };
        return self;
      },
    },
  };
}

function buildClient(c: AiConnector, opts: ClientOptions = CLIENT): AiClient {
  const spec = AI_PROVIDER_SPEC[c.provider];
  if (!c.key && !spec.keyOptional) throw new Error("IA non configurée : aucune clé pour ce fournisseur");
  if (spec.wire !== "messages") return translatedClient(c, opts === CLIENT ? undefined : opts);
  const key = c.key ?? "";
  const sdk = { maxRetries: opts.maxRetries, timeout: opts.timeout };
  // Adresses et ressource toujours données en entier : le SDK lirait sinon ANTHROPIC_BASE_URL ou
  // ANTHROPIC_FOUNDRY_RESOURCE dans l'environnement, qui n'ont pas à contredire les réglages.
  if (c.provider === "anthropic") return claudeClient(new Anthropic({ apiKey: key, baseURL: spec.baseUrl, ...sdk }));
  if (!c.url) throw new Error("IA non configurée : aucune adresse pour ce fournisseur");
  if (c.provider === "foundry") {
    // Une ressource Azure se désigne par son nom (client dédié, comme depuis le début) ; une passerelle d'entreprise, par son adresse.
    const resource = foundryResource(c.url);
    return claudeClient(
      resource && c.url === `https://${resource}.services.ai.azure.com/anthropic`
        ? new AnthropicFoundry({ apiKey: key, resource, baseURL: null, ...sdk })
        : new AnthropicFoundry({ apiKey: key, baseURL: c.url, resource: null, fetch: guardedFetch, ...sdk }),
    );
  }
  // Passerelle : la clé part dans les deux en-têtes en usage (Authorization par défaut, X-Api-Key en plus).
  return claudeClient(new Anthropic({ apiKey: key, baseURL: c.url, defaultHeaders: { "X-Api-Key": key }, fetch: guardedFetch, ...sdk }));
}

let built: { signature: string; client: AiClient } | null = null;
/** Client du fournisseur choisi, reconstruit quand sa configuration change. */
function realClient(): AiClient {
  const c = activeConnector();
  const signature = [c.provider, c.url, c.key, c.model, c.context].join("\n");
  if (built?.signature !== signature) built = { signature, client: buildClient(c) };
  return built.client;
}

/**
 * Client d'IA. En mode démo, tout ce qui part (consignes, outils, messages et résultats d'outils)
 * passe par demoSafe : filet de sécurité pour qu'aucun vrai prénom du foyer ne quitte une session de démo
 * (les consignes et les outils n'en contiennent pas, les données de la démo non plus). Les blocs de réflexion ne sont jamais touchés (signés).
 */
export const aiClient = (): AiClient => {
  const c = realClient();
  if (!isDemo()) return c;
  return { messages: { create: (p, o) => c.messages.create(demoParams(p), o), stream: (p, o) => c.messages.stream(demoParams(p), o) } };
};

/** Ressource Azure et clé du fournisseur Foundry : le mode vocal s'en sert, quel que soit le fournisseur choisi pour Claude. */
export function foundryAccess(): { resource: string; key: string } | null {
  const c = aiConfig().connectors.foundry;
  const resource = foundryResource(c.url);
  return resource && c.key ? { resource, key: c.key } : null;
}

/* ---------- Essai d'un fournisseur ---------- */

/** Libellé d'un champ repris au milieu d'une phrase (déjà dans la langue de la requête) : en minuscules, sauf en allemand où un nom garde sa majuscule. */
const inSentence = (label: string) => (currentLang() === "de" ? label : label.toLowerCase());

/** Ce qui manque à un fournisseur pour répondre, en clair (texte lu dans les Réglages : langue de la requête). */
export function missingFor(c: AiConnector): string | null {
  if (c.ready) return null;
  const spec = AI_PROVIDER_SPEC[c.provider];
  const url = AI_PROVIDER_INFO[c.provider].url;
  const noKey = !c.key && !spec.keyOptional;
  if (url && !c.url) return noKey ? tr("Il manque l'adresse et la clé.") : tr("Il manque l'adresse ({champ}).", { champ: inSentence(url.label) });
  if (noKey) return c.keyUnreadable ? tr("La clé enregistrée n'est plus lisible : ressaisis-la.") : tr("Il manque la clé.");
  return tr("Il manque le modèle : choisis-en un.");
}

/** Pourquoi Pécule refuse de joindre une adresse, dans la langue du membre. */
export function refusedText(e: HttpRefused): string {
  if (e.reason === "introuvable") return tr("Adresse introuvable : « {hote} » ne mène nulle part depuis Pécule.", { hote: e.host });
  if (e.reason === "clair") return tr("En http, Pécule ne joint que la machine ou le réseau local, et cette adresse mène ailleurs : écris-la en https.");
  if (e.reason === "publique") return tr("Cette adresse mène à la machine ou au réseau local : ce fournisseur ne se joint qu'à une adresse publique.");
  if (e.reason === "identifiants") return tr("L'adresse ne doit pas porter d'identifiants : la clé va dans son champ.");
  return tr("Il faut une adresse en https.");
}

/** Ce qui n'a pas marché avec un fournisseur, en clair (texte lu dans les Réglages : langue de la requête). */
export function connectorError(c: AiConnector, e: unknown): string {
  // quoi : « déploiement » ou « modèle », selon le fournisseur.
  const names = { quoi: inSentence(AI_PROVIDER_INFO[c.provider].modelLabel), modele: c.model };
  const claude = AI_PROVIDER_SPEC[c.provider].wire === "messages";
  if (e instanceof ActionError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return tr("Clé refusée par le fournisseur.");
  if (e instanceof Anthropic.PermissionDeniedError) return tr("Cette clé n'a pas accès au {quoi} « {modele} ».", names);
  if (e instanceof Anthropic.NotFoundError)
    return c.url ? tr("Le {quoi} « {modele} » est introuvable à cette adresse (ou l'adresse est incorrecte).", names) : tr("Le {quoi} « {modele} » est introuvable.", names);
  if (e instanceof Anthropic.RateLimitError) return tr("Le fournisseur répond, mais son quota est atteint pour l'instant (429) : réessaie dans une minute.");
  if (e instanceof Anthropic.APIError && e.status === 402) return tr("Le fournisseur répond, mais le compte n'a plus de crédit.");
  if (e instanceof Anthropic.BadRequestError) return tr("Demande refusée par le fournisseur : {detail}", { detail: e.message.slice(0, 200) });
  if (e instanceof Anthropic.APIConnectionTimeoutError) return tr("Pas de réponse dans le délai de l'essai.");
  // Une adresse que Pécule refuse de joindre dit pourquoi (http hors du réseau local, nom introuvable).
  if (e instanceof Anthropic.APIConnectionError) return e.cause instanceof HttpRefused ? refusedText(e.cause) : c.url ? tr("Adresse injoignable : vérifie-la.") : tr("Le fournisseur est injoignable pour l'instant.");
  if (e instanceof Anthropic.APIError) {
    // Une page web en réponse : l'adresse mène ailleurs que sur l'API.
    if (/<(!doctype|html|body)\b/i.test(e.message))
      return claude
        ? e.status != null
          ? tr("Cette adresse ne répond pas comme l'API Messages de Claude (réponse {statut}).", { statut: e.status })
          : tr("Cette adresse ne répond pas comme l'API Messages de Claude (réponse inattendue).")
        : tr("Cette adresse ne répond pas comme le service attendu : vérifie-la.");
    const detail = e.message.slice(0, 200);
    return e.status != null ? tr("Le fournisseur a répondu {statut} : {detail}", { statut: e.status, detail }) : tr("Le fournisseur a répondu une erreur : {detail}", { detail });
  }
  return e instanceof Error ? e.message.slice(0, 200) : tr("Essai impossible");
}

/** Délai de l'essai : court pour un service en ligne, plus long pour un serveur local qui charge d'abord son modèle. */
const TEST: ClientOptions = { maxRetries: 0, timeout: 30_000, localTimeout: 180_000 };

/**
 * Ce que le service dit du modèle choisi et qui limitera Pécule, en clair : un modèle qui n'appelle pas d'outils ne
 * peut pas servir d'assistant, un modèle qui ne lit pas les images ne lira ni photo ni scan.
 */
async function modelNotes(c: AiConnector): Promise<string[]> {
  if (!AI_PROVIDER_SPEC[c.provider].lists) return [];
  const traits = await modelTraits(c);
  const notes: string[] = [];
  if (traits?.tools === false) notes.push(tr("Ce modèle ne sait pas appeler d'outils : l'assistant ne pourra pas lire tes comptes."));
  if (traits?.vision === false) notes.push(tr("Ce modèle ne lit pas les images : une photo ou un scan ne seront pas lus."));
  return notes;
}

/**
 * Envoie une demande minuscule à un fournisseur (tel qu'il est configuré, ou tel qu'on s'apprête à l'enregistrer).
 * `notes` : ce que le modèle ne saura pas faire, quand le service le dit.
 */
export async function testConnector(c: AiConnector): Promise<{ ok: boolean; error?: string; ms: number; notes?: string[] }> {
  const missing = missingFor(c);
  if (missing) return { ok: false, error: missing, ms: 0 };
  const started = Date.now();
  try {
    const r = await buildClient(c, TEST).messages.create({ model: c.model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] });
    const ms = Date.now() - started;
    // Une adresse qui répond autre chose que l'API attendue (page d'accueil, autre API) n'est pas un fournisseur utilisable.
    if (!r || typeof r !== "object" || !Array.isArray(r.content) || !r.usage) return { ok: false, error: tr("Cette adresse ne répond pas comme l'API Messages de Claude."), ms };
    await recordUsage("test", c.model, r.usage);
    const notes = await modelNotes(c).catch(() => []);
    return { ok: true, ms, ...(notes.length ? { notes } : {}) };
  } catch (e) {
    return { ok: false, error: connectorError(c, e), ms: Date.now() - started };
  }
}

/* ---------- Mode démo : la famille fictive à la place de la vraie ---------- */

/** Vrais prénoms du foyer → prénoms de la démo. Posée par la préparation de la démo (`demo.ts`), d'après la vraie base. */
let demoSwap: [RegExp, string][] = [];
export function setDemoNames(pairs: [real: string, fictional: string][]): void {
  demoSwap = pairs
    .filter(([real]) => real.trim().length >= 2)
    .map(([real, fictional]) => [new RegExp(`(?<![\\p{L}])${real.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "giu"), fictional]);
}
/** Filet de sécurité : aucun vrai prénom du foyer ne part chez le fournisseur d'IA depuis une session de démo. */
export const demoSafe = (s: string) => demoSwap.reduce((t, [re, to]) => t.replace(re, (m) => (m === m.toLowerCase() ? to.toLowerCase() : to)), s);
const demoJson = <T>(v: T): T => JSON.parse(demoSafe(JSON.stringify(v))) as T;

type Block = { type: string; text?: string; content?: unknown; input?: unknown };
function demoBlock(b: Block): Block {
  if (b.type === "text" && typeof b.text === "string") return { ...b, text: demoSafe(b.text) };
  if (b.type === "tool_result") return { ...b, content: typeof b.content === "string" ? demoSafe(b.content) : Array.isArray(b.content) ? (b.content as Block[]).map(demoBlock) : b.content };
  return b; // réflexion (signée), appels d'outils, images, documents : intacts
}
function demoParams<P>(params: P): P {
  const p = { ...(params as Record<string, unknown>) };
  if (typeof p.system === "string") p.system = demoSafe(p.system);
  else if (Array.isArray(p.system)) p.system = (p.system as Block[]).map(demoBlock);
  if (p.tools) p.tools = demoJson(p.tools);
  if (Array.isArray(p.messages))
    p.messages = (p.messages as { role: string; content: unknown }[]).map((m) => ({
      ...m,
      content: typeof m.content === "string" ? demoSafe(m.content) : Array.isArray(m.content) ? (m.content as Block[]).map(demoBlock) : m.content,
    }));
  return p as P;
}

/* ---------- Coût ---------- */

// Tarifs et calcul : src/lib/ai-usage.ts (purs, partagés avec l'écran du coût).
export { usageCostUsd, type Usage } from "../lib/ai-usage.ts";

let fx: { rate: number; at: number } | null = null;
/**
 * Euros pour un dollar : cours de référence du jour (Banque centrale européenne), à défaut celui que la synchro
 * crypto a gardé, à défaut 0,86. Le coût de l'IA est compté en euros, quelle que soit la devise du foyer.
 */
export function usdToEur(): Promise<number> {
  if (fx && Date.now() - fx.at < 3600_000) return Promise.resolve(fx.rate);
  // Une seule lecture à la fois : plusieurs réponses de l'IA au même moment attendent la même.
  reading ??= (async () => {
    const rate = await runReal(() => fxRate("USD", "EUR")).catch(() => null);
    const row = rate ? undefined : await one<{ price_eur: number }>("SELECT price_eur FROM prices WHERE id = 'fx:USD'").catch(() => undefined);
    fx = { rate: rate || (row?.price_eur ? Number(row.price_eur) : 0.86), at: Date.now() };
    return fx.rate;
  })().finally(() => {
    reading = null;
  });
  return reading;
}
let reading: Promise<number> | null = null;

const meter = new AsyncLocalStorage<{ eur: number }>();
/** Exécute une tâche en additionnant le coût des appels à l'IA qu'elle déclenche (import massif : coût par fichier). */
export async function meterCost<T>(fn: () => Promise<T>): Promise<{ value: T | undefined; error: unknown; eur: number }> {
  const store = { eur: 0 };
  try {
    return { value: await meter.run(store, fn), error: undefined, eur: store.eur };
  } catch (error) {
    return { value: undefined, error, eur: store.eur };
  }
}

/** Enregistre la consommation d'un appel à Claude ; renvoie son coût en euros. Ne fait jamais échouer l'appelant. */
export async function recordUsage(feature: string, model: string, u: Usage, threadId?: string | null): Promise<number> {
  const custom = await customPrices().catch(() => ({}));
  // Un fournisseur traduit dit lui-même sous quel nom son modèle est compté (`usageModel`).
  const counted = u.label || model;
  return recordCost(feature, counted, usageCostUsd(counted, u, custom), u, threadId);
}

const NO_TOKENS: Usage = { input_tokens: 0, output_tokens: 0 };

/**
 * Enregistre un appel dont le coût en dollars est déjà connu (mode vocal : lecture comptée au caractère,
 * transcription à l'audio) ; renvoie son coût en euros. Ne fait jamais échouer l'appelant.
 */
export async function recordCost(feature: string, model: string, usd: number, u: Usage = NO_TOKENS, threadId?: string | null): Promise<number> {
  // Le coût d'une démo est un vrai coût : il est compté dans la vraie base (sans la conversation, restée en démo).
  if (isDemo()) return runReal(() => recordCost(`${feature}${DEMO_SUFFIX}`, model, usd, u, null));
  try {
    const eur = usd * (await usdToEur());
    await exec(
      `INSERT INTO ai_usage (user_id, thread_id, feature, model, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, cost_usd, cost_eur)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [currentActor().userId, threadId ?? null, feature.slice(0, 24), model.slice(0, 64), u.input_tokens, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.output_tokens, usd, eur],
    );
    addSpent(eur);
    const m = meter.getStore();
    if (m) m.eur += eur;
    return eur;
  } catch (e) {
    console.error("[coût IA]", e);
    const m = meter.getStore();
    if (m) m.eur += usd * 0.86;
    return usd * 0.86;
  }
}
