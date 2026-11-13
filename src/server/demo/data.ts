/*
 * Données du mode démo : une famille fictive de Nantes (deux adultes — noms fournis par l'appelant —,
 * Léo, 6 ans, et Moka, le chien), ≈ 14 mois d'historique jusqu'au jour donné. Pur : ni base, ni
 * réseau. Déterministe : même jour (à Paris) et mêmes membres → mêmes lignes. Chaque table est typée
 * par son schéma Drizzle (`$inferInsert`).
 */
import { getTableName, is } from "drizzle-orm";
import { MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../db/schema/index.ts";
import { Ops, monthsOf } from "./context.ts";
import { accountDefs, accountRows, categoryRows } from "./data-banque.ts";
import { balanceRows, classify, ruleRows, transactionRows } from "./data-classement.ts";
import { buildDocuments } from "./data-documents.ts";
import { buildInvoices, invoiceSpecs } from "./data-factures.ts";
import { generateOperations } from "./data-operations.ts";
import { LOANS, buildWealth } from "./data-patrimoine.ts";
import { buildPilotage } from "./data-pilotage.ts";
import { simulate } from "./data-simulation.ts";
import { buildSituation } from "./data-situation.ts";
import { amortize, incomeModel, scenario } from "./model.ts";
import { type DemoUser, Rand } from "./rng.ts";

export type { DemoUser } from "./rng.ts";

/** Tables alimentées, dans l'ordre d'insertion (clés = exports du schéma Drizzle). */
export const DEMO_TABLES = [
  "users",
  "categories",
  "accounts",
  "transactions",
  "balances",
  "rules",
  "loans",
  "loanSchedule",
  "assets",
  "cryptoPositions",
  "cryptoEvents",
  "prices",
  "wealthSnapshots",
  "invoices",
  "invoiceFiles",
  "invoiceItems",
  "invoiceTransactions",
  "transactionSplits",
  "documents",
  "documentFiles",
  "properties",
  "commitments",
  "incomeSources",
  "payslips",
  "taxReturns",
  "taxReturnSalaries",
  "propertyTaxes",
  "retirementSimulations",
  "careerPeriods",
  "projections",
  "facts",
  "envelopes",
  "goals",
  "agendaItems",
] as const;
export type DemoTable = (typeof DEMO_TABLES)[number];
export type DemoData = { [K in DemoTable]: (typeof schema)[K]["$inferInsert"][] };

/**
 * Tables jamais vidées par la remise à zéro : `logos` (cache d'images publiques des marques, sans
 * donnée personnelle, coûteux à retélécharger). `_migrations` n'est pas dans le schéma Drizzle.
 */
export const KEPT_TABLES: ReadonlySet<string> = new Set(["logos"]);
/** Lignes d'app_kv gardées : la paire de clés VAPID des notifications (secret technique généré). */
export const KEPT_KV = ["vapid"];

/** Toutes les tables du schéma Drizzle à vider (les vues, comme tx_lines, n'en font pas partie). */
export function tablesToClear(): { name: string; table: MySqlTable }[] {
  return (Object.values(schema) as unknown[])
    .filter((v): v is MySqlTable => is(v, MySqlTable))
    .map((table) => ({ name: getTableName(table), table }))
    .filter((t) => !KEPT_TABLES.has(t.name));
}

export function buildDemoData(today: Date, users: DemoUser[]): DemoData {
  if (users.length < 2) throw new Error("Le mode démo attend deux membres (Alex puis Camille).");
  const members = [users[0], users[1]] as const;
  const names = { a: members[0].name, c: members[1].name };
  const s = scenario(today);
  const R = new Rand(`pecule-demo|${s.T}`);
  const ids = new Rand(`pecule-demo-ids|${s.T}`);
  const model = incomeModel(s);
  const loans = {
    rp: amortize(LOANS.rp.id, LOANS.rp.principal, LOANS.rp.rate, LOANS.rp.months, s.rpFirst, LOANS.rp.insurance),
    studio: amortize(LOANS.studio.id, LOANS.studio.principal, LOANS.studio.rate, LOANS.studio.months, s.studioFirst, LOANS.studio.insurance),
  };
  const defs = accountDefs(ids, members);
  const specs = invoiceSpecs(s, ids);

  // Opérations, soldes jour par jour, puis classement.
  const ops = new Ops(R, s.start, s.T);
  const { cryptoBuys } = generateOperations(ops, s, model, monthsOf(s, R), names, loans, specs);
  const opening = { joint: defs.joint.opening, a: defs.a.opening, c: defs.c.opening, livret: defs.livret.opening, ldds: defs.ldds.opening };
  const { daily, final } = simulate(ops, opening, names);
  const { sorted, keyOf, rules } = classify(ops.txs, R, s.T);
  const tx = transactionRows(sorted, keyOf, defs, ids);

  const docs = buildDocuments(s, model, members);
  const wealth = buildWealth({ s, R, users: members, loans, daily, final, txs: sorted, cryptoBuys });
  const situation = buildSituation(s, model, members, loans, docs.ids);

  return {
    // Tous les membres reçus (au-delà des deux premiers : sans données propres).
    users: users.map((u) => ({ id: u.id, name: u.name })),
    categories: categoryRows(),
    accounts: accountRows(defs, final, s.T),
    transactions: tx.rows,
    balances: balanceRows(daily, defs),
    rules: ruleRows(rules),
    ...wealth,
    ...buildInvoices(specs, tx.byRef, members),
    documents: docs.documents,
    documentFiles: docs.documentFiles,
    ...situation,
    ...buildPilotage(s, members, final),
  };
}
