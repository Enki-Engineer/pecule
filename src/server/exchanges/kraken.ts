/*
 * Kraken, en lecture seule : le solde du compte (`Balance`, droit « Query Funds »), qui porte aussi ce qui est en
 * staking ou en récompenses sous des codes à suffixe. Rien d'autre n'est appelé avec la clé ; les noms des actifs
 * et les cours viennent de l'API publique.
 */

import { createHash, createHmac } from "node:crypto";
import { amountOf, krakenSymbol, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, obj, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";

const API = "https://api.kraken.com";
const PRIVATE = new Set(["/0/private/Balance"]);
const PUBLIC = new Set(["/0/public/Assets", "/0/public/AssetPairs", "/0/public/Ticker"]);
/** Erreurs de Kraken qui mettent la clé en cause. */
const REFUSALS = ["EAPI:Invalid key", "EAPI:Invalid signature", "EGeneral:Permission denied"];

/** Signature d'une requête privée : HMAC-SHA512 du chemin et de l'empreinte du numéro d'ordre et du corps. */
export function krakenSignature(path: string, nonce: string, body: string, secret: string): string {
  const digest = createHash("sha256").update(nonce + body).digest();
  return createHmac("sha512", Buffer.from(secret, "base64")).update(Buffer.concat([Buffer.from(path), digest])).digest("base64");
}

let counter = 0;
/** Numéro d'ordre toujours croissant pour une même clé. */
const nextNonce = () => String(Date.now() * 1000 + (counter++ % 1000));

function result(res: { status: number; body: unknown }): Record<string, unknown> {
  const errors = (obj(res.body).error as unknown[] | undefined)?.map(String) ?? [];
  if (errors.length) throw new ExchangeError(`Kraken : ${errors.join(", ")}`, errors.some((e) => REFUSALS.some((r) => e.startsWith(r))));
  if (res.status !== 200) throw new ExchangeError(`Kraken : HTTP ${res.status}`);
  return obj(obj(res.body).result);
}

async function open(http: Http, path: string) {
  if (!PUBLIC.has(path)) throw new Error(`Kraken : chemin non autorisé ${path}`);
  return result(await http(`${API}${path}`));
}

/** Cours en euros des actifs cotés contre l'euro, sinon contre le dollar ; vide si l'API publique ne répond pas. */
async function prices(http: Http, altnames: Record<string, string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const [pairs, ticker] = [await open(http, "/0/public/AssetPairs"), await open(http, "/0/public/Ticker")];
    const last = (pair: string) => amountOf((obj(ticker[pair]).c as unknown[] | undefined)?.[0]);
    const quotes: { symbol: string; quote: string; price: number }[] = [];
    for (const [pair, raw] of Object.entries(pairs)) {
      const symbol = krakenSymbol(text(obj(raw).base), altnames);
      const quote = krakenSymbol(text(obj(raw).quote), altnames);
      const price = last(pair);
      if (symbol && quote && price) quotes.push({ symbol, quote, price });
    }
    const usdPerEur = quotes.find((q) => q.symbol === "EUR" && q.quote === "USD")?.price;
    for (const q of quotes) if (q.quote === "EUR") out.set(q.symbol, q.price);
    if (usdPerEur) for (const q of quotes) if (q.quote === "USD" && !out.has(q.symbol)) out.set(q.symbol, q.price / usdPerEur);
  } catch {
    return out;
  }
  return out;
}

export async function readKraken(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret) throw new ExchangeError("Kraken : clé privée manquante", true);
  const path = "/0/private/Balance";
  if (!PRIVATE.has(path)) throw new Error(`Kraken : chemin non autorisé ${path}`);
  const nonce = nextNonce();
  const body = `nonce=${nonce}`;
  let signature: string;
  try {
    signature = krakenSignature(path, nonce, body, creds.secret);
  } catch {
    throw new ExchangeError("Kraken : clé privée illisible", true);
  }
  const balance = result(await http(`${API}${path}`, { method: "POST", headers: { "API-Key": creds.key, "API-Sign": signature, "Content-Type": "application/x-www-form-urlencoded" }, body }));

  // Nom courant de chaque code (« XXBT » → « XBT ») : sans lui, les anciens codes à quatre lettres sont devinés.
  const altnames: Record<string, string> = {};
  await open(http, "/0/public/Assets")
    .then((assets) => {
      for (const [code, a] of Object.entries(assets)) if (text(obj(a).altname)) altnames[code] = text(obj(a).altname);
    })
    .catch(() => undefined);
  const balances = sumBySymbol(Object.entries(balance).map(([code, amount]) => ({ symbol: krakenSymbol(code, altnames), quantity: amountOf(amount) })));
  return { balances, pricesEur: balances.length ? await prices(http, altnames) : new Map(), unread: [], note: `${balances.length} actifs` };
}
