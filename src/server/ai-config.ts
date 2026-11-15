import { env, sealingSecret } from "./env.ts";
import { exec, one } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { createSealer } from "./secret.ts";
import { AI_PROVIDER_INFO, normalizeAiUrl, resolveAiConfig, type AiConfig, type AiConnector, type AiProvider, type StoredAiConfig } from "../lib/ai-providers.ts";

/*
 * Configuration de l'IA : fournisseur choisi et, par fournisseur, adresse, modèle et clé d'accès.
 * Réglée depuis Réglages → Comptes et connexions (bloc « Intelligence artificielle ») et gardée dans `app_kv` (clé `ai:config`), les clés chiffrées.
 * Les variables d'environnement (AI_FOUNDRY_RESOURCE, AI_FOUNDRY_API_KEY, AI_MODEL) restent les valeurs
 * de départ de Foundry : tant que rien n'est enregistré, rien ne change.
 *
 * Toujours lue et écrite dans la vraie base : une démo utilise l'IA configurée, elle ne la règle pas.
 * La configuration est gardée en mémoire (aiEnabled() est appelé partout, sans attendre) : chargée au
 * démarrage, rechargée à chaque enregistrement, et relue au plus une fois par minute en tâche de fond.
 */

const KEY = "ai:config";
const REFRESH_MS = 60_000;

// Le secret dont dérive la clé de chiffrement : le jeton d'administration, présent seulement dans l'environnement.
const sealer = createSealer(sealingSecret);
const defaults = { foundryResource: env.AI_FOUNDRY_RESOURCE, foundryKey: env.AI_FOUNDRY_API_KEY, model: env.AI_MODEL };

let stored: StoredAiConfig = {};
let config: AiConfig = resolveAiConfig(stored, defaults, sealer.open);
let loadedAt = 0;
let refreshing: Promise<void> | null = null;

/** Relit la configuration en base. */
export async function loadAiConfig(): Promise<AiConfig> {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [KEY]));
  let parsed: unknown = {};
  try {
    parsed = row ? JSON.parse(row.value) : {};
  } catch {
    parsed = {};
  }
  stored = parsed && typeof parsed === "object" ? (parsed as StoredAiConfig) : {};
  config = resolveAiConfig(stored, defaults, sealer.open);
  loadedAt = Date.now();
  return config;
}

/** Configuration effective (en mémoire). Une lecture en base est lancée en tâche de fond si elle date. */
export function aiConfig(): AiConfig {
  if (Date.now() - loadedAt > REFRESH_MS && !refreshing) {
    // Un échec (base pas encore prête au démarrage) garde la configuration connue ; nouvel essai une minute plus tard.
    loadedAt = Date.now();
    refreshing = loadAiConfig()
      .then(() => undefined)
      .catch((e) => console.error("[IA] configuration illisible", e))
      .finally(() => {
        refreshing = null;
      });
  }
  return config;
}

/** Le fournisseur qui répond aujourd'hui. */
export const activeConnector = (): AiConnector => {
  const c = aiConfig();
  return c.connectors[c.provider];
};

async function write(next: StoredAiConfig): Promise<AiConfig> {
  await runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KEY, JSON.stringify(next)]));
  return loadAiConfig();
}

export type ConnectorPatch = { key?: string; url?: string; model?: string };

/**
 * Ce que deviendrait un fournisseur avec ces valeurs, sans rien enregistrer (pour l'essayer d'abord).
 * Une valeur absente garde celle en place ; une valeur vide retire ce qui était enregistré.
 */
export async function previewConnector(provider: AiProvider, patch: ConnectorPatch): Promise<AiConnector> {
  await loadAiConfig();
  return resolveAiConfig(patched(provider, patch), defaults, sealer.open).connectors[provider];
}

function patched(provider: AiProvider, patch: ConnectorPatch): StoredAiConfig {
  const c = { ...(stored.connectors?.[provider] ?? {}) };
  if (patch.key !== undefined) {
    if (patch.key.trim()) c.key = sealer.seal(patch.key.trim());
    else delete c.key;
  }
  if (patch.url !== undefined && AI_PROVIDER_INFO[provider].url) {
    const url = normalizeAiUrl(provider, patch.url);
    if (url) c.url = url;
    else delete c.url;
  }
  if (patch.model !== undefined) {
    if (patch.model.trim()) c.model = patch.model.trim();
    else delete c.model;
  }
  return { ...stored, connectors: { ...stored.connectors, [provider]: c } };
}

/** Enregistre l'adresse, le modèle ou la clé d'un fournisseur (la clé est chiffrée). */
export async function saveConnector(provider: AiProvider, patch: ConnectorPatch): Promise<AiConfig> {
  await loadAiConfig();
  return write(patched(provider, patch));
}

/** Choisit le fournisseur qui répond. */
export async function setActiveProvider(provider: AiProvider): Promise<AiConfig> {
  await loadAiConfig();
  return write({ ...stored, provider });
}
