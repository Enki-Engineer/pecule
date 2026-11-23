import { describe, expect, it } from "vitest";
import { cardanoAccount, isCardanoAddress, readCardano, stakeAddress } from "./cardano.ts";

// Adresses d'exemple de la documentation de Cardano (CIP-19) : la même clé de staking sous chaque forme.
const BASE = "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
const STAKE = "stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw";
const ENTERPRISE = "addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8";
const TESTNET = "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae";

describe("adresses Cardano", () => {
  it("reconnaît les adresses du réseau principal, somme de contrôle comprise", () => {
    expect(isCardanoAddress(BASE)).toBe(true);
    expect(isCardanoAddress(STAKE)).toBe(true);
    expect(isCardanoAddress(ENTERPRISE)).toBe(true);
    expect(isCardanoAddress(TESTNET)).toBe(false);
    expect(isCardanoAddress(`${BASE.slice(0, -1)}y`)).toBe(false);
    expect(isCardanoAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBe(false);
  });

  it("tire d'une adresse de paiement l'adresse de staking du portefeuille", () => {
    expect(stakeAddress(BASE)).toBe(STAKE);
    expect(stakeAddress(STAKE)).toBe(STAKE);
    // Une adresse sans part de staking se lit seule.
    expect(stakeAddress(ENTERPRISE)).toBeNull();
    expect(cardanoAccount(BASE)).toBe(STAKE);
    expect(cardanoAccount(ENTERPRISE)).toBe(ENTERPRISE);
  });
});

describe("readCardano", () => {
  it("lit le solde du portefeuille entier par son adresse de staking, récompenses comprises", async () => {
    const asked: { url: string; body: unknown }[] = [];
    const r = await readCardano(STAKE, async <T>(urls: string[], body: unknown) => {
      asked.push({ url: urls[0], body });
      return [{ stake_address: STAKE, total_balance: "846310654" }] as T;
    });
    expect(r.holdings).toEqual([{ key: "ada", symbol: "ADA", name: "Cardano", coingeckoId: "cardano", quantity: 846.310654 }]);
    expect(asked).toEqual([{ url: "https://api.koios.rest/api/v1/account_info", body: { _stake_addresses: [STAKE] } }]);
  });

  it("lit une adresse sans staking par elle-même, et rend un portefeuille inconnu vide", async () => {
    const r = await readCardano(ENTERPRISE, async <T>(urls: string[]) => {
      expect(urls[0]).toContain("/address_info");
      return [{ balance: "2500000" }] as T;
    });
    expect(r.holdings[0].quantity).toBe(2.5);
    expect((await readCardano(STAKE, async <T>() => [] as T)).holdings).toEqual([]);
    await expect(readCardano("addr1faux", async <T>() => [] as T)).rejects.toThrow();
  });
});
