import { describe, expect, it } from "vitest";
import { mergeDebitRows, type DebitRow } from "./debit-rows.ts";

const row = (name: string, category: string | null, amounts: Record<number, number>): DebitRow => {
  const byMonth = new Array<number>(12).fill(0);
  for (const [m, v] of Object.entries(amounts)) byMonth[Number(m) - 1] = v;
  const paid = byMonth.filter((v) => v > 0);
  return { name, category, byMonth, count: paid.length, total: paid.reduce((s, v) => s + v, 0) };
};

describe("mergeDebitRows", () => {
  it("réunit un même prélèvement renommé en cours d'année (même catégorie, même montant, mois distincts)", () => {
    const rows = [row("Banque de l'Ouest", "Crédit immobilier", { 1: 700, 2: 700, 3: 700 }), row("Prêt de la maison", "Crédit immobilier", { 4: 700, 5: 700 })];
    const merged = mergeDebitRows(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: "Prêt de la maison", count: 5, total: 3500 });
    expect(merged[0].byMonth.slice(0, 5)).toEqual([700, 700, 700, 700, 700]);
  });
  it("réunit deux noms d'une même marque", () => {
    const merged = mergeDebitRows([row("Free", "Internet", { 1: 24, 2: 24 }), row("Fibre — Free", "Internet", { 3: 30, 4: 30 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe("Fibre — Free");
  });
  it("garde à part deux prélèvements qui passent les mêmes mois, ou de montants différents", () => {
    const rows = [row("Prêt de la maison", "Crédit immobilier", { 1: 700, 2: 700 }), row("Prêt du studio", "Crédit immobilier", { 1: 380, 2: 380 }), row("Assurance", "Assurances", { 3: 40 }), row("Mutuelle", "Assurances", { 4: 95 })];
    expect(mergeDebitRows(rows)).toHaveLength(4);
  });
});
