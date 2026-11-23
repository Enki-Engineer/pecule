/*
 * KuCoin, en lecture seule : tous les comptes (`/api/v1/accounts`). La clé va avec une phrase de passe, elle-même
 * signée (clés de version 2). Signature : HMAC-SHA256 en base 64 de l'heure, de la méthode et du chemin.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";
import { hmacBase64, nextMillis } from "./sign.ts";

const API = "https://api.kucoin.com";
const ACCOUNTS = "/api/v1/accounts";
/** Clé, phrase de passe, signature, adresse IP, droit. */
const REFUSALS = new Set(["400003", "400004", "400005", "400006", "400007"]);

export const kucoinSignature = (timestamp: string, method: string, path: string, secret: string) => hmacBase64(`${timestamp}${method}${path}`, secret);

export async function readKucoin(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret || !creds.passphrase) throw new ExchangeError("KuCoin : il manque la clé secrète ou la phrase de passe", true);
  const timestamp = String(nextMillis());
  const res = await http(`${API}${ACCOUNTS}`, {
    headers: { "KC-API-KEY": creds.key, "KC-API-SIGN": kucoinSignature(timestamp, "GET", ACCOUNTS, creds.secret), "KC-API-TIMESTAMP": timestamp, "KC-API-PASSPHRASE": hmacBase64(creds.passphrase, creds.secret), "KC-API-KEY-VERSION": "2" },
  });
  const code = text(obj(res.body).code);
  if (res.status !== 200 || code !== "200000") throw new ExchangeError(`KuCoin : ${text(obj(res.body).msg) || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403 || REFUSALS.has(code));
  const balances = sumBySymbol(list(obj(res.body).data).map((a) => ({ symbol: text(a.currency).toUpperCase() || null, quantity: amountOf(a.balance) })));
  return { balances, pricesEur: new Map(), unread: [], note: `${balances.length} actifs` };
}
