/*
 * Binance, en lecture seule : compte spot, portefeuille de financement et épargne (Simple Earn, souple et bloquée).
 * La clé est d'abord interrogée sur ses droits : une clé qui peut faire plus que lire est refusée, Pécule n'ayant
 * pas à garder de quoi vendre ou retirer. Les cours viennent de l'API publique.
 */

import { createHmac } from "node:crypto";
import { amountOf, isBinanceReceipt, sumBySymbol } from "../../lib/crypto-exchanges.ts";
import { ExchangeError, list, obj, request, text, type Credentials, type ExchangeReading, type Http } from "./http.ts";

const API = "https://api.binance.com";
/** Ce que Pécule appelle avec la clé, et rien d'autre : des lectures. */
const SIGNED: Record<string, "GET" | "POST"> = {
  "/sapi/v1/account/apiRestrictions": "GET",
  "/api/v3/account": "GET",
  "/sapi/v1/asset/get-funding-asset": "POST",
  "/sapi/v1/simple-earn/flexible/position": "GET",
  "/sapi/v1/simple-earn/locked/position": "GET",
};
/** Codes d'erreur de Binance qui mettent la clé en cause (format, clé inconnue, adresse ou droit, signature). */
const REFUSALS = new Set([-2014, -2015, -1022, -2008]);
/** Droits qui dépassent la lecture. */
const WRITE_RIGHTS = ["enableWithdrawals", "enableSpotAndMarginTrading", "enableMargin", "enableFutures", "enableInternalTransfer", "permitsUniversalTransfer", "enableVanillaOptions", "enablePortfolioMarginTrading"];
const PAGE = 100;

export const binanceSignature = (query: string, secret: string) => createHmac("sha256", secret).update(query).digest("hex");

async function signed(http: Http, creds: Credentials, path: string, params: Record<string, string> = {}): Promise<unknown> {
  const method = SIGNED[path];
  if (!method) throw new Error(`Binance : chemin non autorisé ${path}`);
  const query = new URLSearchParams({ ...params, recvWindow: "10000", timestamp: String(Date.now()) }).toString();
  const res = await http(`${API}${path}?${query}&signature=${binanceSignature(query, creds.secret ?? "")}`, { method, headers: { "X-MBX-APIKEY": creds.key } });
  if (res.status === 200) return res.body;
  if (res.status === 451) throw new ExchangeError("Binance ne répond pas aux serveurs du pays où Pécule est hébergé");
  const code = Number(obj(res.body).code);
  throw new ExchangeError(`Binance : ${text(obj(res.body).msg) || `HTTP ${res.status}`}`, res.status === 401 || REFUSALS.has(code));
}

/** Toutes les pages d'une liste d'épargne (« rows »). */
async function earn(http: Http, creds: Credentials, path: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let current = 1; current <= 20; current++) {
    const page = list(obj(await signed(http, creds, path, { current: String(current), size: String(PAGE) })).rows);
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

/** Cours en euros : la paire contre l'euro quand elle existe, sinon contre l'USDT ramené en euros. */
async function prices(http: Http): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  try {
    const res = await http(`${API}/api/v3/ticker/price`);
    const all = new Map(list(res.body).map((t) => [text(t.symbol), amountOf(t.price)]));
    const usdtPerEur = all.get("EURUSDT");
    for (const [pair, price] of all) {
      if (!price) continue;
      if (pair.endsWith("EUR")) out.set(pair.slice(0, -3), price);
    }
    if (usdtPerEur) {
      out.set("USDT", 1 / usdtPerEur);
      for (const [pair, price] of all) if (price && pair.endsWith("USDT") && !out.has(pair.slice(0, -4))) out.set(pair.slice(0, -4), price / usdtPerEur);
    }
  } catch {
    return out;
  }
  return out;
}

export async function readBinance(creds: Credentials, http: Http = request): Promise<ExchangeReading> {
  if (!creds.secret) throw new ExchangeError("Binance : clé secrète manquante", true);
  // Les droits de la clé d'abord : la lecture seule, ou rien. Si Binance ne les donne pas, la lecture continue.
  const rights = await signed(http, creds, "/sapi/v1/account/apiRestrictions").catch((e) => {
    if (e instanceof ExchangeError && e.refused) throw e;
    return null;
  });
  if (rights && WRITE_RIGHTS.some((r) => obj(rights)[r] === true)) throw new ExchangeError("Binance : cette clé peut faire plus que lire (trading, transferts ou retraits). Crée une clé limitée à la lecture.", true);

  const balances: ExchangeReading["balances"] = [];
  const add = (wallet: string, rows: { symbol: string | null; quantity: number }[]) => balances.push(...sumBySymbol(rows).map((b) => ({ ...b, wallet })));
  const spot = obj(await signed(http, creds, "/api/v3/account", { omitZeroBalances: "true" }));
  // « LDBTC » : le reçu d'un BTC placé en épargne souple, relu plus bas par l'épargne elle-même.
  const entries = list(spot.balances).map((b) => ({ asset: text(b.asset), quantity: amountOf(b.free) + amountOf(b.locked) }));
  add("spot", entries.map((b) => ({ symbol: isBinanceReceipt(b.asset) ? null : b.asset, quantity: b.quantity })));
  const receipts = entries.filter((b) => isBinanceReceipt(b.asset) && b.quantity > 0).map((b) => ({ symbol: b.asset.slice(2), quantity: b.quantity }));

  // Le reste ne doit pas empêcher de lire le compte : ce qui échoue garde ses lignes d'avant.
  const unread: string[] = [];
  const part = async (wallet: string, read: () => Promise<{ symbol: string | null; quantity: number }[]>) => {
    try {
      add(wallet, await read());
    } catch (e) {
      if (e instanceof ExchangeError && e.refused) throw e;
      unread.push(`${wallet}:`);
    }
  };
  await part("financement", async () => list(await signed(http, creds, "/sapi/v1/asset/get-funding-asset")).map((b) => ({ symbol: text(b.asset), quantity: amountOf(b.free) + amountOf(b.locked) + amountOf(b.freeze) })));
  // L'épargne souple : ce que dit l'épargne elle-même, et pour un actif qu'elle ne cite pas (ou si elle ne répond
  // pas), son reçu du compte spot — l'un ou l'autre, jamais les deux.
  const flexible = await earn(http, creds, "/sapi/v1/simple-earn/flexible/position")
    .then((rows) => rows.map((p) => ({ symbol: text(p.asset), quantity: amountOf(p.totalAmount) })))
    .catch((e) => {
      if (e instanceof ExchangeError && e.refused) throw e;
      return [] as { symbol: string; quantity: number }[];
    });
  const named = new Set(flexible.filter((p) => p.quantity > 0).map((p) => p.symbol));
  add("epargne", [...flexible, ...receipts.filter((r) => !named.has(r.symbol))]);
  await part("bloque", async () => (await earn(http, creds, "/sapi/v1/simple-earn/locked/position")).map((p) => ({ symbol: text(p.asset), quantity: amountOf(p.amount) })));
  return { balances, pricesEur: balances.length ? await prices(http) : new Map(), unread, note: `${new Set(balances.map((b) => b.symbol)).size} actifs${unread.length ? ` · non lu cette fois : ${unread.map((u) => u.slice(0, -1)).join(", ")}` : ""}` };
}
