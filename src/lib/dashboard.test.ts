import { describe, expect, it } from "vitest";
import { DASH_CARDS, DASH_KPIS, DASH_TEMPLATES, cleanLayout, defaultLayout, formOf, fromLegacy, hasForms, missingCards, missingKpis, moveItem, rowsOf, sameLayout, templateLayout, templateOf, widthsOf } from "./dashboard.ts";

describe("modèles du tableau de bord", () => {
  it("chaque modèle ne pose que des cartes et des chiffres connus, une fois, à une largeur permise", () => {
    for (const m of DASH_TEMPLATES) {
      const layout = templateLayout(m.id);
      expect(cleanLayout(layout), m.id).toEqual(layout);
      expect(new Set(layout.cards.map((c) => c.id)).size, m.id).toBe(layout.cards.length);
      for (const c of layout.cards) expect(widthsOf(c.id), `${m.id} · ${c.id}`).toContain(c.w);
    }
  });

  it("chaque modèle remplit ses rangées : aucun trou dans la grille", () => {
    for (const m of DASH_TEMPLATES) for (const row of rowsOf(templateLayout(m.id).cards)) expect(row.reduce((s, c) => s + c.w, 0), `${m.id} · ${row.map((c) => c.id).join(" + ")}`).toBe(12);
  });

  it("un modèle tient en peu de cartes : dix au plus, cinq pour l'essentiel", () => {
    for (const m of DASH_TEMPLATES) expect(m.cards.length, m.id).toBeLessThanOrEqual(10);
    expect(templateLayout("essentiel").cards).toHaveLength(5);
    expect(templateLayout("essentiel").kpis).toHaveLength(4);
  });

  it("un modèle ne donne une forme qu'aux cartes qui en ont deux", () => {
    for (const m of DASH_TEMPLATES) for (const c of templateLayout(m.id).cards) if (c.f) expect(hasForms(c.id), `${m.id} · ${c.id}`).toBe(true);
  });

  it("seul le quotidien détaille les comptes ; ailleurs ils se résument", () => {
    for (const m of DASH_TEMPLATES) {
      const comptes = templateLayout(m.id).cards.find((c) => c.id === "comptes");
      if (comptes) expect(formOf(comptes), m.id).toBe(m.id === "quotidien" ? "detail" : "essentiel");
    }
  });

  it("la largeur d'origine d'une carte est une largeur permise", () => {
    for (const c of DASH_CARDS) expect(widthsOf(c.id), c.id).toContain(c.w);
  });

  it("reconnaît le modèle qu'un agencement reproduit", () => {
    expect(templateOf(templateLayout("budget"))).toBe("budget");
    const changed = templateLayout("budget");
    changed.cards[0].w = 8;
    expect(templateOf(changed)).toBeNull();
  });
});

describe("cleanLayout", () => {
  it("écarte ce que cette version ne connaît pas et les doublons", () => {
    expect(
      cleanLayout({
        kpis: ["solde", "inconnu", "solde", 3],
        cards: [{ id: "comptes", w: 8 }, { id: "disparue", w: 4 }, { id: "comptes", w: 4 }, null, { id: "postes", w: 6 }],
      }),
    ).toEqual({ kpis: ["solde"], cards: [{ id: "comptes", w: 8 }, { id: "postes", w: 6 }] });
  });

  it("ramène une largeur trop étroite à la plus petite permise, une largeur inconnue à celle d'origine", () => {
    expect(cleanLayout({ kpis: [], cards: [{ id: "semaine", w: 4 }, { id: "evolution", w: 5 }, { id: "postes" }] })).toEqual({
      kpis: [],
      cards: [{ id: "semaine", w: 8 }, { id: "evolution", w: 8 }, { id: "postes", w: 4 }],
    });
  });

  it("garde la forme choisie d'une carte qui en a deux, et l'écarte ailleurs", () => {
    expect(cleanLayout({ kpis: [], cards: [{ id: "comptes", w: 4, f: "essentiel" }, { id: "postes", w: 4, f: "detail" }, { id: "evolution", w: 8, f: "detail" }, { id: "echeances", w: 4, f: "zzz" }] })).toEqual({
      kpis: [],
      cards: [{ id: "comptes", w: 4, f: "essentiel" }, { id: "postes", w: 4, f: "detail" }, { id: "evolution", w: 8 }, { id: "echeances", w: 4 }],
    });
  });

  it("garde un tableau de bord vidé par le membre", () => {
    expect(cleanLayout({ kpis: [], cards: [] })).toEqual({ kpis: [], cards: [] });
  });

  it("refuse ce qui n'est pas un agencement", () => {
    for (const raw of [null, "x", 3, [], {}, { kpis: [] }, { order: [], hidden: [] }]) expect(cleanLayout(raw)).toBeNull();
  });
});

