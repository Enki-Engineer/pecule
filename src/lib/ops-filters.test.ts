import { describe, expect, it } from "vitest";
import { pillOrder, yearBounds, yearGrid } from "./ops-filters.ts";

const none = { a_classer: false, categorie: false, compte: false, nature: false, mois: false };

describe("ordre des pastilles de filtre", () => {
  it("sans filtre, garde l'ordre proposé", () => {
    expect(pillOrder(none)).toEqual(["a_classer", "categorie", "compte", "nature", "mois"]);
  });

  it("met en tête les filtres en cours, chacun à son rang", () => {
    expect(pillOrder({ ...none, mois: true, categorie: true })).toEqual(["categorie", "mois", "a_classer", "compte", "nature"]);
  });
});

describe("années du choix du mois", () => {
  it("va de la plus ancienne année qui a des opérations à l'année en cours", () => {
    expect(yearBounds(["2026-03", "2024-11", "2025-01"], "2026-11")).toEqual({ min: 2024, max: 2026 });
  });

  it("sans opération connue, ne propose que l'année en cours", () => {
    expect(yearBounds([], "2026-11")).toEqual({ min: 2026, max: 2026 });
  });

  it("garde l'année du filtre, mois ou année entière, même sans opération", () => {
    expect(yearBounds(["2026-03"], "2026-11", "2019-06")).toEqual({ min: 2019, max: 2026 });
    expect(yearBounds(["2026-03"], "2026-11", "2021")).toEqual({ min: 2021, max: 2026 });
  });
});

describe("grille des mois d'une année", () => {
  it("donne douze mois, avec le nombre d'opérations de chacun", () => {
    const grid = yearGrid(2025, new Map([["2025-01", 12], ["2025-12", 3]]), "2026-11");
    expect(grid).toHaveLength(12);
    expect(grid[0]).toEqual({ month: "2025-01", count: 12, empty: false });
    expect(grid[1]).toEqual({ month: "2025-02", count: 0, empty: true });
    expect(grid[11]).toEqual({ month: "2025-12", count: 3, empty: false });
  });

  it("écarte les mois à venir", () => {
    const grid = yearGrid(2026, new Map([["2026-11", 5]]), "2026-11");
    expect(grid[10]).toEqual({ month: "2026-11", count: 5, empty: false });
    expect(grid[11]).toEqual({ month: "2026-12", count: 0, empty: true });
  });

  it("tant que les nombres ne sont pas connus, seuls les mois à venir sont écartés", () => {
    const grid = yearGrid(2026, null, "2026-11");
    expect(grid[0]).toEqual({ month: "2026-01", count: null, empty: false });
    expect(grid[11].empty).toBe(true);
  });
});
