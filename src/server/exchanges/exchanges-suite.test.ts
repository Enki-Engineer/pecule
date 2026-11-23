import { describe, expect, it } from "vitest";
import { bitfinexSignature, readBitfinex } from "./bitfinex.ts";
import { bitgetSignature, readBitget } from "./bitget.ts";
import { bitvavoSignature, readBitvavo } from "./bitvavo.ts";
import { bybitSignature, readBybit } from "./bybit.ts";
import { cryptocomSignature, readCryptocom } from "./cryptocom.ts";
import { kucoinSignature, readKucoin } from "./kucoin.ts";
import { okxSignature, readOkx } from "./okx.ts";
import { hmacBase64 } from "./sign.ts";
import { ExchangeError, type Http } from "./http.ts";

type Call = { url: string; host: string; path: string; method: string; headers: Record<string, string>; body?: string };
/** Faux exchange : répond selon le chemin demandé, et garde la trace de ce qu'on lui a demandé. */
function fake(answer: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const http: Http = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url, host: u.host, path: u.pathname, method: init.method ?? "GET", headers: init.headers ?? {}, body: init.body };
    calls.push(call);
    const r = answer(call);
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
const SECRET = "cle-secrete-d-essai";
const creds = { key: "ma-cle", secret: SECRET, passphrase: "ma-phrase" };
const byWallet = (balances: { symbol: string; quantity: number; wallet?: string }[]) => balances.map((b) => `${b.wallet ?? "spot"}:${b.symbol}=${b.quantity}`);

describe("signatures (calculées à part, avec openssl)", () => {
  it("donne pour chaque exchange l'empreinte attendue", () => {
    expect(bitvavoSignature("1700000000000", "GET", "/v2/balance", "", SECRET)).toBe("be1e1010e50493c17ba84ffe5ff966ee2b50c3edb4f8eef6a2a20f77fffc4df8");
    expect(okxSignature("2026-01-02T03:04:05.678Z", "GET", "/api/v5/account/balance", SECRET)).toBe("5ti9A7ZRnIBu5dQfK2WH+d7pKbg872REu0U22XDe0iQ=");
    expect(bybitSignature("1700000000000", "ma-cle", "accountType=UNIFIED", SECRET)).toBe("6d31e4dfe41451249eca4808809cb70f3028fa5622d3e561dd518e056d24e282");
    expect(kucoinSignature("1700000000000", "GET", "/api/v1/accounts", SECRET)).toBe("I67lwJWAuhsGuIB6sKqZwYyOcazLDsMdT0QWdbN3t0Y=");
    expect(hmacBase64("ma-phrase", SECRET)).toBe("/6Ah66K3RZgkAYnRP3HrwjBCAXXlFhx2wmaJAU/rPyc=");
    expect(bitgetSignature("1700000000000", "GET", "/api/v2/spot/account/assets", SECRET)).toBe("P+OYmC3Oc5XeZ89VkCRUncXtRqtN256PuwjW+usV6as=");
    expect(bitfinexSignature("v2/auth/r/wallets", "1700000000000", SECRET)).toBe("d9d452e21ea178ed2caca19cc999958873f2506a57e4b16a08935b4f6088a212880859e190760ac60bc382918ea60a19");
    expect(cryptocomSignature("private/user-balance", 1, "ma-cle", 1700000000000, SECRET)).toBe("b7b9d8318aca10904eb687fb43095f6d6cd72db219b7253753725d08a7b5df8b");
  });
});

