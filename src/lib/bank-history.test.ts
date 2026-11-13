import { describe, expect, it } from "vitest";
import { debitDay, dominant, historyDate, historyLabel, isBankDay, reconcileHistory, rowRanks, type HistoryRow } from "./bank-history.ts";
import type { BankTx } from "./bourso.ts";

// Données fictives : aucun libellé, montant ni numéro réel.
const row = (account: string, date: string, label: string, amount: number, card = false): HistoryRow => ({ account, date, label, amount, suggested: null, card });
const tx = (id: string, accountId: string, date: string, label: string, amount: number): BankTx => ({ id, accountId, date, label, amount });

describe("jours ouvrés des banques", () => {
  it("écarte les week-ends et les jours fermés du calendrier TARGET, pas les autres fériés français", () => {
    expect(isBankDay("2026-05-01")).toBe(false); // 1er mai
    expect(isBankDay("2024-04-01")).toBe(false); // lundi de Pâques
    expect(isBankDay("2026-04-03")).toBe(false); // Vendredi saint
    expect(isBankDay("2026-11-01")).toBe(false); // dimanche
    expect(isBankDay("2026-07-14")).toBe(true);
    expect(isBankDay("2026-11-11")).toBe(true);
  });
});

describe("debitDay", () => {
  it("date un achat par carte du premier jour ouvré du mois suivant", () => {
    expect(debitDay("2026-05-21")).toBe("2026-06-01");
    expect(debitDay("2026-01-09")).toBe("2026-02-02"); // le 1er est un dimanche
    expect(debitDay("2026-04-14")).toBe("2026-05-04"); // 1er mai, puis week-end
    expect(debitDay("2024-03-05")).toBe("2024-04-02"); // lundi de Pâques
    expect(debitDay("2025-12-10")).toBe("2026-01-02");
  });

  it("reporte au mois d'après une opération du dernier jour ouvré", () => {
    expect(debitDay("2026-10-29")).toBe("2026-11-02");
    expect(debitDay("2026-10-30")).toBe("2026-12-01");
    expect(debitDay("2025-12-31")).toBe("2026-02-02");
  });

  it("sait aussi l'arrêté du relevé de la banque, un jour ouvré plus tôt", () => {
    expect(debitDay("2026-10-28", true)).toBe("2026-11-02");
    expect(debitDay("2026-10-29", true)).toBe("2026-12-01");
  });
});

describe("historyLabel", () => {
  it("écrit le libellé de la banque comme Finta l'écrit", () => {
    expect(historyLabel("CARTE 14/04/26 EU.BOUTIQUE.EXEMPLE.COM")).toBe("Carte 14 04 26 Eu Boutique Exemple Com");
    expect(historyLabel("CARTE 04/05/26 ABC*CAFE DU COIN")).toBe("Carte 04 05 26 Abc Cafe Du Coin");
    expect(historyLabel("Relevé différé Carte 4810********0000")).toBe("Relevé Différé Carte 4810 0000");
    expect(historyLabel("PRLV SEPA Fournisseur d'Énergie")).toBe("Prlv Sepa Fournisseur D Énergie");
    expect(historyLabel(" *** ")).toBe("(sans libellé)");
  });

  it("date une ligne de carte du prélèvement, une autre de la banque", () => {
    expect(historyDate(row("c", "2026-03-10", "CARTE 09/03/26 EPICERIE", -12, true))).toBe("2026-04-01");
    expect(historyDate(row("a", "2026-03-10", "PRLV SEPA EAU", -30))).toBe("2026-03-10");
  });
});

describe("reconcileHistory, compte imposé", () => {
  // Deux membres du foyer virent la même somme le même jour au compte commun : l'export de l'un ressemble au compte de l'autre.
  const rows = [
    row("K", "2026-03-02", "VIR Vers compte commun", -500),
    row("K", "2026-02-02", "VIR Vers compte commun", -480),
    row("K", "2026-01-02", "VIR Vers compte commun", -470),
    row("K", "2025-12-02", "VIR Vers compte commun", -460),
    row("K", "2026-03-09", "CARTE 08/03/26 FLEURISTE", -27),
  ];
  const txs = [
    tx("a1", "compte-autre", "2026-03-02", "Vir Vers Compte Commun", -500),
    tx("a2", "compte-autre", "2026-02-02", "Vir Vers Compte Commun", -480),
    tx("a3", "compte-autre", "2026-01-02", "Vir Vers Compte Commun", -470),
    tx("a4", "compte-autre", "2025-12-02", "Vir Vers Compte Commun", -460),
    tx("k1", "compte-k", "2026-03-02", "Vir Vers Compte Commun", -500),
  ];

  it("sans désignation, les couples peuvent désigner le compte d'un autre", () => {
    expect(reconcileHistory(txs, rows).accounts.get("K")).toBe("compte-autre");
  });

  it("le compte désigné l'emporte : seules ses opérations couvrent les lignes", () => {
    const rec = reconcileHistory(txs, rows, new Map([["K", "compte-k"]]));
    expect(rec.accounts.get("K")).toBe("compte-k");
    expect(rec.pairs.map((p) => p.txId)).toEqual(["k1"]);
    // Les virements identiques de l'autre compte ne font pas douter : les quatre lignes sans opération sont à créer.
    expect([rec.missing.length, rec.doubtful.length]).toEqual([4, 0]);
  });
});

