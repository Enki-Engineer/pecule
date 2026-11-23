import { describe, expect, it } from "vitest";
import { accountRule, addDays, cardDebitTargets, cleanBalanceRule, DEFAULT_BALANCE_RULE, firstLow, lowestPoint, pastBalances, projectBalance, SERIES_LEAD_DAYS, type Movement } from "./balance.ts";

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

describe("compte prélevé d'une carte à débit différé", () => {
  const statement = (account_id: string, date: string, amount: number, label = "Relevé différé Carte 4974********0000") => ({ account_id, date, amount, label });
  const total = (account_id: string, date: string, t: number) => ({ account_id, date, total: t });

  it("reconnaît le relevé qui porte les derniers chiffres de la carte", () => {
    const got = cardDebitTargets([{ accountId: "carte", tail: "4821" }], [statement("commun", "2026-11-02", -310.2, "Relevé différé Carte 4974********4821")], []);
    expect([...got]).toEqual([["carte", "commun"]]);
  });

  it("sans chiffres communs, reconnaît le relevé à son montant : ce que la carte a fait prélever ce jour-là", () => {
    const got = cardDebitTargets(
      [
        { accountId: "carte-alex", tail: "9001" },
        { accountId: "carte-camille", tail: "9002" },
      ],
      [statement("commun", "2026-11-02", -310.2), statement("courant", "2026-11-02", -84.5), statement("commun", "2026-10-01", -120)],
      [total("carte-alex", "2026-12-01", -42), total("carte-alex", "2026-11-02", -84.5), total("carte-camille", "2026-11-01", -310.2)],
    );
    expect(Object.fromEntries(got)).toEqual({ "carte-alex": "courant", "carte-camille": "commun" });
  });

  it("remonte à un relevé plus ancien quand le dernier ne désigne personne", () => {
    const got = cardDebitTargets([{ accountId: "carte", tail: null }], [statement("commun", "2026-10-01", -120)], [total("carte", "2026-11-02", -75.3), total("carte", "2026-10-01", -120)]);
    expect(got.get("carte")).toBe("commun");
  });

  it("ne désigne aucun compte quand deux comptes ou deux cartes se disputent le montant", () => {
    const twoAccounts = cardDebitTargets([{ accountId: "carte", tail: null }], [statement("commun", "2026-11-02", -50), statement("courant", "2026-11-02", -50)], [total("carte", "2026-11-02", -50)]);
    expect(twoAccounts.size).toBe(0);
    const twoCards = cardDebitTargets(
      [
        { accountId: "a", tail: null },
        { accountId: "b", tail: null },
      ],
      [statement("commun", "2026-11-02", -50)],
      [total("a", "2026-11-02", -50), total("b", "2026-11-02", -50)],
    );
    expect(twoCards.size).toBe(0);
  });

  it("ne confond ni un relevé trop éloigné du jour de prélèvement, ni un prélèvement qui n'est pas un relevé de carte", () => {
    expect(cardDebitTargets([{ accountId: "carte", tail: null }], [statement("commun", "2026-11-12", -50)], [total("carte", "2026-11-02", -50)]).size).toBe(0);
    expect(cardDebitTargets([{ accountId: "carte", tail: null }], [statement("commun", "2026-11-02", -50, "Relevé de charges de copropriété")], [total("carte", "2026-11-02", -50)]).size).toBe(0);
  });
});

describe("soldes passés", () => {
  const row = (account_id: string, date: string, balance: number) => ({ account_id, date, balance });

  it("rend un point par jour, du jour J − n au jour J, chaque compte gardant son dernier solde connu", () => {
    const points = pastBalances([row("courant", "2026-11-10", 1000), row("livret", "2026-11-12", 500.004), row("courant", "2026-11-14", 800)], today, 7);
    expect(points.map((p) => p.date)).toEqual(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
    expect(points.map((p) => p.balance)).toEqual([1000, 1000, 1500, 1500, 1300, 1300]);
  });

  it("compte toujours le même nombre de points pour un même jour", () => {
    const rows = [row("courant", addDays(today, -200), 10)];
    expect(pastBalances(rows, today, 90)).toHaveLength(0);
    const known = [row("courant", addDays(today, -100), 10)];
    expect(pastBalances(known, today, 90)).toHaveLength(91);
    expect(pastBalances(known, today, 90)[0]).toEqual({ date: addDays(today, -90), balance: 10 });
    expect(pastBalances(known, today, 90).at(-1)).toEqual({ date: today, balance: 10 });
  });

  it("reprend un solde connu pendant les jours d'élan, pas au-delà, et ignore ce qui est daté après le jour J", () => {
    const edge = [row("ancien", addDays(today, -(7 + SERIES_LEAD_DAYS)), 40), row("oublié", addDays(today, -(8 + SERIES_LEAD_DAYS)), 999), row("courant", addDays(today, 1), 5000)];
    const points = pastBalances(edge, today, 7);
    expect(points).toHaveLength(8);
    expect(new Set(points.map((p) => p.balance))).toEqual(new Set([40]));
  });

  it("lit le jour d'un solde quelle que soit la forme de sa date", () => {
    expect(pastBalances([row("courant", "2026-11-15T00:00:00.000Z", 12.5)], today, 7)).toEqual([{ date: today, balance: 12.5 }]);
  });
});
