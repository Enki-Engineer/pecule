import { describe, expect, it } from "vitest";
import { canonicalEmployer, payslipMonths, payslipYears, type PayslipLine } from "./payslips.ts";

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

const line = (user_id: number, period: string, net_paid: number, more: Partial<PayslipLine> = {}): PayslipLine => ({ user_id, period, employer: user_id === 1 ? "Nexalia Conseil" : "Clinique de l'Estuaire", gross: net_paid * 1.3, net_taxable: net_paid * 1.05, income_tax: net_paid * 0.05, net_paid, bonus: null, ...more });

describe("payslipYears", () => {
  const rows = [line(1, "2026-02", 2400.1), line(2, "2026-02", 1900), line(1, "2026-01", 2400.2, { bonus: 500 }), line(2, "2025-12", 1850), line(1, "2025-12", 2300, { net_paid: null })];
  it("additionne par année, la plus récente d'abord, et garde la part de chaque membre", () => {
    const [y26, y25] = payslipYears(rows);
    expect(y26).toMatchObject({ year: "2026", months: 3, netPaid: 6700.3, bonus: 500, employers: ["Nexalia Conseil", "Clinique de l'Estuaire"] });
    expect(y26.members).toEqual([expect.objectContaining({ user_id: 1, months: 2, netPaid: 4800.3 }), expect.objectContaining({ user_id: 2, months: 1, netPaid: 1900 })]);
    // Un montant non lu compte pour zéro, le bulletin reste compté.
    expect(y25).toMatchObject({ year: "2025", months: 2, netPaid: 1850 });
  });
  it("donne pour un membre seul les mêmes totaux que sa part dans le foyer", () => {
    const alone = payslipYears(rows.filter((r) => r.user_id === 1));
    const { user_id: _, ...part } = payslipYears(rows)[0].members[0];
    expect(alone[0]).toMatchObject(part);
  });
});

describe("payslipMonths", () => {
  it("réunit les bulletins d'un même mois et rend les derniers mois dans l'ordre", () => {
    const months = payslipMonths([line(1, "2026-02", 2400, { document_id: 7 }), line(2, "2026-02", 1900), line(1, "2026-01", 2400), line(1, "2025-12", 2300)], 2);
    expect(months.map((m) => m.period)).toEqual(["2026-01", "2026-02"]);
    expect(months[1]).toMatchObject({ net: 4300, tax: 215, byMember: { 1: 2400, 2: 1900 }, doc: 7, employers: ["Nexalia Conseil", "Clinique de l'Estuaire"] });
  });
});
