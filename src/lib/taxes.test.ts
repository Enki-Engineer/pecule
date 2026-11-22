import { describe, expect, it } from "vitest";
import { JOINT, allowedOwner, proposedOwner, salaryReturn, taxYears, type ReturnFigures } from "./taxes.ts";

const ret = (income_year: number, owner_user_id: number, taxable_income: number | null, net_tax: number | null, more: Partial<ReturnFigures> = {}): ReturnFigures => ({
  income_year,
  owner_user_id,
  taxable_income,
  rfr: taxable_income,
  net_tax,
  social_levies: null,
  total: net_tax,
  balance: null,
  tmi: null,
  avg_rate: null,
  ...more,
});

describe("taxYears", () => {
  it("rend une année à une seule déclaration telle que son avis la donne", () => {
    const [y] = taxYears([ret(2025, JOINT, 60000, 4200, { social_levies: 300, total: 4500, tmi: 30, avg_rate: 7.5, balance: -120 })]);
    expect(y).toMatchObject({ income_year: 2025, taxable_income: 60000, net_tax: 4200, social_levies: 300, total: 4500, tmi: 30, avg_rate: 7.5, balance: -120 });
    expect(y.returns).toHaveLength(1);
  });

  it("additionne les déclarations personnelles d'une même année", () => {
    const years = taxYears([ret(2021, 2, 20000, 800, { tmi: 11 }), ret(2022, JOINT, 50000, 3000), ret(2021, 1, 30000, 2200, { tmi: 30, social_levies: 100, total: 2300 })]);
    expect(years.map((y) => y.income_year)).toEqual([2022, 2021]);
    const y21 = years[1];
    expect(y21.returns.map((r) => r.owner_user_id)).toEqual([1, 2]);
    expect(y21).toMatchObject({ taxable_income: 50000, net_tax: 3000, social_levies: 100, total: 3100, tmi: 30 });
    // Taux moyen de l'année : impôt net rapporté au revenu imposable des deux déclarations.
    expect(y21.avg_rate).toBe(6);
  });

  it("garde « inconnu » ce qu'aucune déclaration ne donne", () => {
    const [y] = taxYears([ret(2020, 1, null, null), ret(2020, 2, null, null)]);
    expect(y).toMatchObject({ taxable_income: null, net_tax: null, social_levies: null, tmi: null, avg_rate: null });
  });
});

describe("salaryReturn", () => {
  it("rattache un salaire à la déclaration du membre, sinon à la commune", () => {
    expect(salaryReturn(1, [JOINT])).toBe(JOINT);
    expect(salaryReturn(1, [1, 2])).toBe(1);
    expect(salaryReturn(2, [JOINT, 1])).toBe(JOINT);
  });
});

describe("allowedOwner", () => {
  it("n'admet que la déclaration commune ou celle de celui qui relit", () => {
    expect(allowedOwner(JOINT, 2)).toBe(JOINT);
    expect(allowedOwner(2, 2)).toBe(2);
    // La déclaration personnelle d'un autre membre ne se lit ni ne s'écrit par la relecture d'un avis.
    expect(allowedOwner(1, 2)).toBeNull();
    expect(allowedOwner(Number("abc"), 2)).toBeNull();
  });
});

describe("proposedOwner", () => {
  const members = [
    { id: 1, name: "Alex" },
    { id: 2, name: "Camille" },
  ];
  it("propose le membre quand l'avis ne nomme que lui, hors imposition commune", () => {
    expect(proposedOwner({ situation: "Célibataire", declarants: ["ALEX"] }, members)).toBe(1);
    expect(proposedOwner({ situation: null, declarants: ["Camille Marie"] }, members)).toBe(2);
  });
  it("propose la déclaration commune dans les autres cas", () => {
    expect(proposedOwner({ situation: "Pacsés", declarants: ["Alex"] }, members)).toBe(JOINT);
    expect(proposedOwner({ situation: "Mariés", declarants: ["Alex", "Camille"] }, members)).toBe(JOINT);
    expect(proposedOwner({ situation: "Célibataire", declarants: ["Alex", "Camille"] }, members)).toBe(JOINT);
    expect(proposedOwner({ situation: "Célibataire", declarants: ["Dominique"] }, members)).toBe(JOINT);
    expect(proposedOwner({ situation: "Célibataire", declarants: [] }, members)).toBe(JOINT);
    // Un foyer d'un seul membre : rien à distinguer.
    expect(proposedOwner({ situation: "Célibataire", declarants: ["Alex"] }, [members[0]])).toBe(JOINT);
  });
});
