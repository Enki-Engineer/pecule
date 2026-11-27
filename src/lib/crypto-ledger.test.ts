import { describe, expect, it } from "vitest";
import { exactTrade, fillsOf, type LedgerEntry } from "./crypto-ledger.ts";

const entry = (id: string, ref: string, at: string, symbol: string, amount: number, fee = 0, type = "trade"): LedgerEntry => ({ id, ref, at, type, symbol, amount, fee });

// Un ordre d'achat à cours limité de 80 000, exécuté en deux fois ; les frais sont pris en bitcoin.
const BUY = [
  entry("L1", "T1", "2026-11-20T18:47:01Z", "EUR", -1280),
  entry("L2", "T1", "2026-11-20T18:47:01Z", "BTC", 0.016, 0.000064),
  entry("L3", "T2", "2026-11-20T18:47:03Z", "EUR", -320),
  entry("L4", "T2", "2026-11-20T18:47:03Z", "BTC", 0.004, 0.000012),
];

describe("exécutions lues dans un registre", () => {
  it("réunit les deux écritures d'une même référence : ce qui part, ce qui arrive", () => {
    const fills = fillsOf([...BUY, entry("L5", "D1", "2026-07-13T12:32:00Z", "EUR", 1600, 0, "deposit")]);
    expect(fills).toEqual([
      { ref: "T1", at: "2026-11-20T18:47:01Z", sold: { symbol: "EUR", amount: 1280, fee: 0 }, bought: { symbol: "BTC", amount: 0.016, fee: 0.000064 } },
      { ref: "T2", at: "2026-11-20T18:47:03Z", sold: { symbol: "EUR", amount: 320, fee: 0 }, bought: { symbol: "BTC", amount: 0.004, fee: 0.000012 } },
    ]);
  });

  it("laisse de côté une référence qui n'a pas une sortie et une entrée", () => {
    expect(fillsOf([entry("L1", "T1", "2026-01-01T00:00:00Z", "EUR", -100)])).toEqual([]);
    expect(fillsOf([entry("L1", "T1", "2026-01-01T00:00:00Z", "EUR", -100), entry("L2", "T1", "2026-01-01T00:00:00Z", "BTC", 0.001), entry("L3", "T1", "2026-01-01T00:00:00Z", "ETH", 0.01)])).toEqual([]);
  });
});

describe("achat ou vente exact d'après les exécutions", () => {
  it("un achat en deux exécutions : date, cours d'exécution, frais ramenés à la monnaie, quantité nette", () => {
    const trade = exactTrade(fillsOf(BUY), "achat", "btc", 0.019924)!;
    expect(trade.at).toBe("2026-11-20T18:47:03Z");
    expect(trade.currency).toBe("EUR");
    expect(trade.quantity).toBeCloseTo(0.019924, 9);
    expect(trade.amount).toBeCloseTo(1600, 6);
    expect(trade.price).toBeCloseTo(80000, 6);
    expect(trade.fee).toBeCloseTo(6.08, 6);
  });

  it("une vente : la crypto cédée frais compris, la monnaie reçue frais déduits", () => {
    const fills = fillsOf([entry("L1", "T9", "2026-10-05T09:00:00Z", "ETH", -0.25, 0), entry("L2", "T9", "2026-10-05T09:00:00Z", "USD", 750, 3)]);
    const trade = exactTrade(fills, "vente", "ETH", 0.25)!;
    expect(trade).toMatchObject({ currency: "USD", quantity: 0.25, amount: 747, price: 3000, fee: 3 });
  });

  it("ne dit rien quand les exécutions n'expliquent pas ce que le solde a vu", () => {
    const fills = fillsOf(BUY);
    // Une quantité qui ne colle pas : un autre mouvement s'y mêle.
    expect(exactTrade(fills, "achat", "BTC", 0.05)).toBeNull();
    // Aucune exécution de cette crypto, ou pas dans ce sens.
    expect(exactTrade(fills, "achat", "ETH", 0.02)).toBeNull();
    expect(exactTrade(fills, "vente", "BTC", 0.019924)).toBeNull();
    // Deux monnaies pour un même achat : on ne les additionne pas.
    const mixed = fillsOf([...BUY, entry("L8", "T3", "2026-11-21T10:00:00Z", "USD", -100), entry("L9", "T3", "2026-11-21T10:00:00Z", "BTC", 0.001)]);
    expect(exactTrade(mixed, "achat", "BTC", 0.020924)).toBeNull();
  });

  it("un échange entre deux cryptos n'est ni un achat ni une vente", () => {
    const fills = fillsOf([entry("L1", "T5", "2026-03-01T00:00:00Z", "ETH", -1), entry("L2", "T5", "2026-03-01T00:00:00Z", "BTC", 0.0372)]);
    expect(exactTrade(fills, "achat", "BTC", 0.0372)).toBeNull();
  });
});
