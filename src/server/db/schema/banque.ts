import { char, date, datetime, decimal, foreignKey, index, int, mysqlTable, mysqlView, primaryKey, text, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { createdAt, updatedAt } from "./common.ts";
import { users } from "./auth.ts";

/** Référentiel des catégories (codes A, B et C) ; `kind` : revenu | depense | epargne | interne. */
export const categories = mysqlTable("categories", {
  id: varchar("id", { length: 16 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  groupName: varchar("group_name", { length: 120 }),
  poste: varchar("poste", { length: 120 }),
  kind: varchar("kind", { length: 16 }).notNull(),
  sortOrder: int("sort_order").notNull().default(0),
  description: text("description"),
});

/** Comptes bancaires (id = providerAccountId GoCardless) ; `hidden`/`excluded` = valeurs par défaut, `account_prefs` prioritaire. */
export const accounts = mysqlTable("accounts", {
  id: varchar("id", { length: 64 }).primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  displayName: varchar("display_name", { length: 120 }),
  institution: varchar("institution", { length: 120 }),
  owner: varchar("owner", { length: 16 }).notNull().default("autre"),
  kind: varchar("kind", { length: 16 }).notNull().default("courant"),
  /** Devise du compte. `balance` est toujours dans la devise du foyer ; si le compte en a une autre, son solde d'origine est dans `balance_original`. */
  currency: char("currency", { length: 3 }).notNull().default("EUR"),
  balance: decimal("balance", { precision: 14, scale: 2, mode: "number" }),
  balanceOriginal: decimal("balance_original", { precision: 14, scale: 2, mode: "number" }),
  balanceAt: datetime("balance_at", { mode: "string" }),
  hidden: tinyint("hidden").notNull().default(0),
  excluded: tinyint("excluded").notNull().default(0),
  sortOrder: int("sort_order").notNull().default(0),
  source: varchar("source", { length: 16 }).notNull().default("finta"),
  createdAt: createdAt(),
});

/** Comptes Finta rattachés à un compte Pécule (un compte commun remonte par deux connexions). */
export const accountSources = mysqlTable(
  "account_sources",
  {
    fintaAccountId: char("finta_account_id", { length: 36 }).primaryKey(),
    accountId: varchar("account_id", { length: 64 }).notNull(),
    connectionId: char("connection_id", { length: 36 }),
    connectionStatus: varchar("connection_status", { length: 32 }),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_sources_account").on(t.accountId)],
);

/** Réglages par membre (masqué, hors stats), prioritaires sur ceux du compte. */
export const accountPrefs = mysqlTable(
  "account_prefs",
  {
    userId: int("user_id").notNull(),
    accountId: varchar("account_id", { length: 64 }).notNull(),
    hidden: tinyint("hidden"),
    excluded: tinyint("excluded"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.accountId] }),
    foreignKey({ name: "fk_prefs_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Opérations (id = providerId Finta = colonne ID de l'ancienne base Notion). Statistiques : passer par `tx_lines`. */
export const transactions = mysqlTable(
  "transactions",
  {
    id: varchar("id", { length: 160 }).primaryKey(),
    fintaId: char("finta_id", { length: 36 }),
    accountId: varchar("account_id", { length: 64 }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    /** Montant dans la devise du foyer : c'est lui que lisent toutes les statistiques. */
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    /** Montant et devise d'origine quand le compte n'est pas dans la devise du foyer (NULL sinon) ; `amount` en est la conversion au cours du jour de l'opération. */
    originalAmount: decimal("original_amount", { precision: 14, scale: 2, mode: "number" }),
    originalCurrency: char("original_currency", { length: 3 }),
    label: varchar("label", { length: 512 }).notNull(),
    merchant: varchar("merchant", { length: 255 }),
    /** Libellé de la banque (export BoursoBank) : le nom du créancier que Finta ne transmet pas. */
    bankLabel: varchar("bank_label", { length: 255 }),
    labelKey: varchar("label_key", { length: 255 }).notNull().default(""),
    status: varchar("status", { length: 16 }).notNull().default("posted"),
    categoryId: varchar("category_id", { length: 16 }),
    categorySource: varchar("category_source", { length: 16 }),
    note: text("note"),
    origin: varchar("origin", { length: 16 }).notNull().default("finta"),
    /** Référence de l'opération chez la source bancaire lue en direct (Enable Banking) : c'est par elle qu'une lecture retrouve sa ligne. */
    bankRef: varchar("bank_ref", { length: 160 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_tx_finta").on(t.fintaId),
    uniqueIndex("uq_tx_bank_ref").on(t.bankRef),
    index("idx_tx_date").on(t.date),
    index("idx_tx_account_date").on(t.accountId, t.date),
    index("idx_tx_category").on(t.categoryId),
    index("idx_tx_label_key").on(t.labelKey),
  ],
);

/** Historique quotidien des soldes. */
export const balances = mysqlTable(
  "balances",
  {
    accountId: varchar("account_id", { length: 64 }).notNull(),
    date: date("date", { mode: "string" }).notNull(),
    balance: decimal("balance", { precision: 14, scale: 2, mode: "number" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.accountId, t.date] })],
);

/** Règles de classement : libellé normalisé → catégorie. */
export const rules = mysqlTable(
  "rules",
  {
    id: int("id").autoincrement().primaryKey(),
    pattern: varchar("pattern", { length: 255 }).notNull(),
    categoryId: varchar("category_id", { length: 16 }).notNull(),
    priority: int("priority").notNull().default(100),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("uq_rules_pattern").on(t.pattern)],
);

/** Journal des synchronisations Finta. */
export const syncRuns = mysqlTable("sync_runs", {
  id: int("id").autoincrement().primaryKey(),
  startedAt: createdAt("started_at"),
  finishedAt: datetime("finished_at", { mode: "string" }),
  status: varchar("status", { length: 16 }).notNull().default("running"),
  source: varchar("source", { length: 16 }).notNull(),
  windowStart: date("window_start", { mode: "string" }),
  txSeen: int("tx_seen").notNull().default(0),
  txNew: int("tx_new").notNull().default(0),
  txAuto: int("tx_auto").notNull().default(0),
  error: text("error"),
});

/**
 * Lignes statistiques : une opération non ventilée = 1 ligne, une opération ventilée = ses lignes
 * de ventilation. Toutes les statistiques lisent cette vue (créée par la migration 006).
 */
export const txLines = mysqlView("tx_lines", {
  id: varchar("id", { length: 160 }).notNull(),
  accountId: varchar("account_id", { length: 64 }).notNull(),
  date: date("date", { mode: "string" }).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
  categoryId: varchar("category_id", { length: 16 }),
  status: varchar("status", { length: 16 }).notNull(),
  splitId: int("split_id").notNull(),
}).existing();
