import { describe, expect, it } from "vitest";
import { isEvmAddress, readEvmAddress } from "./evm.ts";
import { TOKENS } from "../../lib/crypto-tokens.ts";

const ADDRESS = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
type Call = { method: string; params: unknown[] };

describe("isEvmAddress", () => {
  it("contrôle la somme de contrôle d'une adresse écrite avec des majuscules", () => {
    expect(isEvmAddress(ADDRESS)).toBe(true);
    expect(isEvmAddress("0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359")).toBe(true);
    // Une lettre a changé de casse : c'est une faute de frappe, ou une autre adresse.
    expect(isEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD")).toBe(false);
  });

  it("accepte une adresse tout en minuscules, refuse ce qui n'en est pas une", () => {
    expect(isEvmAddress(ADDRESS.toLowerCase())).toBe(true);
    expect(isEvmAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA")).toBe(false);
    expect(isEvmAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
  });
});

/** Faux VeChain : rien à cette adresse, ou ce qu'on lui donne ; `null` : le nœud ne répond pas. */
const vechain = (account: { balance: string; energy: string } | null = { balance: "0x0", energy: "0x0" }) => async <T>(): Promise<T> => {
  if (!account) throw new Error("VeChain illisible");
  return account as T;
};

describe("readEvmAddress", () => {
  const usdc = TOKENS.ethereum.find((row) => row[1] === "usd-coin")!;

  /** Faux nœuds : 2 ETH et 41,5 USDC sur Ethereum, rien ailleurs ; `down` : chaînes dont aucun nœud ne répond. */
  const nodes = (down: string[] = []) => async (_urls: string[], calls: Call[], label: string) => {
    if (down.includes(label)) throw new Error(`${label} illisible`);
    return calls.map((c) => {
      if (c.method === "eth_getBalance") return label === "Ethereum" ? word(2n * 10n ** 18n) : "0x0";
      const { to, data } = c.params[0] as { to: string; data: string };
      if (data === "0x313ce567") return word(6n);
      expect(data).toBe(`0x70a08231${"0".repeat(24)}${ADDRESS.slice(2).toLowerCase()}`);
      return label === "Ethereum" && to === usdc[0] ? word(41_500_000n) : "0x";
    });
  };

  it("rend la monnaie native et les jetons détenus, aux bonnes décimales", async () => {
    const r = await readEvmAddress(ADDRESS, nodes(), vechain());
    expect(r.holdings).toEqual([
      { key: "ethereum:native", symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", quantity: 2, place: "Ethereum" },
      { key: `ethereum:${usdc[0]}`, symbol: "USDC", name: usdc[3], coingeckoId: "usd-coin", quantity: 41.5, place: "Ethereum" },
    ]);
    expect(r.unread).toEqual([]);
  });

  it("garde pour plus tard une chaîne qui ne répond pas, sans perdre les autres", async () => {
    const r = await readEvmAddress(ADDRESS, nodes(["Base", "Linea"]), vechain());
    expect(r.holdings).toHaveLength(2);
    expect(r.unread).toEqual(["base:", "linea:"]);
    expect(r.note).toContain("Base, Linea");
  });

  it("échoue si aucune chaîne ne répond, ou si l'adresse est fausse", async () => {
    await expect(readEvmAddress(ADDRESS, async () => Promise.reject(new Error("panne")), vechain())).rejects.toThrow("panne");
    await expect(readEvmAddress("0x123", nodes(), vechain())).rejects.toThrow();
  });

  it("lit aussi la même adresse sur VeChain, et garde ses lignes d'avant si le nœud ne répond pas", async () => {
    // 1 500 VET et 2,5 VTHO, en unités de 10^-18.
    const r = await readEvmAddress(ADDRESS, nodes(), vechain({ balance: `0x${(1500n * 10n ** 18n).toString(16)}`, energy: `0x${(25n * 10n ** 17n).toString(16)}` }));
    expect(r.holdings.filter((h) => h.place === "VeChain")).toEqual([
      { key: "vechain:native", symbol: "VET", name: "VeChain", coingeckoId: "vechain", quantity: 1500, place: "VeChain" },
      { key: "vechain:vtho", symbol: "VTHO", name: "VeThor", coingeckoId: "vethor-token", quantity: 2.5, place: "VeChain" },
    ]);
    const down = await readEvmAddress(ADDRESS, nodes(), vechain(null));
    expect(down.unread).toEqual(["vechain:"]);
    expect(down.holdings).toHaveLength(2);
  });
});
