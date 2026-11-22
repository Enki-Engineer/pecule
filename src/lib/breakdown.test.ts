import { describe, expect, it } from "vitest";
import { arcsOf, averageRows, incomeParts, pickColored, savingsParts, spendingParts, type BreakdownRow } from "./breakdown.ts";

const row = (id: string | null, name: string | null, poste: string | null, kind: string, total: number, count = 1): BreakdownRow => ({ id, name, poste, kind, total, count });

const october: BreakdownRow[] = [
  row("B7", "Impôts / Taxes", "Impôts & Taxes", "depense", -1634, 2),
  row("B1-01", "Loyer / Crédit immobilier", "Logement", "depense", -1381.52, 3),
  row("B1-03", "Électricité / Gaz / Eau", "Logement", "depense", -130, 2),
  row("B3-04", "Restaurants", "Alimentation", "depense", -122.25, 5),
  row("B3-01", "Courses (supermarché)", "Alimentation", "depense", 20, 1), // remboursement net
  row("B11", "Frais bancaires", "Frais bancaires", "depense", -2.05),
  row(null, null, null, "depense", -261.69, 4),
  row("C1", "Transferts entre comptes", "Mouvements internes", "interne", -617.9, 9),
  row("B8", "Épargne", "Epargne & Investissements", "epargne", -300),
  row("A1", "Salaire", "Revenus", "revenu", 3329.74),
  row("A4", "Revenus d'investissements", "Revenus", "revenu", 786.02, 2),
  row(null, null, null, "revenu", 901.17, 3),
];
const september: BreakdownRow[] = [row("B1-01", "Loyer / Crédit immobilier", "Logement", "depense", -1381.52, 3), row("A1", "Salaire", "Revenus", "revenu", 3405.47)];

describe("pickColored", () => {
  it("garde les plus lourds, rangés dans l'ordre du référentiel", () => {
    const rows = [
      { poste: "Divers & Imprévus", code: "B12-01", total: 900 },
      { poste: "Logement", code: "B1-01", total: 18000 },
      { poste: "Transports", code: "B2-01", total: 50 },
      { poste: "Loisirs & Vacances", code: "B9-01", total: 2500 },
      { poste: "Remboursé", code: "B5-01", total: -10 },
    ];
    expect(pickColored(rows, 3)).toEqual(["Logement", "Loisirs & Vacances", "Divers & Imprévus"]);
  });
});

describe("spendingParts", () => {
  const parts = spendingParts(october, september, ["Logement", "Alimentation", "Impôts & Taxes"]);
  it("regroupe par poste, en net, hors épargne et mouvements internes", () => {
    expect(parts.map((p) => p.label)).toEqual(["Impôts & Taxes", "Logement", "À classer", "Alimentation", "Frais bancaires"]);
    expect(parts.find((p) => p.label === "Logement")).toMatchObject({ total: 1511.52, count: 5, prev: 1381.52, poste: "Logement" });
    expect(parts.find((p) => p.label === "Alimentation")?.total).toBe(102.25);
  });
  it("la somme des parts est le total des dépenses du mois", () => {
    expect(Math.round(parts.reduce((s, p) => s + p.total, 0) * 100)).toBe(Math.round((1634 + 1381.52 + 130 + 122.25 - 20 + 2.05 + 261.69) * 100));
  });
  it("couleur fixe par poste, gris pour les autres, à part pour « à classer »", () => {
    expect(Object.fromEntries(parts.map((p) => [p.label, p.slot]))).toEqual({ "Impôts & Taxes": 3, Logement: 1, "À classer": null, Alimentation: 2, "Frais bancaires": null });
    expect(parts.find((p) => p.unclassified)).toMatchObject({ arc: "a-classer", poste: undefined });
    expect(parts.find((p) => p.label === "Frais bancaires")?.arc).toBe("autres");
  });
  it("sans liste du serveur, colore les postes du mois dans l'ordre du référentiel", () => {
    const own = spendingParts(october, []);
    expect(own.filter((p) => p.slot).sort((a, b) => a.slot! - b.slot!).map((p) => p.label)).toEqual(["Logement", "Alimentation", "Impôts & Taxes", "Frais bancaires"]);
  });
  it("catégories du poste, les plus lourdes d'abord", () => {
    expect(parts.find((p) => p.label === "Logement")?.items.map((i) => i.id)).toEqual(["B1-01", "B1-03"]);
  });
});

describe("incomeParts", () => {
  const parts = incomeParts(october, september);
  it("une part par catégorie de revenu, couleur selon le code", () => {
    expect(parts.map((p) => [p.label, p.slot, p.category])).toEqual([
      ["Salaire", 1, "A1"],
      ["Revenus non classés", null, undefined],
      ["Revenus d'investissements", 4, "A4"],
    ]);
    expect(parts[0].prev).toBe(3405.47);
  });
});

