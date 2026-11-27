import { describe, expect, it } from "vitest";
import { alreadyTold, cashFlows, CRYPTO_PLATFORMS, detectMoves, MIN_MOVE_EUR, PLATFORM_WORDS, platformOf, type Holding } from "./crypto-moves.ts";

describe("plateforme crypto dans un libellé bancaire", () => {
  it("reconnaît la marque, quelle que soit la casse", () => {
    expect(platformOf("VIR SEPA Coinbase Europe Ltd")?.name).toBe("Coinbase");
    expect(platformOf("Carte 12 03 26 KRAKEN.COM")?.name).toBe("Kraken");
    expect(platformOf("Virement vers Crypto.com")?.name).toBe("Crypto.com");
  });

  it("reconnaît la société qui encaisse pour la plateforme", () => {
    expect(platformOf("VIR INST Payward Ltd")?.name).toBe("Kraken");
    expect(platformOf("PRLV Foris DAX MT Limited")?.name).toBe("Crypto.com");
    expect(platformOf("VIR Bifinity UAB")?.name).toBe("Binance");
  });

  it("lit aussi le marchand et le libellé de la banque", () => {
    expect(platformOf("Virement émis", null, "SwissBorg Solutions")?.name).toBe("SwissBorg");
  });

  it("ne prend pas un mot pour un autre", () => {
    expect(platformOf("Carte 02 04 26 Librairie Annexo")).toBeNull();
    expect(platformOf("Bookxpress Nantes")).toBeNull();
    expect(platformOf("Boulangerie du Relais")).toBeNull();
    expect(platformOf("", null)).toBeNull();
  });

  it("chaque plateforme a des mots en minuscules, tous dans la liste de présélection", () => {
    for (const p of CRYPTO_PLATFORMS) for (const w of p.words) expect(w).toBe(w.toLowerCase());
    expect(PLATFORM_WORDS.length).toBe(CRYPTO_PLATFORMS.reduce((n, p) => n + p.words.length, 0));
    expect(new Set(PLATFORM_WORDS).size).toBe(PLATFORM_WORDS.length);
  });
});

describe("opération bancaire déjà racontée au journal", () => {
  const told = [
    { date: "2026-03-05", endDate: null, platform: "Coinbase" },
    { date: "2025-01-10", endDate: "2025-12-20", platform: "Binance" },
    { date: "2026-03-05", endDate: null, platform: null },
  ];

  it("le même jour à quelques jours près, sur la même plateforme", () => {
    expect(alreadyTold("2026-03-02", "Coinbase", told)).toBe(true);
    expect(alreadyTold("2026-03-08", "coinbase", told)).toBe(true);
    expect(alreadyTold("2026-03-20", "Coinbase", told)).toBe(false);
    expect(alreadyTold("2026-03-05", "Kraken", told)).toBe(false);
  });

  it("ou pendant une période que le journal résume", () => {
    expect(alreadyTold("2025-06-15", "Binance", told)).toBe(true);
    expect(alreadyTold("2025-12-23", "Binance", told)).toBe(true);
    expect(alreadyTold("2026-02-01", "Binance", told)).toBe(false);
  });
});

const h = (portfolioId: string, symbol: string, quantity: number, priceEur: number | null): Holding => ({ portfolioId, symbol, quantity, priceEur });
const BTC = 80_000;
const ETH = 3_000;

