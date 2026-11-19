import { describe, expect, it } from "vitest";
import { cleanCardLayout, shownCards } from "./card-layout.ts";
import { HOME_IDS, HOME_QUIET, HOME_TEMPLATES, homeDefault, homeTemplate, homeTemplateOf } from "./home-layout.ts";

describe("modèles de l'accueil du téléphone", () => {
  it("chaque modèle ne pose que des blocs connus, une fois chacun, et garde les autres sous la main", () => {
    for (const m of HOME_TEMPLATES) {
      const layout = homeTemplate(m.id);
      expect(new Set(m.cards).size, m.id).toBe(m.cards.length);
      for (const id of m.cards) expect(HOME_IDS, m.id).toContain(id);
      expect([...layout.order].sort(), m.id).toEqual([...HOME_IDS].sort());
      expect(shownCards(layout), m.id).toEqual([...m.cards]);
      expect(cleanCardLayout(HOME_IDS, HOME_QUIET)(layout), m.id).toEqual(layout);
    }
  });

  it("le quotidien ouvre sur les comptes, ce qui est disponible et dépensé vient juste dessous", () => {
    expect(shownCards(homeTemplate("quotidien")).slice(0, 3)).toEqual(["comptes", "disponible", "depense"]);
  });

  it("reconnaît le modèle qu'un agencement reproduit", () => {
    expect(homeTemplateOf(homeTemplate("budget"))).toBe("budget");
    expect(homeTemplateOf(homeDefault())).toBe("ensemble");
    const moved = homeTemplate("budget");
    moved.hidden = moved.hidden.filter((id) => id !== "comptes");
    expect(homeTemplateOf(moved)).toBeNull();
  });

  it("l'accueil d'origine ne change pas pour un appareil déjà réglé : le bloc né depuis arrive retiré", () => {
    const before = { order: ["comptes", "disponible", "depense", "semaine", "aclasser", "amusant", "resume", "enveloppes", "objectifs", "echeances"], hidden: ["amusant"] };
    const now = cleanCardLayout(HOME_IDS, HOME_QUIET)(before)!;
    expect(shownCards(now)).toEqual(["comptes", "disponible", "depense", "semaine", "aclasser", "resume", "enveloppes", "objectifs", "echeances"]);
    expect(now.hidden).toContain("patrimoine");
    expect(now.hidden).toContain("apercu");
    // L'ancien accueil d'origine, enregistré tel quel, reste la vue d'ensemble.
    expect(homeTemplateOf(cleanCardLayout(HOME_IDS, HOME_QUIET)({ order: HOME_IDS.filter((id) => !HOME_QUIET.includes(id)), hidden: [] })!)).toBe("ensemble");
  });
});
