import { describe, expect, it } from "vitest";
import { cleanCardLayout, hideCard, reorderShown, showCard, shownCards } from "./card-layout.ts";

const ALL = ["a", "b", "c", "d"] as const;
const clean = cleanCardLayout(ALL);

describe("cleanCardLayout", () => {
  it("garde l'ordre choisi, sans inconnu ni doublon", () => {
    expect(clean({ order: ["c", "zz", "a", "c", "b", "d"], hidden: ["b", "b", "yy"] })).toEqual({ order: ["c", "a", "b", "d"], hidden: ["b"] });
  });

  it("un bloc né depuis se range après celui qui le précède à l'origine, visible", () => {
    expect(clean({ order: ["d", "a"], hidden: [] })).toEqual({ order: ["d", "a", "b", "c"], hidden: [] });
    expect(clean({ order: ["b", "c", "d"], hidden: [] })!.order).toEqual(["a", "b", "c", "d"]);
  });

  it("refuse ce qui n'est pas un réglage", () => {
    for (const raw of [null, 3, "x", [], {}, { order: [] }, { kpis: [], cards: [] }]) expect(clean(raw)).toBeNull();
  });
});

describe("blocs affichés", () => {
  const layout = { order: ["a", "b", "c", "d"] as ("a" | "b" | "c" | "d")[], hidden: ["c"] as ("a" | "b" | "c" | "d")[] };

  it("liste ce qu'on voit, dans l'ordre", () => {
    expect(shownCards(layout)).toEqual(["a", "b", "d"]);
  });

  it("réordonne ce qu'on voit sans perdre ce qui est retiré", () => {
    expect(reorderShown(layout, ["d", "a", "b"])).toEqual({ order: ["d", "a", "b", "c"], hidden: ["c"] });
  });

  it("retire un bloc, une seule fois", () => {
    expect(hideCard(layout, "a").hidden).toEqual(["c", "a"]);
    expect(hideCard(layout, "c")).toBe(layout);
  });

  it("remet un bloc à la fin de ceux qu'on voit", () => {
    const two = hideCard(layout, "a");
    expect(showCard(two, "c")).toEqual({ order: ["b", "d", "c", "a"], hidden: ["a"] });
    expect(shownCards(showCard(two, "c"))).toEqual(["b", "d", "c"]);
  });
});
