import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANUAL, findArticle } from "./manual.ts";
import { HELP_RULES, helpFor, helpPath } from "./manual-help.ts";

describe("aide de l'écran ouvert", () => {
  it("ne mène qu'à des articles ou des thèmes du manuel", () => {
    const known = (id: string) => !!findArticle(id) || MANUAL.some((th) => th.id === id);
    expect([...HELP_RULES.map((r) => r.to), "relire-un-import"].filter((id) => !known(id))).toEqual([]);
  });

  it("donne sa page à chaque écran de l'appli et à chaque groupe de réglages", () => {
    const app = readFileSync("src/client/app.tsx", "utf8");
    // Écrans derrière la connexion (les pages publiques et la connexion n'ont pas la barre du haut).
    const routes = [...app.slice(app.indexOf("<Route index")).matchAll(/path="([^"*:]+)/g)].map((m) => `/${m[1].replace(/\/$/, "")}`);
    expect(routes.length).toBeGreaterThan(15);
    expect(routes.filter((r) => !r.startsWith("/manuel") && !helpFor(r))).toEqual([]);
    const groups = [...readFileSync("src/client/pages/Settings.tsx", "utf8").matchAll(/\{ id: "(\w+)", label:/g)].map((m) => m[1]);
    expect(groups.filter((g) => !HELP_RULES.some((r) => r.path === `/reglages/${g}`))).toEqual([]);
  });

  it("choisit la page la plus précise, d'après l'adresse et ses paramètres", () => {
    expect(helpFor("/")).toBe("tableau-de-bord");
    expect(helpFor("/operations?compte=abc")).toBe("liste-des-operations");
    expect(helpFor("/operations?a_classer=1")).toBe("classer-une-operation");
    expect(helpFor("/mois?onglet=frise")).toBe("frise");
    expect(helpFor("/mois")).toBe("analyse");
    expect(helpFor("/patrimoine/crypto")).toBe("crypto");
    expect(helpFor("/patrimoine")).toBe("patrimoine-vue-ensemble");
    expect(helpFor("/credits/12")).toBe("credits");
    expect(helpFor("/immobilier/3")).toBe("immobilier");
    expect(helpFor("/documents?lot=4")).toBe("relire-un-import");
    expect(helpFor("/documents?id=8")).toBe("coffre");
    expect(helpFor("/reglages/connexions?c=banque")).toBe("relier-une-banque");
    expect(helpFor("/reglages/connexions")).toBe("comptes");
    expect(helpFor("/reglages/comptes?c=ia")).toBe("brancher-ia");
    expect(helpFor("/reglages/appareil")).toBe("notifications");
    expect(helpFor("/reglages/notifications#solde")).toBe("notifications");
  });

  it("renvoie au sommaire quand l'écran n'a pas sa page", () => {
    expect(helpFor("/manuel/apparence")).toBeNull();
    expect(helpFor("/inconnu")).toBeNull();
    expect(helpPath("/inconnu")).toBe("/manuel");
    expect(helpPath("/budget")).toBe("/manuel/budget");
  });
});
