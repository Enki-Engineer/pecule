import { describe, expect, it } from "vitest";
import { amountOf, EXCHANGE_IDS, EXCHANGE_KINDS, EXCHANGES, exchangeOf, holdingsOf, isBinanceReceipt, isExchangeKind, krakenSymbol, sameCoin, sumBySymbol } from "./crypto-exchanges.ts";

describe("exchanges reliés", () => {
  it("donne à chacun son genre, son guide et ses champs", () => {
    expect(EXCHANGE_KINDS).toEqual(["x-kraken", "x-binance", "x-coinbase", "x-bitpanda"]);
    expect(isExchangeKind("x-kraken")).toBe(true);
    expect(isExchangeKind("evm")).toBe(false);
    expect(exchangeOf("x-bitpanda")).toBe("bitpanda");
    for (const id of EXCHANGE_IDS) {
      expect(EXCHANGES[id].steps.length).toBeGreaterThanOrEqual(2);
      // Le genre tient dans la colonne `crypto_sources.type` (seize caractères).
      expect(`x-${id}`.length).toBeLessThanOrEqual(16);
    }
  });
});

describe("krakenSymbol", () => {
  const altnames = { XXBT: "XBT", XETH: "ETH", ZEUR: "EUR", ZUSD: "USD", XXDG: "XDG", "ETH2.S": "ETH2.S" };

  it("ramène les anciens codes à leur symbole courant", () => {
    expect(krakenSymbol("XXBT", altnames)).toBe("BTC");
    expect(krakenSymbol("XETH", altnames)).toBe("ETH");
    expect(krakenSymbol("ZEUR", altnames)).toBe("EUR");
    expect(krakenSymbol("XXDG", altnames)).toBe("DOGE");
    expect(krakenSymbol("USDT", altnames)).toBe("USDT");
    expect(krakenSymbol("DOT", altnames)).toBe("DOT");
  });

  it("devine les anciens codes quand la liste des actifs manque", () => {
    expect(krakenSymbol("XXBT")).toBe("BTC");
    expect(krakenSymbol("ZUSD")).toBe("USD");
    expect(krakenSymbol("XXDG")).toBe("DOGE");
    // Un symbole de quatre lettres qui n'est pas un ancien code reste tel quel, même s'il commence par X ou Z.
    expect(krakenSymbol("ZETA")).toBe("ZETA");
    expect(krakenSymbol("USDC")).toBe("USDC");
    expect(krakenSymbol("LINK")).toBe("LINK");
  });

  it("réunit sous le même symbole ce qui est en staking, en récompenses ou immobilisé", () => {
    expect(krakenSymbol("ETH2.S", altnames)).toBe("ETH");
    expect(krakenSymbol("ETH2", altnames)).toBe("ETH");
    expect(krakenSymbol("USD.M", altnames)).toBe("USD");
    expect(krakenSymbol("USDT.F", altnames)).toBe("USDT");
    expect(krakenSymbol("XBT.M", altnames)).toBe("BTC");
    expect(krakenSymbol("DOT28.S", altnames)).toBe("DOT");
    expect(krakenSymbol("SOL.B", altnames)).toBe("SOL");
    expect(krakenSymbol("XXBT.HOLD", altnames)).toBe("BTC");
  });

  it("écarte ce qui n'a pas de cours", () => {
    expect(krakenSymbol("KFEE", altnames)).toBeNull();
    expect(krakenSymbol("AAPLx.T", altnames)).toBeNull();
  });
});

describe("soldes", () => {
  it("ne compte pas le reçu d'une épargne souple de Binance, sauf LDO qui n'en est pas un", () => {
    expect(isBinanceReceipt("LDBTC")).toBe(true);
    expect(isBinanceReceipt("LDUSDT")).toBe(true);
    expect(isBinanceReceipt("LDO")).toBe(false);
    expect(isBinanceReceipt("BTC")).toBe(false);
  });

  it("lit un nombre écrit par un exchange, et rien d'autre", () => {
    expect(amountOf("0.0100")).toBe(0.01);
    expect(amountOf("1e-8")).toBe(1e-8);
    expect(amountOf(12)).toBe(12);
    expect(amountOf("abc")).toBe(0);
    expect(amountOf("-3")).toBe(0);
    expect(amountOf(null)).toBe(0);
    expect(amountOf(undefined)).toBe(0);
  });

  it("additionne par symbole, sans les soldes nuls ni les codes écartés", () => {
    expect(
      sumBySymbol([
        { symbol: "ETH", quantity: 1 },
        { symbol: "ETH", quantity: 0.5 },
        { symbol: null, quantity: 9 },
        { symbol: "BTC", quantity: 0 },
      ]),
    ).toEqual([{ symbol: "ETH", quantity: 1.5 }]);
  });
});

describe("valorisation", () => {
  const symbols = { BTC: ["bitcoin", "Bitcoin"], EUR: ["une-crypto-homonyme", "Homonyme"] } as const;

  it("donne son cours CoinGecko à un symbole connu, et le cours de l'exchange à tout ce qui en a un", () => {
    const holdings = holdingsOf(
      [
        { symbol: "BTC", quantity: 0.5 },
        { symbol: "RARE", quantity: 10, wallet: "epargne" },
        { symbol: "SANS", quantity: 1 },
      ],
      new Map([
        ["BTC", 56000],
        ["RARE", 0.2],
      ]),
      symbols,
      {},
    );
    expect(holdings).toEqual([
      { key: "spot:BTC", symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", quantity: 0.5, priceEur: 56000, place: undefined },
      { key: "epargne:RARE", symbol: "RARE", name: "RARE", coingeckoId: null, quantity: 10, priceEur: 0.2, place: "épargne" },
      { key: "spot:SANS", symbol: "SANS", name: "SANS", coingeckoId: null, quantity: 1, priceEur: undefined, place: undefined },
    ]);
  });

  it("ne prend jamais une monnaie pour la crypto qui porte son symbole", () => {
    const [eur, usd] = holdingsOf([{ symbol: "EUR", quantity: 250 }, { symbol: "USD", quantity: 100 }], new Map([["EUR", 99]]), symbols, { EUR: 1, USD: 0.92 });
    expect(eur).toMatchObject({ symbol: "EUR", name: "EUR", coingeckoId: null, priceEur: 1 });
    expect(usd).toMatchObject({ symbol: "USD", coingeckoId: null, priceEur: 0.92 });
  });

  it("dit quand deux cours ne parlent pas de la même crypto", () => {
    expect(sameCoin(100, 101)).toBe(true);
    expect(sameCoin(100, 130)).toBe(true);
    expect(sameCoin(100, 160)).toBe(false);
    expect(sameCoin(0.02, 56000)).toBe(false);
    expect(sameCoin(0, 10)).toBe(false);
  });
});
