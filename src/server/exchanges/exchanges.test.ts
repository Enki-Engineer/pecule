import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { binanceSignature, readBinance } from "./binance.ts";
import { readBitpanda } from "./bitpanda.ts";
import { coinbaseJwt, coinbaseKey, readCoinbase } from "./coinbase.ts";
import { krakenSignature, readKraken } from "./kraken.ts";
import { ExchangeError, type Http } from "./http.ts";

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
/** Faux exchange : répond selon le chemin demandé, et garde la trace de ce qu'on lui a demandé. */
function fake(answer: (path: string, call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const http: Http = async (url, init = {}) => {
    const call = { url, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body };
    calls.push(call);
    const r = answer(new URL(url).pathname, call);
    return { status: r.status ?? 200, body: r.body };
  };
  return { http, calls };
}
const refused = async (run: Promise<unknown>) => {
  const e = await run.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ExchangeError);
  return (e as ExchangeError).refused;
};

describe("signatures (exemples des documentations)", () => {
  it("signe une requête Kraken comme l'exemple de sa documentation", () => {
    const secret = "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==";
    const body = "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25";
    expect(krakenSignature("/0/private/AddOrder", "1616492376594", body, secret)).toBe("4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==");
  });

  it("signe une requête Binance comme l'exemple de sa documentation", () => {
    const query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559";
    expect(binanceSignature(query, "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j")).toBe("c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71");
  });

  it("fabrique pour Coinbase un jeton ES256 que la clé publique vérifie, valable deux minutes pour une requête", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ type: "sec1", format: "pem" }).toString();
    // Coinbase écrit la clé sur une ligne, sauts de ligne en toutes lettres.
    const key = coinbaseKey(pem.replace(/\n/g, "\\n"));
    const name = "organizations/00000000-0000-0000-0000-000000000000/apiKeys/11111111-1111-1111-1111-111111111111";
    const [header, payload, signature] = coinbaseJwt(name, key, "GET", "/v2/accounts", 1_700_000_000_000, "abcd").split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "ES256", kid: name, nonce: "abcd", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({ sub: name, iss: "cdp", nbf: 1_700_000_000, exp: 1_700_000_120, uri: "GET api.coinbase.com/v2/accounts" });
    expect(verify("sha256", Buffer.from(`${header}.${payload}`), { key: createPublicKey(privateKey), dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("refuse pour Coinbase une clé illisible ou d'un autre algorithme", () => {
    expect(() => coinbaseKey("pas une clé")).toThrow(ExchangeError);
    const ed = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => coinbaseKey(ed)).toThrow("ECDSA");
  });
});

describe("Kraken", () => {
  // Réponse d'exemple de la documentation de `Balance`.
  const balance = { ZUSD: "171288.6158", ZEUR: "504861.8946", XXBT: "1011.1908877900", XETH: "818.5500000000", USDT: "500000.00000000", DOT: "2.5000000000", "ETH2.S": "198.3970800000", ETH2: "2.5885574330", "USD.M": "1213029.2780", KFEE: "12", EMPTY: "0.0000" };
  const exchange = () =>
    fake((path) => {
      if (path === "/0/private/Balance") return { body: { error: [], result: balance } };
      if (path === "/0/public/Assets") return { body: { error: [], result: { XXBT: { altname: "XBT" }, XETH: { altname: "ETH" }, ZUSD: { altname: "USD" }, ZEUR: { altname: "EUR" }, USDT: { altname: "USDT" }, DOT: { altname: "DOT" }, ETH2: { altname: "ETH2" } } } };
      if (path === "/0/public/AssetPairs") return { body: { error: [], result: { XXBTZEUR: { base: "XXBT", quote: "ZEUR" }, XETHZUSD: { base: "XETH", quote: "ZUSD" }, ZEURZUSD: { base: "ZEUR", quote: "ZUSD" }, DOTEUR: { base: "DOT", quote: "ZEUR" } } } };
      if (path === "/0/public/Ticker") return { body: { error: [], result: { XXBTZEUR: { c: ["56000.0", "0.1"] }, XETHZUSD: { c: ["2000.0", "1"] }, ZEURZUSD: { c: ["1.25", "1"] }, DOTEUR: { c: ["4.0", "1"] } } } };
      return { status: 404, body: { error: ["EGeneral:Unknown method"] } };
    });

  it("additionne les soldes sous leur symbole, staking compris, et n'appelle que la lecture du solde avec la clé", async () => {
    const { http, calls } = exchange();
    const r = await readKraken({ key: "ma-cle", secret: Buffer.from("secret").toString("base64") }, http);
    const by = Object.fromEntries(r.balances.map((b) => [b.symbol, b.quantity]));
    expect(by.BTC).toBeCloseTo(1011.19088779);
    expect(by.ETH).toBeCloseTo(818.55 + 198.39708 + 2.588557433);
    expect(by.USD).toBeCloseTo(171288.6158 + 1213029.278);
    expect(by.EUR).toBeCloseTo(504861.8946);
    expect(Object.keys(by).sort()).toEqual(["BTC", "DOT", "ETH", "EUR", "USD", "USDT"]);
    // Cours : contre l'euro, sinon contre le dollar ramené en euros.
    expect(r.pricesEur.get("BTC")).toBe(56000);
    expect(r.pricesEur.get("ETH")).toBe(1600);
    expect(r.pricesEur.get("DOT")).toBe(4);

    const signed = calls.filter((c) => c.headers["API-Key"]);
    expect(signed.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual(["POST /0/private/Balance"]);
    expect(signed[0].body).toMatch(/^nonce=\d+$/);
    expect(signed[0].headers["API-Sign"]).toBe(krakenSignature("/0/private/Balance", signed[0].body!.slice(6), signed[0].body!, Buffer.from("secret").toString("base64")));
  });

  it("dit quand c'est la clé qui est refusée, et quand c'est une panne", async () => {
    const creds = { key: "k", secret: Buffer.from("s").toString("base64") };
    expect(await refused(readKraken(creds, fake(() => ({ body: { error: ["EAPI:Invalid key"] } })).http))).toBe(true);
    expect(await refused(readKraken(creds, fake(() => ({ body: { error: ["EGeneral:Permission denied"] } })).http))).toBe(true);
    expect(await refused(readKraken(creds, fake(() => ({ body: { error: ["EService:Unavailable"] } })).http))).toBe(false);
    expect(await refused(readKraken(creds, fake(() => ({ status: 502, body: null })).http))).toBe(false);
    expect(await refused(readKraken({ key: "k" }, fake(() => ({ body: {} })).http))).toBe(true);
  });
});

describe("Binance", () => {
  const readOnly = { ipRestrict: false, enableReading: true, enableWithdrawals: false, enableSpotAndMarginTrading: false, enableMargin: false, enableFutures: false, enableInternalTransfer: false, permitsUniversalTransfer: false, enableVanillaOptions: false };
  const exchange = (over: Record<string, (call: Call) => { status?: number; body: unknown }> = {}) =>
    fake((path, call) => {
      if (over[path]) return over[path](call);
      if (path === "/sapi/v1/account/apiRestrictions") return { body: readOnly };
      if (path === "/api/v3/account") return { body: { canTrade: false, balances: [{ asset: "BTC", free: "0.50000000", locked: "0.10000000" }, { asset: "LDBTC", free: "2.0", locked: "0" }, { asset: "LDO", free: "30", locked: "0" }, { asset: "EUR", free: "120.5", locked: "0" }] } };
      if (path === "/sapi/v1/asset/get-funding-asset") return { body: [{ asset: "USDT", free: "1", locked: "0", freeze: "0.5", withdrawing: "0" }] };
      if (path === "/sapi/v1/simple-earn/flexible/position") return { body: { rows: [{ asset: "BTC", totalAmount: "2.0" }], total: 1 } };
      if (path === "/sapi/v1/simple-earn/locked/position") return { body: { rows: [{ asset: "ETH", amount: "3.5" }], total: 1 } };
      if (path === "/api/v3/ticker/price") return { body: [{ symbol: "BTCEUR", price: "56000" }, { symbol: "EURUSDT", price: "1.25" }, { symbol: "ETHUSDT", price: "2000" }, { symbol: "BTCUSDT", price: "70000" }] };
      return { status: 404, body: {} };
    });
  const creds = { key: "cle", secret: "secret" };

  it("lit le spot, le financement et l'épargne, sans compter deux fois ce qui est en épargne souple", async () => {
    const { http, calls } = exchange();
    const r = await readBinance(creds, http);
    expect(r.balances).toEqual([
      { symbol: "BTC", quantity: 0.6, wallet: "spot" },
      { symbol: "LDO", quantity: 30, wallet: "spot" },
      { symbol: "EUR", quantity: 120.5, wallet: "spot" },
      { symbol: "USDT", quantity: 1.5, wallet: "financement" },
      { symbol: "BTC", quantity: 2, wallet: "epargne" },
      { symbol: "ETH", quantity: 3.5, wallet: "epargne" },
    ]);
    expect(r.unread).toEqual([]);
    expect(r.pricesEur.get("BTC")).toBe(56000);
    expect(r.pricesEur.get("ETH")).toBe(1600);
    expect(r.pricesEur.get("USDT")).toBe(0.8);

    // Avec la clé : des lectures seulement, chacune signée de sa chaîne de paramètres.
    const signed = calls.filter((c) => c.headers["X-MBX-APIKEY"]);
    expect(signed.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /sapi/v1/account/apiRestrictions",
      "GET /api/v3/account",
      "POST /sapi/v1/asset/get-funding-asset",
      "GET /sapi/v1/simple-earn/flexible/position",
      "GET /sapi/v1/simple-earn/locked/position",
    ]);
    for (const c of signed) {
      const [query, signature] = new URL(c.url).search.slice(1).split("&signature=");
      expect(signature).toBe(binanceSignature(query, "secret"));
      expect(query).toMatch(/timestamp=\d+/);
    }
  });

  it("refuse une clé qui peut faire plus que lire, avant toute lecture du compte", async () => {
    for (const right of ["enableWithdrawals", "enableSpotAndMarginTrading", "enableFutures", "permitsUniversalTransfer"]) {
      const { http, calls } = exchange({ "/sapi/v1/account/apiRestrictions": () => ({ body: { ...readOnly, [right]: true } }) });
      expect(await refused(readBinance(creds, http))).toBe(true);
      expect(calls).toHaveLength(1);
    }
  });

  it("dit quand la clé est refusée, et garde pour plus tard une partie du compte qui ne répond pas", async () => {
    expect(await refused(readBinance(creds, exchange({ "/sapi/v1/account/apiRestrictions": () => ({ status: 401, body: { code: -2015, msg: "Invalid API-key, IP, or permissions for action." } }) }).http))).toBe(true);
    expect(await refused(readBinance(creds, exchange({ "/api/v3/account": () => ({ status: 400, body: { code: -1022, msg: "Signature for this request is not valid." } }) }).http))).toBe(true);
    expect(await refused(readBinance(creds, exchange({ "/api/v3/account": () => ({ status: 503, body: null }) }).http))).toBe(false);

    const r = await readBinance(creds, exchange({ "/sapi/v1/simple-earn/locked/position": () => ({ status: 503, body: null }) }).http);
    expect(r.unread).toEqual(["epargne:"]);
    expect(r.balances.map((b) => b.wallet)).toEqual(["spot", "spot", "spot", "financement"]);
  });

  it("lit toutes les pages de l'épargne", async () => {
    const page = (n: number) => ({ rows: Array.from({ length: n }, () => ({ asset: "USDT", totalAmount: "1" })), total: 150 });
    const { http } = exchange({ "/sapi/v1/simple-earn/flexible/position": (c) => ({ body: new URL(c.url).searchParams.get("current") === "1" ? page(100) : page(50) }) });
    expect((await readBinance(creds, http)).balances.find((b) => b.wallet === "epargne" && b.symbol === "USDT")?.quantity).toBe(150);
  });
});

describe("Coinbase", () => {
  const pem = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "sec1", format: "pem" }).toString();
  const creds = { key: "organizations/o/apiKeys/k", secret: pem };
  const account = (currency: string, amount: string) => ({ id: currency, type: "wallet", currency: { code: currency }, balance: { amount, currency } });
  const exchange = (over: Record<string, (call: Call) => { status?: number; body: unknown }> = {}) =>
    fake((path, call) => {
      if (over[path]) return over[path](call);
      if (path === "/api/v3/brokerage/key_permissions") return { body: { can_view: true, can_trade: false, can_transfer: false } };
      if (path === "/v2/accounts")
        return new URL(call.url).searchParams.get("starting_after")
          ? { body: { pagination: { next_uri: null }, data: [account("ETH", "1.5"), account("BTC", "0.25")] } }
          : { body: { pagination: { next_uri: "/v2/accounts?limit=100&starting_after=abc" }, data: [account("BTC", "0.75"), account("EUR", "40.00"), account("DOGE", "0.00000000")] } };
      if (path === "/v2/exchange-rates") return { body: { data: { currency: "EUR", rates: { BTC: "0.00002", ETH: "0.0005" } } } };
      return { status: 404, body: {} };
    });

  it("suit les pages des comptes et additionne par crypto", async () => {
    const { http, calls } = exchange();
    const r = await readCoinbase(creds, http);
    expect(r.balances).toEqual([
      { symbol: "BTC", quantity: 1 },
      { symbol: "EUR", quantity: 40 },
      { symbol: "ETH", quantity: 1.5 },
    ]);
    expect(r.pricesEur.get("BTC")).toBeCloseTo(50000);
    expect(r.pricesEur.get("ETH")).toBe(2000);
    // Chaque requête porte un jeton qui nomme sa méthode et son chemin, sans paramètres.
    const accounts = calls.filter((c) => new URL(c.url).pathname === "/v2/accounts");
    expect(accounts).toHaveLength(2);
    for (const c of accounts) expect(JSON.parse(Buffer.from(c.headers.Authorization.split(".")[1], "base64url").toString()).uri).toBe("GET api.coinbase.com/v2/accounts");
  });

  it("refuse une clé qui peut vendre ou transférer, et dit quand la clé est refusée", async () => {
    expect(await refused(readCoinbase(creds, exchange({ "/api/v3/brokerage/key_permissions": () => ({ body: { can_view: true, can_trade: true, can_transfer: false } }) }).http))).toBe(true);
    expect(await refused(readCoinbase(creds, exchange({ "/api/v3/brokerage/key_permissions": () => ({ body: { can_view: true, can_trade: false, can_transfer: true } }) }).http))).toBe(true);
    expect(await refused(readCoinbase(creds, exchange({ "/v2/accounts": () => ({ status: 401, body: { errors: [{ id: "authentication_error", message: "invalid api key" }] } }) }).http))).toBe(true);
    expect(await refused(readCoinbase(creds, exchange({ "/v2/accounts": () => ({ status: 500, body: null }) }).http))).toBe(false);
  });

  it("ne suit jamais une adresse de page suivante qui sort des comptes", async () => {
    const { http, calls } = exchange({ "/v2/accounts": () => ({ body: { pagination: { next_uri: "https://ailleurs.example/v2/accounts?x=1" }, data: [account("BTC", "1")] } }) });
    await readCoinbase(creds, http);
    expect(calls.every((c) => new URL(c.url).host === "api.coinbase.com")).toBe(true);
    expect(calls.filter((c) => new URL(c.url).pathname === "/v2/accounts")).toHaveLength(1);
  });
});

