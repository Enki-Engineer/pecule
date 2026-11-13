import { describe, expect, it } from "vitest";
import { includesHome, netWithHomeDebtShare, splitHypotheses } from "./projections.ts";

const staking = "staking composé : validateur 32 ETH à 3 %/an → ≈ +5 ETH cumulés fin 2031, identique dans tous les scénarios";

describe("splitHypotheses", () => {
  it("sépare le point de départ, le commun et ce qui change", () => {
    const s = splitHypotheses({
      prudent: `Net au 01/09/2026 : 100 000 € · ETH 1 500 $ · BTC 60 k$ · ${staking}`,
      central: `Net au 01/09/2026 : 100 000 € · ETH 4 000 $ · BTC 140 k$ · ${staking}`,
      favorable: `Net au 01/09/2026 : 100 000 € · ETH 8 000 $ · BTC 250 k$ · ${staking} · alts vendus selon le plan de sortie`,
    });
    expect(s.start).toEqual({ date: "01/09/2026", amount: 100000 });
    expect(s.common).toEqual([`S${staking.slice(1)}`]);
    expect(s.specific).toEqual({ prudent: ["ETH 1 500 $", "BTC 60 k$"], central: ["ETH 4 000 $", "BTC 140 k$"], favorable: ["ETH 8 000 $", "BTC 250 k$", "Alts vendus selon le plan de sortie"] });
  });
  it("coupe aussi sur le tiret long", () => {
    const tail = "moins CRD ≈ 57,5 k€ fin 2031 — l'amortissement mécanique ajoute ≈ 19 k€ quoi qu'il arrive";
    const s = splitHypotheses({ prudent: `Net au 01/09/2026 : 93 300 € · valeur 170 k€ (0 %/an) ${tail}`, central: `Net au 01/09/2026 : 93 300 € · valeur 183 k€ (+1,5 %/an) ${tail}` });
    expect(s.common).toEqual(["L'amortissement mécanique ajoute ≈ 19 k€ quoi qu'il arrive"]);
    expect(s.specific.prudent).toEqual(["Valeur 170 k€ (0 %/an) moins CRD ≈ 57,5 k€ fin 2031"]);
  });
  it("hypothèses identiques : tout est commun", () => {
    const h = "Net au 01/09/2026 : 24 300,50 € · 2 à 3 %/an composés, plafond LDDS atteint";
    const s = splitHypotheses({ prudent: h, central: h, favorable: h });
    expect(s.start?.amount).toBe(24300.5);
    expect(s.common).toEqual(["2 à 3 %/an composés, plafond LDDS atteint"]);
    expect(s.specific).toEqual({ prudent: [], central: [], favorable: [] });
  });
  it("un seul scénario renseigné, ou aucun", () => {
    expect(splitHypotheses({ prudent: null, central: "Net au 01/01/2026 : 10 € · stable", favorable: undefined })).toEqual({ start: null, common: [], specific: { prudent: [], central: ["Net au 01/01/2026 : 10 €", "Stable"], favorable: [] } });
    expect(splitHypotheses({ prudent: null, central: null })).toEqual({ start: null, common: [], specific: { prudent: [], central: [] } });
  });
});

describe("projection avec la résidence principale", () => {
  it("reconnaît la poche de la résidence principale", () => {
    expect(includesHome(["Crypto (SwissBorg)", "Résidence principale — Nantes (part 50 %)"])).toBe(true);
    expect(includesHome(["Crypto", "Angers (équity)", "Livrets et AV"])).toBe(false);
  });
  it("compte la dette de la résidence pour la part détenue", () => {
    const assets = [
      { name: "Résidence principale — Nantes", share: 0.5, loanIds: ["nantes-ce", "nantes-ptz"] },
      { name: "Locatif Angers", share: 1, loanIds: ["angers"] },
    ];
    const loans = [
      { id: "nantes-ce", share: 1, summary: { remaining: 20000 } },
      { id: "nantes-ptz", share: 1, summary: { remaining: 84000 } },
      { id: "angers", share: 1, summary: { remaining: 75000 } },
    ];
    // Les prêts de la résidence sont comptés en entier dans le net : on en rend la moitié.
    expect(netWithHomeDebtShare(300000, assets, loans)).toBe(352000);
  });
  it("net inchangé sans résidence principale ou sans prêt rattaché", () => {
    expect(netWithHomeDebtShare(1000, [{ name: "Livret A", share: 1 }], [])).toBe(1000);
    expect(netWithHomeDebtShare(1000, [{ name: "Résidence principale", share: 0.5, loanIds: [] }], [{ id: "x", share: 1, summary: { remaining: 500 } }])).toBe(1000);
  });
});
