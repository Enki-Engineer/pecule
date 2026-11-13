import { describe, expect, it } from "vitest";
import { bankCounterparty, matchBankRows, nameAddsInfo, parseBoursoCsv, shapeIsSpecific, type BankRow, type BankTx } from "./bourso.ts";
import { displayBankLabel, txTitle } from "./labels.ts";
import { labelShape } from "./nature.ts";

// Données fictives : aucun libellé, montant ni numéro réel.
const HEAD = '"Date Opération";"Date Valeur";Libellé;"Libellé Suggéré";Catégorie;"Catégorie Parente";Solde;Commentaire;"Numéro Compte";"Libellé Compte";Solde;Pointage';

describe("parseBoursoCsv", () => {
  it("lit l'export de 2026 : montant dans la première colonne « Solde », espaces dans les milliers", () => {
    const rows = parseBoursoCsv(
      [
        HEAD,
        '2026-03-05;2026-03-05;"PRLV SEPA FOURNISSEUR ENERGIE ET G";"Fournisseur Energie";Energie;Logement;-61,50;;00010000001;"Compte Joint";1 204,10;',
        '2026-03-02;2026-03-02;"VIR SEPA EMPLOYEUR SA";"Vir Sepa Employeur Sa";"Virements reçus";"Virements reçus";"2 150,00";;00010000002;Courant;"3 000,00";',
      ].join("\n"),
    );
    expect(rows).toEqual([
      { date: "2026-03-05", label: "PRLV SEPA FOURNISSEUR ENERGIE ET G", suggested: "Fournisseur Energie", amount: -61.5, account: "00010000001" },
      { date: "2026-03-02", label: "VIR SEPA EMPLOYEUR SA", suggested: "Vir Sepa Employeur Sa", amount: 2150, account: "00010000002" },
    ]);
  });

  it("lit l'ancien format (intitulés anglais, dates JJ/MM/AAAA) et ignore les lignes incomplètes", () => {
    const rows = parseBoursoCsv(
      "\uFEFFdateOp;dateVal;label;category;categoryParent;supplierFound;amount;comment;accountNum;accountLabel;accountbalance\r\n" +
        '05/03/2026;05/03/2026;"CARTE 04/03/26 BOULANGERIE DU COIN";Alimentation;Vie;"Boulangerie Du Coin";-3,20;;0001;Courant;10,00\r\n' +
        ";;;;;;;;;;\r\n",
    );
    expect(rows).toEqual([{ date: "2026-03-05", label: "CARTE 04/03/26 BOULANGERIE DU COIN", suggested: "Boulangerie Du Coin", amount: -3.2, account: "0001" }]);
  });

  it("renvoie une liste vide pour un fichier qui n'est pas un export d'opérations", () => {
    expect(parseBoursoCsv("nom;prénom\nAlex;Martin")).toEqual([]);
    expect(parseBoursoCsv("")).toEqual([]);
  });
});

describe("bankCounterparty", () => {
  it("préfère le nom reconnu par la banque, sinon le créancier du libellé", () => {
    expect(bankCounterparty("PRLV SEPA FOURNISSEUR ENERGIE ET G", "Fournisseur Energie & Gaz")).toBe("Fournisseur Energie & Gaz");
    expect(bankCounterparty("VIR SEPA EMPLOYEUR SA", "Vir Sepa Employeur Sa")).toBe("Employeur Sa");
    expect(bankCounterparty("VIR INST CAMILLE MARTIN", null)).toBe("Camille Martin");
    expect(bankCounterparty("PRLV SEPA GC RE ASSUREUR EXEMPLE", "Gc Re Assureur Exemple")).toBe("Assureur Exemple");
    expect(bankCounterparty("PRLV SEPA Regie des eaux", null)).toBe("Regie des eaux");
  });

  it("ne nomme ni les cartes, ni les retraits, ni les virements sans nom", () => {
    expect(bankCounterparty("CARTE 04/03/26 BOULANGERIE DU COIN", "Boulangerie Du Coin")).toBeNull();
    expect(bankCounterparty("VIR Virement de Alex MARTIN", null)).toBeNull();
    expect(bankCounterparty("RETRAIT DAB 04/03/26 NANTES", null)).toBeNull();
  });
});

describe("nameAddsInfo", () => {
  it("oui pour une référence, non quand le libellé de Pécule dit déjà le nom", () => {
    expect(nameAddsInfo("04170 N9900000000000001", "Fournisseur Energie")).toBe(true);
    expect(nameAddsInfo("Identif0019999 03 02", "Employeur Sa")).toBe(true);
    expect(nameAddsInfo("Vir Inst Camille Martin", "Camille Martin")).toBe(false);
    expect(nameAddsInfo("Prlv Sepa Regie Des Eaux", "Regie des eaux")).toBe(false);
  });
});

const row = (date: string, label: string, amount: number, account: string): BankRow => ({ date, label, suggested: null, amount, account });
const tx = (id: string, accountId: string, date: string, amount: number, label: string): BankTx => ({ id, accountId, date, amount, label });

