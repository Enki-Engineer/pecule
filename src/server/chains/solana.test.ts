import { describe, expect, it } from "vitest";
import { isSolanaAddress, readSolanaAddress } from "./solana.ts";
import { TOKENS } from "../../lib/crypto-tokens.ts";

// Une adresse bien formée quelconque : celle du programme des SOL enveloppés, que tous les documents citent.
const ADDRESS = "So11111111111111111111111111111111111111112";
type Call = { method: string; params: unknown[] };
const usdc = TOKENS.solana.find((row) => row[1] === "usd-coin")!;
const account = (mint: string, amount: string, decimals: number) => ({ account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } } });

/** Faux nœud : 0,5 SOL, 2 SOL en staking, des USDC dans deux comptes, et un jeton inconnu déposé sans demande. */
const node = (refuse: string[] = []) => async (_urls: string[], calls: Call[]) => {
  const [call] = calls;
  if (refuse.includes(call.method)) throw new Error("refusé");
  if (call.method === "getBalance") return [{ value: 500_000_000 }];
  if (call.method === "getProgramAccounts") return [[{ account: { lamports: 1_500_000_000 } }, { account: { lamports: 500_000_000 } }]];
  const { programId } = call.params[1] as { programId: string };
  return [{ value: programId.startsWith("Tokenkeg") ? [account(usdc[0], "100000000", 6), account(usdc[0], "12500000", 6), account("So1anaJetonInconnu1111111111111111111111111", "999", 0)] : [] }];
};

describe("isSolanaAddress", () => {
  it("demande trente-deux octets en base 58", () => {
    expect(isSolanaAddress(ADDRESS)).toBe(true);
    expect(isSolanaAddress(usdc[0])).toBe(true);
    expect(isSolanaAddress("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA")).toBe(false);
    expect(isSolanaAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
  });
});

describe("readSolanaAddress", () => {
  it("rend le portefeuille, le staking et les jetons de la table, sans les jetons inconnus", async () => {
    const r = await readSolanaAddress(ADDRESS, node());
    expect(r.holdings).toEqual([
      { key: "sol:native", symbol: "SOL", name: "Solana", coingeckoId: "solana", quantity: 0.5 },
      { key: "sol:stake", symbol: "SOL", name: "Solana", coingeckoId: "solana", quantity: 2, place: "staking" },
      { key: `sol:token:${usdc[0]}`, symbol: "USDC", name: usdc[3], coingeckoId: "usd-coin", quantity: 112.5 },
    ]);
    expect(r.unread).toEqual([]);
  });

  it("garde le staking d'avant quand le nœud refuse de le lire", async () => {
    const r = await readSolanaAddress(ADDRESS, node(["getProgramAccounts"]));
    expect(r.holdings.map((h) => h.key)).toEqual(["sol:native", `sol:token:${usdc[0]}`]);
    expect(r.unread).toEqual(["sol:stake"]);
  });

  it("échoue si le solde lui-même ne se lit pas", async () => {
    await expect(readSolanaAddress(ADDRESS, node(["getBalance"]))).rejects.toThrow();
  });
});
