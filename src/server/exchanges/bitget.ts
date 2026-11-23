/*
 * Bitget, en lecture seule : le compte spot (`/api/v2/spot/account/assets`). La clé va avec une phrase de passe.
 * Signature : HMAC-SHA256 en base 64 de l'heure, de la méthode et du chemin.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";
import { hmacBase64, nextMillis } from "./sign.ts";

const API = "https://api.bitget.com";
const ASSETS = "/api/v2/spot/account/assets";
/** Clé, signature, phrase de passe, droit, adresse IP. */
const REFUSALS = new Set(["40006", "40009", "40011", "40012", "40014", "40018", "40037"]);

export const bitgetSignature = (timestamp: string, method: string, path: string, secret: string) => hmacBase64(`${timestamp}${method}${path}`, secret);

export async function readBitget(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret || !creds.passphrase) throw new ExchangeError("Bitget : il manque la clé secrète ou la phrase de passe", true);
  const timestamp = String(nextMillis());
  const res = await http(`${API}${ASSETS}`, { headers: { "ACCESS-KEY": creds.key, "ACCESS-SIGN": bitgetSignature(timestamp, "GET", ASSETS, creds.secret), "ACCESS-TIMESTAMP": timestamp, "ACCESS-PASSPHRASE": creds.passphrase, "Content-Type": "application/json", locale: "en-US" } });
  const code = text(obj(res.body).code);
  if (res.status !== 200 || code !== "00000") throw new ExchangeError(`Bitget : ${text(obj(res.body).msg) || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403 || REFUSALS.has(code));
  const balances = sumBySymbol(list(obj(res.body).data).map((a) => ({ symbol: text(a.coin).toUpperCase() || null, quantity: amountOf(a.available) + amountOf(a.frozen) + amountOf(a.locked) })));
  return { balances, pricesEur: new Map(), unread: [], note: `${balances.length} actifs` };
}