describe("mouvements lus entre deux synchronisations", () => {
  it("de la monnaie en moins et une crypto en plus : un achat, au prix de la monnaie dépensée", () => {
    const moves = detectMoves([h("x", "EUR", 1600, 1)], [h("x", "EUR", 0.4, 1), h("x", "BTC", 0.01995, BTC)], new Set(["x"]));
    expect(moves).toEqual([{ kind: "achat", portfolioId: "x", fromPortfolioId: null, asset: "BTC", quantity: 0.01995, valueEur: 1599.6, direction: null }]);
  });

  it("une crypto en moins et de la monnaie en plus : une vente", () => {
    const [move] = detectMoves([h("x", "ETH", 1, ETH)], [h("x", "ETH", 0.5, ETH), h("x", "USD", 1700, 0.86)], new Set(["x"]));
    expect(move).toMatchObject({ kind: "vente", asset: "ETH", quantity: 0.5 });
    expect(move.valueEur).toBeCloseTo(1462, 6);
  });

  it("une crypto contre une autre, sans monnaie : un échange", () => {
    const [move] = detectMoves([h("x", "ETH", 1, ETH)], [h("x", "BTC", 0.0372, BTC)], new Set(["x"]));
    expect(move).toMatchObject({ kind: "echange", asset: "ETH → BTC", quantity: 0.0372, direction: null });
  });

  it("la même crypto part d'un portefeuille et arrive dans un autre, aux frais près : un transfert", () => {
    const moves = detectMoves([h("x", "ETH", 2, ETH), h("w", "ETH", 0.1, ETH)], [h("x", "ETH", 0.5, ETH), h("w", "ETH", 1.597, ETH)], new Set(["x", "w"]));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ kind: "transfert", portfolioId: "w", fromPortfolioId: "x", asset: "ETH", direction: null });
    expect(moves[0].quantity).toBeCloseTo(1.497, 9);
  });

  it("un achat et un transfert à la même lecture : le transfert est reconnu d'abord, l'achat ensuite", () => {
    const before = [h("x", "EUR", 1600, 1), h("x", "ETH", 2, ETH), h("w", "ETH", 0.1, ETH)];
    const after = [h("x", "EUR", 0.4, 1), h("x", "BTC", 0.01995, BTC), h("x", "ETH", 0.5, ETH), h("w", "ETH", 1.597, ETH)];
    const moves = detectMoves(before, after, new Set(["x", "w"]));
    expect(moves.map((m) => [m.kind, m.portfolioId, m.fromPortfolioId, m.asset, m.direction])).toEqual([
      ["transfert", "w", "x", "ETH", null],
      ["achat", "x", null, "BTC", null],
    ]);
    expect(moves[1].valueEur).toBeCloseTo(1599.6, 6);
  });

  it("une arrivée ou un départ dont l'autre bout n'est pas connu", () => {
    const moves = detectMoves([h("w", "ETH", 1, ETH), h("x", "BTC", 0.5, BTC)], [h("w", "ETH", 1.6, ETH), h("x", "BTC", 0.2, BTC)], new Set(["x", "w"]));
    expect(moves.map((m) => [m.kind, m.portfolioId, m.asset, m.direction])).toEqual([
      ["transfert", "w", "ETH", "in"],
      ["transfert", "x", "BTC", "out"],
    ]);
  });

  it("deux cryptos achetées d'un coup : on ne devine pas le partage, deux arrivées", () => {
    const moves = detectMoves([h("x", "EUR", 2000, 1)], [h("x", "BTC", 0.0125, BTC), h("x", "ETH", 0.33, ETH)], new Set(["x"]));
    expect(moves.map((m) => [m.kind, m.asset, m.direction])).toEqual([
      ["transfert", "BTC", "in"],
      ["transfert", "ETH", "in"],
    ]);
  });

  it("ne propose ni la poussière, ni les récompenses au fil de l'eau, ni un jeton sans cours", () => {
    expect(MIN_MOVE_EUR).toBeGreaterThan(0);
    const before = [h("w", "ETH", 10, ETH), h("w", "DOGE", 0, 0.1)];
    const after = [h("w", "ETH", 10.012, ETH), h("w", "DOGE", 50, 0.1), h("w", "MYSTERE", 1_000_000, null)];
    expect(detectMoves(before, after, new Set(["w"]))).toEqual([]);
  });

  it("la monnaie qui bouge seule n'est pas proposée : la banque la raconte", () => {
    expect(detectMoves([h("x", "EUR", 0, 1)], [h("x", "EUR", 5000, 1)], new Set(["x"]))).toEqual([]);
  });

  it("un portefeuille qu'on vient de relier, ou qui n'a pas été relu, ne propose rien", () => {
    expect(detectMoves([], [h("neuf", "BTC", 1, BTC)], new Set())).toEqual([]);
    expect(detectMoves([h("panne", "BTC", 1, BTC)], [], new Set(["autre"]))).toEqual([]);
  });

  it("additionne les lignes d'une même crypto dans un portefeuille (compte et staking)", () => {
    // Un passage du compte au staking, chez le même exchange, n'est pas un mouvement.
    expect(detectMoves([h("x", "ETH", 2, ETH)], [h("x", "ETH", 0.5, ETH), h("x", "eth", 1.5, ETH)], new Set(["x"]))).toEqual([]);
  });
});

describe("monnaie versée d'après le journal", () => {
  it("additionne les dépôts et les retraits faits, pas ce qui attend ni les autres genres", () => {
    expect(
      cashFlows([
        { type: "depot", value: 1000, status: "fait" },
        { type: "depot", value: 500.5 },
        { type: "depot", value: 300, status: "attente" },
        { type: "retrait", value: 200, status: "fait" },
        { type: "achat", value: 900, status: "fait" },
        { type: "depot", value: null, status: "fait" },
      ]),
    ).toEqual({ deposited: 1500.5, withdrawn: 200 });
  });
});
