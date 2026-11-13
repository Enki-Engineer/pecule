import { customType, datetime } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

/*
 * Conventions du schéma : clés TypeScript en camelCase, colonnes en
 * snake_case nommées explicitement ; dates et date-heures en chaînes (le pool mysql2 est en
 * `dateStrings`) ; DECIMAL lus en nombres (`decimalNumbers`) ; booléens en TINYINT(1) 0/1,
 * comme le SQL existant. Le schéma décrit la base de prod telle que créée par les migrations
 * 001 à 007 (contrôle : `pnpm db:check`).
 */

/** BLOB / LONGBLOB : contenu binaire (clés publiques des passkeys, fichiers des factures). */
export const blob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "blob" });
export const longblob = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "longblob" });

/** DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP. */
export const createdAt = (name = "created_at") => datetime(name, { mode: "string" }).notNull().default(sql`CURRENT_TIMESTAMP`);

/**
 * DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP. Drizzle ne sait pas
 * décrire « ON UPDATE » sur un DATETIME (seulement sur TIMESTAMP) : la base le fait déjà (migrations
 * 001 à 006) et `$onUpdate` couvre les mises à jour écrites avec Drizzle.
 */
export const updatedAt = (name = "updated_at") =>
  datetime(name, { mode: "string" })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`)
    .$onUpdate(() => sql`CURRENT_TIMESTAMP`);
