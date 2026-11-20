import { beforeAll, describe, expect, it } from "vitest";

/*
 * Long PDF lu par tranches de pages : ce que chaque tranche apporte à l'ensemble. Les modules du serveur lisent leur
 * configuration au chargement : on leur en donne une factice (aucune connexion n'est ouverte).
 */
let mergeSegment: typeof import("./read.ts").mergeSegment;
beforeAll(async () => {
  Object.assign(process.env, { DATABASE_URL: "mysql://essai:essai@127.0.0.1:1/essai", APP_URL: "http://localhost:3000", API_TOKEN: "x".repeat(40), SYNC_TOKEN: "y".repeat(40) });
  mergeSegment = (await import("./read.ts")).mergeSegment;
});

describe("tranches d'un long document", () => {
  const rows = { key: "operations", atEnd: ["period_end", "closing_balance", "total_debit"] };

  it("garde l'en-tête de la première tranche, et prend à la dernière ce qui est imprimé à la fin", () => {
    const first = { is_bank_statement: true, bank: "Banque", account_tail: "4821", period_end: "2026-01-31", opening_balance: 100, closing_balance: null, total_debit: null, other_accounts: [{ label: "Livret A", tail: "7702" }], operations: [1, 2] };
    const last = { is_bank_statement: true, bank: null, account_tail: null, period_end: "2026-01-31", opening_balance: null, closing_balance: 250, total_debit: 80, other_accounts: [{ label: "Livret A", tail: "7702" }, { label: "Carte", tail: "1305" }], operations: [3] };
    expect(mergeSegment(first, last, rows)).toEqual({ is_bank_statement: true, bank: "Banque", account_tail: "4821", period_end: "2026-01-31", opening_balance: 100, closing_balance: 250, total_debit: 80, other_accounts: [{ label: "Livret A", tail: "7702" }, { label: "Carte", tail: "1305" }], operations: [1, 2] });
  });

  it("une tranche où le compte n'apparaît pas n'efface rien, et un solde intermédiaire cède au solde final", () => {
    const first = { is_bank_statement: true, opening_balance: 100, closing_balance: 180, operations: [] };
    expect(mergeSegment(first, { is_bank_statement: false, opening_balance: null, closing_balance: null, operations: [] }, rows)).toMatchObject({ is_bank_statement: true, opening_balance: 100, closing_balance: 180 });
    expect(mergeSegment(first, { is_bank_statement: true, opening_balance: 180, closing_balance: 250, operations: [] }, rows)).toMatchObject({ opening_balance: 100, closing_balance: 250 });
  });
});
