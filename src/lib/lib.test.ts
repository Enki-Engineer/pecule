import { describe, expect, it } from "vitest";
import { classifyAccount, displayLabel, isCodeLabel, labelKey, txTitle } from "./labels.ts";
import { autoMatch, cardDate, labelMatchesMerchant, merchantKey, scoreCandidate } from "./invoices.ts";
import { formatDuration, monthsBetween, summarizeLoan, type ScheduleRow } from "./loans.ts";

describe("labelKey", () => {
  it("retire dates, numéros de carte et références", () => {
    expect(labelKey("Carte 11 10 26 Mcdonald S Cb 3361")).toBe("mcdonald s");
    expect(labelKey("Prlv Sepa Orange Sa Orange")).toBe("orange sa orange");
    expect(labelKey("Carte 01 02 26 Petitsculottes", "Petitsculottes")).toBe("petitsculottes");
  });
  it("donne la même clé pour deux mois différents", () => {
    expect(labelKey("Carte 03 09 26 Boulangerie Paul Cb 1234")).toBe(labelKey("Carte 15 10 26 Boulangerie Paul Cb 9876"));
  });
});

describe("classifyAccount", () => {
  it("reconnaît titulaires et cartes", () => {
    const foyer = { members: ["Alex", "Camille"], others: ["Léo"], proInstitutions: ["Banque du Commerce"] };
    expect(classifyAccount("M MARTIN ALEX OU MME DURAND", null, foyer)).toEqual({ owner: "joint", kind: "courant" });
    expect(classifyAccount("Carte Visa Ultim - MME CAMILLE DURAND", null, foyer)).toEqual({ owner: "camille", kind: "carte" });
    expect(classifyAccount("M MARTIN DURAND LEO", null, foyer)).toEqual({ owner: "léo", kind: "courant" });
    expect(classifyAccount("Livret A ALEX MARTIN", null, foyer)).toEqual({ owner: "alex", kind: "epargne" });
    expect(classifyAccount("M ALEX MARTIN MME CAMILLE DURAND", null, foyer).owner).toBe("joint");
    expect(classifyAccount("Atelier", "Banque du Commerce de l'Ouest", foyer).owner).toBe("pro");
    // Un prénom contenu dans un autre mot ne compte pas ; sans personne reconnue : « autre ».
    expect(classifyAccount("COMPTE ALEXANDRIE", null, foyer).owner).toBe("autre");
    expect(classifyAccount("M MARTIN ALEX").owner).toBe("autre");
  });
});

describe("prêts", () => {
  const row = (rang: number, date: string, principal: number, interest: number, remaining: number): ScheduleRow => ({
    rang, date, payment: principal + interest, principal, interest, insurance: 0, deferred_interest: 0, remaining,
  });
  const schedule = [row(1, "2026-01-10", 100, 10, 900), row(2, "2026-02-10", 100, 9, 800), row(3, "2026-03-10", 800, 8, 0)];

  it("prend le capital restant de la dernière échéance passée", () => {
    const s = summarizeLoan(schedule, 1000, "2026-02-15");
    expect(s.remaining).toBe(800);
    expect(s.progress).toBeCloseTo(0.2);
    expect(s.nextPayment?.rang).toBe(3);
    expect(s.remainingPayments).toBe(1);
    expect(s.totalInterest).toBe(27);
  });
  it("avant la première échéance, tout reste dû", () => {
    expect(summarizeLoan(schedule, 1000, "2025-12-01").remaining).toBe(1000);
  });
  it("formate les durées", () => {
    expect(formatDuration(302)).toBe("25 ans 2 mois");
    expect(monthsBetween("2019-11-09", "2045-01-10")).toBe(302);
  });
});

describe("displayLabel", () => {
  it("allège les libellés de carte", () => {
    expect(displayLabel("Carte 11 10 26 Mcdonald S Cb 3361")).toBe("Mcdonald S");
    expect(displayLabel("Prlv Sepa Orange Sa Orange")).toBe("Orange Sa Orange");
    expect(displayLabel("2627885 Od0000020 Cdr20261012")).toBe("2627885 Od0000020 Cdr20261012");
  });
});

describe("rapprochement des factures", () => {
  const tx = (id: string, date: string, amount: number, label: string) => ({ id, date, amount, label });
  it("lit la date d'achat des libellés de carte", () => {
    expect(cardDate("Carte 17 02 26 Amazon Payments 2441535")).toBe("2026-02-17");
    expect(cardDate("Prlv Sepa Orange")).toBeNull();
  });
  it("ramène les variantes d'un marchand à une clé", () => {
    expect(merchantKey("AMZN Mktp FR")).toBe("amazon");
    expect(merchantKey("Amazon EU S.à r.l.")).toBe("amazon");
    expect(merchantKey("LDLC.com")).toBe("ldlc");
    expect(labelMatchesMerchant("Carte 14 04 26 Eu Store Ui Com", "Ubiquiti")).toBe(true);
    expect(labelMatchesMerchant("Carte 15 03 26 Vesia Boulangeri", "Boulanger")).toBe(false);
  });
  it("relie une facture à la seule opération de même montant et même marchand", () => {
    const inv = { invoice_date: "2026-08-27", total: 139.99, merchant: "Cdiscount" };
    const txs = [
      tx("a", "2026-09-01", -139.99, "Carte 27 08 26 Cdiscount 4312335"),
      tx("b", "2026-09-01", -12.33, "Carte 27 08 26 Cdiscount 4312335"),
      tx("c", "2026-09-01", -139.99, "Carte 27 08 26 Fnac"),
    ];
    expect(autoMatch(inv, txs)).toBe("a");
    expect(scoreCandidate(inv, txs[1])?.amount).toBe(false);
  });
  it("ne relie pas en cas d'ambiguïté ou hors fenêtre", () => {
    const inv = { invoice_date: "2026-02-18", total: 65.24, merchant: "Amazon" };
    const dup = [tx("a", "2026-03-02", -65.24, "Carte 18 02 26 Amazon Payments 2441535"), tx("b", "2026-03-02", -65.24, "Carte 18 02 26 Amazon Payments 2441535")];
    expect(autoMatch(inv, dup)).toBeNull();
    expect(scoreCandidate(inv, tx("c", "2026-06-01", -65.24, "Carte 20 05 26 Amazon Payments"))).toBeNull();
  });
});

describe("txTitle", () => {
  it("reconnaît les libellés purement codés", () => {
    expect(isCodeLabel("04170 N2200000000000001")).toBe(true);
    expect(isCodeLabel("Prlv Sepa 03640 Od2026 Cdr")).toBe(true);
    expect(isCodeLabel("Carte 17 02 26 Amazon Payments Cb 3361")).toBe(false);
    expect(isCodeLabel("Vir Inst M Martin Alex")).toBe(false);
  });
  it("préfère le marchand, puis le libellé nettoyé, puis la catégorie pour un code", () => {
    expect(txTitle({ merchant: "Amazon", label: "Carte 17 02 26 Amzn Mktp", category_name: null })).toBe("Amazon");
    expect(txTitle({ merchant: null, label: "Carte 17 02 26 Boulanger Cb 3361", category_name: null })).toBe("Boulanger");
    expect(txTitle({ merchant: null, label: "04170 N2200000000000001", category_name: "Loyer / Crédit immobilier" })).toBe("Loyer / Crédit immobilier · 04170");
    expect(txTitle({ merchant: null, label: "04170 N2200000000000001", category_name: null })).toBe("Opération n° 04170");
    expect(txTitle({ merchant: null, label: "Identif0012026 0300000001", category_name: null })).toBe("Opération Identif0012026");
  });
});