describe("Bitpanda", () => {
  const BTC = "b86c034b-efe3-11eb-b56f-0691764446a7";
  const ACTION = "11111111-efe3-11eb-b56f-0691764446a7";
  const EUR = "b88b8466-efe3-11eb-b56f-0691764446a7";
  const exchange = (over: Record<string, () => { status?: number; body: unknown }> = {}) =>
    fake((path) => {
      if (over[path]) return over[path]();
      if (path === "/v1/api-keys/current") return { body: { data: { label: "Pécule", scopes: ["BALANCES", "TRADE_READ"], status: "ACTIVE" } } };
      if (path === "/v1/portfolio")
        return {
          body: {
            data: [
              { asset_id: BTC, balance: { value: "0.5", asset_id: BTC }, currency_balance: { value: "28000", currency_id: EUR } },
              { asset_id: ACTION, balance: { value: "3", asset_id: ACTION }, currency_balance: { value: "600", currency_id: EUR } },
              { currency_id: EUR, balance: { value: "150.25", currency_id: EUR }, currency_balance: { value: "150.25", currency_id: EUR } },
            ],
          },
        };
      if (path === "/v1/assets") return { body: { data: [{ id: BTC, name: "Bitcoin", symbol: "BTC", type: "CRYPTO", group: "CRYPTOCOIN" }, { id: ACTION, name: "Une action", symbol: "ACT", type: "STOCK", group: "STOCK" }], has_next_page: false } };
      if (path === "/v1/currencies") return { body: { data: [{ id: EUR, symbol: "EUR", name: "Euro" }] } };
      return { status: 404, body: {} };
    });

  it("garde les cryptos et la monnaie, avec la contre-valeur de Bitpanda pour cours", async () => {
    const { http, calls } = exchange();
    const r = await readBitpanda({ key: " ma-cle " }, http);
    expect(r.balances).toEqual([
      { symbol: "BTC", quantity: 0.5 },
      { symbol: "EUR", quantity: 150.25 },
    ]);
    expect(r.pricesEur.get("BTC")).toBe(56000);
    expect(calls.every((c) => c.headers["x-api-key"] === "ma-cle" && c.method === "GET")).toBe(true);
    expect(new URL(calls.find((c) => new URL(c.url).pathname === "/v1/assets")!.url).searchParams.get("id")).toBe(`${BTC},${ACTION}`);
  });

  it("refuse une clé qui peut écrire, et dit quand la clé est refusée", async () => {
    expect(await refused(readBitpanda({ key: "k" }, exchange({ "/v1/api-keys/current": () => ({ body: { data: { scopes: ["BALANCES", "TRADE_WRITE"] } } }) }).http))).toBe(true);
    expect(await refused(readBitpanda({ key: "k" }, exchange({ "/v1/portfolio": () => ({ status: 401, body: { errors: [{ code: "unauthorized", status: 401, title: "Credentials / Access token wrong" }] } }) }).http))).toBe(true);
    expect(await refused(readBitpanda({ key: "k" }, exchange({ "/v1/portfolio": () => ({ status: 500, body: null }) }).http))).toBe(false);
  });
});
