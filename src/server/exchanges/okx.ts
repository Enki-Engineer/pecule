/*
 * OKX, en lecture seule : compte de trading, compte de financement et épargne souple. La clé va avec une phrase de
 * passe. OKX a un site par région (monde, Europe, États-Unis), et une clé ne vaut que sur le sien : ils sont essayés
 * dans l'ordre tant que la clé y est inconnue. Signature : HMAC-SHA256 en base 64 de l'heure, de la méthode et du chemin.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, optional, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";
import { hmacBase64 } from "./sign.ts";

const HOSTS = ["https://www.okx.com", "https://my.okx.com", "https://app.okx.com"];
const TRADING = "/api/v5/account/balance";
const FUNDING = "/api/v5/asset/balances";
const SAVINGS = "/api/v5/finance/savings/balance";
const PATHS = new Set([TRADING, FUNDING, SAVINGS]);
/** Clé inconnue de ce site : elle est peut-être celle d'une autre région. */
const UNKNOWN_KEY = new Set(["50111", "50119", "50101"]);
/** Codes qui mettent la clé en cause : clé, signature, phrase de passe, adresse IP, droit. */
const REFUSALS = new Set(["50100", "50101", "50103", "50104", "50105", "50110", "50111", "50113", "50114", "50119", "50120"]);

export const okxSignature = (timestamp: string, method: string, path: string, secret: string) => hmacBase64(`${timestamp}${method}${path}`, secret);

export async function readOkx(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret || !creds.passphrase) throw new ExchangeError("OKX : il manque la clé secrète ou la phrase de passe", true);
  let host = HOSTS[0];
  const get = async (path: string) => {
    if (!PATHS.has(path)) throw new Error(`OKX : chemin non autorisé ${path}`);
    const timestamp = new Date().toISOString();
    const res = await http(`${host}${path}`, { headers: { "OK-ACCESS-KEY": creds.key, "OK-ACCESS-SIGN": okxSignature(timestamp, "GET", path, creds.secret!), "OK-ACCESS-TIMESTAMP": timestamp, "OK-ACCESS-PASSPHRASE": creds.passphrase! } });
    const code = text(obj(res.body).code);
    if (res.status === 200 && code === "0") return list(obj(res.body).data);
    const error = new ExchangeError(`OKX : ${text(obj(res.body).msg) || `HTTP ${res.status}`}`, res.status === 401 || REFUSALS.has(code));
    throw Object.assign(error, { unknownKey: UNKNOWN_KEY.has(code) });
  };

  // Le compte de trading d'abord, sur chaque site jusqu'à celui qui connaît la clé.
  let trading: Record<string, unknown>[] | null = null;
  let failure: unknown = null;
  for (const candidate of HOSTS) {
    host = candidate;
    try {
      trading = await get(TRADING);
      break;
    } catch (e) {
      failure = e;
      if (!(e as { unknownKey?: boolean }).unknownKey) break;
    }
  }
  if (!trading) throw failure;

  const amounts = (rows: Record<string, unknown>[]) => rows.map((b) => ({ symbol: text(b.ccy).toUpperCase() || null, quantity: amountOf(b.availBal) + amountOf(b.frozenBal) }));
  const balances: ExchangeReading["balances"] = sumBySymbol(amounts(list(trading[0]?.details))).map((b) => ({ ...b, wallet: "spot" }));
  const unread: string[] = [];
  const funding = await optional(unread, "financement", () => get(FUNDING));
  if (funding) balances.push(...sumBySymbol(amounts(funding)).map((b) => ({ ...b, wallet: "financement" })));
  // « amt » : tout ce qui est placé, intérêts déjà versés compris.
  const savings = await optional(unread, "epargne", () => get(SAVINGS));
  if (savings) balances.push(...sumBySymbol(savings.map((b) => ({ symbol: text(b.ccy).toUpperCase() || null, quantity: amountOf(b.amt) }))).map((b) => ({ ...b, wallet: "epargne" })));
  return { balances, pricesEur: new Map(), unread, note: `${new Set(balances.map((b) => b.symbol)).size} actifs` };
}