describe("fromLegacy", () => {
  it("reprend l'ordre choisi sur l'ancien écran, sans les blocs masqués", () => {
    const layout = fromLegacy({ order: ["comptes", "operations", "evolution", "atraiter", "semaine", "natures", "amusant", "resume", "enveloppes", "objectifs", "echeances", "postes", "repartition"], hidden: ["amusant", "resume"] })!;
    expect(layout.cards.map((c) => c.id)).toEqual(["comptes", "operations", "evolution", "atraiter", "semaine", "natures", "enveloppes", "objectifs", "echeances", "postes", "repartition"]);
    expect(layout.cards.find((c) => c.id === "operations")!.w).toBe(8);
    expect(layout.kpis).toEqual(defaultLayout().kpis);
  });

  it("un bloc absent de l'ancien réglage se range après celui qui le précédait à l'origine", () => {
    const layout = fromLegacy({ order: ["atraiter", "evolution"], hidden: [] })!;
    expect(layout.cards.map((c) => c.id).slice(0, 3)).toEqual(["atraiter", "semaine", "natures"]);
    expect(layout.cards.at(-1)!.id).toBe("evolution");
    expect(layout.cards).toHaveLength(DASH_CARDS.length);
  });

  it("refuse ce qui n'est pas un ancien réglage", () => {
    expect(fromLegacy(null)).toBeNull();
    expect(fromLegacy({ kpis: [], cards: [] })).toBeNull();
  });
});

describe("outils", () => {
  it("moveItem déplace sans perdre ni dupliquer", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(moveItem(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("ce qui manque à un agencement est ce que le tiroir propose", () => {
    const layout = templateLayout("quotidien");
    expect(missingCards(layout)).toHaveLength(DASH_CARDS.length - layout.cards.length);
    expect(missingKpis(layout)).toHaveLength(DASH_KPIS.length - layout.kpis.length);
    expect(missingCards(layout)).not.toContain("comptes");
  });

  it("rowsOf passe à la rangée suivante quand la carte ne tient plus", () => {
    expect(rowsOf([{ id: "evolution", w: 8 }, { id: "operations", w: 8 }, { id: "postes", w: 4 }]).map((r) => r.map((c) => c.id))).toEqual([["evolution"], ["operations", "postes"]]);
    expect(rowsOf([])).toEqual([]);
  });

  it("une carte sans forme choisie prend sa forme d'origine ; une carte à une seule forme n'en a pas", () => {
    expect(formOf({ id: "comptes", w: 4 })).toBe("detail");
    expect(formOf({ id: "postes", w: 4 })).toBe("essentiel");
    expect(formOf({ id: "postes", w: 4, f: "detail" })).toBe("detail");
    expect(formOf({ id: "evolution", w: 8 })).toBeNull();
  });

  it("changer la forme d'une carte, c'est changer l'agencement", () => {
    const a = templateLayout("essentiel");
    const b = templateLayout("essentiel");
    b.cards = b.cards.map((c) => (c.id === "comptes" ? { ...c, f: "detail" as const } : c));
    expect(sameLayout(a, b)).toBe(false);
    // La forme d'origine, écrite ou non, c'est la même chose.
    expect(sameLayout({ kpis: [], cards: [{ id: "postes", w: 4 }] }, { kpis: [], cards: [{ id: "postes", w: 4, f: "essentiel" }] })).toBe(true);
  });

  it("sameLayout compare l'ordre et les largeurs", () => {
    expect(sameLayout(templateLayout("budget"), templateLayout("budget"))).toBe(true);
    expect(sameLayout(templateLayout("budget"), templateLayout("quotidien"))).toBe(false);
  });
});
