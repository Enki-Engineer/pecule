/*
 * Crypto.com Exchange, en lecture seule : les soldes du compte (`private/user-balance`). L'appli Crypto.com est un
 * autre compte, sans clé. Signature : HMAC-SHA256 de la méthode, du numéro de la requête, de la clé, des paramètres
 * et du numéro d'ordre.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";
import { hmacHex, nextMillis } from "./sign.ts";

const API = "https://api.crypto.com/exchange/v1";
const METHOD = "private/user-balance";
/** Clé inconnue, signature, adresse IP, droit. */
const REFUSALS = new Set([40101, 40102, 40103, 40104, 40107, 10002, 10003, 10006, 10007]);

export const cryptocomSignature = (method: string, id: number, key: string, nonce: number, secret: string) => hmacHex(`${method}${id}${key}${nonce}`, secret);

export async function readCryptocom(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret) throw new ExchangeError("Crypto.com Exchange : clé secrète manquante", true);
  const id = 1;
  const nonce = nextMillis();
  const body = JSON.stringify({ id, method: METHOD, api_key: creds.key, params: {}, nonce, sig: cryptocomSignature(METHOD, id, creds.key, nonce, creds.secret) });
  const res = await http(`${API}/${METHOD}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
  const code = Number(obj(res.body).code);
  if (res.status !== 200 || code !== 0) throw new ExchangeError(`Crypto.com Exchange : ${text(obj(res.body).message) || `HTTP ${res.status}`}`, res.status === 401 || REFUSALS.has(code));
  const positions = list(obj(obj(res.body).result).data).flatMap((account) => list(account.position_balances));
  const balances = sumBySymbol(positions.map((p) => ({ symbol: text(p.instrument_name).toUpperCase() || null, quantity: amountOf(p.quantity) })));
  return { balances, pricesEur: new Map(), unread: [], note: `${balances.length} actifs` };
}
