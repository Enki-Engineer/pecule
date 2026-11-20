import { describe, expect, it } from "vitest";
import { factText, planFacts, type Fact } from "./facts.ts";

const existing: Fact[] = [
  { fact_key: "dpe", label: "DPE", value: "E", unit: null, as_of: "2024-03-01" },
  { fact_key: "pno", label: "Assurance du propriétaire", value: "113", unit: "€/an", as_of: "2025-10-27" },
];

describe("planFacts", () => {
  it("change la valeur d'un fait connu en gardant son libellé et son unité", () => {
    const p = planFacts(existing, [{ key: "pno", value: 94.2 }], "2026-11-20");
    expect(p).toEqual({ set: [{ key: "pno", label: "Assurance du propriétaire", value: "94.2", unit: "€/an", as_of: "2026-11-20", before: "113 €/an" }], remove: [], unknown: [] });
  });
  it("ajoute un fait nouveau quand il a un libellé, à la date donnée", () => {
    const p = planFacts(existing, [{ key: "chaudiere", label: "Chaudière remplacée", value: "2026", as_of: "2026-06-02" }], "2026-11-20");
    expect(p.set).toEqual([{ key: "chaudiere", label: "Chaudière remplacée", value: "2026", unit: null, as_of: "2026-06-02", before: null }]);
  });
  it("retire un fait connu quand sa valeur est nulle", () => {
    expect(planFacts(existing, [{ key: "dpe", value: null }], "2026-11-20").remove).toEqual([{ key: "dpe", label: "DPE" }]);
  });
  it("signale ce qu'il ne peut ni créer ni retirer", () => {
    const p = planFacts(existing, [{ key: "inconnu", value: "x" }, { key: "absent", value: null }], "2026-11-20");
    expect(p).toEqual({ set: [], remove: [], unknown: ["inconnu", "absent"] });
  });
  it("renomme un fait, efface son unité, et ne garde que la dernière demande d'une même clé", () => {
    const p = planFacts(existing, [{ key: "pno", value: "1" }, { key: "pno", label: "Assurance PNO", value: "94,20 € par an", unit: null }], "2026-11-20");
    expect(p.set).toEqual([{ key: "pno", label: "Assurance PNO", value: "94,20 € par an", unit: null, as_of: "2026-11-20", before: "113 €/an" }]);
  });
});

describe("factText", () => {
  it("accole l'unité quand il y en a une", () => {
    expect(factText("40.68", "m²")).toBe("40.68 m²");
    expect(factText("C", null)).toBe("C");
  });
});
