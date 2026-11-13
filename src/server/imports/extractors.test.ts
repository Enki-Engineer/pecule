import { beforeAll, describe, expect, it } from "vitest";
import type { Extractor } from "./registry.ts";

/*
 * Extracteurs de l'import massif : cohérence des schémas donnés à l'IA et contrôles arithmétiques. Les modules du
 * serveur lisent leur configuration au chargement : on leur en donne une factice (aucune connexion n'est ouverte).
 */
let EXTRACTORS: Extractor[];
let byId: (id: string) => Extractor;

beforeAll(async () => {
  Object.assign(process.env, { DATABASE_URL: "mysql://essai:essai@127.0.0.1:1/essai", APP_URL: "http://localhost:3000", API_TOKEN: "x".repeat(40), SYNC_TOKEN: "y".repeat(40) });
  const m = await import("./extractors/index.ts");
  EXTRACTORS = m.EXTRACTORS;
  byId = (id) => m.extractorById(id)!;
});

const failed = (x: Extractor, data: Record<string, unknown>) => x.checks(data).filter((c) => !c.ok).length;

describe("registre des extracteurs", () => {
  it("donne à chaque type un identifiant unique et un schéma où tout champ est requis (sortie structurée)", () => {
    expect(new Set(EXTRACTORS.map((x) => x.id)).size).toBe(EXTRACTORS.length);
    for (const x of EXTRACTORS.filter((x) => x.id !== "fichier_banque")) {
      expect(Object.keys(x.schema.properties).sort(), x.id).toEqual([...x.schema.required].sort());
      expect(x.instructions.length, x.id).toBeGreaterThan(80);
    }
  });
  it("oriente chaque type de document vers son extracteur", async () => {
    const { pickExtractor } = await import("./extractors/index.ts");
    const pick = (kind: string, domain: string) => pickExtractor({ kind, domain, title: "" })?.id ?? null;
    expect(pick("bulletin", "revenus")).toBe("bulletin");
    expect(pick("avis_impot", "impots")).toBe("avis_impot");
    expect(pick("taxe_fonciere", "impots")).toBe("taxe_fonciere");
    expect(pick("pret", "immobilier")).toBe("pret");
    expect(pick("releve", "retraite")).toBe("retraite");
    expect(pick("releve", "banque")).toBe("releve");
    expect(pick("bail", "immobilier")).toBe("bien");
    expect(pick("diagnostic", "immobilier")).toBeNull();
    expect(pick("releve", "patrimoine")).toBe("placement");
    expect(pick("assurance", "immobilier")).toBe("contrat");
    expect(pick("contrat", "immobilier")).toBeNull();
  });
});

