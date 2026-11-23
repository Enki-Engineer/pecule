import { describe, expect, it } from "vitest";
import { detectWallet, EVM_CHAINS, looksSecret, shortAddress, toUnits } from "./crypto-chains.ts";
import { TOKENS } from "./crypto-tokens.ts";

describe("detectWallet", () => {
  it("reconnaît chaque genre d'adresse à sa forme", () => {
    expect(detectWallet("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBe("btc");
    expect(detectWallet("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr")).toBe("btc");
    expect(detectWallet("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA")).toBe("btc");
    expect(detectWallet("37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf")).toBe("btc");
    expect(detectWallet("zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs")).toBe("btc-xpub");
    expect(detectWallet("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe("evm");
    expect(detectWallet("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe("sol");
    expect(detectWallet(`erd1${"q".repeat(58)}`)).toBe("mvx-staking");
    expect(detectWallet("123456")).toBe("eth-validator");
    expect(detectWallet(`0x${"ab".repeat(48)}`)).toBe("eth-validator");
  });

  it("ignore les espaces autour, et ne reconnaît pas n'importe quoi", () => {
    expect(detectWallet("  0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed\n")).toBe("evm");
    expect(detectWallet("")).toBeNull();
    expect(detectWallet("bonjour")).toBeNull();
    expect(detectWallet("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA")).toBeNull();
    expect(detectWallet("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBeNull();
  });
});

describe("looksSecret", () => {
  it("repère une clé privée ou une phrase de récupération", () => {
    expect(looksSecret("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")).toBe(true);
    expect(looksSecret(`xprv${"1".repeat(107)}`)).toBe(true);
    expect(looksSecret("ab".repeat(32))).toBe(true);
    expect(looksSecret(`0x${"ab".repeat(32)}`)).toBe(true);
    expect(looksSecret(`K${"x".repeat(51)}`)).toBe(true);
  });

  it("laisse passer une adresse publique", () => {
    expect(looksSecret("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBe(false);
    expect(looksSecret("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
    expect(looksSecret("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(false);
    expect(looksSecret("mon portefeuille")).toBe(false);
  });
});

describe("shortAddress et toUnits", () => {
  it("abrège une adresse longue seulement", () => {
    expect(shortAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBe("bc1qcr8t…6fyu");
    expect(shortAddress("123456")).toBe("123456");
  });

  it("ramène un montant entier à ses unités sans perdre les petites décimales", () => {
    expect(toUnits(18234271n, 8)).toBe(0.18234271);
    expect(toUnits(5799564122593029130n, 18)).toBe(5.7995641225);
    expect(toUnits(41192124n, 6)).toBe(41.192124);
    expect(toUnits(1n, 0)).toBe(1);
    expect(toUnits(123456789012345678901234567890n, 18)).toBe(123456789012.34568);
    expect(toUnits(0n, 18)).toBe(0);
  });
});

describe("table des jetons", () => {
  it("couvre chaque chaîne lue, et Solana", () => {
    expect(Object.keys(TOKENS).sort()).toEqual([...EVM_CHAINS.map((c) => c.key), "solana"].sort());
  });

  it("ne porte que des contrats bien formés, une fois chacun, avec un identifiant de cours", () => {
    for (const [chain, rows] of Object.entries(TOKENS)) {
      const seen = new Set<string>();
      for (const [address, id, symbol, name] of rows) {
        expect(address, `${chain} ${symbol}`).toMatch(chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^0x[0-9a-f]{40}$/);
        expect(id).toMatch(/^[a-z0-9-]+$/);
        expect(symbol.length).toBeGreaterThan(0);
        expect(symbol.length).toBeLessThanOrEqual(24);
        expect(name.length).toBeLessThanOrEqual(80);
        expect(seen.has(address), `${chain} ${address} en double`).toBe(false);
        seen.add(address);
      }
    }
  });

  it("ne compte pas deux fois la monnaie native d'une chaîne", () => {
    // Les adresses de convention (0x000…, 0xeee…, précompilés) rendraient le solde natif, déjà lu à part.
    for (const [chain, rows] of Object.entries(TOKENS)) for (const [address] of rows) expect(address, chain).not.toMatch(/^0x(0{40}|e{40}|0{36}[0-9a-f]{4})$/);
  });
});
