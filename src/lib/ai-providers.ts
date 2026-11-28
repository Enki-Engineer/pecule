/*
 * Fournisseurs d'IA : qui répond à Pécule (assistant, lecture des factures, des documents et des bulletins).
 * Pur, partagé par le serveur et l'écran des réglages.
 *
 * Le code de Pécule parle l'API Messages de Claude (boucle d'outils, réflexion adaptative, points de cache, sortie
 * structurée, lecture de PDF). Un fournisseur dit par `wire` quelle API il parle, lui :
 * - « messages » : l'API Messages elle-même (Claude, où qu'il soit servi) — rien à traduire ;
 * - « responses » : l'API Responses d'OpenAI ;
 * - « chat » : l'API Chat Completions, celle que presque tous les autres services ont reprise ;
 * - « ollama » : l'API d'Ollama, la seule par laquelle la fenêtre de contexte se règle à chaque demande.
 * Les trois dernières passent par une traduction (`src/lib/ai-wire*.ts`, `src/server/ai-wires.ts`).
 *
 * Ajouter un fournisseur = une entrée dans AI_PROVIDERS, AI_PROVIDER_SPEC et AI_PROVIDER_INFO ; s'il parle
 * l'API Messages, sa construction dans `buildClient` (src/server/ai.ts) ; sinon, rien de plus tant qu'il parle
 * l'une des API déjà traduites.
 */

import { localized, tk } from "./i18n.ts";
import { isLocalAddress } from "./net.ts";

