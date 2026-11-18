import { describe, expect, it } from "vitest";
import { scopeApplies, scopeKind } from "./scope.ts";

describe("scopeApplies", () => {
  it("vaut pour les écrans qui comptent les opérations des comptes", () => {
    for (const p of ["/", "/operations", "/operations?a_classer=1", "/tri", "/mois", "/mois?onglet=flux", "/comparer", "/budget/"]) {
      expect(scopeApplies(p)).toBe(true);
      expect(scopeKind(p)).toBe("comptes");
    }
  });

  it("vaut pour les revenus et les impôts, qui comptent les membres", () => {
    for (const p of ["/revenus", "/revenus/", "/impots", "/impots?annee=2024"]) expect(scopeKind(p)).toBe("situation");
  });

  it("ne vaut pas pour le patrimoine, la retraite, les documents ni les réglages", () => {
    for (const p of ["/patrimoine", "/patrimoine/crypto", "/immobilier/3", "/retraite", "/projections", "/documents", "/echeancier", "/factures", "/reglages/connexions", "/assistant", "/moisson", "/revenus-fonciers"])
      expect(scopeApplies(p)).toBe(false);
  });
});
