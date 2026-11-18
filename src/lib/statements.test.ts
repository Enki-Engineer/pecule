import { describe, expect, it } from "vitest";
import { balanceGap, coverage, sameAccount, suspects, tailKey } from "./statements.ts";

describe("même compte", () => {
  it("ramène un numéro lu à ses quatre derniers caractères", () => {
    expect(tailKey("8 21")).toBe("821");
    expect(tailKey("000123448 21")).toBe("4821");
    expect(tailKey("•••• 77a2")).toBe("77A2");
    expect(tailKey("")).toBeNull();
    expect(tailKey(null)).toBeNull();
  });

  it("reconnaît le même compte à son numéro, quelle que soit l'écriture de l'intitulé", () => {
    expect(sameAccount({ bank: "Banque de l'Estuaire", label: "Compte courant", tail: "4821" }, { bank: "BANQUE DE L’ESTUAIRE", label: "Compte de dépôt", tail: "48 21" })).toBe(true);
    expect(sameAccount({ bank: "Banque de l'Estuaire", label: "Compte courant", tail: "4821" }, { bank: null, label: "Compte courant", tail: "4821" })).toBe(true);
    expect(sameAccount({ bank: "Banque de l'Estuaire", label: "Compte courant", tail: "4821" }, { bank: "Caisse du Maine", label: "Compte courant", tail: "4821" })).toBe(false);
    expect(sameAccount({ bank: "Banque de l'Estuaire", label: "Compte courant", tail: "4821" }, { bank: "Banque de l'Estuaire", label: "Livret A", tail: "7702" })).toBe(false);
  });

  it("sans numéro, demande la même banque et le même intitulé", () => {
    expect(sameAccount({ bank: "Banque de l'Estuaire", label: "Livret A", tail: null }, { bank: "Banque de l'estuaire", label: "LIVRET A", tail: null })).toBe(true);
    expect(sameAccount({ bank: "Banque de l'Estuaire", label: "Livret A", tail: null }, { bank: "Banque de l'Estuaire", label: "Livret A", tail: "7702" })).toBe(false);
    expect(sameAccount({ bank: null, label: "Livret A", tail: null }, { bank: null, label: "Livret A", tail: null })).toBe(false);
  });
});

describe("relevé qui ne tombe pas juste", () => {
  const ops = [{ amount: 2450 }, { amount: -20.1 }, { amount: -64.9 }];

  it("mesure l'écart au centime", () => {
    expect(balanceGap(100, 2465, ops)).toBe(0);
    expect(balanceGap(100, 2400.1, ops)).toBe(-64.9);
    expect(balanceGap(null, 2465, ops)).toBeNull();
    // Des dixièmes qui ne se représentent pas en binaire ne créent pas d'écart.
    expect(balanceGap(0.1, 0.3, [{ amount: 0.2 }])).toBe(0);
  });

  it("désigne le signe inversé ou la ligne en trop qui expliquerait l'écart", () => {
    // « −20,10 » lu « +20,10 » : le solde calculé dépasse le solde imprimé de 40,20.
    const flipped = [{ amount: 2450 }, { amount: 20.1 }, { amount: -64.9 }];
    expect(suspects(flipped, balanceGap(100, 2465, flipped))).toEqual([{ index: 1, why: "signe" }]);
    const extra = [...ops, { amount: -998.42 }];
    expect(suspects(extra, balanceGap(100, 2465, extra))).toEqual([{ index: 3, why: "en_trop" }]);
    expect(suspects(ops, 0)).toEqual([]);
    expect(suspects(ops, null)).toEqual([]);
    // Une opération manquante ne désigne aucune ligne.
    expect(suspects(ops.slice(0, 2), balanceGap(100, 2465, ops.slice(0, 2)))).toEqual([]);
  });

  it("ne désigne personne quand trop de lignes conviendraient", () => {
    const many = Array.from({ length: 8 }, () => ({ amount: -5 }));
    expect(suspects(many, 5)).toEqual([]);
  });
});

describe("série de relevés", () => {
  const month = (id: number, m: number, opening: number, closing: number) => ({ id, start: `2025-${String(m).padStart(2, "0")}-01`, end: new Date(Date.UTC(2025, m, 0)).toISOString().slice(0, 10), opening, closing, operations: 10 });

  it("est complète quand les soldes s'enchaînent", () => {
    const c = coverage([month(2, 2, 150, 90), month(1, 1, 100, 150), month(3, 3, 90, 300)]);
    expect(c).toMatchObject({ statements: 3, operations: 30, from: "2025-01-01", to: "2025-03-31", gaps: [], breaks: [], undated: 0 });
  });

  it("nomme la période sans relevé", () => {
    const c = coverage([month(1, 1, 100, 150), month(3, 3, 90, 300), month(4, 4, 300, 280)]);
    expect(c.gaps).toEqual([{ from: "2025-02-01", to: "2025-02-28" }]);
    expect(c.breaks).toEqual([]);
  });

  it("ne voit pas de trou entre deux relevés éloignés dont les soldes s'enchaînent (un livret sans mouvement)", () => {
    expect(coverage([month(1, 1, 100, 150), month(6, 6, 150, 180)]).gaps).toEqual([]);
  });

  it("signale deux relevés qui se suivent sans que les soldes s'enchaînent", () => {
    const c = coverage([month(1, 1, 100, 150), month(2, 2, 175, 90)]);
    expect(c.gaps).toEqual([]);
    expect(c.breaks).toEqual([{ at: "2025-02-01", before: 150, after: 175 }]);
  });

  it("ignore le même relevé déposé deux fois, et met de côté celui dont la période n'est pas lue", () => {
    const c = coverage([month(1, 1, 100, 150), month(9, 1, 100, 150), month(2, 2, 150, 90), { id: 5, start: null, end: null, opening: 1, closing: 2, operations: 3 }]);
    expect(c).toMatchObject({ statements: 4, gaps: [], breaks: [], undated: 1, to: "2025-02-28" });
  });
});
