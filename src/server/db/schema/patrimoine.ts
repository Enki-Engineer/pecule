import { sql } from "drizzle-orm";
import { char, date, datetime, decimal, foreignKey, index, int, mysqlTable, primaryKey, text, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { users } from "./auth.ts";
import { updatedAt } from "./common.ts";

/*
 * Patrimoine : crédits (échéanciers), placements, crypto, cours, instantanés.
 * owner_user_id NULL = bien commun de la famille ; share = quote-part retenue pour chaque membre.
 */

export const loans = mysqlTable("loans", {
  id: varchar("id", { length: 32 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  property: varchar("property", { length: 60 }).notNull(),
  bank: varchar("bank", { length: 120 }).notNull(),
  reference: varchar("reference", { length: 60 }),
  type: varchar("type", { length: 32 }).notNull(),
  principal: decimal("principal", { precision: 14, scale: 2, mode: "number" }).notNull(),
  disbursed: decimal("disbursed", { precision: 14, scale: 2, mode: "number" }),
  rate: decimal("rate", { precision: 7, scale: 4, mode: "number" }).notNull(),
  durationMonths: int("duration_months").notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  notes: text("notes"),
  sortOrder: int("sort_order").notNull().default(0),
  ownerUserId: int("owner_user_id"),
  share: decimal("share", { precision: 5, scale: 4, mode: "number" }).notNull().default(1),
});

export const loanSchedule = mysqlTable(
  "loan_schedule",
  {
    loanId: varchar("loan_id", { length: 32 }).notNull(),
    rang: int("rang").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    payment: decimal("payment", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    principal: decimal("principal", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    interest: decimal("interest", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    insurance: decimal("insurance", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    deferredInterest: decimal("deferred_interest", { precision: 14, scale: 2, mode: "number" }).notNull().default(0),
    remaining: decimal("remaining", { precision: 14, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.loanId, t.rang] }),
    index("idx_schedule_date").on(t.loanId, t.date),
    foreignKey({ name: "fk_schedule_loan", columns: [t.loanId], foreignColumns: [loans.id] }).onDelete("cascade"),
  ],
);

/**
 * Placements, épargne, immobilier : `valuation` manuel, cotation (ticker Yahoo) ou versements (la valeur est le
 * dernier versement reçu). `payout_match` : texte cherché dans le libellé des entrées d'argent — ce sont les
 * versements reçus de ce placement (coupons, intérêts, ce qu'une plateforme reverse), src/server/payouts.ts.
 */
export const assets = mysqlTable(
  "assets",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    name: varchar("name", { length: 160 }).notNull(),
    category: varchar("category", { length: 16 }).notNull(),
    institution: varchar("institution", { length: 255 }),
    valuation: varchar("valuation", { length: 16 }).notNull().default("manuel"),
    ticker: varchar("ticker", { length: 32 }),
    quantity: decimal("quantity", { precision: 24, scale: 8, mode: "number" }),
    cash: decimal("cash", { precision: 14, scale: 2, mode: "number" }),
    value: decimal("value", { precision: 14, scale: 2, mode: "number" }),
    valueDate: date("value_date", { mode: "string" }),
    invested: decimal("invested", { precision: 14, scale: 2, mode: "number" }),
    share: decimal("share", { precision: 5, scale: 4, mode: "number" }).notNull().default(1),
    liquidity: varchar("liquidity", { length: 24 }),
    loanIds: varchar("loan_ids", { length: 255 }),
    notes: text("notes"),
    sortOrder: int("sort_order").notNull().default(0),
    closed: tinyint("closed").notNull().default(0),
    payoutMatch: varchar("payout_match", { length: 120 }),
  },
  (t) => [
    uniqueIndex("uq_assets_name").on(t.ownerUserId, t.name),
    foreignKey({ name: "fk_assets_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/**
 * Positions crypto. `source` : manuel (saisie, ligne_key = symbole) ou coinstats (synchro quotidienne,
 * line_key = « portefeuille:identifiant », jamais modifiée à la main). Une ligne manuelle couverte par
 * CoinStats est archivée (archived_at) au lieu d'être supprimée : elle ne compte plus mais reste visible.
 */
export const cryptoPositions = mysqlTable(
  "crypto_positions",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id").notNull(),
    symbol: varchar("symbol", { length: 24 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    coingeckoId: varchar("coingecko_id", { length: 80 }),
    quantity: decimal("quantity", { precision: 30, scale: 10, mode: "number" }).notNull().default(0),
    manualValue: decimal("manual_value", { precision: 14, scale: 2, mode: "number" }),
    location: varchar("location", { length: 255 }),
    updatedAt: date("updated_at", { mode: "string" }),
    sortOrder: int("sort_order").notNull().default(0),
    source: varchar("source", { length: 16 }).notNull().default("manuel"),
    lineKey: varchar("line_key", { length: 160 }).notNull().default(""),
    portfolioId: varchar("portfolio_id", { length: 96 }),
    coinstatsId: varchar("coinstats_id", { length: 120 }),
    syncedAt: datetime("synced_at", { mode: "string" }),
    archivedAt: datetime("archived_at", { mode: "string" }),
    archivedReason: varchar("archived_reason", { length: 255 }),
  },
  (t) => [
    uniqueIndex("uq_crypto_line").on(t.ownerUserId, t.source, t.lineKey),
    index("idx_crypto_portfolio").on(t.portfolioId),
    foreignKey({ name: "fk_crypto_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/**
 * Sources des quantités crypto : portefeuilles CoinStats (feuilles synchronisées ; un portefeuille « parent » ne fait
 * que regrouper) et portefeuilles lus par leur adresse publique (`type` : un genre de src/lib/crypto-chains.ts,
 * identifiant « btc:… », « evm:… », « sol:… »).
 */
export const cryptoSources = mysqlTable("crypto_sources", {
  portfolioId: varchar("portfolio_id", { length: 96 }).primaryKey(),
  ownerUserId: int("owner_user_id").notNull(),
  parentId: varchar("parent_id", { length: 96 }),
  name: varchar("name", { length: 160 }).notNull(),
  type: varchar("type", { length: 16 }).notNull(),
  enabled: tinyint("enabled").notNull().default(1),
  /** ok | vide | doublon | a_verifier | erreur */
  status: varchar("status", { length: 16 }).notNull().default("ok"),
  lines: int("lines").notNull().default(0),
  lastTotalEur: decimal("last_total_eur", { precision: 14, scale: 2, mode: "number" }),
  lastSyncedAt: datetime("last_synced_at", { mode: "string" }),
  note: varchar("note", { length: 255 }),
  /**
   * Source lue sans intermédiaire : les autres sources du membre (séparées par une virgule) où les mêmes avoirs
   * figurent aussi, par un agrégateur. Les cryptos qu'elle lit n'y sont plus comptées (évite le double compte).
   */
  replacesId: text("replaces_id"),
  /** Ce qu'il faut pour relire la source et qui ne s'affiche pas (clé publique étendue d'un compte), chiffré. */
  secret: text("secret"),
});

/**
 * Mouvements lus dans le fichier qu'exporte une appli sans clé d'API (source « f-… »). Le solde d'une crypto est la
 * somme de ses mouvements ; `row_key` (empreinte de la ligne du fichier) fait qu'un fichier déposé deux fois, ou
 * deux exports qui se recouvrent, ne comptent qu'une fois.
 */
export const cryptoFileMoves = mysqlTable(
  "crypto_file_moves",
  {
    id: int("id").autoincrement().primaryKey(),
    portfolioId: varchar("portfolio_id", { length: 96 }).notNull(),
    ownerUserId: int("owner_user_id").notNull(),
    at: datetime("at", { mode: "string" }).notNull(),
    kind: varchar("kind", { length: 96 }).notNull(),
    symbol: varchar("symbol", { length: 24 }).notNull(),
    amount: decimal("amount", { precision: 30, scale: 10, mode: "number" }).notNull(),
    rowKey: char("row_key", { length: 40 }).notNull(),
  },
  (t) => [
    uniqueIndex("uq_crypto_file_move").on(t.portfolioId, t.rowKey),
    foreignKey({ name: "fk_crypto_file_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Journal des synchros CoinStats (crédits consommés, total, erreurs). */
export const cryptoSyncRuns = mysqlTable("crypto_sync_runs", {
  id: int("id").autoincrement().primaryKey(),
  startedAt: datetime("started_at", { mode: "string" }).notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: datetime("finished_at", { mode: "string" }),
  status: varchar("status", { length: 16 }).notNull().default("running"),
  trigger: varchar("trigger", { length: 16 }).notNull(),
  sources: int("sources").notNull().default(0),
  lines: int("lines").notNull().default(0),
  totalEur: decimal("total_eur", { precision: 14, scale: 2, mode: "number" }),
  creditsUsed: int("credits_used"),
  error: text("error"),
});

/** Derniers cours connus : `cg:<id>` (CoinGecko), `yf:<ticker>` (Yahoo Finance). */
export const prices = mysqlTable("prices", {
  id: varchar("id", { length: 96 }).primaryKey(),
  priceEur: decimal("price_eur", { precision: 24, scale: 10, mode: "number" }).notNull(),
  change24h: decimal("change_24h", { precision: 10, scale: 4, mode: "number" }),
  updatedAt: updatedAt(),
});

/**
 * Cours de change de référence (Banque centrale européenne) : unités de la devise pour 1 euro, un par jour ouvré.
 * Seules les devises dont le foyer se sert y sont gardées (src/server/fx.ts).
 */
export const fxRates = mysqlTable(
  "fx_rates",
  {
    date: date("date", { mode: "string" }).notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    rate: decimal("rate", { precision: 18, scale: 8, mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.date] })],
);

/** Un instantané du patrimoine par membre et par jour (`source` : auto | reprise). */
export const wealthSnapshots = mysqlTable(
  "wealth_snapshots",
  {
    userId: int("user_id").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    gross: decimal("gross", { precision: 14, scale: 2, mode: "number" }).notNull(),
    debts: decimal("debts", { precision: 14, scale: 2, mode: "number" }).notNull(),
    net: decimal("net", { precision: 14, scale: 2, mode: "number" }).notNull(),
    breakdown: text("breakdown"),
    source: varchar("source", { length: 16 }).notNull().default("auto"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.date] }),
    foreignKey({ name: "fk_snap_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);
