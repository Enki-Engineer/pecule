import { describe, expect, it } from "vitest";
import { scopeApplies } from "./scope.ts";

describe("scopeApplies", () => {
  it("vaut pour les écrans qui comptent les opérations des comptes", () => {
    for (const p of ["/", "/operations", "/operations?a_classer=1", "/tri", "/mois", "/mois?onglet=flux", "/comparer", "/budget/"]) expect(scopeApplies(p)).toBe(true);
  });

  it("ne vaut pas pour le patrimoine, la situation, les documents ni les réglages", () => {
    for (const p of ["/patrimoine", "/patrimoine/crypto", "/immobilier/3", "/impots", "/documents", "/echeancier", "/factures", "/reglages/connexions", "/assistant", "/moisson"]) expect(scopeApplies(p)).toBe(false);
  });
});
