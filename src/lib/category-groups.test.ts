import { describe, expect, it } from "vitest";
import { groupByPoste, searchGroups, wholePoste } from "./category-groups.ts";

const cat = (id: string, name: string, poste: string | null, sort_order: number, group_name: string | null = null) => ({ id, name, poste, group_name, sort_order });

describe("catégories rangées par poste", () => {
  it("suit l'ordre du référentiel, pour les postes comme pour leurs catégories", () => {
    const groups = groupByPoste([cat("B2", "Restaurants", "Alimentation", 12), cat("A1", "Salaires", "Revenus", 1), cat("B1", "Courses", "Alimentation", 11), cat("B3", "Essence", "Transports", 20)]);
    expect(groups.map((g) => g.poste)).toEqual(["Revenus", "Alimentation", "Transports"]);
    expect(groups[1].list.map((c) => c.id)).toEqual(["B1", "B2"]);
  });

  it("sépare deux catégories de même nom : chacune reste sous son poste", () => {
    const groups = groupByPoste([cat("A2", "Atelier du bois", "Revenus", 2), cat("B9", "Atelier du bois", "Dépenses de l'atelier", 38)]);
    expect(groups).toEqual([
      { poste: "Revenus", list: [expect.objectContaining({ id: "A2" })] },
      { poste: "Dépenses de l'atelier", list: [expect.objectContaining({ id: "B9" })] },
    ]);
  });

  it("à défaut de poste, range sous le groupe, puis sous le nom de la catégorie", () => {
    const groups = groupByPoste([cat("C1", "Virements internes", null, 50, "Mouvements"), cat("C2", "Épargne", null, 51, "Mouvements"), cat("D1", "Divers", null, 60)]);
    expect(groups.map((g) => [g.poste, g.list.length])).toEqual([
      ["Mouvements", 2],
      ["Divers", 1],
    ]);
  });

  it("ne modifie pas la liste reçue", () => {
    const list = [cat("B1", "Courses", "Alimentation", 11), cat("A1", "Salaires", "Revenus", 1)];
    groupByPoste(list);
    expect(list.map((c) => c.id)).toEqual(["B1", "A1"]);
  });
});

describe("poste entier", () => {
  const groups = groupByPoste([cat("B1", "Courses", "Alimentation", 11), cat("B2", "Restaurants", "Alimentation", 12), cat("B3", "Essence", "Transports", 20), cat("C1", "Virements internes", null, 50, "Mouvements"), cat("C2", "Épargne", null, 51, "Mouvements")]);

  it("se propose pour un poste qui réunit plusieurs catégories", () => {
    expect(wholePoste(groups[0])).toBe(true);
  });

  it("ne se propose ni pour une catégorie seule, ni pour un groupe sans poste", () => {
    expect(wholePoste(groups[1])).toBe(false);
    expect(wholePoste(groups[2])).toBe(false);
  });
});

describe("recherche d'une catégorie", () => {
  const groups = groupByPoste([cat("A1", "Salaires", "Revenus", 1), cat("B1", "Courses", "Alimentation", 11), cat("B2", "Restaurants", "Alimentation", 12), cat("B3", "Péages", "Transports", 20)]);
  const ids = (list: typeof groups) => list.map((g) => [g.poste, g.list.map((c) => c.id)]);

  it("sans recherche, rend les groupes tels quels", () => {
    expect(searchGroups(groups, "  ")).toBe(groups);
  });

  it("ne garde que les catégories trouvées, sans accents ni majuscules", () => {
    expect(ids(searchGroups(groups, "PEAGE"))).toEqual([["Transports", ["B3"]]]);
    expect(ids(searchGroups(groups, "rest"))).toEqual([["Alimentation", ["B2"]]]);
  });

  it("garde toutes les catégories d'un poste trouvé par son nom", () => {
    expect(ids(searchGroups(groups, "aliment"))).toEqual([["Alimentation", ["B1", "B2"]]]);
  });

  it("cherche aussi dans le nom affiché", () => {
    const shown = (name: string) => ({ Courses: "Groceries", Transports: "Transport" })[name] ?? name;
    expect(ids(searchGroups(groups, "grocer", shown))).toEqual([["Alimentation", ["B1"]]]);
  });

  it("ne rend rien quand rien ne correspond", () => {
    expect(searchGroups(groups, "zzz")).toEqual([]);
  });
});
