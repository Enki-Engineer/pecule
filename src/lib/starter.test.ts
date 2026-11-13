import { describe, expect, it } from "vitest";
import { STARTER_CATEGORIES, STARTER_GROUPS, STARTER_NAMES, STARTER_RULES, starterKind } from "./starter.ts";

describe("jeu de départ", () => {
  it("a des codes uniques, dont ceux sur lesquels le code compte", () => {
    const ids = STARTER_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Mouvements internes, divers (ventilation des factures), épargne, restaurants et sorties (budgets des fêtes).
    for (const id of ["C1", "C2", "B12-02", "B8", "B3-04", "B3-03", "B9-01", "A1"]) expect(ids).toContain(id);
    expect(starterKind("A3")).toBe("revenu");
    expect(starterKind("B8")).toBe("epargne");
    expect(starterKind("B3-01")).toBe("depense");
    expect(starterKind("C1")).toBe("interne");
  });
  it("traduit chaque nom de catégorie, de poste et de groupe dans les quatre langues", () => {
    const names = new Set([...STARTER_CATEGORIES.flatMap((c) => [c.name, c.poste]), ...Object.values(STARTER_GROUPS)]);
    for (const n of names) {
      const t = STARTER_NAMES[n];
      expect(t, n).toBeDefined();
      for (const lang of ["en", "de", "it", "es"] as const) expect(t[lang].trim().length, `${n} (${lang})`).toBeGreaterThan(0);
    }
  });
  it("n'a que des règles qui visent une catégorie du jeu, écrites comme une clé de libellé", () => {
    const ids = new Set(STARTER_CATEGORIES.map((c) => c.id));
    const patterns = STARTER_RULES.map(([p]) => p);
    expect(new Set(patterns).size).toBe(patterns.length);
    for (const [pattern, id] of STARTER_RULES) {
      expect(ids.has(id), pattern).toBe(true);
      expect(pattern, pattern).toMatch(/^[a-z ]+$/);
    }
  });
  it("ne nomme aucune personne ni aucun lieu", () => {
    expect(JSON.stringify(STARTER_CATEGORIES)).not.toMatch(/chien|SCI|studio/i);
  });
});
