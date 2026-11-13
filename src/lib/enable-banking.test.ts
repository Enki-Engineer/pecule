import { describe, expect, it } from "vitest";
import { ebAccountKind, ebAccountTail, ebBalance, ebCardOutstanding, ebDeferredCard, ebHolding, ebLabel, ebTransaction, type EbBalance, type EbTransaction } from "./enable-banking.ts";

const bal = (type: string, amount: string, date = "2026-11-12"): EbBalance => ({ balance_type: type, balance_amount: { amount, currency: "EUR" }, reference_date: date });
const tx = (status: string, amount: string, booking: string | null, purchase: string, label: string, ref = "1234567890"): EbTransaction => ({
  entry_reference: ref,
  transaction_amount: { amount, currency: "EUR" },
  credit_debit_indicator: "DBIT",
  status,
  booking_date: booking,
  value_date: booking,
  transaction_date: purchase,
  remittance_information: [label],
});

describe("comptes Enable Banking", () => {
  it("reconnaît la nature d'un compte et une carte à débit différé", () => {
    expect(ebAccountKind({ cash_account_type: "CACC" })).toBe("courant");
    expect(ebAccountKind({ cash_account_type: "CARD" })).toBe("carte");
    expect(ebAccountKind({ cash_account_type: "SVGS" })).toBe("epargne");
    expect(ebAccountKind({ cash_account_type: "LOAN" })).toBe("autre");
    expect(ebDeferredCard({ cash_account_type: "CARD", details: "delayed_debit", product: "Carte bancaire à débit différé" })).toBe(true);
    expect(ebDeferredCard({ cash_account_type: "CARD", details: null, product: "Carte à débit immédiat" })).toBe(false);
    expect(ebDeferredCard({ cash_account_type: "CACC", details: "delayed_debit", product: null })).toBe(false);
  });
  it("ne garde du numéro que ses quatre derniers caractères", () => {
    expect(ebAccountTail({ account_id: { iban: "FR76 3000 4000 0312 3456 7890 143" } })).toBe("0143");
    expect(ebAccountTail({ account_id: { other: { identification: "4000000001234567", scheme_name: "BANK" } } })).toBe("4567");
    expect(ebAccountTail({ account_id: null })).toBeNull();
  });
  it("lit le lien du client avec le compte", () => {
    expect(ebHolding({ psu_status: "Account holder" })).toBe("seul");
    expect(ebHolding({ psu_status: "Co-account holder" })).toBe("joint");
    expect(ebHolding({ psu_status: "Attorney" })).toBe("mandataire");
    expect(ebHolding({ psu_status: null })).toBeNull();
  });
});

describe("soldes", () => {
  it("prend le solde comptable d'un compte courant et l'encours d'une carte", () => {
    expect(ebBalance("courant", [bal("XPCD", "-330.00"), bal("CLBD", "-332.05")])).toEqual({ balance: -332.05, date: "2026-11-12", currency: "EUR" });
    expect(ebBalance("courant", [bal("XPCD", "12.50")])).toEqual({ balance: 12.5, date: "2026-11-12", currency: "EUR" });
    expect(ebBalance("carte", [bal("XPCD", "-603.09"), bal("OTHR", "-563.69")])).toEqual({ balance: -563.69, date: "2026-11-12", currency: "EUR" });
    expect(ebBalance("courant", [])).toBeNull();
  });
});

describe("opérations", () => {
  it("date un achat prélevé au jour du prélèvement et garde le jour de l'achat", () => {
    expect(ebTransaction(tx("BOOK", "19.32", "2026-11-02", "2026-10-26", "CARTE 26/10/26 BOULANGERIE DU PORT"))).toEqual({
      reference: "1234567890",
      date: "2026-11-02",
      purchaseDate: "2026-10-26",
      amount: -19.32,
      currency: "EUR",
      label: "CARTE 26/10/26 BOULANGERIE DU PORT",
      status: "posted",
    });
  });
  it("garde en attente un achat pas encore prélevé, à la date du prochain prélèvement", () => {
    const t = ebTransaction(tx("OTHR", "158.80", "2026-12-01", "2026-11-05", "CARTE 05/11/26 CANTINE"));
    expect(t).toMatchObject({ date: "2026-12-01", purchaseDate: "2026-11-05", amount: -158.8, status: "pending" });
  });
  it("écarte un achat du jour (sans date d'écriture) et une opération rejetée", () => {
    expect(ebTransaction(tx("OTHR", "16.40", null, "2026-11-12", "CAFE DU QUAI\\NANTES\\    FR", "avis-2026-xyz"))).toBeNull();
    expect(ebTransaction(tx("RJCT", "50.00", "2026-11-10", "2026-11-10", "PRLV SEPA SALLE DE SPORT"))).toBeNull();
  });
  it("compte un crédit en positif et nettoie le libellé", () => {
    const credit: EbTransaction = { ...tx("BOOK", "1500.00", "2026-11-03", "2026-11-03", "VIR SEPA NEXALIA CONSEIL"), credit_debit_indicator: "CRDT" };
    expect(ebTransaction(credit)).toMatchObject({ amount: 1500, purchaseDate: null, status: "posted" });
    expect(ebLabel({ remittance_information: ["CAFE DU QUAI\\NANTES\\              FR"] })).toBe("CAFE DU QUAI NANTES FR");
    expect(ebTransaction({ ...credit, remittance_information: [] })?.label).toBe("(sans libellé)");
  });
});

describe("encours d'une carte à débit différé", () => {
  const txs = [
    tx("OTHR", "9.20", "2026-12-01", "2026-11-10", "CARTE 10/11/26 LIBRAIRIE", "a"),
    tx("OTHR", "158.80", "2026-12-01", "2026-11-05", "CARTE 05/11/26 CANTINE", "b"),
    tx("OTHR", "16.40", null, "2026-11-12", "CAFE DU QUAI\\NANTES\\ FR", "avis-1"),
    tx("BOOK", "40.00", "2026-11-02", "2026-10-20", "CARTE 20/10/26 FLEURISTE", "c"),
  ];
  it("recoupe le solde de la carte avec ses achats pas encore prélevés", () => {
    expect(ebCardOutstanding([bal("OTHR", "-168.00"), bal("XPCD", "-184.40")], txs)).toEqual({ amount: -168, realtime: -184.4, debitDate: "2026-12-01", count: 2, sum: -168, consistent: true });
  });
  it("signale un solde qui ne correspond pas aux achats", () => {
    expect(ebCardOutstanding([bal("OTHR", "-170.00")], txs)).toMatchObject({ amount: -170, sum: -168, consistent: false, realtime: null });
  });
  it("ne dit rien d'une carte sans encours ni achat en attente", () => {
    expect(ebCardOutstanding([bal("CLBD", "0")], [txs[3]])).toBeNull();
  });
});
