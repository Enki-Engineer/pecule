import { char, datetime, decimal, foreignKey, index, int, longtext, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";
import { createdAt, updatedAt } from "./common.ts";
import { users } from "./auth.ts";

/** Fils de l'assistant : historique append-only (messages API + affichage) et action en attente. */
export const assistantThreads = mysqlTable(
  "assistant_threads",
  {
    id: char("id", { length: 36 }).primaryKey(),
    userId: int("user_id").notNull(),
    messages: longtext("messages").notNull(),
    display: longtext("display").notNull(),
    pending: longtext("pending"),
    inputTokens: int("input_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_threads_user").on(t.userId, t.updatedAt),
    foreignKey({ name: "fk_threads_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/**
 * Actions proposées par l'assistant : une ligne par écriture soumise à confirmation. L'empreinte
 * (outil + paramètres) garantit qu'on exécute ce qui a été montré ; la validité limite une
 * confirmation tardive ; le passage pending → running est atomique (pas de double exécution).
 * status : pending | running | done | declined | error | expired.
 */
export const assistantActions = mysqlTable(
  "assistant_actions",
  {
    id: char("id", { length: 36 }).primaryKey(),
    threadId: char("thread_id", { length: 36 }).notNull(),
    userId: int("user_id").notNull(),
    toolUseId: varchar("tool_use_id", { length: 64 }).notNull(),
    tool: varchar("tool", { length: 64 }).notNull(),
    input: text("input").notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    details: text("details"),
    fingerprint: char("fingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    result: text("result"),
    createdAt: createdAt(),
    expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
    decidedAt: datetime("decided_at", { mode: "string" }),
  },
  (t) => [
    index("idx_actions_thread").on(t.threadId, t.status),
    index("idx_actions_fingerprint").on(t.userId, t.fingerprint),
    foreignKey({ name: "fk_actions_thread", columns: [t.threadId], foreignColumns: [assistantThreads.id] }).onDelete("cascade"),
    foreignKey({ name: "fk_actions_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/**
 * Consommation de Claude par appel (assistant, lecture de facture, classement d'articles) : jetons
 * et coût calculé au tarif du modèle, en dollars (facturation Foundry) et en euros (taux du jour).
 */
export const aiUsage = mysqlTable(
  "ai_usage",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id"),
    threadId: char("thread_id", { length: 36 }),
    feature: varchar("feature", { length: 24 }).notNull(),
    model: varchar("model", { length: 64 }).notNull(),
    inputTokens: int("input_tokens").notNull().default(0),
    cacheWriteTokens: int("cache_write_tokens").notNull().default(0),
    cacheReadTokens: int("cache_read_tokens").notNull().default(0),
    outputTokens: int("output_tokens").notNull().default(0),
    costUsd: decimal("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    costEur: decimal("cost_eur", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_ai_usage_date").on(t.createdAt),
    index("idx_ai_usage_thread").on(t.threadId),
    foreignKey({ name: "fk_ai_usage_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

/**
 * Mémoire de l'assistant, par membre : faits durables donnés au fil des conversations (« j'étais en
 * vacances en août », « le prélèvement en zlotys est YouTube Premium revendu sur Spliit »). Injectés
 * dans les consignes ; visibles et effaçables dans Réglages.
 */
export const assistantMemories = mysqlTable(
  "assistant_memories",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    content: varchar("content", { length: 500 }).notNull(),
    threadId: char("thread_id", { length: 36 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_memories_user").on(t.userId, t.createdAt),
    foreignKey({ name: "fk_memories_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);
