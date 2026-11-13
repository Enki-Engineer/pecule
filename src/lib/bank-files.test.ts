import { describe, expect, it } from "vitest";
import { fileAccounts, parseAmount, parseBankFile, parseDay, splitCsv } from "./bank-files.ts";

describe("dates et montants", () => {
  it("lit les écritures de date courantes", () => {
    expect(parseDay("2026-11-05")).toBe("2026-11-05");
    expect(parseDay("20261105120000[0:GMT]")).toBe("2026-11-05");
    expect(parseDay("05/11/2026")).toBe("2026-11-05");
    expect(parseDay("5.11.26")).toBe("2026-11-05");
    expect(parseDay("11/05/2026", true)).toBe("2026-11-05");
    expect(parseDay("31/02/2026")).toBeNull();
    expect(parseDay("bonjour")).toBeNull();
  });
  it("lit les écritures de montant courantes", () => {
    expect(parseAmount("-1 234,56")).toBe(-1234.56);
    expect(parseAmount("1.234,56 €")).toBe(1234.56);
    expect(parseAmount("1,234.56")).toBe(1234.56);
    expect(parseAmount("(12.00)")).toBe(-12);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("+40")).toBe(40);
    expect(parseAmount("1.234")).toBe(1234);
    expect(parseAmount("0.99")).toBe(0.99);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
  });
});

describe("splitCsv", () => {
  it("respecte les guillemets, les séparateurs dans une cellule et les lignes vides", () => {
    expect(splitCsv('a;"b;c";"dit ""oui"""\r\n\r\n1;2;3\n', ";")).toEqual([
      ["a", "b;c", 'dit "oui"'],
      ["1", "2", "3"],
    ]);
  });
});

describe("parseBankFile", () => {
  it("lit un OFX (balises non fermées) avec son solde", () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>EUR
<BANKACCTFROM><ACCTID>00012345678</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103<TRNAMT>-23.99<FITID>A1<NAME>PRLV SEPA OPERATEUR<MEMO>ABONNEMENT FIBRE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105120000<TRNAMT>1500,00<FITID>A2<NAME>VIR SEPA NEXALIA CONSEIL</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<TRNAMT>-1.00<FITID>A3<NAME>SANS DATE</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>2468.05<DTASOF>20261112</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const f = parseBankFile(ofx);
    expect(f.format).toBe("ofx");
    expect(f.rows).toEqual([
      { date: "2026-11-03", amount: -23.99, label: "PRLV SEPA OPERATEUR ABONNEMENT FIBRE", ref: "A1" },
      { date: "2026-11-05", amount: 1500, label: "VIR SEPA NEXALIA CONSEIL", ref: "A2" },
    ]);
    expect(f.skipped).toBe(1);
    expect(f.balance).toEqual({ amount: 2468.05, date: "2026-11-12" });
  });

  it("lit un QIF, à la française ou à l'américaine", () => {
    const fr = parseBankFile("!Type:Bank\nD05/11/2026\nT-42,10\nPBOULANGERIE DU PORT\nMCARTE 04/11\n^\nD06/11/2026\nT1 200,00\nPLOYER\n^\n");
    expect(fr.format).toBe("qif");
    expect(fr.rows).toEqual([
      { date: "2026-11-05", amount: -42.1, label: "BOULANGERIE DU PORT CARTE 04/11", ref: null },
      { date: "2026-11-06", amount: 1200, label: "LOYER", ref: null },
    ]);
    const us = parseBankFile("!Type:Bank\nD11/25/2026\nT-9.99\nPCOFFEE\n^\nD12/01/2026\nT-5.00\nPTEA\n^\n");
    expect(us.rows.map((r) => r.date)).toEqual(["2026-11-25", "2026-12-01"]);
  });

  it("lit un CSV à en-tête, avec un préambule et une colonne de montant", () => {
    const csv = "Compte courant;;\nExport du 12/11/2026;;\nDate opération;Libellé;Montant;Devise\n05/11/2026;\"CARTE 04/11 LIBRAIRIE; NANTES\";-18,50;EUR\n06/11/2026;VIR SEPA LOYER;650,00;EUR\n;;;\n";
    const f = parseBankFile(csv);
    expect(f.format).toBe("csv");
    expect(f.columns).toEqual({ date: 0, label: 1, amount: 2 });
    expect(f.rows).toEqual([
      { date: "2026-11-05", amount: -18.5, label: "CARTE 04/11 LIBRAIRIE; NANTES", ref: null },
      { date: "2026-11-06", amount: 650, label: "VIR SEPA LOYER", ref: null },
    ]);
  });

  it("lit un CSV à colonnes Débit et Crédit", () => {
    const f = parseBankFile("Date,Description,Debit,Credit\n2026-11-05,Groceries,42.10,\n2026-11-06,Salary,,1500.00\n");
    expect(f.columns).toEqual({ date: 0, label: 1, debit: 2, credit: 3 });
    expect(f.rows.map((r) => r.amount)).toEqual([-42.1, 1500]);
  });

  it("devine les colonnes d'un CSV sans en-tête", () => {
    const f = parseBankFile("05/11/2026\tCB LIBRAIRIE DU CENTRE\t-18,50\n06/11/2026\tVIREMENT RECU\t650,00\n07/11/2026\tPRLV ASSURANCE\t-31,20\n");
    expect(f.columns).toEqual({ date: 0, label: 1, amount: 2 });
    expect(f.rows).toHaveLength(3);
  });

  it("repère les comptes mêlés dans un même CSV", () => {
    const f = parseBankFile("Date;Libellé;Montant;Numéro Compte\n05/11/2026;A;-1,00;00011\n06/11/2026;B;-2,00;00022\n07/11/2026;C;-3,00;00011\n");
    expect(f.columns).toEqual({ date: 0, label: 1, amount: 2, account: 3 });
    expect(f.rows[1]).toMatchObject({ account: "00022" });
    expect(fileAccounts(f)).toEqual([
      { account: "00011", rows: 2 },
      { account: "00022", rows: 1 },
    ]);
    expect(fileAccounts(parseBankFile("Date;Libellé;Montant\n05/11/2026;A;-1,00\n"))).toEqual([]);
  });

  it("ne lit rien d'un fichier qui n'est pas un relevé", () => {
    expect(parseBankFile("bonjour\ntout le monde\n").rows).toEqual([]);
  });
});
