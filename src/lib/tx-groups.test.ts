import { describe, expect, it } from "vitest";
import { balanceOf, defaultSince, groupByMonth, isInternal, olderYear, posteSlot, sumMonths } from "./tx-groups.ts";

const row = (id: string, date: string) => ({ id, date });

describe("groupByMonth", () => {
  it("range les opérations par mois, puis par jour, sans changer leur ordre", () => {
    const groups = groupByMonth([row("a", "2026-11-12"), row("b", "2026-11-12"), row("c", "2026-11-03"), row("d", "2026-10-28"), row("e", "2025-10-28")]);
    expect(groups.map((g) => [g.month, g.count])).toEqual([
      ["2026-11", 3],
      ["2026-10", 1],
      ["2025-10", 1],
    ]);
    expect(groups[0].days.map((d) => [d.day, d.items.map((t) => t.id)])).toEqual([
      ["2026-11-12", ["a", "b"]],
      ["2026-11-03", ["c"]],
    ]);
  });

  it("suit aussi un tri du plus ancien au plus récent", () => {
    expect(groupByMonth([row("a", "2026-10-28"), row("b", "2026-11-03")]).map((g) => g.month)).toEqual(["2026-10", "2026-11"]);
  });

  it("rend une liste vide pour une liste vide", () => {
    expect(groupByMonth([])).toEqual([]);
  });
});

describe("bilan d'un mois", () => {
  const nov = { count: 40, uncategorized: 2, revenus: 3200.1, depenses: 1980.35, epargne: 300 };
  const oct = { count: 52, uncategorized: 0, revenus: 3100, depenses: 3400.2, epargne: 0 };

  it("le solde est revenus moins dépenses, l'épargne n'en est pas retirée", () => {
    expect(balanceOf(nov)).toBe(1219.75);
    expect(balanceOf(oct)).toBe(-300.2);
  });

  it("réunit plusieurs mois", () => {
    expect(sumMonths([nov, oct])).toEqual({ count: 92, uncategorized: 2, revenus: 6300.1, depenses: 5380.55, epargne: 300 });
    expect(sumMonths([])).toEqual({ count: 0, uncategorized: 0, revenus: 0, depenses: 0, epargne: 0 });
  });
});

describe("posteSlot", () => {
  const colored = ["Logement", "Alimentation", "Transports"];
  it("donne au poste d'une dépense son rang de couleur", () => {
    expect(posteSlot(colored, { category_poste: "Alimentation", category_kind: "depense" })).toBe(2);
  });
  it("ne colore ni un poste hors de la liste, ni un revenu, ni une ligne sans catégorie", () => {
    expect(posteSlot(colored, { category_poste: "Loisirs", category_kind: "depense" })).toBeNull();
    expect(posteSlot(colored, { category_poste: "Alimentation", category_kind: "revenu" })).toBeNull();
    expect(posteSlot(colored, { category_poste: null, category_kind: null })).toBeNull();
    expect(posteSlot(undefined, { category_poste: "Logement", category_kind: "depense" })).toBeNull();
  });
});

describe("isInternal", () => {
  it("reconnaît un mouvement entre comptes du foyer à sa catégorie", () => {
    expect(isInternal({ category_kind: "interne" })).toBe(true);
    expect(isInternal({ category_kind: "epargne" })).toBe(false);
    expect(isInternal({ category_kind: null })).toBe(false);
  });
});

describe("années affichées", () => {
  const months = ["2026-11", "2026-10", "2026-01", "2025-12", "2025-03", "2023-06"];

  it("affiche d'office l'année du mois le plus récent", () => {
    expect(defaultSince(months, [])).toBe("2026");
    expect(defaultSince(months, ["2026-11", "2026-10"])).toBe("2026");
    expect(defaultSince([], [])).toBeNull();
  });

  it("remonte jusqu'à l'année du plus vieux mois déjà chargé", () => {
    expect(defaultSince(months, ["2026-11", "2025-12"])).toBe("2025");
    expect(defaultSince(months, new Set(["2023-06", "2026-10"]))).toBe("2023");
  });

  it("propose l'année précédente qui a des opérations, avec leur nombre", () => {
    const counted = months.map((month, i) => ({ month, count: 10 * (i + 1) }));
    expect(olderYear(counted, "2026")).toEqual({ year: "2025", count: 90 });
    expect(olderYear(counted, "2025")).toEqual({ year: "2023", count: 60 });
    expect(olderYear(counted, "2023")).toBeNull();
  });
});