export const AI_PROVIDERS = ["foundry", "anthropic", "compatible", "openai", "openrouter", "ollama", "openai-compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const isAiProvider = (v: unknown): v is AiProvider => typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);

export const DEFAULT_AI_PROVIDER: AiProvider = "foundry";
export const DEFAULT_AI_MODEL = "claude-opus-5-5";
/** Modèles Claude proposés à la saisie (le champ reste libre : un déploiement Foundry porte le nom qu'on lui a donné). */
export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

/** L'API que parle un fournisseur. */
export type AiWire = "messages" | "responses" | "chat" | "ollama";

/**
 * Ce qu'un fournisseur demande et permet.
 * `address` : « fixe » (l'adresse du service est écrite ici), « publique » (saisie, https vers un nom de domaine
 * public), « locale » (saisie, et qui peut être celle de la machine ou du réseau local — en clair seulement là).
 */
export type AiProviderSpec = {
  wire: AiWire;
  /** Sous quel titre il est rangé dans les réglages. */
  family: "claude" | "autres";
  address: "fixe" | "publique" | "locale";
  /** Adresse du service, quand elle est fixe. */
  baseUrl?: string;
  /** Peut répondre sans clé (un serveur de modèles sur la machine ou le réseau local). */
  keyOptional?: boolean;
  /** Modèle pris tant que rien n'est choisi ; vide : il faut en choisir un. */
  defaultModel: string;
  /** Modèles proposés à la saisie, quand le service ne donne pas sa liste. */
  models: string[];
  /** Le service donne la liste de ses modèles : l'écran la propose (`POST /api/ai/models`). */
  lists?: boolean;
  /** La fenêtre de contexte se règle ici (Ollama). */
  context?: boolean;
};

export const AI_PROVIDER_SPEC: Record<AiProvider, AiProviderSpec> = {
  foundry: { wire: "messages", family: "claude", address: "publique", defaultModel: DEFAULT_AI_MODEL, models: AI_MODELS },
  anthropic: { wire: "messages", family: "claude", address: "fixe", baseUrl: "https://api.anthropic.com", defaultModel: DEFAULT_AI_MODEL, models: AI_MODELS },
  compatible: { wire: "messages", family: "claude", address: "publique", defaultModel: DEFAULT_AI_MODEL, models: AI_MODELS },
  // Modèles et modèle de départ : ceux que la documentation d'OpenAI conseille (novembre 2026). Le champ reste libre.
  openai: { wire: "responses", family: "autres", address: "fixe", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-6.2-sol", models: ["gpt-6.2-sol", "gpt-6.2-astra", "gpt-6.1-terra", "gpt-6-luna"] },
  openrouter: { wire: "chat", family: "autres", address: "fixe", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "", models: [], lists: true },
  ollama: { wire: "ollama", family: "autres", address: "locale", keyOptional: true, defaultModel: "", models: [], lists: true, context: true },
  "openai-compatible": { wire: "chat", family: "autres", address: "locale", keyOptional: true, defaultModel: "", models: [], lists: true },
};

/**
 * Un modèle que le service propose, avec ce qu'il en dit. `tools` : il sait appeler des outils (l'assistant en a
 * besoin) ; `vision` : il lit les images (photos, scans). Absents quand le service ne le dit pas.
 */
export type AiModelChoice = { id: string; name?: string; note?: string; tools?: boolean; vision?: boolean; size?: number; context?: number; price?: { input: number; output: number } };

/**
 * Fenêtre de contexte demandée à Ollama, en jetons : celle de départ, et les bornes de ce qui se saisit. Les consignes
 * et les outils de l'assistant en prennent à eux seuls près de 27 000 (mesuré le 28/11/2026 sur un modèle Qwen) : la
 * valeur de départ laisse de quoi lire les résultats des outils et répondre.
 */
export const OLLAMA_CONTEXT = { default: 65_536, min: 4_096, max: 1_048_576, assistant: 27_000 };
/** Adresse où Ollama écoute quand rien n'a été changé. */
export const OLLAMA_PORT = 11_434;

type UrlField = { label: string; placeholder: string; hint: string };
export const AI_PROVIDER_INFO: Record<AiProvider, { label: string; hint: string; url: UrlField | null; keyPlaceholder: string; modelLabel: string }> = {
  foundry: localized(
    {
      label: "Microsoft Foundry",
      hint: tk("Claude servi par une ressource Azure AI Foundry"),
      url: localized(
        {
          label: tk("Ressource ou adresse"),
          placeholder: tk("ma-ressource ou https://ma-ressource.services.ai.azure.com/anthropic"),
          hint: tk("Le nom de la ressource Azure suffit. Une passerelle d'entreprise s'écrit avec son adresse complète."),
        },
        "label", "placeholder", "hint",
      ),
      keyPlaceholder: tk("Clé de la ressource"),
      modelLabel: tk("Déploiement"),
    },
    "label", "hint", "keyPlaceholder", "modelLabel",
  ),
  anthropic: localized(
    {
      label: "API Claude (Anthropic)",
      hint: tk("Claude en direct, facturé par Anthropic"),
      url: null,
      keyPlaceholder: "sk-ant-…",
      modelLabel: tk("Modèle"),
    },
    "label", "hint", "keyPlaceholder", "modelLabel",
  ),
  compatible: localized(
    {
      label: tk("Passerelle compatible"),
      hint: tk("Tout service qui expose l'API Messages de Claude à sa propre adresse"),
      url: localized(
        {
          label: tk("Adresse"),
          placeholder: "https://passerelle.exemple.com",
          hint: tk("Adresse de base, sans « /v1/messages ». Le modèle servi doit être un modèle Claude."),
        },
        "label", "placeholder", "hint",
      ),
      keyPlaceholder: tk("Clé ou jeton de la passerelle"),
      modelLabel: tk("Modèle"),
    },
    "label", "hint", "keyPlaceholder", "modelLabel",
  ),
  openai: localized(
    {
      label: "OpenAI",
      hint: tk("Les modèles GPT, facturés par OpenAI"),
      url: null,
      keyPlaceholder: "sk-…",
      modelLabel: tk("Modèle"),
    },
    "hint", "modelLabel",
  ),
  openrouter: localized(
    {
      label: "OpenRouter",
      hint: tk("Des centaines de modèles avec une seule clé, facturés par OpenRouter"),
      url: null,
      keyPlaceholder: "sk-or-…",
      modelLabel: tk("Modèle"),
    },
    "hint", "modelLabel",
  ),
  ollama: localized(
    {
      label: "Ollama",
      hint: tk("Des modèles ouverts qui tournent chez toi : rien ne part chez un fournisseur"),
      url: localized(
        {
          label: tk("Adresse"),
          placeholder: "http://localhost:11434",
          hint: tk("Là où Ollama écoute. En http, seulement sur la machine ou le réseau local."),
        },
        "label", "hint",
      ),
      keyPlaceholder: tk("Aucune, le plus souvent"),
      modelLabel: tk("Modèle"),
    },
    "hint", "keyPlaceholder", "modelLabel",
  ),
  "openai-compatible": localized(
    {
      label: tk("Compatible OpenAI"),
      hint: tk("LM Studio, Mistral, Groq, vLLM… : tout service qui parle l'API « Chat Completions »"),
      url: localized(
        {
          label: tk("Adresse"),
          placeholder: "http://localhost:1234/v1",
          hint: tk("Adresse de base, « /v1 » compris, sans « /chat/completions ». En http, seulement sur la machine ou le réseau local."),
        },
        "label", "hint",
      ),
      keyPlaceholder: tk("Aucune, le plus souvent"),
      modelLabel: tk("Modèle"),
    },
    "label", "hint", "keyPlaceholder", "modelLabel",
  ),
};

/* ---------- Adresses ---------- */

/** Nom de ressource Azure nu : lettres, chiffres et tirets. */
const RESOURCE_NAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/i;

/**
 * Un hôte vers lequel le serveur accepte d'envoyer une clé et des données : un nom de domaine public.
 * Ni machine locale, ni adresse IP (une adresse saisie dans les réglages ne doit pas permettre de
 * sonder le réseau de l'hébergement).
 */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (!h.includes(".") || h.includes(":") || h.startsWith("[")) return false;
  if (/^[\d.]+$/.test(h)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(h);
}

/** Lit une adresse https saisie à la main (schéma facultatif) ; null si elle est inutilisable. */
function parseHttps(input: string): URL | null {
  const s = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  // https seulement : une clé ne voyage pas en clair. Pas d'identifiants dans l'adresse.
  if (url.protocol !== "https:" || url.username || url.password || !isPublicHost(url.hostname)) return null;
  return url;
}

/** Chemin sans barre finale, débarrassé de ce que le SDK ajoute lui-même (« /v1/messages »). */
const basePath = (url: URL) => url.pathname.replace(/\/+$/, "").replace(/\/v1(\/messages)?$/i, "");

/**
 * Adresse d'une ressource Foundry, telle que le SDK l'attend : `https://<ressource>.services.ai.azure.com/anthropic`.
 * Accepte le simple nom de la ressource, un hôte nu, ou l'adresse complète copiée du portail Azure
 * (`…/anthropic/v1/messages`). Une passerelle d'entreprise garde son chemin. null = rien d'exploitable.
 */
export function normalizeFoundryUrl(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  if (RESOURCE_NAME.test(s)) return `https://${s.toLowerCase()}.services.ai.azure.com/anthropic`;
  const url = parseHttps(s);
  return url ? `https://${url.host}${basePath(url) || "/anthropic"}` : null;
}

/**
 * Nom de la ressource Azure d'une adresse Foundry : c'est par lui que le mode vocal rejoint les autres
 * services de la même ressource (transcription, voix) avec la même clé. Une passerelle ne le révèle pas → null.
 */
export function foundryResource(url: string | null | undefined): string | null {
  if (!url) return null;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return /^([a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?)\.(?:services\.ai|openai|cognitiveservices)\.azure\.com$/.exec(host)?.[1] ?? null;
}

/** Adresse de base d'une passerelle compatible (le SDK y ajoute « /v1/messages ») ; null si inutilisable. */
export function normalizeGatewayUrl(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const url = parseHttps(s);
  return url ? `https://${url.host}${basePath(url)}` : null;
}

/**
 * Un hôte qui a tout l'air d'être sur la machine ou le réseau local, d'après son seul nom : sans point, de suffixe
 * local, ou adresse IP locale. Ne sert qu'à deviner le schéma d'une adresse écrite sans lui : ce qu'une adresse a le
 * droit de recevoir se décide au serveur, d'après ce vers quoi son nom mène (`destination`, `src/server/ai-http.ts`).
 */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(h) || h.includes(":")) return isLocalAddress(h);
  return !h.includes(".") || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(h);
}

/**
 * Lit l'adresse d'un service qui peut être sur la machine ou le réseau local (Ollama, LM Studio…). Sans schéma :
 * http pour un hôte local (avec `barePort`, le port habituel du service), https pour le reste. null si inutilisable.
 * Une adresse en http écrite en entier est gardée telle quelle : c'est le serveur qui refuse de la joindre si son nom
 * ne mène pas à la machine ou au réseau local (un nom de réseau privé virtuel y mène, et rien ne le dit dans le nom).
 */
function parseOpen(input: string, barePort?: number): URL | null {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input);
  let url: URL;
  try {
    url = new URL(hasScheme ? input : `http://${input}`);
    if (!hasScheme) {
      if (!isLocalHost(url.hostname)) url = new URL(`https://${input}`);
      else if (!url.port && barePort) url.port = String(barePort);
    }
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return null;
  return url;
}

/** Adresse d'un Ollama, sans ce que Pécule ajoute lui-même (« /api/chat ») : `http://localhost:11434`, `https://ollama.com`. */
export function normalizeOllamaUrl(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const url = parseOpen(s, OLLAMA_PORT);
  // Seule la fin du chemin est retirée : « /ollama/api/chat » garde « /ollama », un chemin qui contient « api » reste entier.
  return url ? `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "").replace(/\/(api(\/(chat|generate|tags|show|version|ps))?|v1(\/(chat\/completions|models|messages|responses))?)$/i, "")}` : null;
}

/**
 * Adresse de base d'un service compatible OpenAI, « /v1 » compris (Pécule y ajoute « /chat/completions ») :
 * `http://localhost:1234/v1`, `https://api.mistral.ai/v1`. Une adresse sans chemin reçoit « /v1 ».
 */
export function normalizeOpenAiUrl(input: string | null | undefined): string | null {
  const s = (input ?? "").trim();
  if (!s) return null;
  const url = parseOpen(s);
  if (!url) return null;
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(chat\/completions|completions|models|responses)$/i, "");
  return `${url.protocol}//${url.host}${path || "/v1"}`;
}

