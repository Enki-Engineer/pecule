import { describe, expect, it } from "vitest";
import { daysBetween, paidSummary, renewal, shareBudget, shiftDays, yearlyCost } from "./contracts.ts";

describe("renewal", () => {
  it("garde une échéance à venir et en déduit la date limite de résiliation", () => {
    expect(renewal("2026-12-08", 30, "2026-11-10")).toEqual({ recorded: "2026-12-08", next: "2026-12-08", assumedYearly: false, noticeDays: 30, cancelBefore: "2026-11-08", daysLeft: -2 });
    expect(renewal("2027-03-01", 60, "2026-11-10")).toMatchObject({ cancelBefore: "2026-12-31", daysLeft: 51 });
  });

  it("reporte une échéance passée à son prochain anniversaire", () => {
    expect(renewal("2024-01-15", 30, "2026-11-10")).toMatchObject({ next: "2027-01-15", assumedYearly: true, cancelBefore: "2026-12-16" });
    // Échéance du jour : c'est encore elle.
    expect(renewal("2025-11-10", null, "2026-11-10")).toMatchObject({ next: "2026-11-10", cancelBefore: "2026-11-10", daysLeft: 0, noticeDays: null });
  });

  it("ramène un 29 février au 28 les années ordinaires", () => {
    expect(renewal("2024-02-29", 0, "2025-01-01")?.next).toBe("2025-02-28");
    expect(renewal("2024-02-29", 0, "2027-03-01")?.next).toBe("2028-02-29");
  });

  it("ne rend rien sans date lisible", () => {
    expect(renewal(null, 30, "2026-11-10")).toBeNull();
    expect(renewal("bientôt", 30, "2026-11-10")).toBeNull();
  });
});

describe("jours", () => {
  it("décale et compte en jours pleins, changement d'heure compris", () => {
    expect(shiftDays("2026-03-30", -2)).toBe("2026-03-28");
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-20", "2026-10-30")).toBe(10);
    expect(daysBetween("2026-11-10", "2026-11-08")).toBe(-2);
  });
});

describe("yearlyCost", () => {
  it("déduit le montant qui manque", () => {
    expect(yearlyCost({ monthly: 47.8, annual: null })).toEqual({ monthly: 47.8, annual: 573.6 });
    expect(yearlyCost({ monthly: null, annual: 258 })).toEqual({ monthly: 21.5, annual: 258 });
  });
  it("garde les deux montants saisis, même s'ils ne se recoupent pas", () => {
    expect(yearlyCost({ monthly: 50, annual: 580 })).toEqual({ monthly: 50, annual: 580 });
  });
  it("ne rend rien sans montant", () => {
    expect(yearlyCost({ monthly: null, annual: null })).toBeNull();
  });
});

describe("paidSummary", () => {
  const months = [
    { month: "2026-09", total: 47.8, count: 1 },
    { month: "2026-10", total: 47.8, count: 1 },
    { month: "2026-08", total: 35.3, count: 2 },
  ];

  it("additionne les mois prélevés, dans l'ordre", () => {
    expect(paidSummary(months, "2025-11-11", "2024-01-03")).toEqual({
      total: 130.9,
      count: 4,
      months: 3,
      monthlyAverage: 43.63,
      firstMonth: "2026-08",
      lastMonth: "2026-10",
      partial: false,
      byMonth: [months[2], months[0], months[1]],
    });
  });

  it("signale un historique plus court que la période", () => {
    expect(paidSummary(months, "2025-11-11", "2026-08-02")?.partial).toBe(true);
    expect(paidSummary(months, "2025-11-11", "2025-11-28")?.partial).toBe(false);
    expect(paidSummary(months, "2025-11-11", null)?.partial).toBe(false);
  });

  it("ne rend rien sans prélèvement", () => {
    expect(paidSummary([], "2025-11-11", null)).toBeNull();
  });
});

describe("shareBudget", () => {
  it("donne les textes courts en entier et partage le reste", () => {
    expect(shareBudget([1000, 50_000, 30_000], 21_000)).toEqual([1000, 10_000, 10_000]);
    expect(shareBudget([2000, 3000], 24_000)).toEqual([2000, 3000]);
    expect(shareBudget([40_000], 24_000)).toEqual([24_000]);
  });
  it("redistribue en plusieurs tours", () => {
    expect(shareBudget([100, 6000, 20_000], 18_100)).toEqual([100, 6000, 12_000]);
  });
  it("ignore les textes vides et un budget nul", () => {
    expect(shareBudget([0, 500], 300)).toEqual([0, 300]);
    expect(shareBudget([10, 20], 0)).toEqual([0, 0]);
    expect(shareBudget([], 100)).toEqual([]);
  });
});