describe("matchBankRows", () => {
  // Deux comptes dans l'export (J = joint, P = personnel) ; un troisième compte de Pécule (K) n'y figure pas.
  const rows = [
    row("2026-03-05", "PRLV SEPA FOURNISSEUR ENERGIE ET G", -61.5, "J"),
    row("2026-03-06", "PRLV SEPA REGIE DES EAUX", -34, "J"),
    row("2026-03-09", "PRLV SEPA OPERATEUR FIBRE", -29.99, "J"),
    row("2026-03-02", "VIR SEPA EMPLOYEUR SA", 2150, "P"),
    row("2026-03-10", "PRLV SEPA ASSUREUR EXEMPLE", -18.4, "P"),
    row("2026-03-12", "VIR INST CAMILLE MARTIN", -40, "P"),
    row("2026-03-05", "CARTE 04/03/26 BOULANGERIE DU COIN", -3.2, "P"),
    row("2026-03-05", "CARTE 04/03/26 BOULANGERIE DU COIN", -3.2, "P"),
    row("2026-03-20", "PRLV SEPA SALLE DE SPORT", -25, "P"),
    row("2026-03-20", "PRLV SEPA MUTUELLE EXEMPLE", -25, "P"),
  ];
  const txs = [
    tx("a", "joint", "2026-03-05", -61.5, "04170 N9900000000000001"),
    tx("b", "joint", "2026-03-06", -34, "Comd98 Zg00000001 Mev"),
    tx("c", "joint", "2026-03-09", -29.99, "737005 9900000000000000000000001"),
    tx("d", "perso", "2026-03-02", 2150, "Identif0019999 03 02"),
    tx("e", "perso", "2026-03-10", -18.4, "Eusepadr 0072 T9 Xxxxxx"),
    tx("f", "perso", "2026-03-12", -40, "Vir Inst Camille Martin"),
    // Achat différé : daté du prélèvement de la carte, le jour d'achat est dans le libellé.
    tx("g", "perso", "2026-04-01", -3.2, "Carte 04 03 26 Boulangerie Du Coin"),
    tx("h", "perso", "2026-04-01", -3.2, "Carte 04 03 26 Boulangerie Du Coin"),
    // Même montant et même jour que l'eau, mais sur un compte absent de l'export.
    tx("i", "camille", "2026-03-06", -34, "99000000001"),
    // Deux prélèvements de 25 € le même jour : rien ne permet de choisir.
    tx("j", "perso", "2026-03-20", -25, "88000000001"),
  ];
  const { matches, ambiguous } = matchBankRows(txs, rows);
  const labelOf = (id: string) => matches.find((m) => m.txId === id)?.row.label;

  it("retrouve les prélèvements et virements par montant, date et compte", () => {
    expect(labelOf("a")).toBe("PRLV SEPA FOURNISSEUR ENERGIE ET G");
    expect(labelOf("b")).toBe("PRLV SEPA REGIE DES EAUX");
    expect(labelOf("d")).toBe("VIR SEPA EMPLOYEUR SA");
    expect(labelOf("e")).toBe("PRLV SEPA ASSUREUR EXEMPLE");
    expect(labelOf("f")).toBe("VIR INST CAMILLE MARTIN");
  });

  it("rapproche un achat par carte sur son jour d'achat, même en double", () => {
    expect(labelOf("g")).toBe("CARTE 04/03/26 BOULANGERIE DU COIN");
    expect(labelOf("h")).toBe("CARTE 04/03/26 BOULANGERIE DU COIN");
  });

  it("ne prête pas le libellé d'un autre compte et ne devine pas entre deux libellés", () => {
    expect(labelOf("i")).toBeUndefined();
    expect(labelOf("j")).toBeUndefined();
    expect(ambiguous).toBe(1);
  });

  it("départage deux lignes de même montant par les mots du libellé", () => {
    const r = matchBankRows(
      [...txs, tx("k", "perso", "2026-03-20", -25, "Prlv Sepa Salle De Sport")],
      rows,
    );
    expect(r.matches.find((m) => m.txId === "k")?.row.label).toBe("PRLV SEPA SALLE DE SPORT");
  });
});

describe("shapeIsSpecific", () => {
  it("accepte une forme qui garde un code court ou un mot, refuse une simple suite de chiffres", () => {
    expect(shapeIsSpecific(labelShape("04170 N9900000000000001"))).toBe(true);
    expect(shapeIsSpecific(labelShape("Identif0019999 03 02"))).toBe(true);
    expect(shapeIsSpecific(labelShape("Ch3 W99999 M999999"))).toBe(true);
    expect(shapeIsSpecific(labelShape("99000000001"))).toBe(false);
    expect(shapeIsSpecific(labelShape("9900001"))).toBe(false);
  });
});

describe("libellé de la banque à l'écran", () => {
  it("nettoie les préfixes et la date de carte", () => {
    expect(displayBankLabel("PRLV SEPA FOURNISSEUR ENERGIE ET G")).toBe("Fournisseur Energie Et G");
    expect(displayBankLabel("VIR SEPA EMPLOYEUR SA")).toBe("Virement Employeur Sa");
    expect(displayBankLabel("CARTE 04/03/26 BOULANGERIE DU COIN")).toBe("Boulangerie Du Coin");
  });

  it("sert de titre à une opération codée sans nom", () => {
    expect(txTitle({ merchant: null, label: "99000000001", bank_label: "PRLV SEPA REGIE DES EAUX" })).toBe("Regie Des Eaux");
    expect(txTitle({ merchant: "Eau", label: "99000000001", bank_label: "PRLV SEPA REGIE DES EAUX" })).toBe("Eau");
    expect(txTitle({ merchant: null, label: "Vir Inst Camille Martin", bank_label: "VIR INST CAMILLE MARTIN" })).toBe("Virement Camille Martin");
  });
});
