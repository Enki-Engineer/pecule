import { describe, expect, it } from "vitest";
import { addMonths, comparisonSpan, isYearPeriod, monthsOfPeriod, PERIOD_RE, periodHasMonth, periodRange, shiftPeriod, trendEnd, trendMonths } from "../lib/periods.ts";

describe("comparisonSpan", () => {
  const nov = { from: "2026-11-01", to: "2026-11-30" };
  it("mois précédent, même mois l'an dernier", () => {
    expect(comparisonSpan(nov, "prev")).toMatchObject({ from: "2026-10-01", to: "2026-10-31", divisor: 1 });
    expect(comparisonSpan(nov, "year")).toMatchObject({ from: "2025-11-01", divisor: 1 });
  });
  it("moyenne des 3 mois précédents", () => {
    expect(comparisonSpan(nov, "avg3")).toMatchObject({ from: "2026-08-01", to: "2026-10-31", divisor: 3 });
  });
});

describe("période d'analyse", () => {
  it("reconnaît un mois ou une année", () => {
    expect(PERIOD_RE.test("2026-11")).toBe(true);
    expect(PERIOD_RE.test("2026")).toBe(true);
    expect(PERIOD_RE.test("2026-13")).toBe(false);
    expect(isYearPeriod("2026")).toBe(true);
    expect(isYearPeriod("2026-11")).toBe(false);
  });
  it("décale les mois par-dessus les années", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-11", -11)).toBe("2025-12");
    expect(shiftPeriod("2026", -1)).toBe("2025");
    expect(shiftPeriod("2026-12", 1)).toBe("2027-01");
  });
  it("donne les bornes d'un mois et d'une année, fin exclue", () => {
    expect(periodRange("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01", previous: "2026-11", prevStart: "2026-11-01", year: false });
    expect(periodRange("2026")).toEqual({ start: "2026-01-01", end: "2027-01-01", previous: "2025", prevStart: "2025-01-01", year: true });
    expect(monthsOfPeriod("2025")).toHaveLength(12);
    expect(periodHasMonth("2025", "2025-03")).toBe(true);
    expect(periodHasMonth("2025-04", "2025-03")).toBe(false);
  });
});

describe("fenêtre du graphique mois par mois", () => {
  const now = "2026-11";
  it("reste en place tant que le mois choisi y est", () => {
    expect(trendEnd(now, "2026-11", now)).toBe("2026-11");
    expect(trendEnd(now, "2026-03", now)).toBe("2026-11");
    expect(trendEnd(now, "2025-12", now)).toBe("2026-11");
  });
  it("glisse juste assez quand le mois choisi en sort", () => {
    expect(trendEnd(now, "2025-11", now)).toBe("2026-10");
    expect(trendEnd("2026-10", "2025-03", now)).toBe("2026-02");
    expect(trendEnd("2026-02", "2026-02", now)).toBe("2026-02");
    expect(trendEnd("2026-02", "2026-05", now)).toBe("2026-05");
    expect(trendEnd("2026-02", "2026-11", now)).toBe("2026-11");
  });
  it("ajoute trois mois de prévision quand elle touche le présent", () => {
    const w = trendMonths("2026-11", "2026-11", now);
    expect(w.months).toHaveLength(15);
    expect(w.months[0]).toBe("2025-12");
    expect(w.forecast).toEqual(["2026-12", "2027-01", "2027-02"]);
    expect(trendMonths("2025-03", "2026-02", now)).toEqual({ months: expect.arrayContaining(["2025-03", "2026-02"]), forecast: [] });
  });
  it("montre les douze mois d'une année, les prochains en prévision", () => {
    expect(trendMonths("2026", now, now).forecast).toEqual(["2026-12"]);
    expect(trendMonths("2025", now, now)).toEqual({ months: monthsOfPeriod("2025"), forecast: [] });
  });
});
