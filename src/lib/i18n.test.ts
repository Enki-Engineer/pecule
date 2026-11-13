import { afterEach, describe, expect, it } from "vitest";
import { LANGS, currentLang, isLang, locale, registerDict, setLangResolver, t, tk, tn, translate, translatePlural } from "./i18n.ts";

registerDict("en", {
  "Je t'écoute": "I'm listening",
  "il y a {n} min": "{n} min ago",
  "{n} opération": ["{n} transaction", "{n} transactions"],
  "Mois##menu": "Monthly view",
});

afterEach(() => setLangResolver(() => "fr"));

describe("translate", () => {
  it("rend le français tel quel, variables remplies", () => {
    expect(translate("fr", "Je t'écoute")).toBe("Je t'écoute");
    expect(translate("fr", "il y a {n} min", { n: 5 })).toBe("il y a 5 min");
  });
  it("traduit, et garde le français quand la traduction manque", () => {
    expect(translate("en", "Je t'écoute")).toBe("I'm listening");
    expect(translate("en", "il y a {n} min", { n: 5 })).toBe("5 min ago");
    expect(translate("en", "Texte pas encore traduit")).toBe("Texte pas encore traduit");
    expect(translate("de", "Je t'écoute")).toBe("Je t'écoute");
  });
  it("n'affiche jamais ce qui suit « ## » (même texte, sens différent)", () => {
    expect(translate("fr", "Mois##menu")).toBe("Mois");
    expect(translate("en", "Mois##menu")).toBe("Monthly view");
    expect(translate("it", "Mois##menu")).toBe("Mois");
  });
  it("laisse une variable inconnue visible plutôt que de l'effacer", () => {
    expect(translate("fr", "Bonjour {nom}", { autre: 1 })).toBe("Bonjour {nom}");
  });
});

describe("translatePlural", () => {
  it("suit la règle de chaque langue : 0 est singulier en français, pluriel en anglais", () => {
    expect(translatePlural("fr", "{n} opération", "{n} opérations", 0)).toBe("0 opération");
    expect(translatePlural("fr", "{n} opération", "{n} opérations", 1)).toBe("1 opération");
    expect(translatePlural("fr", "{n} opération", "{n} opérations", 2)).toBe("2 opérations");
    expect(translatePlural("en", "{n} opération", "{n} opérations", 0)).toBe("0 transactions");
    expect(translatePlural("en", "{n} opération", "{n} opérations", 1)).toBe("1 transaction");
  });
  it("garde le français quand la traduction manque", () => {
    expect(translatePlural("es", "{n} opération", "{n} opérations", 3)).toBe("3 opérations");
  });
});

describe("langue courante", () => {
  it("vient du résolveur (français par défaut)", () => {
    expect(currentLang()).toBe("fr");
    expect(t("Je t'écoute")).toBe("Je t'écoute");
    setLangResolver(() => "en");
    expect(t("Je t'écoute")).toBe("I'm listening");
    expect(tn("{n} opération", "{n} opérations", 4)).toBe("4 transactions");
    expect(locale()).toBe("en-GB");
  });
  it("tk ne traduit pas : il marque un texte traduit plus tard", () => {
    setLangResolver(() => "en");
    expect(tk("Je t'écoute")).toBe("Je t'écoute");
    expect(t(tk("Je t'écoute"))).toBe("I'm listening");
  });
  it("ne connaît que les cinq langues de Pécule", () => {
    expect(LANGS.map((l) => l.id)).toEqual(["fr", "en", "de", "it", "es"]);
    expect(isLang("de")).toBe(true);
    expect(isLang("pt")).toBe(false);
    expect(isLang(null)).toBe(false);
  });
});
