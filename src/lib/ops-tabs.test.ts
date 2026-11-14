import { describe, expect, it } from "vitest";
import { opsTab, screenKey, scrollOnReturn } from "./ops-tabs.ts";

describe("opsTab", () => {
  it("reconnaît les deux écrans de la section, avec ou sans filtres", () => {
    expect(opsTab("/operations")).toBe("operations");
    expect(opsTab("/operations?a_classer=1")).toBe("operations");
    expect(opsTab("/factures/")).toBe("factures");
    expect(opsTab("/factures?id=3")).toBe("factures");
  });

  it("ne prend pas les autres écrans, même voisins", () => {
    for (const p of ["/", "/tri", "/mois", "/operations/3", "/facturesque", "/documents"]) expect(opsTab(p)).toBeNull();
  });
});

describe("screenKey", () => {
  it("est la même pour Opérations et Factures : aller de l'un à l'autre ne démonte rien", () => {
    expect(screenKey("/factures")).toBe(screenKey("/operations"));
  });

  it("reste l'adresse pour les autres écrans", () => {
    expect(screenKey("/mois")).toBe("/mois");
    expect(screenKey("/immobilier/3")).toBe("/immobilier/3");
    expect(screenKey("/tri")).not.toBe(screenKey("/operations"));
  });
});

describe("scrollOnReturn", () => {
  it("rend la hauteur laissée quand l'écran revient avec les mêmes filtres", () => {
    expect(scrollOnReturn({ search: "?compte=a", y: 840 }, "?compte=a")).toBe(840);
    expect(scrollOnReturn({ search: "", y: 120 }, "")).toBe(120);
  });

  it("repart du haut quand les filtres ont changé ou que l'écran n'a jamais été vu", () => {
    expect(scrollOnReturn({ search: "", y: 840 }, "?a_classer=1")).toBe(0);
    expect(scrollOnReturn(undefined, "")).toBe(0);
  });
});
