import { datetime, foreignKey, index, int, mysqlTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { createdAt, longblob } from "./common.ts";
import { users } from "./auth.ts";

/**
 * Journal d'audit : qui (membre, ou NULL pour le système), par quel canal (`via` : ecran | api |
 * assistant | systeme), a fait quoi (`action`, ex. « PATCH /api/transactions/:id »), sur quoi.
 */
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: int("id").autoincrement().primaryKey(),
    at: createdAt("at"),
    userId: int("user_id"),
    via: varchar("via", { length: 16 }).notNull(),
    action: varchar("action", { length: 96 }).notNull(),
    target: varchar("target", { length: 191 }),
    details: text("details"),
  },
  (t) => [
    index("idx_audit_at").on(t.at),
    index("idx_audit_action").on(t.action, t.target),
    foreignKey({ name: "fk_audit_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("set null"),
  ],
);

/**
 * Alertes techniques (erreur serveur, synchro, cours, plantage) affichées dans Réglages ; une même
 * alerte non résolue se répète en incrémentant `occurrences` au lieu de créer une ligne.
 */
export const alerts = mysqlTable(
  "alerts",
  {
    id: int("id").autoincrement().primaryKey(),
    at: createdAt("at"),
    lastAt: createdAt("last_at"),
    level: varchar("level", { length: 16 }).notNull().default("erreur"),
    source: varchar("source", { length: 32 }).notNull(),
    message: varchar("message", { length: 512 }).notNull(),
    details: text("details"),
    occurrences: int("occurrences").notNull().default(1),
    resolvedAt: datetime("resolved_at", { mode: "string" }),
  },
  (t) => [index("idx_alerts_open").on(t.resolvedAt, t.lastAt)],
);

/**
 * Logos des marques (domaine officiel) et des cryptos (CoinGecko), téléchargés une fois par le
 * serveur puis servis par /api/logos/:key. status = ok | absent (nouvel essai après 7 jours).
 */
export const logos = mysqlTable("logos", {
  key: varchar("key", { length: 150 }).primaryKey(),
  mime: varchar("mime", { length: 40 }),
  data: longblob("data"),
  source: varchar("source", { length: 255 }),
  status: varchar("status", { length: 8 }).notNull().default("ok"),
  fetchedAt: createdAt("fetched_at"),
});

/** Réglages techniques générés par l'appli (ex. clés VAPID des notifications), une valeur par clé. */
export const appKv = mysqlTable("app_kv", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  createdAt: createdAt(),
});

/**
 * Traductions des noms de données (catégories, postes, groupes) : le nom tel qu'il est écrit en base (`source`,
 * dans la langue de celui qui l'a créé) et son nom dans chaque langue de Pécule. Remplie par l'import
 * d'administration ou par Claude quand un nom apparaît ; lue par `GET /api/i18n/data`.
 */
export const dataTranslations = mysqlTable(
  "data_translations",
  {
    source: varchar("source", { length: 191 }).notNull(),
    lang: varchar("lang", { length: 5 }).notNull(),
    text: varchar("text", { length: 191 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.source, t.lang] })],
);

/**
 * Abonnements aux notifications push : un par appareil (endpoint du navigateur), avec les alertes
 * choisies sur cet appareil (prefs, JSON) et le seuil de solde bas.
 */
export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    endpoint: varchar("endpoint", { length: 600 }).notNull(),
    endpointHash: varchar("endpoint_hash", { length: 64 }).notNull(),
    p256dh: varchar("p256dh", { length: 200 }).notNull(),
    auth: varchar("auth", { length: 100 }).notNull(),
    device: varchar("device", { length: 120 }),
    prefs: text("prefs"),
    createdAt: createdAt(),
    lastSentAt: datetime("last_sent_at", { mode: "string" }),
  },
  (t) => [
    uniqueIndex("uq_push_endpoint").on(t.endpointHash),
    foreignKey({ name: "fk_push_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Notifications déjà envoyées (une clé par alerte et par membre) : jamais deux fois la même. */
export const notificationsSent = mysqlTable(
  "notifications_sent",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    key: varchar("key", { length: 191 }).notNull(),
    title: varchar("title", { length: 200 }),
    body: varchar("body", { length: 400 }),
    url: varchar("url", { length: 200 }),
    sentAt: createdAt("sent_at"),
  },
  (t) => [
    uniqueIndex("uq_notif_key").on(t.userId, t.key),
    foreignKey({ name: "fk_notif_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);
