/*
 * Bitvavo, en lecture seule : les soldes du compte (`/balance`) et ce qui est en staking (`/stakingBalance`).
 * Signature : HMAC-SHA256 de l'heure, de la méthode, du chemin et du corps. Les cours viennent de l'API publique.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, optional, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";
import { hmacHex, nextMillis } from "./sign.ts";

const API = "https://api.bitvavo.com";
const PATHS = new Set(["/v2/balance", "/v2/stakingBalance"]);

export const bitvavoSignature = (timestamp: string, method: string, path: string, body: string, secret: string) => hmacHex(`${timestamp}${method}${path}${body}`, secret);

export async function readBitvavo(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret) throw new ExchangeError("Bitvavo : clé secrète manquante", true);
  const get = async (path: string) => {
    if (!PATHS.has(path)) throw new Error(`Bitvavo : chemin non autorisé ${path}`);
    const timestamp = String(nextMillis());
    const res = await http(`${API}${path}`, { headers: { "Bitvavo-Access-Key": creds.key, "Bitvavo-Access-Timestamp": timestamp, "Bitvavo-Access-Signature": bitvavoSignature(timestamp, "GET", path, "", creds.secret!), "Bitvavo-Access-Window": "20000" } });
    if (res.status === 200) return list(res.body);
    throw new ExchangeError(`Bitvavo : ${text(obj(res.body).error) || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403);
  };
  const balances: ExchangeReading["balances"] = sumBySymbol((await get("/v2/balance")).map((b) => ({ symbol: text(b.symbol).toUpperCase() || null, quantity: amountOf(b.available) + amountOf(b.inOrder) })));
  const unread: string[] = [];
  const staked = await optional(unread, "staking", () => get("/v2/stakingBalance"));
  if (staked) balances.push(...sumBySymbol(staked.map((b) => ({ symbol: text(b.symbol).toUpperCase() || null, quantity: amountOf(b.amount) }))).map((b) => ({ ...b, wallet: "staking" })));

  const pricesEur = new Map<string, number>();
  if (balances.length)
    await http(`${API}/v2/ticker/price`)
      .then((res) => {
        for (const t of list(res.body)) if (text(t.market).endsWith("-EUR") && amountOf(t.price)) pricesEur.set(text(t.market).slice(0, -4), amountOf(t.price));
      })
      .catch(() => undefined);
  return { balances, pricesEur, unread, note: `${new Set(balances.map((b) => b.symbol)).size} actifs` };
}