describe("contrôles arithmétiques", () => {
  it("bulletin : net avant impôt − impôt = net payé", () => {
    const ok = { is_payslip: true, employer: "Atelier", period: "2026-03", pay_date: null, gross: 3000, net_before_tax: 2340, net_taxable: 2450, income_tax: 122.5, tax_rate: 5, net_paid: 2217.5, bonus: null, employer_cost: null, ytd_net_taxable: null, notes: null };
    expect(failed(byId("bulletin"), ok)).toBe(0);
    expect(failed(byId("bulletin"), { ...ok, net_paid: 2300 })).toBe(1);
    expect(failed(byId("bulletin"), { ...ok, gross: null })).toBeGreaterThan(0);
  });

  it("taxe foncière : cotisations + ordures ménagères + frais = montant de l'avis", () => {
    const ok = { is_property_tax_notice: true, year: 2025, property_id: "appartement", city: "Nantes", base: 1200, contributions: 400, teom: 62, fees: 18, total: 480, notes: null };
    expect(failed(byId("taxe_fonciere"), ok)).toBe(0);
    expect(failed(byId("taxe_fonciere"), { ...ok, total: 500 })).toBe(1);
    expect(failed(byId("taxe_fonciere"), { ...ok, property_id: null })).toBe(1);
  });

  it("crédit : capital remboursé, restant dû décroissant et nul à la fin, lignes qui tombent juste", () => {
    // 3 000 € sur 3 mois sans intérêts, puis le même tableau abîmé.
    const schedule = [1, 2, 3].map((rang) => ({ rang, date: `2026-0${rang}-05`, payment: 1010, principal: 1000, interest: 8, insurance: 2, deferred: 0, remaining: 3000 - rang * 1000 }));
    const ok = { is_loan_document: true, loan_id: "pret-1", name: "Prêt", bank: "Banque", reference: null, type: "amortissable", property_id: null, principal: 3000, rate: 1.2, duration_months: 3, start_date: "2026-01-05", end_date: "2026-03-05", schedule };
    expect(failed(byId("pret"), ok)).toBe(0);
    expect(failed(byId("pret"), { ...ok, principal: 3500 })).toBe(1);
    expect(failed(byId("pret"), { ...ok, schedule: schedule.map((s, i) => (i === 1 ? { ...s, remaining: 2500 } : s)) })).toBe(1);
    expect(failed(byId("pret"), { ...ok, schedule: schedule.map((s, i) => (i === 0 ? { ...s, payment: 990 } : s)) })).toBe(1);
    // Tableau prévisionnel sans dates : seule la date de la première échéance manque.
    const undated = { ...ok, start_date: null, end_date: null, schedule: schedule.map((s) => ({ ...s, date: null })) };
    expect(byId("pret").checks(undated).filter((c) => !c.ok)).toHaveLength(1);
    expect(byId("pret").table!({ ...undated, start_date: "2026-01-31" })!.lines.map((l) => l[1])).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("relevé : solde de départ + opérations = solde d'arrivée", () => {
    const ok = { is_bank_statement: true, account_id: "m:compte", owner: null, bank: "Banque", account_label: "Compte courant", account_tail: "1234", period_start: "2026-01-01", period_end: "2026-01-31", opening_balance: 100, closing_balance: 2529.9, operations: [{ date: "2026-01-03", label: "VIR SALAIRE", amount: 2450 }, { date: "2026-01-09", label: "CARTE BOULANGERIE", amount: -20.1 }] };
    expect(failed(byId("releve"), ok)).toBe(0);
    expect(failed(byId("releve"), { ...ok, closing_balance: 2530 })).toBe(1);
    expect(failed(byId("releve"), { ...ok, operations: [...ok.operations, { date: "2026-02-02", label: "HORS PÉRIODE", amount: 0 }] })).toBe(1);
  });

  it("contrat : 12 mensualités = montant annuel", () => {
    const ok = { is_recurring_contract: true, type: "assurance", label: "Assurance habitation", provider: "Assureur", monthly: 21.5, annual: 258, start_date: "2025-01-01", end_date: null, renewal_date: "2027-01-01", notice_days: 60 };
    expect(failed(byId("contrat"), ok)).toBe(0);
    expect(failed(byId("contrat"), { ...ok, annual: 300 })).toBe(1);
    expect(failed(byId("contrat"), { ...ok, monthly: null, annual: null })).toBe(1);
  });

  it("retraite : au plus 4 trimestres par an, une ligne par année", () => {
    const career = [2020, 2021].map((year) => ({ year, employer: "Atelier", income: 30000, quarters: 4, points: 120 }));
    const ok = { is_retirement_document: true, document_date: "2026-08-01", quarters_recorded: 8, quarters_required: 172, legal_age: "64 ans", full_rate_age: "67 ans", simulations: [], career };
    expect(failed(byId("retraite"), ok)).toBe(0);
    // Année en double à 5 trimestres : trois contrôles tombent (plafond annuel, doublon, total éloigné du total enregistré).
    expect(failed(byId("retraite"), { ...ok, career: [...career, { ...career[1], quarters: 5 }] })).toBe(3);
  });
});
