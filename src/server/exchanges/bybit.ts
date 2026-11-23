/*
 * Bybit, en lecture seule : compte unifié (ou spot) et compte de financement. La clé est d'abord interrogée sur
 * elle-même : une clé qui n'est pas « Read-Only » est refusée. Bybit a un site pour l'Europe, où une clé du site
 * mondial est inconnue : les deux sont essayés. Signature : HMAC-SHA256 de l'heure, de la clé, de la fenêtre et
 * des paramètres.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, optional, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";
import { hmacHex, nextMillis } from "./sign.ts";

const HOSTS = ["https://api.bybit.com", "https://api.bybit.eu"];
const KEY_INFO = "/v5/user/query-api";
const WALLET = "/v5/account/wallet-balance";
const FUNDING = "/v5/asset/transfer/query-account-coins-balance";
const PATHS = new Set([KEY_INFO, WALLET, FUNDING]);
const WINDOW = "10000";
/** Clé, signature, droit, adresse IP, clé expirée. */
const REFUSALS = new Set([10003, 10004, 10005, 10010, 33004]);

export const bybitSignature = (timestamp: string, key: string, query: string, secret: string) => hmacHex(`${timestamp}${key}${WINDOW}${query}`, secret);

export async function readBybit(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret) throw new ExchangeError("Bybit : clé secrète manquante", true);
  let host = HOSTS[0];
  const get = async (path: string, params: Record<string, string> = {}) => {
    if (!PATHS.has(path)) throw new Error(`Bybit : chemin non autorisé ${path}`);
    const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => a.localeCompare(b))).toString();
    const timestamp = String(nextMillis());
    const res = await http(`${host}${path}${query ? `?${query}` : ""}`, { headers: { "X-BAPI-API-KEY": creds.key, "X-BAPI-TIMESTAMP": timestamp, "X-BAPI-SIGN": bybitSignature(timestamp, creds.key, query, creds.secret!), "X-BAPI-RECV-WINDOW": WINDOW, "X-BAPI-SIGN-TYPE": "2" } });
    const code = Number(obj(res.body).retCode);
    if (res.status === 200 && code === 0) return obj(obj(res.body).result);
    const error = new ExchangeError(`Bybit : ${text(obj(res.body).retMsg) || `HTTP ${res.status}`}`, res.status === 401 || REFUSALS.has(code));
    throw Object.assign(error, { unknownKey: code === 10003 });
  };

  let info: Record<string, unknown> | null = null;
  let failure: unknown = null;
  for (const candidate of HOSTS) {
    host = candidate;
    try {
      info = await get(KEY_INFO);
      break;
    } catch (e) {
      failure = e;
      if (!(e as { unknownKey?: boolean }).unknownKey) break;
    }
  }
  if (!info) throw failure;
  if (Number(info.readOnly) !== 1) throw new ExchangeError("Bybit : cette clé peut faire plus que lire. Crée une clé « Read-Only ».", true);

  const coins = (rows: Record<string, unknown>[]) => sumBySymbol(rows.map((c) => ({ symbol: text(c.coin).toUpperCase() || null, quantity: amountOf(c.walletBalance) })));
  const account = await get(WALLET, { accountType: Number(info.uta) === 1 ? "UNIFIED" : "SPOT" });
  const balances: ExchangeReading["balances"] = coins(list(account.list).flatMap((a) => list(a.coin))).map((b) => ({ ...b, wallet: "spot" }));
  const unread: string[] = [];
  const funding = await optional(unread, "financement", () => get(FUNDING, { accountType: "FUND" }));
  if (funding) balances.push(...coins(list(funding.balance)).map((b) => ({ ...b, wallet: "financement" })));
  return { balances, pricesEur: new Map(), unread, note: `${new Set(balances.map((b) => b.symbol)).size} actifs` };
}
