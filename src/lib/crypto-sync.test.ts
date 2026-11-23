import { describe, expect, it } from "vitest";
import { coingeckoCandidate, decideManualLines, portfolioSignature, suspiciousDrop, withoutChainCovered, findDuplicates, replacedIds } from "./crypto-sync.ts";

describe("synchro CoinStats", () => {
  it("repère les portefeuilles en double (même nom, mêmes avoirs, même parent)", () => {
    const a = portfolioSignature("p1", "Binance Funding", [{ identifier: "hamster", count: 27.78 }, { identifier: "usd-coin", count: 0 }]);
    const b = portfolioSignature("p1", "Binance Funding ", [{ identifier: "hamster", count: 27.78 }]);
    const c = portfolioSignature("p1", "Binance Funding", [{ identifier: "hamster", count: 30 }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("garde l'existant si un portefeuille important revient vide ou divisé par deux", () => {
    expect(suspiciousDrop(5000, 0, 0)).toBe(true);
    expect(suspiciousDrop(5000, 2000, 3)).toBe(true);
    expect(suspiciousDrop(5000, 4000, 3)).toBe(false);
    expect(suspiciousDrop(50, 0, 0)).toBe(false);
    expect(suspiciousDrop(null, 0, 0)).toBe(false);
  });

  it("archive les lignes manuelles couvertes, garde les absentes, signale les écarts", () => {
    const synced = [
      { symbol: "ETH", identifier: "ethereum", count: 40.36, valueEur: 100000 },
      { symbol: "ETH", identifier: "ethereum", count: 0.06, valueEur: 150 },
      { symbol: "USDC", identifier: "usd-coin", count: 671.29, valueEur: 600 },
      { symbol: "EUR", identifier: "FiatCoinEUR", count: 5000, valueEur: 5000 },
      { symbol: "LINK", identifier: "chainlink", count: 10, valueEur: 150 },
    ];
    const d = decideManualLines(
      [
        { id: 1, symbol: "ETH", quantity: 40.42, manualValue: null },
        { id: 2, symbol: "USDC", quantity: 258.51, manualValue: null },
        { id: 3, symbol: "BNB", quantity: 3.336, manualValue: null },
        { id: 4, symbol: "EUR", quantity: 0, manualValue: 5000 },
        { id: 5, symbol: "AUTRES", quantity: 0, manualValue: 2400 },
        { id: 6, symbol: "LINK", quantity: 53.06, manualValue: null },
      ],
      synced,
    );
    expect(d.map((x) => [x.id, x.action])).toEqual([
      [1, "archiver"],
      [2, "archiver"],
      [3, "garder"],
      [4, "archiver"],
      [5, "archiver"],
      [6, "conflit"],
    ]);
  });

  it("propose l'id CoinGecko : ligne manuelle connue, table de correspondance, sinon l'identifiant", () => {
    const known = new Map([["EGLD", "elrond-erd-2"]]);
    expect(coingeckoCandidate("elrond-erd-2", "EGLD", known)).toBe("elrond-erd-2");
    expect(coingeckoCandidate("binance-coin", "BNB", known)).toBe("binancecoin");
    expect(coingeckoCandidate("FiatCoinEUR", "EUR", known)).toBeNull();
    expect(coingeckoCandidate("staked-ether", "STETH", known)).toBe("staked-ether");
    expect(coingeckoCandidate("AERO-aero-458bbf", "AERO", known)).toBeNull();
  });
});


describe("lecture sur la blockchain prioritaire", () => {
  const lines = [{ coin: { symbol: "ETH" } }, { coin: { symbol: "EGLD" } }];
  it("écarte seulement l'actif remplacé, dans le portefeuille désigné", () => {
    const skip = new Set(["staking:EGLD", "staking:ETH"]);
    expect(withoutChainCovered(lines, "staking", skip).kept).toHaveLength(0);
    expect(withoutChainCovered(lines, "cryptocom", skip).kept).toHaveLength(2);
    expect(withoutChainCovered(lines, "staking", new Set(["staking:EGLD"])).kept.map((l) => l.coin.symbol)).toEqual(["ETH"]);
  });
});

describe("doublons entre sources", () => {
  const kraken = { id: "x-kraken:1", name: "Kraken", replaces: [], lines: [{ symbol: "BTC", quantity: 0.25 }, { symbol: "XRP", quantity: 1200.5 }, { symbol: "EUR", quantity: 14.2 }] };
  const binance = { id: "x-binance:1", name: "Binance", replaces: [], lines: [{ symbol: "USDC", quantity: 10 }, { symbol: "USDC", quantity: 32.5 }, { symbol: "ADA", quantity: 80 }] };

  it("propose de ne compter qu'une fois deux sources qui portent les mêmes cryptos pour les mêmes quantités", () => {
    const found = findDuplicates([kraken], [{ id: "cs1", name: "Kraken", lines: [{ symbol: "btc", quantity: 0.25 }, { symbol: "XRP", quantity: 1200.5 }, { symbol: "FLR", quantity: 3 }] }]);
    expect(found).toEqual([{ directId: "x-kraken:1", directName: "Kraken", otherId: "cs1", otherName: "Kraken", symbols: ["BTC", "XRP"] }]);
  });

  it("rapproche un compte que l'agrégateur découpe en plusieurs portefeuilles", () => {
    const found = findDuplicates(
      [binance],
      [
        { id: "spot", name: "Binance", lines: [{ symbol: "USDC", quantity: 10 }, { symbol: "ADA", quantity: 80 }] },
        { id: "funding", name: "Binance · Funding", lines: [{ symbol: "USDC", quantity: 32.5 }] },
        { id: "earn", name: "Binance · Earn", lines: [{ symbol: "VET", quantity: 500 }] },
      ],
    );
    expect(found.map((f) => f.otherId)).toEqual(["spot", "funding"]);
  });

  it("ne propose rien pour une seule crypto commune parmi d'autres, une quantité différente, ou une paire déjà réglée", () => {
    // Une quantité ronde commune parmi d'autres cryptos : peut-être un hasard, rien n'est proposé.
    const other = { id: "cs1", name: "Ledger", lines: [{ symbol: "EUR", quantity: 100 }, { symbol: "ETH", quantity: 3 }] };
    expect(findDuplicates([{ ...kraken, lines: [{ symbol: "EUR", quantity: 100 }] }], [other])).toEqual([]);
    // Une quantité qui n'a rien de rond : assez pour le proposer, même parmi d'autres cryptos.
    expect(findDuplicates([kraken], [{ id: "cs5", name: "Ledger", lines: [{ symbol: "XRP", quantity: 1300.5137 }, { symbol: "ETH", quantity: 3 }] }])).toEqual([]);
    expect(findDuplicates([{ ...kraken, lines: [{ symbol: "XRP", quantity: 1200.5137 }] }], [{ id: "cs5", name: "Ledger", lines: [{ symbol: "XRP", quantity: 1200.5137 }, { symbol: "ETH", quantity: 3 }] }])).toHaveLength(1);
    expect(findDuplicates([kraken], [{ id: "cs2", name: "Kraken", lines: [{ symbol: "BTC", quantity: 0.26 }, { symbol: "XRP", quantity: 1100 }] }])).toEqual([]);
    expect(findDuplicates([{ ...kraken, replaces: ["cs3"] }], [{ id: "cs3", name: "Kraken", lines: [{ symbol: "BTC", quantity: 0.25 }, { symbol: "XRP", quantity: 1200.5 }] }])).toEqual([]);
    // La seule crypto d'un portefeuille, à la même quantité : assez pour le proposer.
    expect(findDuplicates([kraken], [{ id: "cs4", name: "Coffre", lines: [{ symbol: "BTC", quantity: 0.25 }] }])).toHaveLength(1);
  });

  it("lit la liste des sources remplacées", () => {
    expect(replacedIds(null)).toEqual([]);
    expect(replacedIds("a")).toEqual(["a"]);
    expect(replacedIds("a, b,,c")).toEqual(["a", "b", "c"]);
  });
});