describe("reconcileHistory", () => {
  // Deux comptes de l'export : un compte courant (A) et une carte à débit différé (C).
  const rows = [
    row("A", "2026-03-05", "PRLV SEPA EAU DE LA VILLE", -34),
    row("A", "2026-03-06", "VIR SEPA EMPLOYEUR", 2150),
    row("A", "2026-02-05", "PRLV SEPA EAU DE LA VILLE", -33),
    row("A", "2025-11-05", "PRLV SEPA EAU DE LA VILLE", -31),
    row("C", "2026-03-10", "CARTE 09/03/26 EPICERIE DU COIN", -12.4, true),
    row("C", "2026-03-12", "CARTE 11/03/26 LIBRAIRIE", -18.9, true),
    row("C", "2026-03-13", "CARTE 12/03/26 CAFE", -0.4, true),
    row("C", "2026-03-13", "CARTE 12/03/26 CAFE", -0.4, true),
    row("C", "2026-03-13", "CARTE 12/03/26 CAFE", -0.4, true),
    row("C", "2026-03-16", "59,99 PLN 1 EURO = 4,2 PLN", -14.28, true),
    row("C", "2026-03-18", "CARTE 17/03/26 EDITEUR ETRANGER", -13.94, true),
    row("C", "2025-10-14", "CARTE 13/10/25 EPICERIE DU COIN", -9.9, true),
  ];
  const txs = [
    tx("t1", "compte", "2026-03-05", "04170 N2200000000000001", -34),
    tx("t2", "compte", "2026-03-06", "Réf Abcd", 2150),
    tx("t3", "compte", "2026-02-05", "04170 N2200000000000002", -33),
    tx("t4", "carte", "2026-04-01", "Carte 09 03 26 Epicerie Du Coin", -12.4),
    tx("t5", "carte", "2026-04-01", "Carte 11 03 26 Librairie", -18.9),
    tx("t6", "carte", "2026-04-01", "Carte 12 03 26 Cafe", -0.4),
    tx("t7", "carte", "2026-04-01", "Carte 12 03 26 Cafe", -0.4),
    tx("t8", "carte", "2026-04-01", "59 99 Pln 1 Euro 4 2 Pln", -14.28),
    tx("t9", "carte", "2026-04-01", "59 99 Pln 1 Euro 4 300000001", -13.94),
  ];

  it("apprend les comptes et ne laisse en manque que les lignes sans opération, une pour une", () => {
    const rec = reconcileHistory(txs, rows);
    expect(Object.fromEntries(rec.accounts)).toEqual({ A: "compte", C: "carte" });
    expect(rec.pairs).toHaveLength(9);
    // L'ancienne facture d'eau, l'ancien achat, et le troisième café du même jour.
    expect(rec.missing.map((r) => `${r.date} ${r.label}`).sort()).toEqual(["2025-10-14 CARTE 13/10/25 EPICERIE DU COIN", "2025-11-05 PRLV SEPA EAU DE LA VILLE", "2026-03-13 CARTE 12/03/26 CAFE"]);
    expect(rec.doubtful).toEqual([]);
    expect(rec.orphans.size).toBe(0);
  });

  it("retrouve une ligne de carte sans jour d'achat à la date du prélèvement", () => {
    const rec = reconcileHistory(txs, rows);
    expect(rec.pairs.find((p) => p.txId === "t8")?.row.label).toBe("59,99 PLN 1 EURO = 4,2 PLN");
    // Finta n'a gardé que le cours de la devise ; la banque, elle, nomme le marchand.
    expect(rec.pairs.find((p) => p.txId === "t9")?.row.label).toBe("CARTE 17/03/26 EDITEUR ETRANGER");
  });

  it("une fois les opérations créées, plus rien ne manque", () => {
    const first = reconcileHistory(txs, rows);
    const created = first.missing.map((r, i) => tx(`n${i}`, first.accounts.get(r.account)!, historyDate(r), historyLabel(r.label), r.amount));
    const again = reconcileHistory([...txs, ...created], rows);
    expect(again.missing).toEqual([]);
    expect(again.pairs).toHaveLength(rows.length);
  });

  it("ne crée pas une ligne qu'une opération d'un autre compte pourrait être, et signale les opérations sans ligne", () => {
    const rec = reconcileHistory([...txs, tx("x1", "autre", "2025-11-06", "Eau", -31), tx("x2", "compte", "2026-02-20", "Inconnu", -77)], rows);
    expect(rec.doubtful.map((r) => r.date)).toEqual(["2025-11-05"]);
    expect(rec.missing).toHaveLength(2);
    expect(Object.fromEntries(rec.orphans)).toEqual({ compte: 1 });
  });

  it("laisse sans compte un export qu'aucune opération ne permet de reconnaître", () => {
    const rec = reconcileHistory(txs, [...rows, row("Z", "2021-05-04", "CARTE 03/05/21 EPICERIE", -8, true)]);
    expect(rec.accounts.has("Z")).toBe(false);
    expect(rec.missing.some((r) => r.account === "Z")).toBe(true);
  });
});

describe("rowRanks et dominant", () => {
  it("numérote les lignes identiques", () => {
    const a = row("C", "2026-03-13", "CARTE 12/03/26 CAFE", -0.4, true);
    const b = { ...a };
    const c = row("C", "2026-03-13", "CARTE 12/03/26 THE", -0.4, true);
    const ranks = rowRanks([a, b, c]);
    expect([ranks.get(a), ranks.get(b), ranks.get(c)]).toEqual([0, 1, 0]);
  });

  it("ne retient une catégorie que si elle domine", () => {
    expect(dominant(new Map([["B3-01", 8], ["B3-02", 2]]), 0.7, 5)).toBe("B3-01");
    expect(dominant(new Map([["B3-01", 6], ["B3-02", 4]]), 0.7, 5)).toBeNull();
    expect(dominant(new Map([["B3-01", 3]]), 0.7, 5)).toBeNull();
    expect(dominant(undefined, 0.7, 5)).toBeNull();
  });
});
