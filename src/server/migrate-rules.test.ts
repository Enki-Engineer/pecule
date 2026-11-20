import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alreadyDone, TABLE_OPTIONS, withTableOptions } from "./migrate-rules.ts";

describe("alreadyDone", () => {
  it("reconnaît une instruction de structure dont l'effet est déjà là", () => {
    for (const code of ["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_TABLE_EXISTS_ERROR", "ER_FK_DUP_NAME", "ER_CANT_DROP_FIELD_OR_KEY"]) expect(alreadyDone(Object.assign(new Error("x"), { code })), code).toBe(true);
  });
  it("laisse passer toute autre erreur", () => {
    for (const code of ["ER_PARSE_ERROR", "ER_BAD_FIELD_ERROR", "ER_DUP_ENTRY", "ER_NO_SUCH_TABLE", "ECONNRESET"]) expect(alreadyDone(Object.assign(new Error("x"), { code })), code).toBe(false);
    expect(alreadyDone(new Error("Duplicate column name 'topic'"))).toBe(false);
    expect(alreadyDone(null)).toBe(false);
    expect(alreadyDone("ER_DUP_FIELDNAME")).toBe(false);
  });
});

describe("withTableOptions", () => {
  const table = "CREATE TABLE `goals` (\n\t`id` int AUTO_INCREMENT NOT NULL,\n\t`name` varchar(80) NOT NULL,\n\tCONSTRAINT `goals_id` PRIMARY KEY(`id`)\n)";

  it("ajoute le jeu de caractères et la collation de Pécule à une table qui ne les dit pas", () => {
    expect(withTableOptions(`${table};`)).toBe(`${table} ${TABLE_OPTIONS};`);
    expect(withTableOptions(table)).toBe(`${table} ${TABLE_OPTIONS}`);
    expect(withTableOptions(`${table} ENGINE=InnoDB;\n`)).toBe(`${table} ENGINE=InnoDB ${TABLE_OPTIONS};`);
    expect(withTableOptions(`-- objectifs d'épargne\ncreate table if not exists \`goals\` (\`id\` int);`)).toBe(`-- objectifs d'épargne\ncreate table if not exists \`goals\` (\`id\` int) ${TABLE_OPTIONS};`);
  });
  it("laisse une table qui les dit déjà", () => {
    for (const options of ["DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin", "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci", "COLLATE=utf8mb4_bin", "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"])
      expect(withTableOptions(`${table} ${options};`), options).toBe(`${table} ${options};`);
  });
  it("ne touche à aucune autre instruction", () => {
    for (const sql of [
      "ALTER TABLE `goals` ADD `target` decimal(12,2);",
      "CREATE INDEX `idx_goals_name` ON `goals` (`name`);",
      "CREATE OR REPLACE VIEW `v` AS select `id` from `goals`;",
      "CREATE TABLE `copie` AS SELECT `id` FROM `goals` WHERE `id` IN (1, 2);",
      "CREATE TABLE `copie` LIKE `goals`;",
      "UPDATE `goals` SET `name` = 'CREATE TABLE (x)' WHERE `id` = 1;",
    ])
      expect(withTableOptions(sql), sql).toBe(sql);
  });
  it("vaut pour toutes les tables créées par les migrations du dépôt", () => {
    const created = readdirSync("drizzle")
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .flatMap((f) => readFileSync(`drizzle/${f}`, "utf8").split("--> statement-breakpoint"))
      .map((sql) => sql.trim())
      .filter((sql) => /^CREATE TABLE/i.test(sql));
    expect(created.length).toBeGreaterThan(0);
    for (const sql of created) expect(withTableOptions(sql), sql.slice(0, 60)).toMatch(/\) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;?$/);
  });
});
