import { describe, expect, it } from "vitest";
import { expectedIn, recurringKey, recurringSeries, type RecurringRow } from "./recurring.ts";

const row = (date: string, amount: number, key: string, name = key, kind: "depense" | "revenu" = amount < 0 ? "depense" : "revenu"): RecurringRow => ({ date, amount, key, name, kind, category: null });

const history: RecurringRow[] = [
  // Électricité : chaque mois, le 5, montant stable.
  ...["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((m) => row(`${m}-05`, -70, "energie", "Électricité")),
  // Salaire : chaque mois, fin de mois.
  ...["2026-07", "2026-08", "2026-09", "2026-10"].map((m) => row(`${m}-28`, 2400, "salaire", "Salaire")),
  // Courses : plusieurs fois par mois, ce n'est pas une récurrence mensuelle.
  ...["2026-08", "2026-09", "2026-10"].flatMap((m) => [3, 10, 17, 24].map((d) => row(`${m}-${String(d).padStart(2, "0")}`, -80, "courses"))),
  // Abonnement arrêté en août.
  ...["2026-05", "2026-06", "2026-07", "2026-08"].map((m) => row(`${m}-12`, -9.99, "ancien")),
  // Achat isolé.
  row("2026-10-14", -350, "velo"),
  // Montant trop variable.
  row("2026-08-02", -20, "variable"),
  row("2026-09-02", -95, "variable"),
  row("2026-10-02", -310, "variable"),
];

describe("recurringSeries", () => {
  it("ne garde que ce qui revient une fois par mois, d'un montant stable, et qui vit encore", () => {
    const s = recurringSeries(history, "2026-11");
    expect(s.map((x) => x.name)).toEqual(["Salaire", "Électricité"]);
    expect(s[0]).toMatchObject({ amount: 2400, day: 28, kind: "revenu", lastMonth: "2026-10" });
    expect(s[1]).toMatchObject({ amount: -70, day: 5, kind: "depense", lastMonth: "2026-11" });
  });
});

describe("recurringSeries : paiements au montant fixe", () => {
  const debit = (date: string, amount: number, key: string, name: string, category: string | null = "Crédit immobilier", nature = "prelevement"): RecurringRow => ({ date, amount, key, name, kind: "depense", category, nature });
  const MONTHS = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"];

  it("retrouve une mensualité dont le libellé a changé avec la source", () => {
    const rows = [
      ...["2026-07", "2026-08", "2026-09"].map((m) => debit(`${m}-05`, -384.58, "nom:pret studio angers", "Prêt du studio")),
      ...["2026-10", "2026-11"].map((m) => debit(`${m}-05`, -384.58, "forme:04170 n9", "Crédit immobilier · 04170")),
    ];
    const s = recurringSeries(rows, "2026-11");
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ name: "Crédit immobilier · 04170", amount: -384.58, day: 5, lastMonth: "2026-11", months: 5, nature: "prelevement" });
    // Passée en novembre sous son nouveau libellé : attendue seulement en décembre.
    expect(expectedIn(s, rows, ["2026-11", "2026-12"]).map((e) => `${e.month} ${e.amount}`)).toEqual(["2026-12 -384.58"]);
  });

  it("sépare deux contrats du même créancier", () => {
    const rows = MONTHS.slice(0, 4).flatMap((m) => [debit(`${m}-03`, -60, "nom:energie nantaise", "Énergie nantaise", "Énergie"), debit(`${m}-09`, -70, "nom:energie nantaise", "Énergie nantaise", "Énergie")]);
    const s = recurringSeries(rows, "2026-11");
    expect(s.map((x) => [x.name, x.amount, x.day])).toEqual([
      ["Énergie nantaise", -70, 9],
      ["Énergie nantaise", -60, 3],
    ]);
    // Le contrat à 70 € est passé en novembre : il ne reste que l'autre à attendre.
    const november = [...rows, debit("2026-11-09", -70, "nom:energie nantaise", "Énergie nantaise", "Énergie")];
    expect(expectedIn(recurringSeries(november, "2026-11"), november, ["2026-11"]).map((e) => e.amount)).toEqual([-60]);
  });

  it("ne compte pas deux fois une série déjà reconnue à son libellé", () => {
    const rows = MONTHS.map((m) => debit(`${m}-12`, -23.99, "nom:fibre", "Fibre", "Internet"));
    expect(recurringSeries(rows, "2026-11")).toHaveLength(1);
  });

  it("ne prend pas une coïncidence pour une série", () => {
    const card = (date: string, amount: number, key: string) => debit(date, amount, key, key, "Loisirs", "carte");
    // Trois commerces différents au même prix, par carte.
    expect(recurringSeries([card("2026-08-04", -29, "nom:piscine"), card("2026-09-11", -29, "nom:cinema"), card("2026-10-20", -29, "nom:escalade")], "2026-11")).toEqual([]);
    // Même prix et même catégorie, mais pas le même moyen de paiement.
    expect(recurringSeries([debit("2026-08-04", -29, "nom:a", "A", "Loisirs", "prelevement"), debit("2026-09-04", -29, "nom:b", "B", "Loisirs", "virement"), debit("2026-10-04", -29, "nom:c", "C", "Loisirs", "carte")], "2026-11")).toEqual([]);
    // Un petit montant qui revient parmi d'autres achats au même endroit (un café) : pas un engagement.
    const coffee = ["2026-08", "2026-09", "2026-10"].flatMap((m) => [card(`${m}-02`, -1.8, "nom:cafe du port"), card(`${m}-09`, -14.5 - Number(m.slice(5)), "nom:cafe du port"), card(`${m}-20`, -7.2 - Number(m.slice(5)), "nom:cafe du port")]);
    expect(recurringSeries(coffee, "2026-11")).toEqual([]);
    // Un abonnement par carte parmi d'autres achats chez la même enseigne, lui, est reconnu.
    const mixed = ["2026-08", "2026-09", "2026-10"].flatMap((m) => [card(`${m}-02`, -49.5, "nom:couches et cie"), card(`${m}-09`, -12 - Number(m.slice(5)), "nom:couches et cie"), card(`${m}-20`, -30 - 2 * Number(m.slice(5)), "nom:couches et cie")]);
    expect(recurringSeries(mixed, "2026-11").map((x) => x.amount)).toEqual([-49.5]);
  });
});

describe("expectedIn", () => {
  it("attend chaque série une fois par mois, sauf là où elle est déjà passée", () => {
    const s = recurringSeries(history, "2026-11");
    const e = expectedIn(s, history, ["2026-11", "2026-12"]);
    expect(e.map((x) => `${x.month} ${x.name} ${x.amount}`)).toEqual(["2026-11 Salaire 2400", "2026-12 Salaire 2400", "2026-12 Électricité -70"]);
  });
});

describe("recurringKey", () => {
  it("retire le nom du mois, qui change à chaque passage", () => {
    expect(recurringKey("employeur salaire octobre")).toBe("employeur salaire");
    expect(recurringKey("loyer studio novembre")).toBe("loyer studio");
    expect(recurringKey("mai")).toBe("mai");
    expect(recurringKey("librairie du port")).toBe("librairie du port");
  });
});
