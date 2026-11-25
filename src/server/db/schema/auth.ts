import { bigint, char, datetime, foreignKey, index, int, mysqlTable, text, tinyint, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { blob, createdAt } from "./common.ts";

/** Membres du foyer : pas d'inscription publique. `role` : admin (sauvegarde complète, jeton d'administration) | membre. */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  role: varchar("role", { length: 16 }).notNull().default("membre"),
  /** Langue de Pécule choisie par le membre (fr, en, de, it, es) ; NULL = pas encore choisie (français, ou langue de l'appareil). */
  language: varchar("language", { length: 5 }),
  createdAt: createdAt(),
});

/** Clés d'accès (Face ID / Touch ID) ; `id_hash` = SHA-256 de l'identifiant WebAuthn. */
export const passkeys = mysqlTable(
  "passkeys",
  {
    id: varchar("id", { length: 512 }).notNull(),
    idHash: char("id_hash", { length: 64 }).primaryKey(),
    userId: int("user_id").notNull(),
    publicKey: blob("public_key").notNull(),
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: varchar("transports", { length: 255 }),
    deviceName: varchar("device_name", { length: 120 }),
    createdAt: createdAt(),
    lastUsedAt: datetime("last_used_at", { mode: "string" }),
  },
  (t) => [foreignKey({ name: "fk_passkeys_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade")],
);

/**
 * Mot de passe d'un membre : facultatif, la clé d'accès reste la connexion proposée d'abord. Seule son empreinte
 * (scrypt, avec ses réglages et son sel) est gardée. `failures` et `locked_until` freinent les essais.
 */
export const passwords = mysqlTable(
  "passwords",
  {
    userId: int("user_id").primaryKey(),
    hash: varchar("hash", { length: 255 }).notNull(),
    failures: int("failures").notNull().default(0),
    lockedUntil: datetime("locked_until", { mode: "string" }),
    createdAt: createdAt(),
    /** Dernier changement du mot de passe (écrit par le serveur). */
    changedAt: createdAt("changed_at"),
  },
  (t) => [foreignKey({ name: "fk_passwords_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade")],
);

/** Sessions navigateur : seule l'empreinte du jeton est stockée. */
export const sessions = mysqlTable(
  "sessions",
  {
    tokenHash: char("token_hash", { length: 64 }).primaryKey(),
    userId: int("user_id").notNull(),
    expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: createdAt("last_seen_at"),
    userAgent: varchar("user_agent", { length: 255 }),
    /** Session en mode démo : toutes ses requêtes lisent et écrivent la base de données fictives. */
    demo: tinyint("demo").notNull().default(0),
  },
  (t) => [foreignKey({ name: "fk_sessions_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade")],
);

/** Défis WebAuthn en cours (inscription ou connexion). */
export const authChallenges = mysqlTable("auth_challenges", {
  id: char("id", { length: 64 }).primaryKey(),
  challenge: varchar("challenge", { length: 255 }).notNull(),
  purpose: varchar("purpose", { length: 16 }).notNull(),
  userId: int("user_id"),
  expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
});

/** Liens d'inscription d'un membre (valables 7 jours). */
export const enrollmentTokens = mysqlTable(
  "enrollment_tokens",
  {
    tokenHash: char("token_hash", { length: 64 }).primaryKey(),
    userId: int("user_id").notNull(),
    expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
    usedAt: datetime("used_at", { mode: "string" }),
    createdAt: createdAt(),
  },
  (t) => [foreignKey({ name: "fk_enroll_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade")],
);

/* ---------- Connexion OAuth de l'appli Claude au serveur MCP (src/server/oauth.ts) ---------- */

/** Clients OAuth : enregistrés par Claude (source « dcr », identifiant pcl_…) ou décrits par un document (source « cimd », identifiant = URL). */
export const oauthClients = mysqlTable("oauth_clients", {
  clientId: varchar("client_id", { length: 255 }).primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  /** Tableau JSON des adresses de retour admises. */
  redirectUris: text("redirect_uris").notNull(),
  source: varchar("source", { length: 8 }).notNull(),
  createdAt: createdAt(),
  fetchedAt: datetime("fetched_at", { mode: "string" }),
});

/** Demandes d'autorisation en attente du consentement d'un membre (10 minutes). */
export const oauthRequests = mysqlTable("oauth_requests", {
  idHash: char("id_hash", { length: 64 }).primaryKey(),
  clientId: varchar("client_id", { length: 255 }).notNull(),
  redirectUri: varchar("redirect_uri", { length: 512 }).notNull(),
  state: text("state"),
  codeChallenge: varchar("code_challenge", { length: 64 }).notNull(),
  scope: varchar("scope", { length: 255 }),
  expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
});

/** Accès accordés par un membre à un client : jeton d'accès (1 h) et jeton de renouvellement tournant ; seules les empreintes sont stockées. */
export const oauthGrants = mysqlTable(
  "oauth_grants",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id").notNull(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    clientName: varchar("client_name", { length: 120 }).notNull(),
    scope: varchar("scope", { length: 255 }).notNull(),
    accessHash: char("access_hash", { length: 64 }).notNull(),
    accessExpiresAt: datetime("access_expires_at", { mode: "string" }).notNull(),
    refreshHash: char("refresh_hash", { length: 64 }).notNull(),
    /** Jeton de renouvellement précédent : le revoir trahit un vol, l'accès est alors révoqué. */
    prevRefreshHash: char("prev_refresh_hash", { length: 64 }),
    refreshExpiresAt: datetime("refresh_expires_at", { mode: "string" }).notNull(),
    createdAt: createdAt(),
    lastUsedAt: datetime("last_used_at", { mode: "string" }),
    revokedAt: datetime("revoked_at", { mode: "string" }),
  },
  (t) => [
    uniqueIndex("uq_oauth_grants_access").on(t.accessHash),
    uniqueIndex("uq_oauth_grants_refresh").on(t.refreshHash),
    index("idx_oauth_grants_prev").on(t.prevRefreshHash),
    foreignKey({ name: "fk_oauth_grants_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade"),
  ],
);

/** Codes d'autorisation à usage unique (1 minute), échangés contre un accès. */
export const oauthCodes = mysqlTable(
  "oauth_codes",
  {
    codeHash: char("code_hash", { length: 64 }).primaryKey(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    userId: int("user_id").notNull(),
    redirectUri: varchar("redirect_uri", { length: 512 }).notNull(),
    codeChallenge: varchar("code_challenge", { length: 64 }).notNull(),
    scope: varchar("scope", { length: 255 }).notNull(),
    expiresAt: datetime("expires_at", { mode: "string" }).notNull(),
    usedAt: datetime("used_at", { mode: "string" }),
    /** Accès créé par ce code : révoqué si le code est présenté une seconde fois. */
    grantId: int("grant_id"),
  },
  (t) => [foreignKey({ name: "fk_oauth_codes_user", columns: [t.userId], foreignColumns: [users.id] }).onDelete("cascade")],
);
