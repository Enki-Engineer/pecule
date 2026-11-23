/*
 * Coinbase, en lecture seule : les comptes de l'appli (`/v2/accounts`), avec une clé de la plateforme développeur
 * (CDP) signée en ES256. Chaque requête porte un jeton signé qui ne vaut que pour elle, deux minutes. La clé est
 * d'abord interrogée sur ses droits : une clé qui peut vendre ou transférer est refusée.
 */

import { createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";
import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";

const HOST = "api.coinbase.com";
const ACCOUNTS = "/v2/accounts";
const PERMISSIONS = "/api/v3/brokerage/key_permissions";
const RATES = "/v2/exchange-rates";
const b64 = (value: Buffer | string) => Buffer.from(value).toString("base64url");

/** Clé privée telle que Coinbase l'écrit dans son fichier (les sauts de ligne y sont des « \n » en toutes lettres). */
export function coinbaseKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(pem.trim().replace(/\\n/g, "\n"));
  } catch {
    throw new ExchangeError("Coinbase : clé privée illisible. Colle-la en entier, lignes BEGIN et END comprises.", true);
  }
  if (key.asymmetricKeyType !== "ec") throw new ExchangeError("Coinbase : cette clé n'est pas une clé ECDSA. Crée une clé avec l'algorithme ECDSA.", true);
  return key;
}

/** Jeton d'une requête : signé par la clé, il nomme la méthode et le chemin (sans paramètres) et vaut deux minutes. */
export function coinbaseJwt(keyName: string, key: KeyObject, method: string, path: string, now = Date.now(), nonce = randomBytes(16).toString("hex")): string {
  const nbf = Math.floor(now / 1000);
  const header = { alg: "ES256", kid: keyName, nonce, typ: "JWT" };
  const payload = { sub: keyName, iss: "cdp", nbf, exp: nbf + 120, uri: `${method} ${HOST}${path}` };
  const data = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(payload))}`;
  return `${data}.${b64(sign("sha256", Buffer.from(data), { key, dsaEncoding: "ieee-p1363" }))}`;
}

export async function readCoinbase(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  const key = coinbaseKey(creds.secret ?? "");
  const name = creds.key.trim();
  const get = async (path: string, query = "") => {
    const res = await http(`https://${HOST}${path}${query}`, { headers: { Authorization: `Bearer ${coinbaseJwt(name, key, "GET", path)}` } });
    if (res.status === 200) return obj(res.body);
    throw new ExchangeError(`Coinbase : ${text(list(obj(res.body).errors)[0]?.message) || text(obj(res.body).message) || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403);
  };

  // Les droits de la clé d'abord : « View », ou rien. Si Coinbase ne les donne pas, la lecture continue.
  const rights = await get(PERMISSIONS).catch(() => null);
  if (rights && (rights.can_trade === true || rights.can_transfer === true)) throw new ExchangeError("Coinbase : cette clé peut faire plus que lire (vendre ou transférer). Crée une clé avec le seul droit « View ».", true);

  const rows: { symbol: string | null; quantity: number }[] = [];
  let query = "?limit=100";
  for (let page = 0; page < 50; page++) {
    const body = await get(ACCOUNTS, query);
    for (const a of list(body.data)) rows.push({ symbol: (text(obj(a.balance).currency) || text(obj(a.currency).code)).toUpperCase() || null, quantity: amountOf(obj(a.balance).amount) });
    // La page suivante est donnée par Coinbase : on n'en suit que les paramètres, jamais une autre adresse.
    const next = text(obj(body.pagination).next_uri);
    if (!next.startsWith(`${ACCOUNTS}?`)) break;
    query = next.slice(ACCOUNTS.length);
  }
  const balances = sumBySymbol(rows);

  // Cours publics : combien d'unités de chaque actif pour un euro.
  const pricesEur = new Map<string, number>();
  if (balances.length)
    await http(`https://${HOST}${RATES}?currency=EUR`)
      .then((res) => {
        for (const [symbol, rate] of Object.entries(obj(obj(obj(res.body).data).rates))) if (amountOf(rate)) pricesEur.set(symbol.toUpperCase(), 1 / amountOf(rate));
      })
      .catch(() => undefined);
  return { balances, pricesEur, unread: [], note: `${balances.length} actifs` };
}