describe("savingsParts", () => {
  const rows = [...october, row("B8-02", "Assurance-vie", "Epargne & Investissements", "epargne", -100), row("B8-03", "Plan d'épargne", "Epargne & Investissements", "epargne", 0)];
  const before = [row("B8", "Épargne", "Epargne & Investissements", "epargne", -250)];
  it("une part par support, montants positifs, couleur selon le poids", () => {
    const parts = savingsParts(rows, before);
    expect(parts.map((p) => [p.label, p.total, p.slot, p.category])).toEqual([
      ["Épargne", 300, 1, "B8"],
      ["Assurance-vie", 100, 2, "B8-02"],
      ["Plan d'épargne", 0, null, "B8-03"],
    ]);
    expect(parts[0].prev).toBe(250);
    expect(parts[1].prev).toBe(0);
  });
  it("ne prend ni les dépenses ni les mouvements internes", () => {
    expect(savingsParts(october, []).map((p) => p.key)).toEqual(["B8"]);
  });
});

describe("averageRows", () => {
  it("fait la moyenne catégorie par catégorie, un mois sans elle comptant pour zéro", () => {
    const avg = averageRows([september, october, []]);
    const of = (id: string | null, kind: string) => avg.find((r) => r.id === id && r.kind === kind)?.total;
    expect(of("A1", "revenu")).toBe(2245.07);
    expect(of("B1-01", "depense")).toBe(-921.01);
    expect(of("B7", "depense")).toBe(-544.67);
    // Sans catégorie : les dépenses et les revenus non classés restent deux lignes distinctes.
    expect(of(null, "depense")).toBe(-87.23);
    expect(of(null, "revenu")).toBe(300.39);
  });
  it("rend une liste vide sans mois", () => {
    expect(averageRows([])).toEqual([]);
  });
  it("sert de période de référence aux parts", () => {
    const parts = spendingParts(october, averageRows([september, september]));
    expect(parts.find((p) => p.label === "Logement")?.prev).toBe(1381.52);
  });
});

describe("arcsOf", () => {
  it("ordre fixe des couleurs, puis autres, puis à classer ; parts négatives écartées", () => {
    const parts = spendingParts([...october, row("B5-01", "Nourriture (chien)", "Animaux", "depense", 15)], [], ["Logement", "Alimentation", "Impôts & Taxes"]);
    expect(arcsOf(parts).map((a) => [a.key, a.label])).toEqual([
      ["Logement", "Logement"],
      ["Alimentation", "Alimentation"],
      ["Impôts & Taxes", "Impôts & Taxes"],
      ["autres", "Frais bancaires"],
      ["a-classer", "À classer"],
    ]);
  });
  it("plusieurs postes gris : une seule part « Autres postes »", () => {
    const parts = spendingParts(october, [], ["Logement"]);
    const others = arcsOf(parts).find((a) => a.key === "autres");
    expect(others).toMatchObject({ label: "Autres postes", value: 1738.3 });
  });
});

describe("virements qui franchissent la vue du membre", () => {
  const rows: BreakdownRow[] = [
    row("A1", "Salaire", null, "revenu", 2400),
    row("virement:recu:camille", "Apports de Camille", null, "revenu", 900, 2),
    row("B1-01", "Loyer / Crédit immobilier", "Logement", "depense", -900),
    row("virement:verse:joint", "Versements au compte commun", "Versements au compte commun", "depense", -600, 2),
  ];

  it("un apport est une part des revenus, colorée, forée par son identifiant", () => {
    const part = incomeParts(rows, []).find((p) => p.key === "virement:recu:camille")!;
    expect(part).toMatchObject({ label: "Apports de Camille", total: 900, count: 2, transfer: true, category: "virement:recu:camille", slot: 8, arc: "virement:recu:camille" });
    // La couleur du salaire ne bouge pas.
    expect(incomeParts(rows, []).find((p) => p.key === "A1")!.slot).toBe(1);
  });

  it("un versement fait son propre poste de dépense, foré par son identifiant et non par un poste du référentiel", () => {
    const part = spendingParts(rows, [], ["Logement"]).find((p) => p.transfer)!;
    expect(part).toMatchObject({ label: "Versements au compte commun", total: 600, count: 2, category: "virement:verse:joint" });
    expect(part.poste).toBeUndefined();
    expect(spendingParts(rows, [], ["Logement"]).find((p) => p.label === "Logement")!.poste).toBe("Logement");
  });
});
