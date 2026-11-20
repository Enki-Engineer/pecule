import { describe, expect, it } from "vitest";
import { groupLabels, preselected, ruleWorthy } from "./classify.ts";

describe("classement en lot", () => {
  const row = (id: string, label_key: string | null, amount: number, date: string, label = `LIBELLÉ ${id}`) => ({ id, label, label_key, amount, date });

  it("réunit les opérations par libellé et par sens, les groupes les plus fréquents d'abord", () => {
    const g = groupLabels([row("a", "boulangerie du centre", -4.2, "2025-03-01"), row("b", "boulangerie du centre", -6.1, "2025-03-09", "CARTE BOULANGERIE"), row("c", "boulangerie du centre", -5, "2025-03-04"), row("d", "librairie", -30, "2025-03-02"), row("e", "librairie", 30, "2025-03-05"), row("f", null, -1, "2025-03-05")]);
    expect(g.map((x) => [x.key, x.credit, x.count])).toEqual([
      ["boulangerie du centre", false, 3],
      ["librairie", false, 1],
      ["librairie", true, 1],
    ]);
    expect(g[0]).toMatchObject({ label: "CARTE BOULANGERIE", last: "2025-03-09", total: -15.3, typical: -5, ids: ["a", "b", "c"] });
  });

  it("à nombre égal, le plus gros montant d'abord", () => {
    expect(groupLabels([row("a", "eau", -40, "2025-01-01"), row("b", "loyer", -800, "2025-01-01")]).map((x) => x.key)).toEqual(["loyer", "eau"]);
  });

  it("ne fait pas une règle d'une clé trop courte ou sans mot", () => {
    expect(ruleWorthy("cheque n")).toBe(false);
    expect(ruleWorthy("a b c d e f g h")).toBe(false);
    expect(ruleWorthy("boulangerie du centre")).toBe(true);
    expect(ruleWorthy("vers livret a")).toBe(true);
  });

  it("ne coche d'office ni une supposition ni une absence de catégorie", () => {
    expect(preselected({ categoryId: "B2", confidence: "haute" })).toBe(true);
    expect(preselected({ categoryId: "B2", confidence: "moyenne" })).toBe(true);
    expect(preselected({ categoryId: "B2", confidence: "basse" })).toBe(false);
    expect(preselected({ categoryId: null, confidence: "haute" })).toBe(false);
  });
});
