/*
 * Bitfinex, en lecture seule : tous les portefeuilles du compte (`auth/r/wallets`). La clé est d'abord interrogée
 * sur ses droits : une clé qui peut écrire est refusée. Signature : HMAC-SHA384 du chemin et du numéro d'ordre.
 * Bitfinex a ses propres codes pour quelques cryptos (« UST » pour l'USDT) : sa table publique les ramène au symbole.
 */

import { amountOf, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";
import { hmacHex, nextMillis } from "./sign.ts";

const API = "https://api.bitfinex.com";
const WALLETS = "v2/auth/r/wallets";
const PERMISSIONS = "v2/auth/r/permissions";
const PATHS = new Set([WALLETS, PERMISSIONS]);
const SYMBOLS = "v2/conf/pub:map:currency:sym";

export const bitfinexSignature = (path: string, nonce: string, secret: string) => hmacHex(`/api/${path}${nonce}`, secret, "sha384");

export async function readBitfinex(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret) throw new ExchangeError("Bitfinex : clé secrète manquante", true);
  const post = async (path: string): Promise<unknown[]> => {
    if (!PATHS.has(path)) throw new Error(`Bitfinex : chemin non autorisé ${path}`);
    const nonce = String(nextMillis());
    const res = await http(`${API}/${path}`, { method: "POST", headers: { "bfx-apikey": creds.key, "bfx-nonce": nonce, "bfx-signature": bitfinexSignature(path, nonce, creds.secret!), "Content-Type": "application/json" } });
    if (res.status === 200 && Array.isArray(res.body)) return res.body;
    // Une erreur de Bitfinex : [« error », code, message]. 10100 : clé ou signature ; 10111 : droit manquant.
    const [, code, message] = Array.isArray(res.body) ? res.body : [];
    throw new ExchangeError(`Bitfinex : ${text(message) || `HTTP ${res.status}`}`, res.status === 401 || res.status === 403 || code === 10100 || code === 10111);
  };

  // Les droits de la clé d'abord : [domaine, lecture, écriture]. Si Bitfinex ne les donne pas, la lecture continue.
  const rights = await post(PERMISSIONS).catch((e) => {
    if (e instanceof ExchangeError && e.refused) throw e;
    return null;
  });
  if (rights?.some((r) => Array.isArray(r) && Number(r[2]) === 1)) throw new ExchangeError("Bitfinex : cette clé peut écrire (ordres, retraits ou transferts). Crée une clé limitée à la lecture.", true);

  // Un portefeuille : [genre, code de la crypto, solde, …]. Un solde un peu négatif n'est pas un avoir.
  const wallets = (await post(WALLETS)).filter(Array.isArray) as unknown[][];
  const names = new Map<string, string>();
  await http(`${API}/${SYMBOLS}`)
    .then((res) => {
      for (const pair of (Array.isArray(res.body) && Array.isArray(res.body[0]) ? res.body[0] : []) as unknown[]) if (Array.isArray(pair)) names.set(text(pair[0]), text(pair[1]));
    })
    .catch(() => undefined);
  const balances = sumBySymbol(wallets.map((w) => ({ symbol: (names.get(text(w[1])) || text(w[1])).toUpperCase() || null, quantity: amountOf(w[2]) })));
  return { balances, pricesEur: new Map(), unread: [], note: `${balances.length} actifs` };
}
