import { describe, expect, it } from "vitest";
import { STARTER_CATEGORIES, STARTER_PRIORITY, STARTER_RULES, STARTER_RULES_BEFORE } from "./starter.ts";
import { followers, insertRank, ownCode, plannedRules, proposals, ruleFor, rulePlan, type KeyState, type OwnCategory, type Rule } from "./starter-proposals.ts";

const starter = (id: string) => STARTER_CATEGORIES.find((c) => c.id === id)!;
/** Foyer installé avant les ajouts : les catégories d'origine, à leur rang. */
const before: OwnCategory[] = STARTER_CATEGORIES.filter((c) => !c.added).map((c, i) => ({ id: c.id, name: c.name, sort_order: i }));
const rank = (own: OwnCategory[], id: string) => own.find((c) => c.id === id)!.sort_order;
/** Règles de départ telles qu'un foyer d'avant les porte. */
const GUARDS = ["totalenergies electricite", "totalenergies power", "totalenergies charging", "totalenergies rechar", "shell recharge", "nespresso", "besson chaussures", "bessonchaussures"];
const oldRules: Rule[] = STARTER_RULES.filter(([p, id]) => !GUARDS.includes(p) && p !== "ev charging" && (!starter(id).added || p in STARTER_RULES_BEFORE)).map(([pattern, id]) => ({ pattern, category_id: STARTER_RULES_BEFORE[pattern] ?? id, priority: STARTER_PRIORITY }));

describe("catégories proposées", () => {
  it("propose à un foyer d'avant toutes les catégories ajoutées, et rien à une installation neuve", () => {
    const added = STARTER_CATEGORIES.filter((c) => c.added);
    expect(added.length).toBeGreaterThan(0);
    expect(proposals(before, {}).map((c) => c.id)).toEqual(added.map((c) => c.id));
    const fresh = STARTER_CATEGORIES.map((c, i) => ({ id: c.id, name: c.name, sort_order: i }));
    expect(proposals(fresh, Object.fromEntries(added.map((c) => [c.id, c.id])))).toEqual([]);
  });
  it("ne repropose pas une catégorie reçue, même renommée, ni une catégorie que le foyer a créée sous ce nom", () => {
    const renamed = [...before, { id: "B2-05", name: "Essence", sort_order: 99 }];
    expect(proposals(renamed, { "B2-05": "B2-05" }).map((c) => c.id)).not.toContain("B2-05");
    const own = [...before, { id: "B2-07", name: "carburant", sort_order: 99 }];
    expect(ownCode(starter("B2-05"), own, {})).toBe("B2-07");
    expect(proposals(own, {}).map((c) => c.id)).not.toContain("B2-05");
  });
  it("ne se fie pas à un code que le foyer a pris pour une catégorie à lui", () => {
    const own = [...before, { id: "B2-05", name: "Vélo", sort_order: 99 }];
    expect(proposals(own, {}).map((c) => c.id)).toContain("B2-05");
  });
  it("repropose une catégorie reçue qui n'existe plus", () => {
    expect(proposals(before, { "B2-05": "B2-05" }).map((c) => c.id)).toContain("B2-05");
  });
});

describe("rang d'une catégorie ajoutée", () => {
  it("se place après celle qui la précède dans le jeu de départ", () => {
    expect(insertRank(starter("B2-05"), before, {})).toBe(rank(before, "B2-04") + 1);
    expect(insertRank(starter("A7"), before, {})).toBe(rank(before, "A6") + 1);
    // Nouveau poste : après le dernier poste de dépenses, avant les mouvements internes.
    expect(insertRank(starter("B13-01"), before, {})).toBe(rank(before, "B12-04") + 1);
    expect(insertRank(starter("B14"), before, {})).toBe(rank(before, "B12-04") + 1);
  });
  it("suit une catégorie ajoutée juste avant elle, où que soit son code", () => {
    const own = [...before.map((c) => (c.sort_order > rank(before, "B2-04") ? { ...c, sort_order: c.sort_order + 1 } : c)), { id: "B2-09", name: "Carburant (essence, gazole)", sort_order: rank(before, "B2-04") + 1 }];
    expect(insertRank(starter("B2-06"), own, { "B2-05": "B2-09" })).toBe(rank(before, "B2-04") + 2);
  });
  it("ne prend pas pour repère une catégorie que le foyer a créée sous le même nom, rangée ailleurs", () => {
    const own = [...before, { id: "B12-05", name: "Tabac", sort_order: rank(before, "C1") }];
    expect(insertRank(starter("B14"), own, {})).toBe(rank(before, "B12-04") + 1);
  });
  it("va à la fin d'un référentiel qui ne doit rien au jeu de départ", () => {
    expect(insertRank(starter("B2-05"), [{ id: "X1", name: "Tout", sort_order: 4 }], {})).toBe(5);
    expect(insertRank(starter("B2-05"), [], {})).toBe(0);
  });
});

