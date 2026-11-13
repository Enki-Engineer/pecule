import { describe, expect, it } from "vitest";
import { labelShape, merchantName, natureOf, natureSql, shapeRegex } from "./nature.ts";

describe("natureOf", () => {
  it("reconnaît les natures des débits", () => {
    expect(natureOf("Carte 11 10 26 Mcdonald S Cb 3361", -11.6)).toBe("carte");
    expect(natureOf("59 99 Pln 1 Euro 4 200000001", -14.15)).toBe("carte");
    expect(natureOf("2600001 Od0000001 Cdr20260612", -842.17)).toBe("prelevement");
    expect(natureOf("030100 4600000000000000000000001", -394.87)).toBe("prelevement");
    expect(natureOf("000030000001 Loansn", -154.77)).toBe("prelevement");
    expect(natureOf("Prlv Sepa Orange Sa Orange", -10.99)).toBe("prelevement");
    expect(natureOf("Vir Inst Camille Durand", -510)).toBe("virement");
    expect(natureOf("Réf Sct300000000000000000000001", -5000)).toBe("virement");
    expect(natureOf("M Martin Alex Ou Mme Durand", -1500)).toBe("virement");
    expect(natureOf("P000002 Martin Durand Charges Lots", -4100.24)).toBe("virement");
    expect(natureOf("Relevé Différé Carte 4810 1305", -1315.92)).toBe("interne");
    expect(natureOf("Retrait Dab 12 10 26 Nantes", -40)).toBe("retrait");
  });
  it("reconnaît les crédits", () => {
    expect(natureOf("Avoir 12 10 26 Amazon", 19.99)).toBe("remboursement");
    expect(natureOf("Identif0012026 06 05", 3345.47)).toBe("entree");
    expect(natureOf("Relevé Différé Carte 4810 1305", 99.8)).toBe("interne");
  });
  it("produit une expression SQL", () => {
    expect(natureSql()).toContain("REGEXP '^carte '");
  });
});

describe("labelShape / shapeRegex", () => {
  it("donne la même forme aux prélèvements d'un même créancier", () => {
    expect(labelShape("2600001 Od0000001 Cdr20260612")).toBe(labelShape("2627885 Od0000020 Cdr20261012"));
    expect(labelShape("030181 46500000000000000000001")).toBe(labelShape("030181 46400000000000000000002"));
  });
  it("distingue des créanciers différents", () => {
    const free = new RegExp(shapeRegex(labelShape("737005 46300000000000000000003")));
    expect(free.test("737005 46300000000000000000003")).toBe(true);
    expect(free.test("030181 46500000000000000000001")).toBe(false);
    expect(free.test("690500000000000004 222")).toBe(false);
    const enedis = new RegExp(shapeRegex(labelShape("04170 N2200000000000001")));
    expect(enedis.test("04170 n2200000000000002")).toBe(true);
    expect(enedis.test("03392 n2200000000000003")).toBe(false);
  });
  it("garde les mots tels quels", () => {
    const re = new RegExp(shapeRegex(labelShape("000030000001 Loansn")));
    expect(re.test("000032317211 loansn")).toBe(true);
    expect(re.test("carte 11 10 26 loansn")).toBe(false);
  });
});

describe("merchantName", () => {
  it("nettoie un libellé de carte", () => {
    expect(merchantName("Carte 11 10 26 Mcdonald S Cb 3361")).toBe("Mcdonald S");
    expect(merchantName("Carte 10 10 26 Curabet Mireille")).toBe("Curabet Mireille");
    expect(merchantName("Carte 01 11 26 Amazon Payments", "Amazon")).toBe("Amazon");
  });
});
