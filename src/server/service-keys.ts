import { exec, one } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { env, sealingSecret } from "./env.ts";
import { createSealer } from "./secret.ts";

/*
 * Clés des services facultatifs (quantités crypto par CoinStats, cours par CoinGecko), réglables dans l'appli :
 * gardées chiffrées dans `app_kv` (vraie base, jamais celle de la démo), avec pour valeur de départ la variable
 * de l'hébergement du même nom. Comme pour le fournisseur d'IA : ce qui est enregistré dans les réglages prime,
 * retirer la valeur rend la main à l'hébergement. Lues en mémoire (le code les demande sans attendre).
 */

export const SERVICES = ["coinstats", "coingecko"] as const;
export type Service = (typeof SERVICES)[number];
export type KeySource = "reglages" | "hebergement" | null;

const KEY = "services:keys";
const REFRESH_MS = 60_000;
const sealer = createSealer(sealingSecret);
const defaults: Record<Service, string | undefined> = { coinstats: env.COINSTATS_API_KEY, coingecko: env.COINGECKO_DEMO_KEY };

let stored: Partial<Record<Service, string>> = {};
let loadedAt = 0;
let refreshing: Promise<void> | null = null;

export async function loadServiceKeys() {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [KEY]));
  try {
    const parsed = row ? (JSON.parse(row.value) as unknown) : {};
    stored = parsed && typeof parsed === "object" ? (parsed as Partial<Record<Service, string>>) : {};
  } catch {
    stored = {};
  }
  loadedAt = Date.now();
}

function fresh() {
  if (Date.now() - loadedAt > REFRESH_MS && !refreshing) {
    loadedAt = Date.now();
    refreshing = loadServiceKeys()
      .catch((e) => console.error("[services] clés illisibles", e))
      .finally(() => {
        refreshing = null;
      });
  }
}

/** Clé d'un service : celle des réglages, sinon celle de l'hébergement, sinon null (service éteint). */
export function serviceKey(service: Service): string | null {
  fresh();
  const sealed = stored[service];
  return (sealed ? sealer.open(sealed) : null) ?? defaults[service] ?? null;
}

/** État d'une clé, sans jamais la rendre. */
export function serviceKeyStatus(service: Service): { keySet: boolean; source: KeySource; unreadable: boolean } {
  fresh();
  const sealed = stored[service];
  const opened = sealed ? sealer.open(sealed) : null;
  return { keySet: Boolean(opened ?? defaults[service]), source: opened ? "reglages" : defaults[service] ? "hebergement" : null, unreadable: Boolean(sealed) && !opened };
}

/** Enregistre la clé d'un service (chaîne vide : la retire des réglages). */
export async function saveServiceKey(service: Service, key: string) {
  await loadServiceKeys();
  const next = { ...stored };
  if (key.trim()) next[service] = sealer.seal(key.trim());
  else delete next[service];
  await runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KEY, JSON.stringify(next)]));
  stored = next;
}
