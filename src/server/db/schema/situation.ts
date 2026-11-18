import { date, decimal, foreignKey, index, int, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { createdAt, updatedAt } from "./common.ts";
import { users } from "./auth.ts";

/*
 * Domaines repris de Notion (phase 14) : biens immobiliers, engagements récurrents (frais fixes,
 * contrats, abonnements), revenus du foyer, impôts (IR par année, taxes foncières par bien),
 * retraite (simulations officielles, carrière), projections de patrimoine, mouvements crypto et
 * faits clés (champ libre par entité). Visibilité : owner_user_id NULL = commun, sinon le seul
 * propriétaire. Les KPI ne sont jamais stockés : ils sont recalculés.
 */

/** kind : residence_principale | locatif | sci. */
export const properties = mysqlTable("properties", {
  id: varchar("id", { length: 32 }).primaryKey(),
  ownerUserId: int("owner_user_id"),
  name: varchar("name", { length: 160 }).notNull(),
  kind: varchar("kind", { length: 24 }).notNull(),
  city: varchar("city", { length: 120 }),
  surface: decimal("surface", { precision: 8, scale: 2, mode: "number" }),
  rooms: int("rooms"),
  acquisitionDate: date("acquisition_date", { mode: "string" }),
  acquisitionPrice: decimal("acquisition_price", { precision: 14, scale: 2, mode: "number" }),
  acquisitionCosts: decimal("acquisition_costs", { precision: 14, scale: 2, mode: "number" }),
  rentMonthly: decimal("rent_monthly", { precision: 12, scale: 2, mode: "number" }),
  chargesMonthly: decimal("charges_monthly", { precision: 12, scale: 2, mode: "number" }),
  deposit: decimal("deposit", { precision: 12, scale: 2, mode: "number" }),
  leaseKind: varchar("lease_kind", { length: 24 }),
  leaseStart: date("lease_start", { mode: "string" }),
  nextRentRevision: date("next_rent_revision", { mode: "string" }),
  taxRegime: varchar("tax_regime", { length: 40 }),
  assetId: int("asset_id"),
  loanIds: varchar("loan_ids", { length: 255 }),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Engagements récurrents (frais fixes, contrats, assurances, abonnements, taxes, garde, budgets
 * courants). type : credit | assurance | abonnement | taxe | garde | budget ;
 * status : actif | a_verifier | a_completer | resilie | non_compte.
 */
export const commitments = mysqlTable(
  "commitments",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    label: varchar("label", { length: 160 }).notNull(),
    groupName: varchar("group_name", { length: 60 }),
    type: varchar("type", { length: 16 }).notNull().default("abonnement"),
    status: varchar("status", { length: 16 }).notNull().default("actif"),
    monthly: decimal("monthly", { precision: 12, scale: 2, mode: "number" }),
    annual: decimal("annual", { precision: 12, scale: 2, mode: "number" }),
    categoryId: varchar("category_id", { length: 16 }),
    matchPattern: varchar("match_pattern", { length: 120 }),
    /** Forme du libellé bancaire brut (expression régulière, codes compris) : nomme les prélèvements SEPA. */
    labelRegex: varchar("label_regex", { length: 191 }),
    propertyId: varchar("property_id", { length: 32 }),
    provider: varchar("provider", { length: 120 }),
    startDate: date("start_date", { mode: "string" }),
    endDate: date("end_date", { mode: "string" }),
    renewalDate: date("renewal_date", { mode: "string" }),
    noticeDays: int("notice_days"),
    notes: text("notes"),
    source: varchar("source", { length: 16 }).notNull().default("manuel"),
    sourceRef: varchar("source_ref", { length: 191 }),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_commitments_source_ref").on(t.sourceRef), index("idx_commitments_status").on(t.status)],
);

/** Revenus du foyer. person : prénom d'un membre ou « Foyer » ; kind : salaire | bonus | loyer | partage | autre. */
export const incomeSources = mysqlTable(
  "income_sources",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    person: varchar("person", { length: 16 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull().default("autre"),
    monthly: decimal("monthly", { precision: 12, scale: 2, mode: "number" }),
    annualGross: decimal("annual_gross", { precision: 14, scale: 2, mode: "number" }),
    validFrom: date("valid_from", { mode: "string" }),
    validTo: date("valid_to", { mode: "string" }),
    notes: text("notes"),
    sourceRef: varchar("source_ref", { length: 191 }),
    sortOrder: int("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_income_source_ref").on(t.sourceRef)],
);

/**
 * Impôt sur le revenu, une ligne par déclaration : celle du foyer (imposition commune) ou celle d'un membre
 * (imposition séparée : avant la vie commune, ou couple ni marié ni pacsé). `owner_user_id` : 0 = déclaration commune,
 * sinon le membre déclarant — 0 et non NULL, parce que la colonne fait partie de la clé (une déclaration commune et
 * une par membre au plus pour une année de revenus). Une déclaration personnelle n'est vue des autres membres que si
 * son déclarant partage ses revenus (src/server/sharing.ts). Les salaires déclarés par chacun sont dans
 * `tax_return_salaries`.
 */
export const taxReturns = mysqlTable(
  "tax_returns",
  {
    incomeYear: int("income_year").notNull(),
    ownerUserId: int("owner_user_id").notNull().default(0),
    noticeYear: int("notice_year"),
    parts: decimal("parts", { precision: 4, scale: 2, mode: "number" }),
    situation: varchar("situation", { length: 40 }),
    otherIncome: decimal("other_income", { precision: 12, scale: 2, mode: "number" }),
    taxableIncome: decimal("taxable_income", { precision: 12, scale: 2, mode: "number" }),
    rfr: decimal("rfr", { precision: 12, scale: 2, mode: "number" }),
    netTax: decimal("net_tax", { precision: 12, scale: 2, mode: "number" }),
    socialLevies: decimal("social_levies", { precision: 12, scale: 2, mode: "number" }),
    total: decimal("total", { precision: 12, scale: 2, mode: "number" }),
    decote: decimal("decote", { precision: 12, scale: 2, mode: "number" }),
    credits: decimal("credits", { precision: 12, scale: 2, mode: "number" }),
    balance: decimal("balance", { precision: 12, scale: 2, mode: "number" }),
    tmi: decimal("tmi", { precision: 5, scale: 2, mode: "number" }),
    avgRate: decimal("avg_rate", { precision: 5, scale: 2, mode: "number" }),
    creditsDetail: text("credits_detail"),
    notes: text("notes"),
    documentId: int("document_id"),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ name: "pk_tax_returns", columns: [t.incomeYear, t.ownerUserId] })],
);

/**
 * Salaires déclarés par un membre pour une année de revenus (une ligne par déclarant). Un membre ne figure que sur
 * une déclaration par année : la sienne s'il en a une, sinon la déclaration commune (`returnOf`, src/lib/taxes.ts).
 */
export const taxReturnSalaries = mysqlTable(
  "tax_return_salaries",
  {
    incomeYear: int("income_year").notNull(),
    userId: int("user_id").notNull(),
    amount: decimal("amount", { precision: 12, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ name: "pk_tax_return_salaries", columns: [t.incomeYear, t.userId] }),
    foreignKey({ name: "fk_tax_salaries_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Taxe foncière, une ligne par année et par bien. */
export const propertyTaxes = mysqlTable(
  "property_taxes",
  {
    id: int("id").autoincrement().primaryKey(),
    year: int("year").notNull(),
    propertyId: varchar("property_id", { length: 32 }).notNull(),
    base: decimal("base", { precision: 12, scale: 2, mode: "number" }),
    contributions: decimal("contributions", { precision: 12, scale: 2, mode: "number" }),
    teom: decimal("teom", { precision: 12, scale: 2, mode: "number" }),
    fees: decimal("fees", { precision: 12, scale: 2, mode: "number" }),
    total: decimal("total", { precision: 12, scale: 2, mode: "number" }),
    notes: text("notes"),
    documentId: int("document_id"),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("uq_property_taxes").on(t.year, t.propertyId)],
);

/** Simulations de retraite (officielles ou scénarios), par membre. */
export const retirementSimulations = mysqlTable(
  "retirement_simulations",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id").notNull(),
    simulatedOn: date("simulated_on", { mode: "string" }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    age: decimal("age", { precision: 5, scale: 2, mode: "number" }),
    quarters: int("quarters"),
    basePension: decimal("base_pension", { precision: 10, scale: 2, mode: "number" }),
    complementary: decimal("complementary", { precision: 10, scale: 2, mode: "number" }),
    grossMonthly: decimal("gross_monthly", { precision: 10, scale: 2, mode: "number" }),
    netMonthly: decimal("net_monthly", { precision: 10, scale: 2, mode: "number" }),
    adjustment: varchar("adjustment", { length: 120 }),
    source: varchar("source", { length: 16 }).notNull().default("info-retraite"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("uq_retirement_sim").on(t.ownerUserId, t.simulatedOn, t.label),
    foreignKey({ name: "fk_retirement_sim_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Carrière enregistrée (relevé de situation individuelle), par membre. */
export const careerPeriods = mysqlTable(
  "career_periods",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id").notNull(),
    period: varchar("period", { length: 60 }).notNull(),
    startYear: int("start_year"),
    endYear: int("end_year"),
    employer: varchar("employer", { length: 160 }),
    income: decimal("income", { precision: 12, scale: 2, mode: "number" }),
    quarters: int("quarters"),
    points: decimal("points", { precision: 10, scale: 2, mode: "number" }),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("uq_career_period").on(t.ownerUserId, t.period),
    foreignKey({ name: "fk_career_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Projections de patrimoine : une valeur par membre (NULL = commune), scénario, horizon et poche. */
export const projections = mysqlTable(
  "projections",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    scenario: varchar("scenario", { length: 16 }).notNull(),
    horizonYear: int("horizon_year").notNull(),
    poche: varchar("poche", { length: 60 }).notNull(),
    value: decimal("value", { precision: 14, scale: 2, mode: "number" }),
    hypothesis: text("hypothesis"),
    asOf: date("as_of", { mode: "string" }),
  },
  // Le membre fait partie de la clé : deux membres peuvent avoir une poche du même nom (« Crypto ») sans s'écraser.
  (t) => [uniqueIndex("uq_projection").on(t.ownerUserId, t.scenario, t.horizonYear, t.poche)],
);

/** Mouvements crypto (journal : achats, ventes, transferts, staking…), par membre. */
export const cryptoEvents = mysqlTable(
  "crypto_events",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    asset: varchar("asset", { length: 120 }),
    type: varchar("type", { length: 40 }),
    platform: varchar("platform", { length: 60 }),
    quantity: decimal("quantity", { precision: 30, scale: 10, mode: "number" }),
    /** Valeur du mouvement, dans la devise du foyer. */
    value: decimal("value", { precision: 14, scale: 2, mode: "number" }),
    note: text("note"),
    sourceRef: varchar("source_ref", { length: 191 }),
  },
  (t) => [
    uniqueIndex("uq_crypto_events_ref").on(t.sourceRef),
    index("idx_crypto_events_date").on(t.date),
    foreignKey({ name: "fk_crypto_events_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Faits clés d'une entité (bien, retraite, emploi…) : libellé, valeur, unité, date de relevé. */
export const facts = mysqlTable(
  "facts",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    entityType: varchar("entity_type", { length: 16 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    factKey: varchar("fact_key", { length: 60 }).notNull(),
    label: varchar("label", { length: 160 }).notNull(),
    value: varchar("value", { length: 500 }).notNull(),
    unit: varchar("unit", { length: 24 }),
    asOf: date("as_of", { mode: "string" }),
    sortOrder: int("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("uq_facts").on(t.entityType, t.entityId, t.factKey)],
);

/** Bulletins de paie (lus par Claude dans le coffre) : un par membre, employeur et mois. */
export const payslips = mysqlTable(
  "payslips",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id").notNull(),
    employer: varchar("employer", { length: 120 }).notNull(),
    period: varchar("period", { length: 7 }).notNull(),
    payDate: date("pay_date", { mode: "string" }),
    gross: decimal("gross", { precision: 12, scale: 2, mode: "number" }),
    netBeforeTax: decimal("net_before_tax", { precision: 12, scale: 2, mode: "number" }),
    netTaxable: decimal("net_taxable", { precision: 12, scale: 2, mode: "number" }),
    incomeTax: decimal("income_tax", { precision: 12, scale: 2, mode: "number" }),
    taxRate: decimal("tax_rate", { precision: 5, scale: 2, mode: "number" }),
    netPaid: decimal("net_paid", { precision: 12, scale: 2, mode: "number" }),
    bonus: decimal("bonus", { precision: 12, scale: 2, mode: "number" }),
    employerCost: decimal("employer_cost", { precision: 12, scale: 2, mode: "number" }),
    ytdNetTaxable: decimal("ytd_net_taxable", { precision: 12, scale: 2, mode: "number" }),
    notes: text("notes"),
    documentId: int("document_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("uq_payslips").on(t.ownerUserId, t.employer, t.period),
    index("idx_payslips_period").on(t.period),
    foreignKey({ name: "fk_payslips_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/**
 * Enveloppes mensuelles : plafond de dépenses par poste (ou par catégorie), suivi sur le mois en
 * cours, alerte au seuil (80 % par défaut). owner_user_id NULL = enveloppe du foyer.
 */
export const envelopes = mysqlTable("envelopes", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("owner_user_id"),
  scope: varchar("scope", { length: 12 }).notNull().default("poste"),
  ref: varchar("ref", { length: 120 }).notNull(),
  monthly: decimal("monthly", { precision: 12, scale: 2, mode: "number" }).notNull(),
  alertPct: int("alert_pct").notNull().default(80),
  sortOrder: int("sort_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Objectifs d'épargne : montant visé, échéance, avancement lu sur un placement ou un livret lié
 * (asset_id) ou saisi à la main. owner_user_id NULL = objectif du foyer.
 */
export const goals = mysqlTable("goals", {
  id: int("id").autoincrement().primaryKey(),
  ownerUserId: int("owner_user_id"),
  name: varchar("name", { length: 120 }).notNull(),
  emoji: varchar("emoji", { length: 16 }),
  target: decimal("target", { precision: 14, scale: 2, mode: "number" }).notNull(),
  targetDate: date("target_date", { mode: "string" }),
  assetId: int("asset_id"),
  currentManual: decimal("current_manual", { precision: 14, scale: 2, mode: "number" }),
  notes: text("notes"),
  status: varchar("status", { length: 12 }).notNull().default("actif"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
