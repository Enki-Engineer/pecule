import { afterEach, describe, expect, it } from "vitest";
import { brandInitials, brandOf, BRAND_DOMAINS, cleanDomain, customMatcher, customPattern, patternKey, setCustomBrands } from "./brands.ts";

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

  it("reconnaît les enseignes courantes, même tronquées ou collées par la banque", () => {
    expect(d("Carte 02 05 26 Hellofresh France")).toBe("hellofresh.fr");
    expect(d("Autoroutes Du S")).toBe("vinci-autoroutes.com");
    expect(d("Direction Generale Des Finance")).toBe("impots.gouv.fr");
    expect(d("Gie Les Cinemas Pathe")).toBe("pathe.fr");
    expect(d("Megadonquijote")).toBe("donki.com");
    expect(d("Seven Eleven")).toBe("7-eleven.com");
    expect(d("Openai Chatgpt Subscr")).toBe("openai.com");
    expect(d("Claude Ai Subscription")).toBe("claude.ai");
    expect(d("Uberjp Eats")).toBe("ubereats.com");
    expect(d("Avis Budget Nantes")).toBe("avis.fr");
    expect(d("Super U Angers")).toBe("magasins-u.com");
    expect(d("C&A Nantes")).toBe("c-and-a.com");
  });

  it("ne prend pas un prénom ou un nom de famille pour une marque", () => {
    expect(d("Vir Inst M Alex Hertz")).toBeNull();
    expect(d("Virement de Claude Martin")).toBeNull();
    expect(d("Alan Durand")).toBeNull();
    expect(d("Avis d'imposition")).toBeNull();
    expect(d("Pharmacie Du Monde")).toBeNull();
    expect(d("Sum Up Marche Des Halles")).toBeNull();
  });

  it("ne confond pas des mots courants", () => {
    expect(d("Boulangerie/café")).toBeNull();
    expect(d("Boulanger De Neuvil")).toBeNull();
    expect(d("M Martin Alex Ou Mme Durand")).toBeNull();
    expect(d("Relevé Différé Carte 4810 6696")).toBeNull();
  });
});

describe("enseignes du foyer", () => {
  afterEach(() => {
    setCustomBrands([]);
  });

  it("garde un motif écrit comme les libellés, et refuse ce qui est trop vague", () => {
    expect(customPattern("  Fournil DES Halles ")).toBe("fournil des halles");
    expect(customPattern("L'Épicerie d'Angers")).toBe("l'epicerie d'angers");
    expect(customPattern("ab")).toBeNull();
    expect(customPattern("de la")).toBeNull();
    expect(customPattern("?!")).toBeNull();
    expect(customPattern("mot ".repeat(40))).toBeNull();
  });

  it("reconnaît tous les mots du motif, entiers, dans n'importe quel ordre", () => {
    const m = customMatcher("fournil des halles")!;
    expect(m.test("carte 12 03 26 fournil des halles nantes")).toBe(true);
    expect(m.test("fournil 4412 des halles")).toBe(true);
    expect(m.test("halles des fournil")).toBe(true);
    expect(m.test("fournils des halles")).toBe(false);
    expect(m.test("fournil des hall")).toBe(false);
    expect(customMatcher("")).toBeNull();
  });

  it("tient pour le même motif les mêmes mots dans un autre ordre", () => {
    expect(patternKey("Halles des  fournil des")).toBe(patternKey("fournil des halles"));
    expect(patternKey("fournil des halles")).not.toBe(patternKey("fournil halles"));
  });

  it("ne lit jamais le motif comme une expression régulière", () => {
    expect(customMatcher("c.a+b")!.test("cxaab")).toBe(false);
    expect(customMatcher("c.a+b")!.test("carte c.a+b nantes")).toBe(true);
    expect(customMatcher("atelier.*")!.test("atelier camille")).toBe(false);
    expect(customMatcher("canal+")!.test("canal+")).toBe(true);
  });

  it("passe avant le référentiel et dit quand la liste change", () => {
    expect(d("Carte 02 05 26 Fournil Des Halles Nantes")).toBeNull();
    expect(setCustomBrands([{ name: "Le Fournil des Halles", pattern: "fournil des halles", domain: "fournil-des-halles.example" }])).toBe(true);
    expect(setCustomBrands([{ name: "Le Fournil des Halles", pattern: "fournil des halles", domain: "fournil-des-halles.example" }])).toBe(false);
    const hit = brandOf("Carte 02 05 26 Fournil Des Halles Nantes");
    expect(hit).toMatchObject({ name: "Le Fournil des Halles", domain: "fournil-des-halles.example", custom: true });
    // Une enseigne du foyer l'emporte sur une marque du référentiel.
    expect(d("Amazon Payments")).toBe("amazon.fr");
    setCustomBrands([{ name: "Commandes de Léo", pattern: "amazon payments", domain: null }]);
    expect(brandOf("Amazon Payments")).toMatchObject({ name: "Commandes de Léo", domain: null, custom: true });
    expect(d("Amazon Eu Sarl")).toBe("amazon.fr");
    // La liste retirée, le référentiel reprend sa place (le cache est vidé).
    expect(setCustomBrands([])).toBe(true);
    expect(d("Amazon Payments")).toBe("amazon.fr");
    expect(d("Carte 02 05 26 Fournil Des Halles Nantes")).toBeNull();
  });

  it("ignore un motif trop vague venu de la base", () => {
    setCustomBrands([{ name: "Vide", pattern: "de", domain: null }]);
    expect(brandOf("Virement de Camille")).toBeNull();
  });

  it("réduit un site à son domaine et refuse ce qui n'en est pas un", () => {
    expect(cleanDomain("https://www.Exemple.fr/contact?x=1")).toBe("exemple.fr");
    expect(cleanDomain("boutique.exemple.fr:8443")).toBe("boutique.exemple.fr");
    expect(cleanDomain("exemple.fr.")).toBe("exemple.fr");
    expect(cleanDomain("exemple")).toBeNull();
    expect(cleanDomain("192.168.0.1")).toBeNull();
    expect(cleanDomain("http://localhost:3000")).toBeNull();
    expect(cleanDomain("exemple .fr")).toBeNull();
    expect(cleanDomain("")).toBeNull();
  });

  it("donne des initiales à une enseigne sans logo", () => {
    expect(brandInitials("Le Fournil des Halles")).toBe("FH");
    expect(brandInitials("Atelier de Léo")).toBe("AL");
    expect(brandInitials("Atelier")).toBe("AT");
    expect(brandInitials("L'Épicerie d'Angers")).toBe("ÉA");
    expect(brandInitials("Chez Camille")).toBe("CA");
    expect(brandInitials("Le 21")).toBe("21");
    expect(brandInitials("De la")).toBe("DL");
    expect(brandInitials("")).toBe("?");
  });

  it("ne mêle pas les sites des enseignes du foyer aux domaines du référentiel", () => {
    setCustomBrands([{ name: "Le Fournil des Halles", pattern: "fournil des halles", domain: "fournil-des-halles.example" }]);
    expect(BRAND_DOMAINS.has("fournil-des-halles.example")).toBe(false);
    expect(BRAND_DOMAINS.has("amazon.fr")).toBe(true);
  });
});
