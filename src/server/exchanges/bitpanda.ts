/*
 * Bitpanda, en lecture seule, par son API publique (l'ancienne, api.bitpanda.com, ferme le 31 janvier 2027) : le
 * portefeuille (`/v1/portfolio`, droit « Balances »), puis le nom de chaque actif et de chaque monnaie (droit
 * « Trade (Read) »). Seules les cryptos et la monnaie sont gardées ; une clé qui peut écrire est refusée.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";

const API = "https://api.public.bitpanda.com";
const PATHS = new Set(["/v1/api-keys/current", "/v1/portfolio", "/v1/assets", "/v1/currencies"]);
const CHUNK = 50;

export async function readBitpanda(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  const get = async (path: string, query = "") => {
    if (!PATHS.has(path)) throw new Error(`Bitpanda : chemin non autorisé ${path}`);
    const res = await http(`${API}${path}${query}`, { headers: { "x-api-key": creds.key.trim() } });
    if (res.status === 200) return obj(res.body);
    throw new ExchangeError(`Bitpanda : ${text(list(obj(res.body).errors)[0]?.title) || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403);
  };

  // Les droits de la clé d'abord : aucun qui écrive. Si Bitpanda ne les donne pas, la lecture continue.
  const current = await get("/v1/api-keys/current").catch(() => null);
  const scopes = current ? JSON.stringify(current.scopes ?? obj(current.data).scopes ?? []) : "";
  if (/write/i.test(scopes)) throw new ExchangeError("Bitpanda : cette clé peut faire plus que lire (un droit « Write »). Crée une clé avec « Balances » et « Trade (Read) » seulement.", true);

  const entries = list((await get("/v1/portfolio")).data);
  const ids = [...new Set(entries.map((e) => text(e.asset_id)).filter(Boolean))];
  const assets = new Map<string, { symbol: string; type: string }>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const page = await get("/v1/assets", `?page_size=${CHUNK}&id=${ids.slice(i, i + CHUNK).map(encodeURIComponent).join(",")}`);
    for (const a of list(page.data)) assets.set(text(a.id), { symbol: text(a.symbol).toUpperCase(), type: text(a.type) });
  }
  const currencies = new Map(list((await get("/v1/currencies")).data).map((c) => [text(c.id), text(c.symbol).toUpperCase()]));

  const rows: { symbol: string | null; quantity: number }[] = [];
  const pricesEur = new Map<string, number>();
  for (const e of entries) {
    const quantity = amountOf(obj(e.balance).value);
    const asset = assets.get(text(e.asset_id));
    // Actions, ETF et métaux ont leur place ailleurs dans le patrimoine : seules les cryptos entrent ici.
    if (asset && asset.type && !/crypto/i.test(asset.type)) continue;
    const symbol = asset?.symbol || currencies.get(text(e.currency_id)) || null;
    rows.push({ symbol, quantity });
    // La contre-valeur que donne Bitpanda, quand elle est en euros, vaut cours pour ce que CoinGecko ne suit pas.
    const worth = obj(e.currency_balance);
    if (symbol && quantity && currencies.get(text(worth.currency_id)) === "EUR" && amountOf(worth.value)) pricesEur.set(symbol, amountOf(worth.value) / quantity);
  }
  const balances = sumBySymbol(rows);
  return { balances, pricesEur, unread: [], note: `${balances.length} actifs` };
}
