import { char, date, datetime, decimal, foreignKey, index, int, mediumtext, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { createdAt, longblob, updatedAt } from "./common.ts";
import { users } from "./auth.ts";

/*
 * Coffre de documents (phase 13) : tout fichier qui n'est pas une facture d'achat (avis d'impôt,
 * contrats, actes, baux, diagnostics, relevés, fiches reprises de Notion…). Type et domaine
 * reconnus par Claude, texte extrait pour la recherche plein texte (index FULLTEXT ajouté à la
 * main dans la migration : Drizzle ne sait pas le décrire). Échéancier : tâches et jalons saisis,
 * complétés à la volée par les échéances calculées (prêts, garanties, documents, impôts).
 */

/** kind : avis_impot | taxe_fonciere | contrat | bail | acte | pret | assurance | releve | diagnostic | fiscal | statuts | devis | prospectus | export | fiche | note | autre. */
export const documents = mysqlTable(
  "documents",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    title: varchar("title", { length: 255 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull().default("autre"),
    /** banque | immobilier | patrimoine | crypto | impots | retraite | revenus | budget | autre */
    domain: varchar("domain", { length: 16 }).notNull().default("autre"),
    /** Nature du contrat (`TOPICS`, src/lib/contracts.ts) : assurance_auto, energie… ; nul pour ce qui n'est pas un contrat comparable. */
    topic: varchar("topic", { length: 24 }),
    entityType: varchar("entity_type", { length: 16 }),
    entityId: varchar("entity_id", { length: 64 }),
    docDate: date("doc_date", { mode: "string" }),
    expiresAt: date("expires_at", { mode: "string" }),
    summary: text("summary"),
    /** Faits clés extraits (JSON : [{ label, value }]). */
    facts: text("facts"),
    contentText: mediumtext("content_text"),
    fileName: varchar("file_name", { length: 255 }),
    fileMime: varchar("file_mime", { length: 80 }),
    fileSize: int("file_size"),
    fileSha256: char("file_sha256", { length: 64 }),
    /** appli | assistant | raccourci | notion | dossier */
    source: varchar("source", { length: 16 }).notNull().default("appli"),
    sourceRef: varchar("source_ref", { length: 191 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_documents_file").on(t.fileSha256),
    uniqueIndex("uq_documents_source_ref").on(t.sourceRef),
    index("idx_documents_domain").on(t.domain, t.docDate),
    index("idx_documents_entity").on(t.entityType, t.entityId),
    index("idx_documents_expires").on(t.expiresAt),
    index("idx_documents_topic").on(t.topic),
    foreignKey({ name: "fk_documents_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

export const documentFiles = mysqlTable(
  "document_files",
  {
    documentId: int("document_id").primaryKey(),
    content: longblob("content").notNull(),
  },
  (t) => [foreignKey({ name: "fk_document_files_doc", columns: [t.documentId], foreignColumns: [documents.id] }).onDelete("cascade")],
);

/**
 * Échéancier : tâches (à cocher, éventuellement récurrentes) et jalons (dates à retenir).
 * kind : tache | jalon ; status : a_faire | fait | abandonne ; recurrence : mensuel | trimestriel | annuel.
 */
export const agendaItems = mysqlTable(
  "agenda_items",
  {
    id: int("id").autoincrement().primaryKey(),
    ownerUserId: int("owner_user_id"),
    kind: varchar("kind", { length: 12 }).notNull().default("tache"),
    title: varchar("title", { length: 255 }).notNull(),
    notes: text("notes"),
    dueDate: date("due_date", { mode: "string" }),
    domain: varchar("domain", { length: 16 }).notNull().default("autre"),
    entityType: varchar("entity_type", { length: 16 }),
    entityId: varchar("entity_id", { length: 64 }),
    amount: decimal("amount", { precision: 14, scale: 2, mode: "number" }),
    status: varchar("status", { length: 12 }).notNull().default("a_faire"),
    doneAt: datetime("done_at", { mode: "string" }),
    recurrence: varchar("recurrence", { length: 12 }),
    source: varchar("source", { length: 16 }).notNull().default("manuel"),
    sourceRef: varchar("source_ref", { length: 191 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("uq_agenda_source_ref").on(t.sourceRef),
    index("idx_agenda_due").on(t.status, t.dueDate),
    foreignKey({ name: "fk_agenda_owner", columns: [t.ownerUserId], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

/** Jetons personnels limités (Raccourci iOS « Envoyer à Pécule ») : seulement le dépôt de fichiers. */
export const apiTokens = mysqlTable(
  "api_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    tokenHash: char("token_hash", { length: 64 }).notNull(),
    scope: varchar("scope", { length: 16 }).notNull().default("depot"),
    createdAt: createdAt(),
    lastUsedAt: datetime("last_used_at", { mode: "string" }),
    revokedAt: datetime("revoked_at", { mode: "string" }),
  },
  (t) => [
    uniqueIndex("uq_api_tokens_hash").on(t.tokenHash),
    foreignKey({ name: "fk_api_tokens_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/*
 * Import massif de documents (phase 28). Un lot = un dossier déposé ; une ligne par fichier, avec son état :
 * envoi (annoncé, pas encore reçu) | attente | lecture | a_relire (proposition prête, rien n'est écrit) |
 * valide (écrit dans les écrans) | range (au coffre ou aux factures, rien d'autre à écrire) | ecarte |
 * doublon (fichier déjà connu avant le lot) | ignore (écarté avant l'envoi : type, taille) | erreur.
 * Le fichier lui-même est au coffre (`document_id`) ou aux factures (`invoice_id`) : rien n'est gardé ici.
 */
export const importBatches = mysqlTable(
  "import_batches",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    /** ouvert | annule */
    status: varchar("status", { length: 12 }).notNull().default("ouvert"),
    /** ecran | cli | mcp */
    source: varchar("source", { length: 12 }).notNull().default("ecran"),
    /** Plafond de dépense d'IA du lot, en euros : atteint, la lecture s'arrête et attend. */
    costCapEur: decimal("cost_cap_eur", { precision: 8, scale: 2, mode: "number" }).notNull().default(5),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_import_batches_user").on(t.userId, t.createdAt), foreignKey({ name: "fk_import_batches_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade")],
);

export const importItems = mysqlTable(
  "import_items",
  {
    id: int("id").autoincrement().primaryKey(),
    batchId: int("batch_id").notNull(),
    /** Chemin dans le dossier déposé (indice pour reconnaître le document). */
    relPath: varchar("rel_path", { length: 500 }).notNull(),
    fileSize: int("file_size").notNull().default(0),
    fileMime: varchar("file_mime", { length: 80 }),
    fileSha256: char("file_sha256", { length: 64 }),
    status: varchar("status", { length: 12 }).notNull().default("envoi"),
    /** Extracteur retenu (src/server/imports/registry.ts), null si le document est seulement rangé. */
    extractor: varchar("extractor", { length: 24 }),
    documentId: int("document_id"),
    invoiceId: int("invoice_id"),
    title: varchar("title", { length: 255 }),
    /** Données lues (JSON), corrections de relecture (JSON), contrôles (JSON), ce que Pécule contient déjà (JSON). */
    proposal: mediumtext("proposal"),
    edits: text("edits"),
    checks: text("checks"),
    existing: text("existing"),
    /** haute | moyenne | basse */
    confidence: varchar("confidence", { length: 8 }),
    /** Journal de ce que la validation a écrit (JSON), pour pouvoir l'annuler. */
    result: mediumtext("result"),
    error: text("error"),
    costEur: decimal("cost_eur", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
    attempts: int("attempts").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_import_items_batch").on(t.batchId, t.status),
    index("idx_import_items_status").on(t.status),
    foreignKey({ name: "fk_import_items_batch", columns: [t.batchId], foreignColumns: [importBatches.id] }).onDelete("cascade"),
  ],
);
