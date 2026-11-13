import { describe, expect, it } from "vitest";
import { comparisonSpan } from "../lib/periods.ts";

describe("comparisonSpan", () => {
  const nov = { from: "2026-11-01", to: "2026-11-30" };
  it("mois précédent, même mois l'an dernier", () => {
    expect(comparisonSpan(nov, "prev")).toMatchObject({ from: "2026-10-01", to: "2026-10-31", divisor: 1 });
    expect(comparisonSpan(nov, "year")).toMatchObject({ from: "2025-11-01", divisor: 1 });
  });
  it("moyenne des 3 mois précédents", () => {
    expect(comparisonSpan(nov, "avg3")).toMatchObject({ from: "2026-08-01", to: "2026-10-31", divisor: 3 });
  });
});
