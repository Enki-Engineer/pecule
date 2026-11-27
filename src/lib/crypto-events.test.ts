import { describe, expect, it } from "vitest";
import { defaultTitle, EVENT_KIND_INFO, EVENT_KINDS, kindOf, unitPrice, validPeriod } from "./crypto-events.ts";

describe("genres d'un mouvement crypto", () => {
  it("chaque genre a son libellé et son explication", () => {
    for (const kind of EVENT_KINDS) {
      expect(EVENT_KIND_INFO[kind].label.length).toBeGreaterThan(2);
      expect(EVENT_KIND_INFO[kind].hint.length).toBeGreaterThan(10);
    }
    expect(new Set(EVENT_KINDS.map((k) => EVENT_KIND_INFO[k].label)).size).toBe(EVENT_KINDS.length);
  });

  it("un genre de la liste est rendu tel quel", () => {
    for (const kind of EVENT_KINDS) expect(kindOf(kind)).toBe(kind);
    expect(kindOf("ACHAT")).toBe("achat");
    expect(kindOf(" Fin-Staking ")).toBe("fin-staking");
  });

  it("les genres écrits en toutes lettres avant la liste fermée sont reconnus", () => {
    expect(kindOf("Achat")).toBe("achat");
    expect(kindOf("Vente")).toBe("vente");
    expect(kindOf("Transfert")).toBe("transfert");
    expect(kindOf("Dépôt fiat")).toBe("depot");
    expect(kindOf("Staking — entrée")).toBe("staking");
    expect(kindOf("Staking — sortie")).toBe("fin-staking");
    expect(kindOf("Staking — récompenses")).toBe("recompense");
    expect(kindOf("Intérêts/lending")).toBe("interets");
    expect(kindOf("Mining")).toBe("minage");
  });

  it("un texte inconnu n'est pas deviné", () => {
    expect(kindOf("Pont entre deux chaînes")).toBeNull();
    expect(kindOf("")).toBeNull();
    expect(kindOf(null)).toBeNull();
    // « Stakingue » n'est pas « staking » : le mot doit être entier.
    expect(kindOf("Stakingue")).toBeNull();
  });
});

describe("cours unitaire d'un mouvement", () => {
  it("le cours noté l'emporte", () => {
    expect(unitPrice({ type: "achat", quantity: 0.02, value: 1050, price: 52000 })).toEqual({ price: 52000, derived: false });
  });

  it("sans cours noté, un achat ou une vente le donne par division", () => {
    expect(unitPrice({ type: "achat", quantity: 0.02, value: 1050 })).toEqual({ price: 52500, derived: true });
    expect(unitPrice({ type: "Vente", quantity: -0.5, value: 900 })).toEqual({ price: 1800, derived: true });
  });

  it("rien à déduire pour un transfert, ni sans quantité ou sans montant", () => {
    expect(unitPrice({ type: "transfert", quantity: 1, value: 1800 })).toBeNull();
    expect(unitPrice({ type: "achat", quantity: null, value: 1050 })).toBeNull();
    expect(unitPrice({ type: "achat", quantity: 0.02, value: null })).toBeNull();
    expect(unitPrice({ type: "achat", quantity: 0, value: 1050 })).toBeNull();
  });
});

describe("titre et période", () => {
  it("le titre proposé réunit le genre, ce qui a bougé et où", () => {
    expect(defaultTitle("Achat", "0,02 BTC", "Coinbase")).toBe("Achat · 0,02 BTC · Coinbase");
    expect(defaultTitle("Transfert", null, " ")).toBe("Transfert");
  });

  it("une période ne finit pas avant de commencer", () => {
    expect(validPeriod("2026-03-01", null)).toBe(true);
    expect(validPeriod("2026-03-01", "2026-03-01")).toBe(true);
    expect(validPeriod("2026-03-01", "2026-12-31")).toBe(true);
    expect(validPeriod("2026-03-01", "2026-02-28")).toBe(false);
  });
});
