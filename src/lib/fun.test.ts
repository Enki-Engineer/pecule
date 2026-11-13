import { describe, expect, it } from "vitest";
import { equivalence, FETE_BUDGETS, FUN_UNITS, pickHighlight, workTime } from "./fun.ts";
import { SEASONS, type Season } from "./seasons.ts";

const eq = (amount: number, season: Season) => equivalence(amount, season)?.text ?? null;

describe("equivalence", () => {
  it("compte la bière en pintes, puis en litres, puis en fûts", () => {
    expect(eq(3, "saint-patrick")).toBeNull(); // moins d'une pinte
    expect(eq(7, "saint-patrick")).toBe("1 pinte de bière");
    expect(eq(84, "saint-patrick")).toBe("6 L de bière");
    expect(eq(-84, "saint-patrick")).toBe("6 L de bière"); // une dépense est un débit
    expect(eq(1200, "saint-patrick")).toBe("2,9 fûts de bière");
    expect(equivalence(84, "saint-patrick")?.ref).toBe("à 7 € la pinte");
  });
  it("compte au poids en grammes, kilos et tonnes", () => {
    expect(eq(0.5, "halloween")).toBeNull();
    expect(eq(6.5, "halloween")).toBe("650 g de bonbons");
    expect(eq(45, "paques")).toBe("1,5 kg d'œufs en chocolat");
    expect(eq(1240, "halloween")).toBe("124 kg de bonbons");
    expect(eq(200_000, "halloween")).toBe("20 tonnes de bonbons");
  });
  it("accorde le pluriel à partir de deux", () => {
    expect(eq(35, "saint-valentin")).toBe("1 bouquet de roses");
    expect(eq(52, "saint-valentin")).toBe("1,5 bouquet de roses");
    expect(eq(70, "saint-valentin")).toBe("2 bouquets de roses");
    expect(eq(20, "saint-valentin")).toBeNull();
  });
  it("a une unité pour chaque thème, au prix affiché", () => {
    for (const s of Object.keys(SEASONS) as Season[]) {
      expect(FUN_UNITS[s].price, s).toBeGreaterThan(0);
      expect(FUN_UNITS[s].ref, s).toMatch(/^à .+ €/);
      expect(equivalence(1000, s), s).not.toBeNull();
    }
  });
});

describe("workTime", () => {
  it("écrit un montant en temps de travail", () => {
    expect(workTime(50, null)).toBeNull();
    expect(workTime(1, 20)).toBeNull(); // 3 minutes
    expect(workTime(10, 20)).toBe("30 min de travail");
    expect(workTime(-66.5, 20)).toBe("3 h 20 de travail");
    expect(workTime(60, 20)).toBe("3 h de travail");
    expect(workTime(140, 20)).toBe("1 jour de travail");
    expect(workTime(420, 20)).toBe("3 jours de travail");
    expect(workTime(6000, 20)).toBe("2 mois de travail");
    expect(workTime(200_000, 20)).toBe("5,5 ans de travail");
  });
});

describe("budgets des fêtes", () => {
  it("ne citent que des catégories de dépense du référentiel", () => {
    for (const b of Object.values(FETE_BUDGETS)) for (const c of b.categories) expect(c).toMatch(/^B\d+(-\d\d)?$/);
  });
});

describe("pickHighlight", () => {
  it("change chaque jour, à tour de rôle", () => {
    const list = ["a", "b", "c"];
    const picks = [1, 2, 3, 4].map((d) => pickHighlight(list, new Date(2026, 2, d)));
    expect(new Set(picks.slice(0, 3)).size).toBe(3);
    expect(picks[3]).toBe(picks[0]);
    expect(pickHighlight([], new Date())).toBeNull();
  });
});
