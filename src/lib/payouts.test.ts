import { describe, expect, it } from "vitest";
import { likeText, payoutYield, summarizePayouts, yearBefore } from "./payouts.ts";

// Un coupon mensuel de la famille de la démo : 30 € par mois depuis septembre 2025, 31 € depuis mars 2026.
const monthly = [
  ...["2025-09-09", "2025-10-09", "2025-11-12", "2025-12-09", "2026-01-09", "2026-02-10"].map((date) => ({ date, amount: 30 })),
  ...["2026-03-10", "2026-04-09", "2026-05-12", "2026-06-09", "2026-07-09", "2026-08-11", "2026-09-09", "2026-10-09", "2026-11-10"].map((date) => ({ date, amount: 31 })),
];

describe("versements reçus d'un placement", () => {
  it("recule d'un an, 29 février compris", () => {
    expect(yearBefore("2026-11-19")).toBe("2025-11-19");
    expect(yearBefore("2028-02-29")).toBe("2027-02-28");
    expect(yearBefore("2029-02-28")).toBe("2028-02-28");
  });

  it("résume par année, la plus récente d'abord, quel que soit l'ordre des lignes", () => {
    const s = summarizePayouts([...monthly].reverse(), "2026-11-19");
    expect(s.count).toBe(15);
    expect(s.total).toBe(6 * 30 + 9 * 31);
    expect(s.last).toEqual({ date: "2026-11-10", amount: 31 });
    expect(s.first).toEqual({ date: "2025-09-09", amount: 30 });
    expect(s.years).toEqual([
      { year: "2026", total: 2 * 30 + 9 * 31, count: 11 },
      { year: "2025", total: 4 * 30, count: 4 },
    ]);
  });

  it("compte douze mois jour pour jour", () => {
    const s = summarizePayouts(monthly, "2026-11-19");
    // Du 20/11/2025 au 19/11/2026 : décembre à février à 30 €, mars à novembre à 31 €.
    expect(s.last12).toBe(3 * 30 + 9 * 31);
    expect(s.fullYear).toBe(true);
    // Le versement d'il y a un an jour pour jour appartient aux douze mois d'avant.
    expect(summarizePayouts(monthly, "2026-11-12").last12).toBe(3 * 30 + 9 * 31);
    // Un versement daté de demain n'est pas encore reçu.
    expect(summarizePayouts(monthly, "2026-11-09").last12).toBe(30 + 3 * 30 + 8 * 31);
  });

  it("ne donne un rendement que sur une année entière et une valeur connue", () => {
    const s = summarizePayouts(monthly, "2026-11-19");
    expect(payoutYield(s, 9000)).toBe(4.1);
    expect(payoutYield(s, 0)).toBeNull();
    expect(payoutYield(s, null)).toBeNull();
    const young = summarizePayouts(monthly.slice(-6), "2026-11-19");
    expect(young.fullYear).toBe(false);
    expect(payoutYield(young, 9000)).toBeNull();
  });

  it("n'a rien à dire sans versement", () => {
    const s = summarizePayouts([], "2026-11-19");
    expect(s).toMatchObject({ count: 0, total: 0, last: null, first: null, years: [], last12: 0, fullYear: false });
    expect(payoutYield(s, 9000)).toBeNull();
  });

  it("cherche le texte tel qu'il est saisi", () => {
    expect(likeText("Nexalia")).toBe("%Nexalia%");
    expect(likeText("100%_net")).toBe("%100\\%\\_net%");
  });
});
