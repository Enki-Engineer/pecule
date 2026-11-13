import { char, date, decimal, foreignKey, index, int, mysqlTable, primaryKey, text, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { createdAt, longblob, updatedAt } from "./common.ts";
import { users } from "./auth.ts";
import { transactions } from "./banque.ts";

/*
 * Factures (20/10/2026) : fichier stocké en base à part, articles, liens n-n avec les
 * opérations et ventilation d'une opération entre plusieurs catégories.
 */

export const invoices = mysqlTable(
  "invoices",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    merchant: varchar("merchant", { length: 120 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    invoiceDate: date("invoice_date", { mode: "string" }),
    orderRef: varchar("order_ref", { length: 80 }),
    invoiceNumber: varchar("invoice_number", { length: 80 }),
    total: decimal("total", { precision: 12, scale: 2, mode: "number" }),
    currency: char("currency", { length: 3 }).notNull().default("EUR"),
    warrantyUntil: date("warranty_until", { mode: "string" }),
    source: varchar("source", { length: 16 }).notNull().default("appli"),
    sourceRef: varchar("source_ref", { length: 160 }),
    notes: text("notes"),
    fileName: varchar("file_name", { length: 255 }),
    fileMime: varchar("file_mime", { length: 80 }),
    fileSize: int("file_size"),
    fileSha256: char("file_sha256", { length: 64 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Facture sans opération attendue (payée par un tiers, carte remplacée…) : exclue du rapprochement. */
    noMatch: tinyint("no_match").notNull().default(0),
  },
  (t) => [
    uniqueIndex("uq_invoices_source_ref").on(t.sourceRef),
    uniqueIndex("uq_invoices_file").on(t.fileSha256),
    index("idx_invoices_date").on(t.invoiceDate),
    index("idx_invoices_merchant").on(t.merchant),
    foreignKey({ name: "fk_invoices_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

export const invoiceFiles = mysqlTable(
  "invoice_files",
  {
    invoiceId: int("invoice_id").primaryKey(),
    content: longblob("content").notNull(),
  },
  (t) => [foreignKey({ name: "fk_invoice_files", columns: [t.invoiceId], foreignColumns: [invoices.id] }).onDelete("cascade")],
);

export const invoiceItems = mysqlTable(
  "invoice_items",
  {
    id: int("id").autoincrement().primaryKey(),
    invoiceId: int("invoice_id").notNull(),
    position: int("position").notNull().default(0),
    label: varchar("label", { length: 512 }).notNull(),
    quantity: decimal("quantity", { precision: 10, scale: 3, mode: "number" }).notNull().default(1),
    amount: decimal("amount", { precision: 12, scale: 2, mode: "number" }),
    categoryId: varchar("category_id", { length: 16 }),
    ref: varchar("ref", { length: 64 }),
    url: varchar("url", { length: 512 }),
  },
  (t) => [
    index("idx_items_invoice").on(t.invoiceId, t.position),
    foreignKey({ name: "fk_items_invoice", columns: [t.invoiceId], foreignColumns: [invoices.id] }).onDelete("cascade"),
  ],
);

export const invoiceTransactions = mysqlTable(
  "invoice_transactions",
  {
    invoiceId: int("invoice_id").notNull(),
    transactionId: varchar("transaction_id", { length: 160 }).notNull(),
    source: varchar("source", { length: 16 }).notNull().default("manuel"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.invoiceId, t.transactionId] }),
    index("idx_invoice_tx").on(t.transactionId),
    foreignKey({ name: "fk_invtx_invoice", columns: [t.invoiceId], foreignColumns: [invoices.id] }).onDelete("cascade"),
    foreignKey({ name: "fk_invtx_tx", columns: [t.transactionId], foreignColumns: [transactions.id] }).onDelete("cascade"),
  ],
);

/** Ventilation d'une opération (montant + catégorie), éventuellement issue d'un article de facture. */
export const transactionSplits = mysqlTable(
  "transaction_splits",
  {
    id: int("id").autoincrement().primaryKey(),
    transactionId: varchar("transaction_id", { length: 160 }).notNull(),
    position: int("position").notNull().default(0),
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }).notNull(),
    categoryId: varchar("category_id", { length: 16 }),
    label: varchar("label", { length: 255 }),
    invoiceItemId: int("invoice_item_id"),
  },
  (t) => [
    index("idx_splits_tx").on(t.transactionId, t.position),
    foreignKey({ name: "fk_splits_tx", columns: [t.transactionId], foreignColumns: [transactions.id] }).onDelete("cascade"),
    foreignKey({ name: "fk_splits_item", columns: [t.invoiceItemId], foreignColumns: [invoiceItems.id] }).onDelete("set null"),
  ],
);
