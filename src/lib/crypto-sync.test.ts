import { describe, expect, it } from "vitest";
import { coingeckoCandidate, decideManualLines, portfolioSignature, suspiciousDrop, withoutChainCovered } from "./crypto-sync.ts";

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
