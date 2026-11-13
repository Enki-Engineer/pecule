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
