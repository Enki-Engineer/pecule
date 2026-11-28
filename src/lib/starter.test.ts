import { describe, expect, it } from "vitest";
import { STARTER_CATEGORIES, STARTER_GROUPS, STARTER_NAMES, STARTER_RULES, STARTER_RULES_BEFORE, starterKind } from "./starter.ts";

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
  it("garde les codes déjà distribués, et marque ce qui est arrivé après eux", () => {
    // Les quarante-six catégories des premières installations : leur code ne change plus de sens.
    const first = STARTER_CATEGORIES.filter((c) => !c.added).map((c) => c.id);
    expect(first).toHaveLength(46);
    for (const id of ["A6", "B1-06", "B2-04", "B4-05", "B5-04", "B6-02", "B7", "B9-04", "B10", "B11", "B12-04"]) expect(first).toContain(id);
    // Une catégorie ajoutée suit, dans son poste, celles qui y étaient.
    const postes = STARTER_CATEGORIES.map((c) => c.poste);
    for (const [i, c] of STARTER_CATEGORIES.entries()) if (i && c.poste !== postes[i - 1]) expect(postes.slice(0, i), c.id).not.toContain(c.poste);
  });
  it("dit d'où vient chaque règle déplacée vers une catégorie ajoutée", () => {
    const byId = new Map(STARTER_CATEGORIES.map((c) => [c.id, c]));
    const rules = new Map(STARTER_RULES);
    for (const [pattern, was] of Object.entries(STARTER_RULES_BEFORE)) {
      expect(byId.get(rules.get(pattern)!)?.added, pattern).toBe(true);
      expect(byId.get(was) && !byId.get(was)!.added, pattern).toBe(true);
    }
  });
  it("ne nomme aucune personne ni aucun lieu", () => {
    expect(JSON.stringify(STARTER_CATEGORIES)).not.toMatch(/chien|SCI|studio/i);
  });
});
