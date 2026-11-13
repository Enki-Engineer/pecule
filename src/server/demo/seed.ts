import { getTableName, notInArray, sql } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { db } from "../db.ts";
import * as schema from "../db/schema/index.ts";
import { DEMO_TABLES, type DemoData, type DemoTable, KEPT_KV, buildDemoData, tablesToClear } from "./data.ts";

/*
 * Remise à zéro de la base démo : dans une seule transaction (une seule connexion), contrôle des clés
 * étrangères suspendu, toutes les tables du schéma vidées (sauf `logos` et la clé VAPID d'app_kv),
 * données fictives insérées par lots, puis `app_kv['demo:seeded']` = horodatage ISO de la remise à zéro.
 * À appeler dans le contexte démo : `db` vise alors la base démo.
 */

const BATCH = 400;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Insère les lignes d'une table par lots (types vérifiés par DemoData : une ligne = `$inferInsert` de sa table). */
async function insertAll<K extends DemoTable>(tx: Tx, key: K, data: DemoData): Promise<number> {
  const table = schema[key] as MySqlTable;
  const rows = data[key] as MySqlTable["$inferInsert"][];
  for (let i = 0; i < rows.length; i += BATCH) await tx.insert(table).values(rows.slice(i, i + BATCH));
  return rows.length;
}

export async function seedDemo(opts: { today?: Date; users: { id: number; name: string }[] }): Promise<{ counts: Record<string, number> }> {
  const data = buildDemoData(opts.today ?? new Date(), opts.users);
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 0`);
    try {
      for (const { table } of tablesToClear()) {
        if (table === schema.appKv) await tx.delete(schema.appKv).where(notInArray(schema.appKv.key, KEPT_KV));
        else await tx.delete(table);
      }
      for (const key of DEMO_TABLES) counts[getTableName(schema[key])] = await insertAll(tx, key, data);
      const seededAt = new Date().toISOString();
      await tx.insert(schema.appKv).values({ key: "demo:seeded", value: seededAt }).onDuplicateKeyUpdate({ set: { value: seededAt } });
    } finally {
      // La variable vit sur la connexion, rendue ensuite au pool : on la rétablit dans tous les cas.
      await tx.execute(sql`SET FOREIGN_KEY_CHECKS = 1`);
    }
  });
  return { counts };
}
