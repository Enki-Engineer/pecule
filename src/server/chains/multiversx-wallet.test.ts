import { describe, expect, it } from "vitest";
import { readMultiversxWallet } from "./multiversx-wallet.ts";

const ADDRESS = `erd1${"q".repeat(58)}`;
const staking = (total: number) => async () => ({ active: total, rewards: 0, undelegating: 0, total });
/** Faux service : 2,5 EGLD, un jeton valorisé, une poussière, un jeton sans cours. */
const api = (down: string[] = []) => async <T>(urls: string[]): Promise<T> => {
  const path = new URL(urls[0]).pathname;
  if (down.some((d) => path.endsWith(d))) throw new Error("panne");
  if (path.endsWith("/tokens"))
    return [
      { identifier: "MEX-455c57", ticker: "MEX", name: "MEX", balance: "1500000000000000000000", decimals: 18, price: 0.00001, valueUsd: 0.015 },
      { identifier: "USDC-c76f1f", ticker: "USDC", name: "WrappedUSDC", balance: "40000000", decimals: 6, price: 1, valueUsd: 40 },
      { identifier: "PUB-123456", ticker: "PUB", name: "Publicité", balance: "1000", decimals: 0, price: 0.000001, valueUsd: 0.001 },
      { identifier: "RIEN-abcdef", ticker: "RIEN", name: "Sans cours", balance: "5", decimals: 0 },
    ] as T;
  return { balance: "2500000000000000000" } as T;
};

describe("readMultiversxWallet", () => {
  it("lit les EGLD disponibles, les EGLD délégués et les jetons valorisés, au cours du service", async () => {
    const r = await readMultiversxWallet(ADDRESS, 0.9, api(), staking(190));
    expect(r.holdings).toEqual([
      { key: "egld", symbol: "EGLD", name: "MultiversX", coingeckoId: "elrond-erd-2", quantity: 2.5 },
      { key: "elrond-erd-2", symbol: "EGLD", name: "MultiversX", coingeckoId: "elrond-erd-2", quantity: 190, place: "staking" },
      { key: "token:MEX-455c57", symbol: "MEX", name: "MEX", coingeckoId: null, quantity: 1500, priceEur: 0.000009 },
      // Un jeton MultiversX garde son propre cours : ce n'est pas la crypto du même symbole ailleurs.
      { key: "token:USDC-c76f1f", symbol: "USDC", name: "WrappedUSDC", coingeckoId: null, quantity: 40, priceEur: 0.9 },
    ]);
    expect(r.unread).toEqual([]);
  });

  it("garde d'avant ce qui ne se lit pas, sans perdre le solde", async () => {
    const r = await readMultiversxWallet(ADDRESS, 0.9, api(["/tokens"]), async () => Promise.reject(new Error("panne")));
    expect(r.holdings.map((h) => h.key)).toEqual(["egld"]);
    expect(r.unread).toEqual(["elrond-erd-2", "token:"]);
  });

  it("échoue si le compte lui-même ne se lit pas, ou si l'adresse est fausse", async () => {
    await expect(readMultiversxWallet(ADDRESS, 0.9, async () => Promise.reject(new Error("panne")), staking(0))).rejects.toThrow("panne");
    await expect(readMultiversxWallet("erd1faux", 0.9, api(), staking(0))).rejects.toThrow();
  });
});