/** Adresse d'un fournisseur sous sa forme enregistrée ; null si vide, inutilisable, ou si le fournisseur n'en a pas. */
export function normalizeAiUrl(provider: AiProvider, input: string | null | undefined): string | null {
  if (provider === "foundry") return normalizeFoundryUrl(input);
  if (provider === "compatible") return normalizeGatewayUrl(input);
  if (provider === "ollama") return normalizeOllamaUrl(input);
  if (provider === "openai-compatible") return normalizeOpenAiUrl(input);
  return null;
}

/** Fenêtre de contexte saisie, ramenée dans ses bornes ; null si ce n'est pas un nombre. */
export function cleanContext(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(OLLAMA_CONTEXT.max, Math.max(OLLAMA_CONTEXT.min, Math.round(n))) : null;
}

/* ---------- Configuration ---------- */

/** Ce qui est gardé en base (`app_kv`, clé `ai:config`) : les clés d'accès y sont chiffrées. */
export type StoredAiConfig = {
  provider?: string;
  connectors?: Partial<Record<AiProvider, { url?: string; model?: string; key?: string; context?: number }>>;
};

/** Valeurs de départ posées par l'hébergement (variables d'environnement) : elles ne valent que pour Foundry. */
export type AiDefaults = { foundryResource?: string; foundryKey?: string; model?: string };

