import { describe, expect, it } from "vitest";
import { accountRule, addDays, cleanBalanceRule, DEFAULT_BALANCE_RULE, firstLow, lowestPoint, projectBalance, type Movement } from "./balance.ts";

const today = "2026-11-15";
const moves: Movement[] = [
  { date: "2026-11-12", amount: -78, name: "Impôt", source: "recurrence", late: true },
  { date: "2026-11-19", amount: -36, name: "Box", source: "recurrence" },
  { date: "2026-11-19", amount: -16, name: "Forfait", source: "recurrence" },
  { date: "2026-11-27", amount: 3871, name: "Salaire", source: "recurrence" },
  { date: "2026-12-05", amount: -1129, name: "Prêt", source: "recurrence" },
  { date: "2026-12-01", amount: -640, name: "Carte", source: "carte" },
];

describe("règle de solde bas", () => {
  it("garde ce qui tient debout et complète le reste", () => {
    expect(cleanBalanceRule(null)).toEqual(DEFAULT_BALANCE_RULE);
    expect(cleanBalanceRule({ threshold: 500.004, days: 14, enabled: false })).toEqual({ enabled: false, threshold: 500, days: 14, accounts: {} });
    expect(cleanBalanceRule({ threshold: "200", days: 0 }).threshold).toBe(200);
    expect(cleanBalanceRule({ days: 45 }).days).toBe(7);
    // Un seuil négatif est permis : prévenir avant la limite d'un découvert autorisé.
    expect(cleanBalanceRule({ threshold: -300 }).threshold).toBe(-300);
  });

  it("ne garde d'un compte que ce qui diffère de la règle", () => {
    const rule = cleanBalanceRule({ accounts: { a: { watch: false }, b: { threshold: 50 }, c: { watch: true }, d: null } });
    expect(rule.accounts).toEqual({ a: { watch: false }, b: { threshold: 50 } });
    expect(accountRule(rule, "a")).toEqual({ watched: false, threshold: 200 });
    expect(accountRule(rule, "b")).toEqual({ watched: true, threshold: 50 });
    expect(accountRule(rule, "zzz")).toEqual({ watched: true, threshold: 200 });
    expect(accountRule({ ...rule, enabled: false }, "b").watched).toBe(false);
  });

  it("repart de la règle en place quand on ne change qu'un réglage", () => {
    const base = cleanBalanceRule({ threshold: 300, days: 14, accounts: { a: { watch: false } } });
    expect(cleanBalanceRule({ days: 3 }, base)).toEqual({ ...base, days: 3 });
  });
});

describe("prévision du solde", () => {
  it("avance jour par jour et compte dès aujourd'hui ce qui est en retard", () => {
    const points = projectBalance(400, moves, today, 7);
    expect(points).toHaveLength(8);
    expect(points[0]).toEqual({ date: today, balance: 322 });
    expect(points[4]).toEqual({ date: "2026-11-19", balance: 270 });
    expect(points.at(-1)).toEqual({ date: "2026-11-22", balance: 270 });
  });

  it("ignore ce qui tombe après la fenêtre", () => {
    expect(projectBalance(400, moves, today, 7).some((p) => p.balance > 400)).toBe(false);
    expect(projectBalance(400, moves, today, 12).at(-1)!.balance).toBe(4141);
  });

  it("trouve le premier jour sous le seuil et ce qui l'y fait passer", () => {
    const points = projectBalance(240, moves, today, 7);
    expect(firstLow(points, moves, 200)).toEqual({ date: today, balance: 162, cause: moves[0] });
    const later = projectBalance(300, moves, today, 7);
    expect(firstLow(later, moves, 200)).toEqual({ date: "2026-11-19", balance: 170, cause: moves[1] });
    expect(firstLow(projectBalance(900, moves, today, 7), moves, 200)).toBeNull();
  });

  it("donne le point le plus bas de la fenêtre", () => {
    expect(lowestPoint(projectBalance(900, moves, today, 30))).toEqual({ date: "2026-11-19", balance: 770 });
    expect(lowestPoint([])).toBeNull();
  });

  it("additionne les jours d'un mois à l'autre", () => {
    expect(addDays("2026-11-28", 5)).toBe("2026-12-03");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});
