import { describe, expect, it } from "vitest";
import { asWelcomeStep, bankGuide, consentsWith, draftWithCountry, householdChanges, nextWelcomeStep, previousWelcomeStep, proposedHousehold, welcomeFlow, welcomeProgress, type BankGuideInput, type HouseholdDraft } from "./onboarding.ts";

const admin = welcomeFlow({ admin: true });
const member = welcomeFlow({ admin: false });

describe("parcours de bienvenue", () => {
  it("ne montre « Ton foyer » qu'à l'administrateur", () => {
    expect(admin).toEqual(["bienvenue", "foyer", "reperes", "comptes", "banque", "pret"]);
    expect(member).toEqual(["bienvenue", "reperes", "comptes", "banque", "pret"]);
  });

  it("ne reprend qu'une étape du parcours du membre", () => {
    expect(asWelcomeStep("banque", member)).toBe("banque");
    expect(asWelcomeStep("foyer", admin)).toBe("foyer");
    expect(asWelcomeStep("foyer", member)).toBeNull();
    expect(asWelcomeStep("ailleurs", admin)).toBeNull();
    expect(asWelcomeStep(null, admin)).toBeNull();
  });

  it("compte le guide de la banque avec « Tes comptes »", () => {
    expect(welcomeProgress("bienvenue", admin)).toEqual({ index: 0, total: 5 });
    expect(welcomeProgress("comptes", admin)).toEqual({ index: 3, total: 5 });
    expect(welcomeProgress("banque", admin)).toEqual({ index: 3, total: 5 });
    expect(welcomeProgress("pret", admin)).toEqual({ index: 4, total: 5 });
    expect(welcomeProgress("banque", member)).toEqual({ index: 2, total: 4 });
  });

  it("n'ouvre le guide de la banque que si le membre a choisi de la relier", () => {
    expect(nextWelcomeStep("bienvenue", admin)).toBe("foyer");
    expect(nextWelcomeStep("bienvenue", member)).toBe("reperes");
    expect(nextWelcomeStep("comptes", admin, { bank: true })).toBe("banque");
    expect(nextWelcomeStep("comptes", admin)).toBe("pret");
    expect(nextWelcomeStep("banque", admin)).toBe("pret");
    expect(nextWelcomeStep("pret", admin)).toBeNull();
  });

  it("revient d'une étape, sans repasser par le guide depuis la fin", () => {
    expect(previousWelcomeStep("bienvenue", admin)).toBeNull();
    expect(previousWelcomeStep("reperes", admin)).toBe("foyer");
    expect(previousWelcomeStep("reperes", member)).toBe("bienvenue");
    expect(previousWelcomeStep("banque", member)).toBe("comptes");
    expect(previousWelcomeStep("pret", admin)).toBe("comptes");
  });
});

describe("réglages du foyer proposés", () => {
  const origin: HouseholdDraft = { country: "FR", currency: "EUR", timeZone: "Europe/Paris", modulesOff: [] };
  const zurich = { country: "CH", currency: "CHF", timeZone: "Europe/Zurich" };

  it("prend ce que dit le navigateur sur une installation neuve, et retire hors de France les écrans français", () => {
    expect(proposedHousehold(origin, zurich, true)).toEqual({ ...zurich, modulesOff: ["impots", "retraite"] });
    expect(proposedHousehold({ ...origin, modulesOff: ["crypto"] }, zurich, true).modulesOff).toEqual(["crypto", "impots", "retraite"]);
    expect(proposedHousehold(origin, { country: "FR", currency: "EUR", timeZone: "Europe/Paris" }, true)).toEqual(origin);
  });

  it("ne propose rien à un foyer déjà réglé ou qui a déjà des comptes", () => {
    expect(proposedHousehold(origin, zurich, false)).toEqual(origin);
    const belgium: HouseholdDraft = { country: "BE", currency: "EUR", timeZone: "Europe/Brussels", modulesOff: ["retraite", "crypto"] };
    expect(proposedHousehold(belgium, zurich, true)).toEqual({ ...belgium, modulesOff: ["crypto", "retraite"] });
  });

  it("fait suivre la devise, le fuseau et les écrans français quand le pays change", () => {
    const guess = { country: "US", currency: "USD", timeZone: "America/Los_Angeles" };
    expect(draftWithCountry(origin, "US", guess)).toEqual({ country: "US", currency: "USD", timeZone: "America/Los_Angeles", modulesOff: ["impots", "retraite"] });
    expect(draftWithCountry(origin, "CA", guess)).toEqual({ country: "CA", currency: "CAD", timeZone: "America/Toronto", modulesOff: ["impots", "retraite"] });
    const abroad: HouseholdDraft = { ...zurich, modulesOff: ["crypto", "impots", "retraite"] };
    expect(draftWithCountry(abroad, "FR", guess)).toEqual({ country: "FR", currency: "EUR", timeZone: "Europe/Paris", modulesOff: ["crypto"] });
  });

  it("n'enregistre que ce qui a changé", () => {
    expect(householdChanges(origin, { ...origin })).toEqual({ settings: null, currency: null });
    expect(householdChanges({ ...origin, modulesOff: ["retraite", "crypto"] }, { ...origin, modulesOff: ["crypto", "retraite"] })).toEqual({ settings: null, currency: null });
    expect(householdChanges(origin, { ...zurich, modulesOff: ["impots", "retraite"] })).toEqual({ settings: { country: "CH", timeZone: "Europe/Zurich", modulesOff: ["impots", "retraite"] }, currency: "CHF" });
    expect(householdChanges(origin, { ...origin, currency: "USD" })).toEqual({ settings: null, currency: "USD" });
    expect(householdChanges(origin, { ...origin, modulesOff: ["immobilier"] })).toEqual({ settings: { modulesOff: ["immobilier"] }, currency: null });
  });
});

