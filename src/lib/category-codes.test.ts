import { describe, expect, it } from "vitest";
import { nextCategoryCode } from "./category-codes.ts";

const all = [
  { id: "A1", poste: "Revenus" },
  { id: "A6", poste: "Revenus" },
  { id: "B2-01", poste: "Transports" },
  { id: "B2-04", poste: "Transports" },
  { id: "B7", poste: "Impôts & Taxes" },
  { id: "B12-02", poste: "Divers & Imprévus" },
  { id: "C1", poste: "Mouvements internes" },
  { id: "C2", poste: "Mouvements internes" },
];

describe("code d'une nouvelle catégorie", () => {
  it("prend la suite des codes de son poste", () => {
    expect(nextCategoryCode(all, "Transports", "depense")).toBe("B2-05");
    expect(nextCategoryCode(all, "Revenus", "revenu")).toBe("A7");
    expect(nextCategoryCode(all, "Mouvements internes", "interne")).toBe("C3");
  });
  it("donne un second code au poste qui n'avait qu'une catégorie", () => {
    expect(nextCategoryCode(all, "Impôts & Taxes", "depense")).toBe("B7-02");
  });
  it("ouvre un numéro pour un nouveau poste, selon sa nature", () => {
    expect(nextCategoryCode(all, "Crédits", "depense")).toBe("B13");
    expect(nextCategoryCode(all, "Aides", "revenu")).toBe("A7");
    expect(nextCategoryCode([], "Revenus", "revenu")).toBe("A1");
  });
  it("saute un code déjà pris ailleurs", () => {
    expect(nextCategoryCode([...all, { id: "B2-05", poste: "Autre poste" }], "Transports", "depense")).toBe("B2-06");
  });
});