describe("Bitvavo", () => {
  const exchange = (staking: { status?: number; body: unknown } = { body: [{ symbol: "ETH", amount: "1.5" }] }) =>
    fake((c) => {
      if (c.path === "/v2/balance") return { body: [{ symbol: "BTC", available: "0.5", inOrder: "0.25" }, { symbol: "EUR", available: "100", inOrder: "0" }, { symbol: "ADA", available: "0", inOrder: "0" }] };
      if (c.path === "/v2/stakingBalance") return staking;
      if (c.path === "/v2/ticker/price") return { body: [{ market: "BTC-EUR", price: "56000" }, { market: "ETH-EUR", price: "1570" }, { market: "ETH-BTC", price: "0.03" }] };
      return { status: 404, body: {} };
    });

  it("additionne le disponible et ce qui est en ordre, lit le staking à part, et signe chaque lecture", async () => {
    const { http, calls } = exchange();
    const r = await readBitvavo(creds, http);
    expect(byWallet(r.balances)).toEqual(["spot:BTC=0.75", "spot:EUR=100", "staking:ETH=1.5"]);
    expect(r.pricesEur.get("BTC")).toBe(56000);
    expect(r.pricesEur.get("ETH")).toBe(1570);
    const signed = calls.filter((c) => c.headers["Bitvavo-Access-Key"]);
    expect(signed.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /v2/balance", "GET /v2/stakingBalance"]);
    for (const c of signed) expect(c.headers["Bitvavo-Access-Signature"]).toBe(bitvavoSignature(c.headers["Bitvavo-Access-Timestamp"], "GET", c.path, "", SECRET));
  });

  it("garde le staking d'avant s'il ne se lit pas, et dit quand la clé est refusée", async () => {
    const r = await readBitvavo(creds, exchange({ status: 503, body: null }).http);
    expect(r.unread).toEqual(["staking:"]);
    expect(await refused(readBitvavo(creds, fake(() => ({ status: 403, body: { errorCode: 305, error: "No active API key found." } })).http))).toBe(true);
    expect(await refused(readBitvavo(creds, fake(() => ({ status: 500, body: null })).http))).toBe(false);
  });
});

describe("OKX", () => {
  const exchange = (knownOn = "www.okx.com") =>
    fake((c) => {
      if (c.host !== knownOn) return { status: 401, body: { code: "50119", msg: "API key doesn't exist" } };
      if (c.path === "/api/v5/account/balance") return { body: { code: "0", data: [{ details: [{ ccy: "BTC", availBal: "0.4", frozenBal: "0.1" }, { ccy: "USDT", availBal: "50", frozenBal: "0" }] }] } };
      if (c.path === "/api/v5/asset/balances") return { body: { code: "0", data: [{ ccy: "ETH", availBal: "2", frozenBal: "0" }] } };
      if (c.path === "/api/v5/finance/savings/balance") return { body: { code: "0", data: [{ ccy: "USDT", amt: "300" }] } };
      return { status: 404, body: {} };
    });

  it("lit le trading, le financement et l'épargne, avec la phrase de passe", async () => {
    const { http, calls } = exchange();
    expect(byWallet((await readOkx(creds, http)).balances)).toEqual(["spot:BTC=0.5", "spot:USDT=50", "financement:ETH=2", "epargne:USDT=300"]);
    for (const c of calls) {
      expect(c.headers["OK-ACCESS-PASSPHRASE"]).toBe("ma-phrase");
      expect(c.headers["OK-ACCESS-SIGN"]).toBe(okxSignature(c.headers["OK-ACCESS-TIMESTAMP"], "GET", c.path, SECRET));
    }
  });

  it("essaie le site de chaque région tant que la clé y est inconnue", async () => {
    const { http, calls } = exchange("my.okx.com");
    expect((await readOkx(creds, http)).balances).toHaveLength(4);
    expect(calls.map((c) => c.host)).toEqual(["www.okx.com", "my.okx.com", "my.okx.com", "my.okx.com"]);
    expect(await refused(readOkx(creds, exchange("nulle-part").http))).toBe(true);
  });

  it("demande la phrase de passe, et distingue une panne d'un refus", async () => {
    expect(await refused(readOkx({ key: "k", secret: "s" }, exchange().http))).toBe(true);
    expect(await refused(readOkx(creds, fake(() => ({ status: 503, body: null })).http))).toBe(false);
  });
});

describe("Bybit", () => {
  const exchange = (info: Record<string, unknown> = { readOnly: 1, uta: 1 }, knownOn = "api.bybit.com") =>
    fake((c) => {
      if (c.host !== knownOn) return { body: { retCode: 10003, retMsg: "API key is invalid.", result: {} } };
      if (c.path === "/v5/user/query-api") return { body: { retCode: 0, retMsg: "", result: info } };
      if (c.path === "/v5/account/wallet-balance") return { body: { retCode: 0, result: { list: [{ accountType: new URL(c.url).searchParams.get("accountType"), coin: [{ coin: "BTC", walletBalance: "0.3" }, { coin: "USDT", walletBalance: "0" }] }] } } };
      if (c.path === "/v5/asset/transfer/query-account-coins-balance") return { body: { retCode: 0, result: { balance: [{ coin: "ETH", walletBalance: "1.2" }] } } };
      return { status: 404, body: {} };
    });

  it("lit le compte unifié et le financement, chaque requête signée avec ses paramètres", async () => {
    const { http, calls } = exchange();
    expect(byWallet((await readBybit(creds, http)).balances)).toEqual(["spot:BTC=0.3", "financement:ETH=1.2"]);
    expect(new URL(calls[1].url).searchParams.get("accountType")).toBe("UNIFIED");
    for (const c of calls) expect(c.headers["X-BAPI-SIGN"]).toBe(bybitSignature(c.headers["X-BAPI-TIMESTAMP"], "ma-cle", new URL(c.url).search.slice(1), SECRET));
  });

  it("lit le compte spot d'un compte qui n'est pas unifié, et essaie le site européen", async () => {
    const classic = exchange({ readOnly: 1, uta: 0 });
    await readBybit(creds, classic.http);
    expect(new URL(classic.calls[1].url).searchParams.get("accountType")).toBe("SPOT");
    const eu = exchange({ readOnly: 1, uta: 1 }, "api.bybit.eu");
    expect((await readBybit(creds, eu.http)).balances).toHaveLength(2);
    expect(eu.calls.map((c) => c.host).slice(0, 2)).toEqual(["api.bybit.com", "api.bybit.eu"]);
  });

  it("refuse une clé qui n'est pas en lecture seule, avant toute lecture du compte", async () => {
    const { http, calls } = exchange({ readOnly: 0, uta: 1 });
    expect(await refused(readBybit(creds, http))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await refused(readBybit(creds, exchange({}, "nulle-part").http))).toBe(true);
  });
});

describe("KuCoin, Bitget, Crypto.com Exchange", () => {
  it("KuCoin : additionne les comptes par crypto, phrase de passe signée", async () => {
    const { http, calls } = fake(() => ({ body: { code: "200000", data: [{ currency: "BTC", type: "main", balance: "0.1" }, { currency: "BTC", type: "trade", balance: "0.2" }, { currency: "KCS", type: "main", balance: "5" }] } }));
    const r = await readKucoin(creds, http);
    expect(r.balances.map((b) => [b.symbol, Number(b.quantity.toFixed(8))])).toEqual([["BTC", 0.3], ["KCS", 5]]);
    expect(calls[0].headers["KC-API-PASSPHRASE"]).toBe(hmacBase64("ma-phrase", SECRET));
    expect(calls[0].headers["KC-API-KEY-VERSION"]).toBe("2");
    expect(calls[0].headers["KC-API-SIGN"]).toBe(kucoinSignature(calls[0].headers["KC-API-TIMESTAMP"], "GET", "/api/v1/accounts", SECRET));
    expect(await refused(readKucoin(creds, fake(() => ({ status: 401, body: { code: "400003", msg: "The API key does not exist or site mismatch." } })).http))).toBe(true);
    expect(await refused(readKucoin(creds, fake(() => ({ status: 500, body: null })).http))).toBe(false);
    expect(await refused(readKucoin({ key: "k", secret: "s" }, http))).toBe(true);
  });

  it("Bitget : additionne le disponible, le gelé et le bloqué", async () => {
    const { http, calls } = fake(() => ({ body: { code: "00000", msg: "success", data: [{ coin: "BTC", available: "0.5", frozen: "0.1", locked: "0.2" }, { coin: "BGB", available: "0", frozen: "0", locked: "0" }] } }));
    const r = await readBitget(creds, http);
    expect(r.balances.map((b) => [b.symbol, Number(b.quantity.toFixed(8))])).toEqual([["BTC", 0.8]]);
    expect(calls[0].headers["ACCESS-PASSPHRASE"]).toBe("ma-phrase");
    expect(calls[0].headers["ACCESS-SIGN"]).toBe(bitgetSignature(calls[0].headers["ACCESS-TIMESTAMP"], "GET", "/api/v2/spot/account/assets", SECRET));
    expect(await refused(readBitget(creds, fake(() => ({ status: 400, body: { code: "40037", msg: "Apikey does not exist" } })).http))).toBe(true);
    expect(await refused(readBitget(creds, fake(() => ({ status: 502, body: null })).http))).toBe(false);
  });

  it("Crypto.com Exchange : lit les positions du compte par une requête signée dans son corps", async () => {
    const { http, calls } = fake(() => ({ body: { id: 1, code: 0, result: { data: [{ position_balances: [{ instrument_name: "CRO", quantity: "1500.5" }, { instrument_name: "BTC", quantity: "0.01" }, { instrument_name: "USD", quantity: "0" }] }] } } }));
    expect((await readCryptocom(creds, http)).balances).toEqual([
      { symbol: "CRO", quantity: 1500.5 },
      { symbol: "BTC", quantity: 0.01 },
    ]);
    const body = JSON.parse(calls[0].body!) as { id: number; method: string; api_key: string; nonce: number; sig: string; params: object };
    expect(calls[0].method).toBe("POST");
    expect(body.sig).toBe(cryptocomSignature("private/user-balance", body.id, "ma-cle", body.nonce, SECRET));
    // La clé secrète ne part jamais : seule sa signature.
    expect(calls[0].body).not.toContain(SECRET);
    expect(await refused(readCryptocom(creds, fake(() => ({ status: 401, body: { code: 40101, message: "Authentication failure" } })).http))).toBe(true);
    expect(await refused(readCryptocom(creds, fake(() => ({ status: 500, body: null })).http))).toBe(false);
  });
});

describe("Bitfinex", () => {
  const exchange = (rights: unknown = [["account", 1, 0], ["orders", 1, 0], ["wallets", 1, 0], ["withdraw", 0, 0]]) =>
    fake((c) => {
      if (c.path === "/v2/auth/r/permissions") return { body: rights };
      if (c.path === "/v2/auth/r/wallets") return { body: [["exchange", "BTC", 0.5, 0, 0.5], ["funding", "BTC", 0.25, 0, 0.25], ["exchange", "UST", 120, 0, 120], ["exchange", "EUR", -0.0001, 0, 0]] };
      if (c.path === "/v2/conf/pub:map:currency:sym") return { body: [[["UST", "USDt"], ["IOT", "IOTA"]]] };
      return { status: 404, body: null };
    });

  it("additionne les portefeuilles et ramène les codes de Bitfinex à leur symbole", async () => {
    const { http, calls } = exchange();
    expect((await readBitfinex(creds, http)).balances).toEqual([
      { symbol: "BTC", quantity: 0.75 },
      { symbol: "USDT", quantity: 120 },
    ]);
    const signed = calls.filter((c) => c.headers["bfx-apikey"]);
    expect(signed.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /v2/auth/r/permissions", "POST /v2/auth/r/wallets"]);
    for (const c of signed) expect(c.headers["bfx-signature"]).toBe(bitfinexSignature(c.path.slice(1), c.headers["bfx-nonce"], SECRET));
    expect(Number(signed[1].headers["bfx-nonce"])).toBeGreaterThan(Number(signed[0].headers["bfx-nonce"]));
  });

  it("refuse une clé qui peut écrire, et dit quand la clé est refusée", async () => {
    const { http, calls } = exchange([["account", 1, 0], ["withdraw", 1, 1]]);
    expect(await refused(readBitfinex(creds, http))).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await refused(readBitfinex(creds, fake(() => ({ status: 500, body: ["error", 10100, "apikey: digest invalid"] })).http))).toBe(true);
    expect(await refused(readBitfinex(creds, fake((c) => (c.path.endsWith("permissions") ? { status: 502, body: null } : { status: 502, body: null })).http))).toBe(false);
  });
});