/** D'où vient une valeur : saisie dans les réglages, ou posée par l'hébergement. */
export type AiSource = "reglages" | "hebergement" | null;

export type AiConnector = {
  provider: AiProvider;
  /** Adresse saisie (ou posée par l'hébergement) ; null pour un service à adresse fixe. */
  url: string | null;
  urlSource: AiSource;
  /** Modèle (ou déploiement) ; vide tant qu'aucun n'est choisi, pour un fournisseur qui n'en propose pas un d'office. */
  model: string;
  key: string | null;
  keySource: AiSource;
  /** Une clé est enregistrée mais ne se déchiffre plus (secret du serveur changé) : à ressaisir. */
  keyUnreadable: boolean;
  /** Fenêtre de contexte demandée, en jetons (Ollama) ; null ailleurs. */
  context: number | null;
  /** Tout ce qu'il faut pour appeler : un modèle, une clé si le fournisseur en demande une, une adresse s'il n'en a pas de fixe. */
  ready: boolean;
};

export type AiConfig = { provider: AiProvider; connectors: Record<AiProvider, AiConnector> };

/**
 * Configuration effective : ce qui est enregistré dans les réglages, complété par les valeurs de
 * l'hébergement pour Foundry. `open` déchiffre une clé (null si illisible).
 */