describe("règles d'une catégorie ajoutée", () => {
  it("choisit la règle la plus prioritaire, puis le motif le plus long", () => {
    const rules: Rule[] = [
      { pattern: "esso", category_id: "B2-05", priority: 200 },
      { pattern: "nespresso", category_id: "B3-01", priority: 200 },
      { pattern: "esso angers centre", category_id: "B2-04", priority: 100 },
    ];
    expect(ruleFor(rules, "nespresso nantes")?.category_id).toBe("B3-01");
    expect(ruleFor(rules, "esso angers centre ville")?.category_id).toBe("B2-04");
    expect(ruleFor(rules, "esso angers")?.category_id).toBe("B2-05");
    expect(ruleFor(rules, "boulangerie")).toBeNull();
  });
  it("ajoute les motifs absents et déplace ceux que le foyer porte encore tels quels", () => {
    const plan = rulePlan("B2-05", oldRules);
    expect(plan.move.sort()).toEqual(["esso", "station service", "totalenergies"]);
    expect(plan.add).toContain("shell");
    const after = plannedRules(oldRules, plan, "B2-05");
    expect(after.find((r) => r.pattern === "totalenergies")?.category_id).toBe("B2-05");
    expect(after.find((r) => r.pattern === "shell")).toEqual({ pattern: "shell", category_id: "B2-05", priority: STARTER_PRIORITY });
    expect(after.find((r) => r.pattern === "sncf")?.category_id).toBe("B2-04");
  });
  it("laisse un motif que le foyer a repris à son compte", () => {
    const rules = oldRules.map((r) => (r.pattern === "esso" ? { ...r, category_id: "B3-01" } : r.pattern === "totalenergies" ? { ...r, priority: 100 } : r));
    const plan = rulePlan("B2-05", rules);
    expect(plan.move).toEqual(["station service"]);
    expect(plan.add).not.toContain("esso");
    expect(plan.add).not.toContain("totalenergies");
  });
  it("amène les règles de départ plus précises que les siennes, si le foyer a leur catégorie", () => {
    // « nespresso » contient « esso », le fournisseur d'électricité porte le nom des stations : sans elles, tout suivrait en carburant.
    const guard = rulePlan("B2-05", oldRules).guard;
    expect(guard.map(([p]) => p).sort()).toEqual([...GUARDS].sort());
    expect(new Map(guard).get("nespresso")).toBe("B3-01");
    expect(new Map(guard).get("totalenergies electricite")).toBe("B1-03");
    expect(new Map(rulePlan("B2-05", oldRules, (id) => (id === "B3-01" ? "X7" : id)).guard).get("nespresso")).toBe("X7");
    expect(rulePlan("B2-05", oldRules, () => null).guard).toEqual([]);
    expect(rulePlan("B2-05", [...oldRules, { pattern: "nespresso", category_id: "B12-02", priority: 100 }]).guard.map(([p]) => p)).not.toContain("nespresso");
    expect(rulePlan("B13-01", oldRules).guard).toEqual([]);
    const after = plannedRules(oldRules, rulePlan("B2-05", oldRules), "B2-05");
    expect(ruleFor(after, "nespresso nantes")?.category_id).toBe("B3-01");
    expect(ruleFor(after, "totalenergies electricite et gaz")?.category_id).toBe("B1-03");
    expect(ruleFor(after, "totalenergies angers")?.category_id).toBe("B2-05");
    const states = [
      { label_key: "nespresso nantes", category_id: "B2-04", category_source: "regle", n: 3 },
      { label_key: "totalenergies electricite et gaz", category_id: "B2-04", category_source: "regle", n: 12 },
    ];
    expect(followers(states, oldRules, after, "B2-05")).toEqual([]);
  });
  it("donne à la règle le code que la catégorie a chez le foyer", () => {
    const plan = rulePlan("B2-05", oldRules);
    expect(plannedRules(oldRules, plan, "B2-09").filter((r) => r.category_id === "B2-09").length).toBe(plan.add.length + plan.move.length);
  });
});

describe("opérations qui suivent une catégorie ajoutée", () => {
  const plan = rulePlan("B2-05", oldRules);
  const after = plannedRules(oldRules, plan, "B2-05");
  const state = (label_key: string, category_id: string | null, category_source: string | null, n = 1): KeyState => ({ label_key, category_id, category_source, n });
  it("prend ce que la règle d'avant avait classé, et ce qui était resté sans catégorie faute de règle", () => {
    const states = [state("totalenergies nantes", "B2-04", "regle", 6), state("shell angers", null, null, 2)];
    expect(followers(states, oldRules, after, "B2-05")).toEqual(states);
  });
  it("laisse un classement fait à la main, par une facture ou par un libellé déjà vu", () => {
    const states = [state("totalenergies nantes", "B2-04", "manuel"), state("totalenergies nantes", "B2-04", "auto"), state("totalenergies nantes", "B2-03", "regle"), state("esso angers", "B12-02", "facture")];
    expect(followers(states, oldRules, after, "B2-05")).toEqual([]);
  });
  it("laisse une opération qu'une règle du foyer classe ailleurs, ou que le membre a remise sans catégorie", () => {
    const own: Rule[] = [...oldRules, { pattern: "totalenergies rechar", category_id: "B2-03", priority: 100 }];
    const states = [state("totalenergies rechar nantes", "B2-03", "regle"), state("totalenergies nantes", null, null), state("sncf connect", "B2-04", "regle")];
    expect(followers(states, own, plannedRules(own, rulePlan("B2-05", own), "B2-05"), "B2-05")).toEqual([]);
  });
});
