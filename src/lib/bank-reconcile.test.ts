import { describe, expect, it } from "vitest";
import { purchaseDateFor, purchaseDay, reconcile, summarize, type RecTx } from "./bank-reconcile.ts";

const tx = (id: string, date: string, amount: number, label: string, status = "posted"): RecTx => ({ id, date, amount, label, status });

describe("purchaseDay", () => {
  it("lit le jour de l'achat dans les deux écritures d'un libellé de carte", () => {
    expect(purchaseDay("CARTE 05/11/26 BOULANGERIE DU PORT")).toBe("2026-11-05");
    expect(purchaseDay("Carte 05 11 26 Boulangerie Du Port Cb 1234")).toBe("2026-11-05");
    expect(purchaseDay("Avoir 28 02 2026 Librairie")).toBe("2026-02-28");
    expect(purchaseDay("PRLV SEPA SALLE DE SPORT")).toBeNull();
    expect(purchaseDay("59 99 Pln 1 Euro 4 28")).toBeNull();
    expect(purchaseDay("Carte 31 02 26 Impossible")).toBeNull();
  });
});

describe("reconcile", () => {
  it("apparie une opération pour une opération, même répétée le même jour", () => {
    const r = reconcile(
      [tx("b1", "2026-11-03", -2.1, "CARTE 03/11/26 TRAMWAY"), tx("b2", "2026-11-03", -2.1, "CARTE 03/11/26 TRAMWAY"), tx("b3", "2026-11-04", -40, "PRLV SEPA EAU")],
      [tx("p1", "2026-11-03", -2.1, "Carte 03 11 26 Tramway"), tx("p2", "2026-11-04", -40, "Prlv Sepa 04170")],
    );
    expect(r.pairs.map((p) => [p.incoming.id, p.existing.id, p.how])).toEqual([
      ["b1", "p1", "achat"],
      ["b3", "p2", "date"],
    ]);
    expect(r.onlyIncoming.map((t) => t.id)).toEqual(["b2"]);
    expect(r.onlyExisting).toEqual([]);
  });

  it("retrouve un achat de fin de mois daté un mois plus tôt dans l'existant", () => {
    const r = reconcile([tx("b", "2026-11-02", -23.2, "CARTE 29/09/26 PRIMEUR")], [tx("p", "2026-10-01", -23.2, "Carte 29 09 26 Primeur Cb 9310")]);
    expect(r.pairs[0]).toMatchObject({ how: "achat" });
    expect(summarize(r)).toEqual({ same: 0, shifted: 1, onlyIncoming: 0, onlyExisting: 0 });
  });

  it("apparie par la date un achat en devise dont l'ancien libellé n'a pas de jour d'achat", () => {
    const r = reconcile([tx("b", "2026-09-01", -173.04, "CARTE 18/08/26 LIBRAIRIE EN LIGNE 200,00 USD / 1 euro = 1,1558")], [tx("p", "2026-09-01", -173.04, "200 00 Usd 1 Euro 1 155802126")]);
    expect(r.pairs[0]).toMatchObject({ how: "date" });
  });

  it("rapproche à quelques jours près, le plus proche d'abord, et pas au-delà", () => {
    const r = reconcile(
      [tx("b", "2026-11-02", -0.4, "CARTE 30/09/26 CAFE")],
      [tx("loin", "2026-10-01", -0.4, "Carte 20 09 26 Cafe"), tx("pres", "2026-10-01", -0.4, "Carte 29 09 26 Cafe")],
    );
    expect(r.pairs.map((p) => [p.existing.id, p.how])).toEqual([["pres", "proche"]]);
    expect(reconcile([tx("b", "2026-11-02", -0.4, "CARTE 30/09/26 CAFE")], [tx("loin", "2026-10-01", -0.4, "Carte 20 09 26 Cafe")]).pairs).toEqual([]);
  });

  it("ne prend un doublon écarté qu'en dernier recours et ne le compte pas comme manquant", () => {
    const incoming = [tx("b", "2026-10-01", -12, "CARTE 05/09/26 FLEURISTE")];
    const existing = [tx("dup", "2026-10-01", -12, "Carte 05 09 26 Fleuriste", "duplicate"), tx("bon", "2026-10-01", -12, "Carte 05 09 26 Fleuriste")];
    expect(reconcile(incoming, existing).pairs[0].existing.id).toBe("bon");
    expect(summarize(reconcile(incoming, existing))).toEqual({ same: 1, shifted: 0, onlyIncoming: 0, onlyExisting: 0 });
    expect(reconcile(incoming, [existing[0]]).pairs[0].existing.id).toBe("dup");
  });
});

describe("purchaseDateFor", () => {
  it("garde le jour d'achat du libellé quand il précède l'écriture de peu", () => {
    expect(purchaseDateFor("Carte 29 10 26 Boulangerie Du Port", "2026-12-01")).toBe("2026-10-29");
    expect(purchaseDateFor("Carte 30 12 25 Librairie", "2026-01-02")).toBe("2025-12-30");
    expect(purchaseDateFor("Avoir 03 11 26 Librairie", "2026-11-05")).toBe("2026-11-03");
  });
  it("écarte un jour postérieur à l'écriture, trop ancien, ou un libellé sans jour d'achat", () => {
    expect(purchaseDateFor("Carte 05 11 26 Librairie", "2026-11-02")).toBeNull();
    expect(purchaseDateFor("Carte 05 03 26 Librairie", "2026-11-02")).toBeNull();
    expect(purchaseDateFor("Prlv Sepa Energie", "2026-11-02")).toBeNull();
  });
});
