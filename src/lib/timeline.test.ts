import { describe, expect, it } from "vitest";
import { bubbleRadius, cumulativeNet, laneOf, niceTicks, stackOffsets } from "./timeline.ts";

describe("laneOf", () => {
  it("range chaque opération dans son couloir", () => {
    expect(laneOf({ kind: "revenu", amount: 2400, nature: "entree" })).toBe("entrees");
    expect(laneOf({ kind: "depense", amount: 35, nature: "remboursement" })).toBe("entrees");
    expect(laneOf({ kind: "depense", amount: -52.3, nature: "carte" })).toBe("carte");
    expect(laneOf({ kind: "depense", amount: -80, nature: "prelevement" })).toBe("prelevement");
    expect(laneOf({ kind: "depense", amount: -80, nature: "interne" })).toBe("prelevement");
    expect(laneOf({ kind: "epargne", amount: -300, nature: "virement" })).toBe("epargne");
  });
});

describe("bubbleRadius", () => {
  it("fait suivre l'aire au montant, entre un minimum et un maximum", () => {
    expect(bubbleRadius(-1600, 1600)).toBe(20);
    expect(bubbleRadius(-400, 1600)).toBe(10);
    expect(bubbleRadius(-2, 1600)).toBe(4);
    expect(bubbleRadius(50, 0)).toBe(4);
  });
});

describe("stackOffsets", () => {
  it("empile autour du centre sans chevauchement", () => {
    const { offsets, extent } = stackOffsets([10, 6, 4], 2);
    expect(offsets).toEqual([0, -18, 16]);
    expect(extent).toBe(24);
    expect(stackOffsets([]).extent).toBe(0);
  });
});

describe("cumulativeNet", () => {
  it("cumule les montants signés jour après jour et s'arrête au jour demandé", () => {
    const points = [
      { day: 1, amount: 2000 },
      { day: 2, amount: -500 },
      { day: 2, amount: -100.5 },
      { day: 4, amount: -300 },
    ];
    expect(cumulativeNet(points, 5)).toEqual([2000, 1399.5, 1399.5, 1099.5, 1099.5]);
    expect(cumulativeNet(points, 5, 3)).toEqual([2000, 1399.5, 1399.5, null, null]);
  });
});

describe("niceTicks", () => {
  it("donne des graduations rondes, zéro compris", () => {
    expect(niceTicks(0, 3800)).toEqual([0, 1000, 2000, 3000]);
    expect(niceTicks(-420, 1900)).toEqual([0, 1000]);
    expect(niceTicks(-900, 400, 4)).toEqual([-500, 0]);
    expect(niceTicks(0, 0)).toEqual([0]);
  });
});
