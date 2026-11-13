import { describe, expect, it } from "vitest";
import { canonicalEmployer } from "./payslips.ts";

describe("canonicalEmployer", () => {
  const known = ["Nexalia Conseil", "Clinique de l'Estuaire", "Orvale"];
  it("ramène les variantes d'un employeur au nom déjà connu", () => {
    expect(canonicalEmployer("nexalia conseil", known)).toBe("Nexalia Conseil");
    expect(canonicalEmployer("NEXALIA - CONSEIL SAS", known)).toBe("Nexalia Conseil");
    expect(canonicalEmployer("Nexalia Conseil Nantes", known)).toBe("Nexalia Conseil");
    expect(canonicalEmployer("Clinique de l’Estuaire", known)).toBe("Clinique de l'Estuaire");
    expect(canonicalEmployer("Orvale Industrie", known)).toBe("Orvale");
    expect(canonicalEmployer("Nexalia", known)).toBe("Nexalia Conseil");
  });
  it("laisse un employeur nouveau tel quel", () => {
    expect(canonicalEmployer("  Atelier   du Port ", known)).toBe("Atelier du Port");
    expect(canonicalEmployer("Nexalis", known)).toBe("Nexalis");
    expect(canonicalEmployer("Orvale")).toBe("Orvale");
  });
});
