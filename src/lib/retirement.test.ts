import { describe, expect, it } from "vitest";
import { retirementFact, simFamily } from "./retirement.ts";

describe("retraite : ce que l'écran retrouve", () => {
  const facts = [
    { label: "Âge légal de départ", value: "64" },
    { label: "Date de départ au plus tôt", value: "2052-04-01" },
    { label: "Âge du taux plein automatique", value: "67" },
    { label: "Trimestres requis pour le taux plein", value: "172" },
    { label: "Trimestres enregistrés au 14/07/2026", value: "68" },
  ];

  it("lit ses chiffres clés par le début du libellé", () => {
    expect(retirementFact(facts, "quarters")).toBe("68");
    expect(retirementFact(facts, "required")).toBe("172");
    expect(retirementFact(facts, "legalAge")).toBe("64");
    expect(retirementFact(facts, "fullAge")).toBe("67");
    expect(retirementFact(facts, "earliest")).toBe("2052-04-01");
  });

  it("ne prend pas un fait voisin pour un autre", () => {
    expect(retirementFact([{ label: "Trimestres validés", value: "68" }], "quarters")).toBeNull();
    expect(retirementFact([], "fullAge")).toBeNull();
  });

  it("range une simulation dans sa famille", () => {
    expect(simFamily({ source: "info-retraite", label: "Départ à l'âge légal (64 ans)" })).toBe("officielle");
    expect(simFamily({ source: "scenario", label: "Carrière complète, départ à 65 ans" })).toBe("complete");
    expect(simFamily({ source: "scenario", label: "Arrêt à 55 ans (FIRE), départ à 64 ans" })).toBe("fire");
    expect(simFamily({ source: "scenario", label: "Arrêt d'activité à 58 ans" })).toBe("fire");
    expect(simFamily({ source: "scenario", label: "Temps partiel dès 60 ans" })).toBeNull();
    // Une estimation officielle reste officielle, quel que soit son libellé.
    expect(simFamily({ source: "info-retraite", label: "Carrière complète" })).toBe("officielle");
  });
});
