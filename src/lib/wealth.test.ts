import { describe, expect, it } from "vitest";
import { accountShare, assetValue, historyRangeStart, historyRangeUseful, valueCrypto, netBefore } from "./wealth.ts";
import { cumulative, monthTotals } from "./month.ts";

describe("assetValue", () => {
  it("valorise un placement coté : parts × cours + espèces", () => {
    expect(assetValue({ valuation: "cotation", price: 5.1234, quantity: 950, cash: 12.5, value: 4000 })).toEqual({ quoted: true, value: 4879.73 });
  });
  it("garde la valeur saisie sans cours, ou pour un placement manuel", () => {
    expect(assetValue({ valuation: "cotation", price: null, quantity: 950, cash: 0, value: 4000 })).toEqual({ quoted: false, value: 4000 });
    expect(assetValue({ valuation: "manuel", price: 3, quantity: 10, cash: null, value: 8213.16 })).toEqual({ quoted: false, value: 8213.16 });
  });
});

describe("accountShare", () => {
  it("compte commun pour moitié, le sien en entier, celui d'un autre membre exclu", () => {
    expect(accountShare("joint", "alex")).toBe(0.5);
    expect(accountShare("alex", "alex")).toBe(1);
    expect(accountShare("camille", "alex")).toBe(0);
  });
});

describe("valueCrypto", () => {
  const rows = [
    { symbol: "ETH", quantity: "2", manual_value: null, price: "3000", change_24h: "-5", price_at: "2026-11-09 10:00:00" },
    { symbol: "BTC", quantity: 0.1, manual_value: null, price: 80000, change_24h: 10, price_at: "2026-11-09 11:00:00" },
    { symbol: "AUTRES", quantity: 0, manual_value: 500, price: null, change_24h: null, price_at: null },
    { symbol: "XYZ", quantity: 5, manual_value: null, price: null, change_24h: null, price_at: null },
  ];
  const r = valueCrypto(rows);
  it("valeur manuelle prioritaire, quantité × cours sinon, rien sans cours", () => {
    expect(r.positions.map((p) => [p.symbol, p.value])).toEqual([
      ["BTC", 8000],
      ["ETH", 6000],
      ["AUTRES", 500],
      ["XYZ", null],
    ]);
    expect(r.total).toBe(14500);
  });
  it("pondère la variation 24 h par la valeur des seules positions cotées", () => {
    expect(r.change24h).toBeCloseTo((8000 * 10 + 6000 * -5) / 14000, 6);
    expect(r.pricesAt).toBe("2026-11-09 11:00:00");
  });
});

describe("monthTotals / cumulative", () => {
  it("additionne par nature (dépenses et épargne en positif) sans « -0 »", () => {
    const t = monthTotals([
      { kind: "revenu", total: 4050 },
      { kind: "depense", total: -2700 },
      { kind: "depense", total: 13.75 },
      { kind: "epargne", total: -500 },
      { kind: "interne", total: -1000 },
    ]);
    expect(t).toEqual({ revenus: 4050, depenses: 2686.25, epargne: 500 });
    expect(Object.is(monthTotals([]).depenses, -0)).toBe(false);
  });
  it("cumule jour par jour, jours sans opération compris", () => {
    expect(cumulative([{ day: 1, total: 10.4 }, { day: 3, total: 5 }], 4)).toEqual([10, 10, 15, 15]);
  });
});

describe("durées de la courbe d'évolution", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 10, 13, 12);
  it("fait commencer chaque durée à son nombre de jours, et « tout » au début", () => {
    expect(historyRangeStart("tout", now)).toBe(0);
    expect(historyRangeStart("1m", now)).toBe(now - 31 * DAY);
    expect(historyRangeStart("6m", now)).toBe(now - 183 * DAY);
  });
  it("ne propose une durée que si l'historique remonte plus loin qu'elle", () => {
    const first = now - 82 * DAY; // un historique de 82 jours
    expect(historyRangeUseful("1m", first, now)).toBe(true);
    expect(historyRangeUseful("3m", first, now)).toBe(false);
    expect(historyRangeUseful("6m", first, now)).toBe(false);
    expect(historyRangeUseful("tout", first, now)).toBe(true);
  });
  it("garde « tout » sans aucun point, et refuse le reste", () => {
    expect(historyRangeUseful("tout", null, now)).toBe(true);
    expect(historyRangeUseful("1m", null, now)).toBe(false);
    expect(historyRangeUseful("1m", undefined, now)).toBe(false);
  });
});

describe("netBefore", () => {
  const now = Date.parse("2026-11-16T09:00:00Z");
  const history = [
    { date: "2026-09-01", net: 100 },
    { date: "2026-10-10", net: 140 },
    { date: "2026-10-20", net: "150.5" },
    { date: "2026-11-15", net: 180 },
  ];

  it("rend le dernier relevé à la date voulue ou avant", () => {
    expect(netBefore(history, 30, now)).toBe(140);
    expect(netBefore(history, 7, now)).toBe(150.5);
  });

  it("à défaut de relevé assez ancien, prend le plus ancien ; sans historique, rien", () => {
    expect(netBefore(history, 400, now)).toBe(100);
    expect(netBefore([], 30, now)).toBeNull();
  });
});