describe("guide Enable Banking", () => {
  const blank: BankGuideInput = { keySaved: false, keyUnreadable: false, application: null, consents: 0, declared: { application: false, activation: false } };

  it("commence par l'application, puis avance sur la parole du membre tant que Pécule n'a pas la clé", () => {
    expect(bankGuide(blank)).toEqual({ states: { application: "en_cours", activation: "a_venir", cle: "a_venir", accord: "a_venir" }, current: "application", done: false });
    expect(bankGuide({ ...blank, declared: { application: true, activation: false } }).current).toBe("activation");
    expect(bankGuide({ ...blank, declared: { application: true, activation: true } }).states).toEqual({ application: "fait", activation: "fait", cle: "en_cours", accord: "a_venir" });
    // L'activation cochée sans l'application ne fait rien avancer.
    expect(bankGuide({ ...blank, declared: { application: false, activation: true } }).current).toBe("application");
  });

  it("croit Enable Banking dès que la clé est donnée", () => {
    const withKey = { ...blank, keySaved: true, declared: { application: true, activation: true } };
    expect(bankGuide({ ...withKey, application: { active: true } }).current).toBe("accord");
    // Activation cochée trop vite : le membre y est ramené, la clé reste donnée.
    expect(bankGuide({ ...withKey, application: { active: false } }).states).toEqual({ application: "fait", activation: "en_cours", cle: "fait", accord: "a_venir" });
    // Une clé donnée d'emblée vaut une application créée.
    expect(bankGuide({ ...blank, keySaved: true, application: { active: true } }).states.application).toBe("fait");
  });

  it("est fini quand le membre a donné son accord à une banque", () => {
    expect(bankGuide({ ...blank, keySaved: true, application: { active: true }, consents: 1 })).toEqual({ states: { application: "fait", activation: "fait", cle: "fait", accord: "fait" }, current: null, done: true });
    // Enable Banking injoignable : un accord déjà donné dit assez que l'application était active.
    expect(bankGuide({ ...blank, keySaved: true, application: null, consents: 2 }).done).toBe(true);
  });

  it("ne compte que les accords donnés avec l'application suivie", () => {
    // Camille est reliée par l'application du foyer, puis crée la sienne : celle-ci n'a encore rien autorisé.
    const sessions = [{ userId: 1 }, { userId: 2, own: false }, { userId: 2, own: true }];
    expect(consentsWith(sessions, "foyer", 2)).toEqual([{ userId: 2, own: false }]);
    expect(consentsWith(sessions, "moi", 2)).toEqual([{ userId: 2, own: true }]);
    expect(consentsWith(sessions, "moi", 1)).toEqual([]);
    expect(consentsWith(sessions, "foyer", undefined)).toEqual([]);
  });

  it("redemande la clé quand elle n'est plus lisible, sans repartir de la création de l'application", () => {
    const g = bankGuide({ ...blank, keySaved: true, keyUnreadable: true, application: null, consents: 1 });
    expect(g.current).toBe("cle");
    expect(g.done).toBe(false);
    expect(g.states).toEqual({ application: "fait", activation: "fait", cle: "en_cours", accord: "fait" });
    // Même sans accord encore donné, et quoi que le membre ait déclaré sur cet appareil.
    expect(bankGuide({ ...blank, keySaved: true, keyUnreadable: true }).current).toBe("cle");
  });
});
