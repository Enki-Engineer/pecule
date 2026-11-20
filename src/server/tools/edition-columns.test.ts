import { describe, expect, it } from "vitest";
import { getTableConfig, MySqlTable } from "drizzle-orm/mysql-core";
import * as schema from "../db/schema/index.ts";
import { EDITED_COLUMNS } from "./edition-columns.ts";

describe("colonnes écrites par les outils d'édition", () => {
  const tables = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!(value instanceof MySqlTable)) continue;
    const cfg = getTableConfig(value as MySqlTable);
    tables.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
  }
  for (const [table, columns] of Object.entries(EDITED_COLUMNS)) {
    it(`existent toutes dans « ${table} »`, () => {
      const known = tables.get(table);
      expect(known, `table ${table} absente du schéma`).toBeDefined();
      expect(columns.filter((c) => !known!.has(c))).toEqual([]);
    });
  }
});
