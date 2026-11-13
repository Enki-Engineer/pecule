import { describe, expect, it } from "vitest";
import { brandOf } from "./brands.ts";

const d = (...t: string[]) => brandOf(...t)?.domain ?? null;

describe("brandOf", () => {
  it("reconnaît les marchands dans les libellés bancaires", () => {
    expect(d("Carte 30 04 26 Nyx Nespresso")).toBe("nespresso.com");
    expect(d("Amazon Payments")).toBe("amazon.fr");
    expect(d("Ubr Pending Uber Com")).toBe("uber.com");
    expect(d("Easy Jet Kdllpsq")).toBe("easyjet.com");
    expect(d("Google You Tube Premium")).toBe("youtube.com");
    expect(d("Mobile Camille — Orange")).toBe("orange.fr");
    expect(d("Caisse d’épargne")).toBe("caisse-epargne.fr");
    expect(d("Prêt Action Logement (Nantes)")).toBe("actionlogement.fr");
    expect(d("Adeo Tecnomat")).toBe("leroymerlin.fr");
  });

  it("donne la priorité à la plateforme la plus précise", () => {
    expect(d("Kiln · validateur ETH (Ledger)")).toBe("kiln.fi");
    expect(d("MultiversX · xPortal")).toBe("xportal.com");
    expect(d("Ledger · Ethereum")).toBe("ledger.com");
  });

  it("reconnaît un grand employeur sans prendre le pas sur un marchand", () => {
    expect(d("Vir Sepa Capgemini Technology Services")).toBe("capgemini.com");
    expect(d("Vir Sopra Steria Group Salaire")).toBe("soprasteria.com");
    expect(d("Vir France Travail Allocations")).toBe("francetravail.fr");
    expect(d("Vir La Banque Postale")).toBe("labanquepostale.fr");
    expect(d("La Poste Colissimo")).toBe("laposte.fr");
    expect(d("Vinci Autoroutes")).toBe("vinci-autoroutes.com");
    expect(d("Vir Vinci Construction")).toBe("vinci.com");
    expect(d("Bouygues Telecom")).toBe("bouyguestelecom.fr");
    expect(d("Dassault Systemes Se")).toBe("3ds.com");
  });

  it("ne confond pas des mots courants", () => {
    expect(d("Boulangerie/café")).toBeNull();
    expect(d("Boulanger De Neuvil")).toBeNull();
    expect(d("M Martin Alex Ou Mme Durand")).toBeNull();
    expect(d("Relevé Différé Carte 4810 6696")).toBeNull();
  });
});
