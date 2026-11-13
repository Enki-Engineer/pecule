import { serviceKey } from "./service-keys.ts";

/*
 * Client CoinStats Open API, en LECTURE SEULE : la clé n'a pas de portée (elle permettrait de
 * supprimer un portefeuille), donc seuls des GET vers une liste blanche de chemins sont possibles.
 * Appels espacés de 600 ms (offre gratuite : 2 requêtes/s). La clé ne doit jamais être journalisée.
 */

const BASE = "https://openapiv1.coinstats.app";
const ALLOWED = new Set(["/portfolio/list", "/portfolio/coins", "/fiats", "/usage/credits"]);

export const coinstatsEnabled = () => Boolean(serviceKey("coinstats"));

export type CsPortfolio = { portfolioId: string; portfolioName: string; portfolioType: string; children?: CsPortfolio[] };
export type CsCoinLine = {
  count: number;
  coin: { identifier: string; symbol: string; name: string; priceChange24h?: number | null };
  price?: { USD?: number | null } | null;
};

let last = 0;
async function get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
  if (!ALLOWED.has(path)) throw new Error(`CoinStats : chemin non autorisé ${path}`);
  const key = serviceKey("coinstats");
  if (!key) throw new Error("CoinStats : clé absente");
  const wait = last + 600 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = `${BASE}${path}?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method: "GET", headers: { "X-API-KEY": key, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, Number(res.headers.get("retry-after") ?? 2) * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`CoinStats ${path} → HTTP ${res.status}`);
    const body = (await res.json()) as unknown;
    return (Array.isArray(body) ? body : ((body as { result?: unknown }).result ?? body)) as T;
  }
}

export const listPortfolios = () => get<CsPortfolio[]>("/portfolio/list", { includeChildren: "true" });

/** Lignes d'un portefeuille (toutes les pages). */
export async function portfolioCoins(portfolioId: string): Promise<CsCoinLine[]> {
  const out: CsCoinLine[] = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await get<CsCoinLine[]>("/portfolio/coins", { portfolioId, limit: 100, page });
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

/** Taux USD → EUR (les cours CoinStats sont en USD). */
export async function eurRate(): Promise<number> {
  const fiats = await get<{ name: string; rate: number }[]>("/fiats");
  const eur = fiats.find((f) => f.name === "EUR");
  if (!eur?.rate) throw new Error("CoinStats : taux EUR introuvable");
  return eur.rate;
}

export const creditsUsed = () => get<{ usedCredits: number; remainingCredits: number }>("/usage/credits");
