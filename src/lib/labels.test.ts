import { describe, expect, it } from "vitest";
import { groupByOwner, OWNER_ORDER, ownerLabel, bankHeadline, bankMotif, displayBankLabel, displayLabel } from "./labels.ts";

describe("groupByOwner / ownerLabel", () => {
  it("place les personnes du foyer entre le compte commun et « autre », « pro »", () => {
    const list = [{ owner: "pro" }, { owner: "camille" }, { owner: "joint" }, { owner: "alex" }, { owner: "autre" }];
    expect(groupByOwner(list, OWNER_ORDER).map((g) => g.owner)).toEqual(["joint", "alex", "camille", "autre", "pro"]);
    expect(ownerLabel("alex")).toBe("Alex");
    expect(ownerLabel("jean-luc")).toBe("Jean-Luc");
    expect(ownerLabel("joint")).toBe("Compte commun");
  });
});

describe("libellé de la banque en plusieurs lignes", () => {
  const impots = "PRLV SEPA DIRECTION GENERALE DES FINANCE\nSOLDE IMPOT REVENUS 2025 N DE FACTURE 26\n12345678901\nABCD123E45678901FGH\nRUM AAFR00ZZZ0000001A00B0C000000XYZ0A00";
  const mobile = "PRLV SEPA OPERATEUR MOBILE\nVotre abonnement mobile: 06XXXXX000 (fac\nture: 1234567890)\n00000N1111111111111111\nRUM ABCD000000000000000";
  it("affiche l'intitulé seul", () => {
    expect(bankHeadline(impots)).toBe("PRLV SEPA DIRECTION GENERALE DES FINANCE");
    expect(displayBankLabel(impots)).toBe("Direction Generale Des Finance");
    expect(displayBankLabel("VIR Virement depuis Courant\nMARTIN ALEX")).toBe("Virement depuis Courant");
    expect(displayLabel("Vir Virement Depuis Courant Martin Alex")).toBe("Virement Depuis Courant Martin Alex");
  });
  it("tire le texte du créancier, sans les références", () => {
    expect(bankMotif(impots)).toBe("Solde impot revenus 2025 n de facture 26");
    expect(bankMotif(mobile)).toBe("Votre abonnement mobile: facture");
    expect(bankMotif("PRLV SEPA ENERGIE DE L'OUEST\nPrelevement Energie de l'Ouest Electrici\nte et Gaz-Reference client 1\n00000N1111111111111111\nRUM ABCD012345678")).toBe("Prelevement Energie de l'Ouest Electricite et Gaz Reference client 1");
    expect(bankMotif("VIR SEPA CAGNOTTE\nLOYER-12345678\n7654321\nRéf AA1BCDEFGH2IJKL3MNOP")).toBe("Loyer");
    expect(bankMotif("VIR Virement depuis Courant\nMARTIN ALEX")).toBe("Martin alex");
  });
  it("ne rend rien quand il n'y a que des références, ou une seule ligne", () => {
    expect(bankMotif("PRLV SEPA BANQUE DE L'OUEST\n1234567\n1234567AB0000001CDE20261112\nRUM ABC2000000XY0000001")).toBeNull();
    expect(bankMotif("PRLV SEPA BANQUE DE L'OUEST")).toBeNull();
    expect(bankMotif(null)).toBeNull();
  });
});
