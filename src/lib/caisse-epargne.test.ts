import { describe, expect, it } from "vitest";
import { ceLabel, parseCeStatement } from "./caisse-epargne.ts";

// Relevé fictif, mis en page comme la sortie de `pdftotext -layout` (aucun nom, montant ni numéro réel).
const pad = (s: string, n: number) => s + " ".repeat(Math.max(0, n - s.length));
const line = (date: string, label: string, debit = "", credit = "") => pad(pad(`            ${pad(date, 10)}${label}`, 110 - debit.length) + debit, 136 - credit.length) + credit;
const HEADER = pad(pad("            Date      Détail des opérations en euros", 105) + "Débit", 130) + "Crédit";
const STATEMENT = [
  "                                 M. JEAN EXEMPLE",
  "                                 COMPTE DE DEPOT - N° 12345 00200 01234567890",
  HEADER,
  line("", "SOLDE PRECEDENT AU 06/12/19", "", "1 000,00"),
  "                      Virements reçus",
  line("28/12", "VIR SEPA EMPLOYEUR SA", "", "2 150,00"),
  "                      -Réf. donneur d'ordre :SALAIRE 122019",
  "                      Paiements par carte",
  line("03/01", "CB EPICERIE DU COIN FACT 181219", "12,40"),
  line("03/01", "CB CAFE FACT 201219", "0,40"),
  "                      Prélèvements",
  // La marge gauche porte parfois un identifiant client sur la même ligne qu'une opération.
  "  00011122  " + line("05/01", "* FRAIS TENUE DE COMPTE", "2,00").slice(12),
  line("02/01", "VIREMENT VERS JEAN EXEMPLE", "500,00"),
  "                      VIREMENT DE M. JEAN EXEMPLE",
  "                      -Réf. donneur d'ordre :VIREMENT VERS JEAN EXEMPLE",
  line("", "NOUVEAU SOLDE CREDITEUR AU 06/01/20 (en francs : 17 286,43)", "", "2 635,20"),
  "            M. JEAN EXEMPLE - LIV.A EN CPTE - N° 12345 00200 09876543210",
  HEADER,
  line("", "SOLDE PRECEDENT AU 06/10/19", "", "10,00"),
  line("31/12", "VERSEMENT D'INTERETS", "", "0,08"),
  line("", "NOUVEAU SOLDE CREDITEUR AU 06/01/20", "", "10,08"),
].join("\n");

describe("parseCeStatement", () => {
  const accounts = parseCeStatement(STATEMENT);

  it("lit chaque compte du relevé et vérifie qu'il retombe sur son solde", () => {
    expect(accounts.map((a) => [a.number, a.from, a.to, a.before, a.after, a.balanced])).toEqual([
      ["01234567890", "2019-12-06", "2020-01-06", 1000, 2635.2, true],
      ["09876543210", "2019-10-06", "2020-01-06", 10, 10.08, true],
    ]);
  });

  it("range chaque montant du bon côté et date les opérations de janvier sur l'année suivante", () => {
    expect(accounts[0].operations.map((o) => [o.date, o.amount, o.label])).toEqual([
      ["2019-12-28", 2150, "VIR SEPA EMPLOYEUR SA"],
      ["2020-01-03", -12.4, "CB EPICERIE DU COIN FACT 181219"],
      ["2020-01-03", -0.4, "CB CAFE FACT 201219"],
      ["2020-01-05", -2, "FRAIS TENUE DE COMPTE"],
      ["2020-01-02", -500, "VIREMENT VERS JEAN EXEMPLE"],
    ]);
  });

  it("garde le motif d'un virement et signale un relevé dont le compte n'est pas juste", () => {
    expect(accounts[0].operations[4].detail).toContain("VIREMENT DE M. JEAN EXEMPLE");
    expect(parseCeStatement(STATEMENT.replace("12,40", "12,50"))[0].balanced).toBe(false);
  });
});

describe("relevé d'ouverture d'un compte", () => {
  it("part de zéro quand le solde précédent n'a ni date ni montant", () => {
    const text = [
      "                                 MLLE ANNE EXEMPLE OU M JEAN EXEMPLE",
      "                                 COMPTE DE DEPOT JOINT - N° 12345 00200 01112223334",
      HEADER,
      line("", "SOLDE PRECEDENT"),
      "                      Opérations de dépôt",
      line("13/12", "DEPOT ESP N° 0000000001 OV ESP", "", "20,00"),
      line("05/01", "VIR SEPA M. JEAN EXEMPLE", "", "30,00"),
      line("", "NOUVEAU SOLDE CREDITEUR AU 13/01/18", "", "50,00"),
    ].join("\n");
    const [a] = parseCeStatement(text);
    expect([a.from, a.to, a.before, a.after, a.balanced]).toEqual(["2017-12-13", "2018-01-13", 0, 50, true]);
    expect(a.operations.map((o) => o.date)).toEqual(["2017-12-13", "2018-01-05"]);
  });
});

describe("ceLabel", () => {
  it("écrit un achat par carte comme les autres banques, et joint le motif d'un virement", () => {
    expect(ceLabel({ date: "2020-01-03", label: "CB EPICERIE DU COIN FACT 181219", detail: "", amount: -12.4 })).toBe("CARTE 18/12/19 EPICERIE DU COIN");
    expect(ceLabel({ date: "2020-01-02", label: "VIREMENT SEPA PAR INTERNET", detail: "ACTIVATION COMPTE · -Réf. donneur d'ordre :X", amount: -500 })).toBe("VIREMENT SEPA PAR INTERNET ACTIVATION COMPTE");
    expect(ceLabel({ date: "2020-01-05", label: "PRLV Orange", detail: "", amount: -10 })).toBe("PRLV Orange");
  });
});
