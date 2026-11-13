/*
 * Fournisseurs d'IA : qui sert Claude à Pécule (assistant, lecture des factures, des documents et des bulletins).
 * Pur, partagé par le serveur et l'écran des réglages.
 *
 * Tous parlent l'API Messages de Claude : c'est elle que le code de Pécule utilise (boucle d'outils, réflexion
 * adaptative, points de cache, sortie structurée, lecture de PDF). Ajouter un fournisseur de ce type = une
 * entrée dans AI_PROVIDERS et AI_PROVIDER_INFO, et sa construction dans `buildClient` (src/server/ai.ts).
 * Un fournisseur qui parle une autre API demanderait en plus une traduction de ces appels.
 */

import { localized, tk } from "./i18n.ts";

export const AI_PROVIDERS = ["foundry", "anthropic", "compatible"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const isAiProvider = (v: unknown): v is AiProvider => typeof v === "string" && (AI_PROVIDERS as readonly string[]).includes(v);

export const DEFAULT_AI_PROVIDER: AiProvider = "foundry";
export const DEFAULT_AI_MODEL = "claude-opus-5-5";
/** Modèles proposés à la saisie (le champ reste libre : un déploiement Foundry porte le nom qu'on lui a donné). */
export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

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

/** Adresse d'un fournisseur sous sa forme enregistrée ; null si vide, inutilisable, ou si le fournisseur n'en a pas. */
export function normalizeAiUrl(provider: AiProvider, input: string | null | undefined): string | null {
  if (provider === "foundry") return normalizeFoundryUrl(input);
  if (provider === "compatible") return normalizeGatewayUrl(input);
  return null;
}

/* ---------- Configuration ---------- */

/** Ce qui est gardé en base (`app_kv`, clé `ai:config`) : les clés d'accès y sont chiffrées. */
export type StoredAiConfig = {
  provider?: string;
  connectors?: Partial<Record<AiProvider, { url?: string; model?: string; key?: string }>>;
};

/** Valeurs de départ posées par l'hébergement (variables d'environnement) : elles ne valent que pour Foundry. */
export type AiDefaults = { foundryResource?: string; foundryKey?: string; model?: string };

/** D'où vient une valeur : saisie dans les réglages, ou posée par l'hébergement. */
export type AiSource = "reglages" | "hebergement" | null;

export type AiConnector = {
  provider: AiProvider;
  url: string | null;
  urlSource: AiSource;
  model: string;
  key: string | null;
  keySource: AiSource;
  /** Une clé est enregistrée mais ne se déchiffre plus (secret du serveur changé) : à ressaisir. */
  keyUnreadable: boolean;
  /** Tout ce qu'il faut pour appeler : une clé, et une adresse si le fournisseur en demande une. */
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
    const s = stored.connectors?.[provider] ?? {};
    const fromHost = provider === "foundry";
    const savedKey = s.key ? open(s.key) : null;
    const hostKey = fromHost ? defaults.foundryKey || null : null;
    const savedUrl = normalizeAiUrl(provider, s.url);
    const hostUrl = fromHost ? normalizeFoundryUrl(defaults.foundryResource) : null;
    const key = savedKey ?? hostKey;
    const url = savedUrl ?? hostUrl;
    connectors[provider] = {
      provider,
      url,
      urlSource: savedUrl ? "reglages" : hostUrl ? "hebergement" : null,
      model: s.model?.trim() || (fromHost && defaults.model) || DEFAULT_AI_MODEL,
      key,
      keySource: savedKey ? "reglages" : hostKey ? "hebergement" : null,
      keyUnreadable: Boolean(s.key) && savedKey === null,
      ready: Boolean(key) && (AI_PROVIDER_INFO[provider].url === null || Boolean(url)),
    };
  }
  return { provider: isAiProvider(stored.provider) ? stored.provider : DEFAULT_AI_PROVIDER, connectors };
}

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