export function resolveAiConfig(stored: StoredAiConfig, defaults: AiDefaults, open: (sealed: string) => string | null): AiConfig {
  const connectors = {} as Record<AiProvider, AiConnector>;
  for (const provider of AI_PROVIDERS) {
    const spec = AI_PROVIDER_SPEC[provider];
    const s = stored.connectors?.[provider] ?? {};
    const fromHost = provider === "foundry";
    const savedKey = s.key ? open(s.key) : null;
    const hostKey = fromHost ? defaults.foundryKey || null : null;
    const savedUrl = normalizeAiUrl(provider, s.url);
    const hostUrl = fromHost ? normalizeFoundryUrl(defaults.foundryResource) : null;
    const key = savedKey ?? hostKey;
    const url = savedUrl ?? hostUrl;
    const model = s.model?.trim() || (fromHost && defaults.model) || spec.defaultModel;
    connectors[provider] = {
      provider,
      url,
      urlSource: savedUrl ? "reglages" : hostUrl ? "hebergement" : null,
      model,
      key,
      keySource: savedKey ? "reglages" : hostKey ? "hebergement" : null,
      keyUnreadable: Boolean(s.key) && savedKey === null,
      context: spec.context ? (cleanContext(s.context) ?? OLLAMA_CONTEXT.default) : null,
      ready: Boolean(model) && (Boolean(key) || spec.keyOptional === true) && (spec.address === "fixe" || Boolean(url)),
    };
  }
  return { provider: isAiProvider(stored.provider) ? stored.provider : DEFAULT_AI_PROVIDER, connectors };
}

/** Adresse de base à laquelle Pécule appelle un fournisseur : celle du service, ou celle des réglages. */
export const connectorBase = (c: Pick<AiConnector, "provider" | "url">): string | null => AI_PROVIDER_SPEC[c.provider].baseUrl ?? c.url;

/** Ce que l'écran des réglages reçoit : jamais une clé, seulement si elle existe et d'où elle vient. */
export type AiConnectorStatus = Omit<AiConnector, "key"> & { id: AiProvider; active: boolean; keySet: boolean };
export type AiStatus = { provider: AiProvider; enabled: boolean; connectors: AiConnectorStatus[] };

export function aiStatusOf(config: AiConfig): AiStatus {
  return {
    provider: config.provider,
    enabled: config.connectors[config.provider].ready,
    connectors: AI_PROVIDERS.map((id) => {
      const { key, ...rest } = config.connectors[id];
      return { ...rest, id, active: id === config.provider, keySet: Boolean(key) };
    }),
  };
}
