import { afterEach, describe, expect, it, vi } from "vitest";
import { balances, derivedAddress, isBitcoinAddress, parseXpub, readBitcoinAddress, readBitcoinXpub, type Balance } from "./bitcoin.ts";

// Comptes des documents de référence (BIP44, BIP49, BIP84, BIP86), tous tirés de la même phrase d'essai publique.
const XPUB_44 = "xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj";
const YPUB_49 = "ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP";
const ZPUB_84 = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
const XPUB_86 = "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";

describe("adresses dérivées d'une clé étendue", () => {
  it("donne les adresses des documents de référence, dans chaque forme", () => {
    expect(derivedAddress(parseXpub(XPUB_44)!.account, "p2pkh", 0, 0)).toBe("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA");
    expect(derivedAddress(parseXpub(YPUB_49)!.account, "p2sh-p2wpkh", 0, 0)).toBe("37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf");
    const segwit = parseXpub(ZPUB_84)!.account;
    expect(derivedAddress(segwit, "p2wpkh", 0, 0)).toBe("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu");
    expect(derivedAddress(segwit, "p2wpkh", 0, 1)).toBe("bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g");
    expect(derivedAddress(segwit, "p2wpkh", 1, 0)).toBe("bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el");
    const taproot = parseXpub(XPUB_86)!.account;
    expect(derivedAddress(taproot, "p2tr", 0, 0)).toBe("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr");
    expect(derivedAddress(taproot, "p2tr", 0, 1)).toBe("bc1p4qhjn9zdvkux4e44uhx8tc55attvtyu358kutcqkudyccelu0was9fqzwh");
    expect(derivedAddress(taproot, "p2tr", 1, 0)).toBe("bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7");
  });

  it("lit la forme d'adresse dans le préfixe, sauf pour une xpub qui ne la dit pas", () => {
    expect(parseXpub(ZPUB_84)!.scripts).toEqual(["p2wpkh"]);
    expect(parseXpub(YPUB_49)!.scripts).toEqual(["p2sh-p2wpkh"]);
    expect(parseXpub(XPUB_44)!.scripts).toHaveLength(4);
  });

  it("refuse ce qui n'est pas une clé étendue publique du réseau principal", () => {
    expect(parseXpub("xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdk")).toBeNull();
    expect(parseXpub("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu")).toBeNull();
    expect(parseXpub("")).toBeNull();
  });
});

describe("isBitcoinAddress", () => {
  it("accepte les quatre formes d'adresse", () => {
    for (const a of ["1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA", "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf", "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr"])
      expect(isBitcoinAddress(a), a).toBe(true);
  });

  it("refuse une adresse dont un caractère a changé, ou d'un autre réseau", () => {
    expect(isBitcoinAddress("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabB")).toBe(false);
    expect(isBitcoinAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv")).toBe(false);
    expect(isBitcoinAddress("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcs")).toBe(false);
    expect(isBitcoinAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")).toBe(false);
    expect(isBitcoinAddress("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(false);
  });
});

/** Faux réseau : les adresses données ont servi et portent ce solde ; il note ce qu'on lui demande. */
function network(used: Record<string, number>) {
  const asked: string[][] = [];
  const read = async (addresses: string[]): Promise<Balance[]> => {
    asked.push(addresses);
    return addresses.map((a) => ({ sats: BigInt(used[a] ?? 0), used: a in used }));
  };
  return { asked, read };
}

describe("lecture d'un compte", () => {
  it("additionne réception et monnaie rendue, et s'arrête après vingt adresses jamais servies", async () => {
    const account = parseXpub(ZPUB_84)!.account;
    const net = network({
      [derivedAddress(account, "p2wpkh", 0, 0)]: 150_000,
      [derivedAddress(account, "p2wpkh", 0, 25)]: 0,
      [derivedAddress(account, "p2wpkh", 1, 3)]: 50_000,
    });
    const r = await readBitcoinXpub(ZPUB_84, net.read);
    expect(r.holdings).toEqual([{ key: "btc", symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", quantity: 0.002 }]);
    expect(r.note).toContain("3 adresses");
    // Réception : 0-19, 20-39 (la 25 a servi), 40-59 ; monnaie rendue : 0-19, 20-39.
    expect(net.asked).toHaveLength(5);
    expect(net.asked.every((batch) => batch.length === 20)).toBe(true);
  });

  it("essaie chaque forme d'adresse d'une xpub, sans chercher la monnaie rendue là où rien n'a servi", async () => {
    const account = parseXpub(XPUB_44)!.account;
    const net = network({ [derivedAddress(account, "p2tr", 0, 2)]: 70_000 });
    const r = await readBitcoinXpub(XPUB_44, net.read);
    expect(r.holdings[0].quantity).toBe(0.0007);
    expect(r.note).toContain("Taproot");
    // Trois formes vides (une lecture chacune), puis Taproot : réception 0-19 et 20-39, monnaie rendue 0-19.
    expect(net.asked).toHaveLength(6);
  });

  it("rend un compte vide sans ligne", async () => {
    const r = await readBitcoinXpub(ZPUB_84, network({}).read);
    expect(r.holdings).toEqual([]);
    expect(r.note).toBe("aucune adresse utilisée");
  });

  it("lit une adresse seule, et refuse une adresse invalide sans rien demander au réseau", async () => {
    const net = network({ bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu: 123_456_789 });
    expect((await readBitcoinAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu", net.read)).holdings[0].quantity).toBe(1.23456789);
    await expect(readBitcoinAddress("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv", net.read)).rejects.toThrow();
    expect(net.asked).toHaveLength(1);
  });
});

describe("soldes demandés au réseau", () => {
  afterEach(() => vi.unstubAllGlobals());
  const A = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
  const B = "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA";
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("lit plusieurs adresses en une requête", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return json({ [A]: { final_balance: 1500, n_tx: 2 }, [B]: { final_balance: 0, n_tx: 0 } });
    });
    expect(await balances([A, B])).toEqual([
      { sats: 1500n, used: true },
      { sats: 0n, used: false },
    ]);
    expect(asked).toEqual([`https://blockchain.info/balance?active=${A}|${B}`]);
  });

  it("passe au service de secours, adresse par adresse, si le premier ne répond pas ou répond à moitié", async () => {
    const esplora = { chain_stats: { funded_txo_sum: 5000, spent_txo_sum: 2000, tx_count: 3 }, mempool_stats: { funded_txo_sum: 100, spent_txo_sum: 0, tx_count: 1 } };
    for (const first of [() => json({}, 503), () => json({ [A]: { final_balance: 1, n_tx: 1 } })]) {
      const asked: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        asked.push(new URL(url).host);
        return url.includes("blockchain.info") ? first() : json(esplora);
      });
      expect(await balances([A, B])).toEqual([
        { sats: 3100n, used: true },
        { sats: 3100n, used: true },
      ]);
      expect(asked).toEqual(["blockchain.info", "blockstream.info", "blockstream.info"]);
    }
  });

  it("échoue quand aucun service ne répond, sans rien inventer", async () => {
    vi.stubGlobal("fetch", async () => json({}, 500));
    await expect(balances([A])).rejects.toThrow("Bitcoin illisible");
  });
});
