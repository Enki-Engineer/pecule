import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Le schéma de départ (`drizzle/initial/schema.sql`) doit contenir toutes les migrations du dépôt : après en avoir
 * ajouté une, relancer `pnpm local base && pnpm db:initial`.
 */
describe("schéma de départ", () => {
  it("est à jour de la dernière migration", () => {
    const file = "drizzle/initial/schema.sql";
    expect(existsSync(file), "pnpm db:initial n'a jamais été lancé").toBe(true);
    const upTo = /^-- inclut-jusqu-a: (.+)$/m.exec(readFileSync(file, "utf8"))?.[1]?.trim();
    const last = readdirSync("drizzle")
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort()
      .at(-1);
    // Dépôt à l'histoire repliée et sans migration écrite depuis : la dernière est alors la dernière des repliées.
    const folded = existsSync("drizzle/initial/incluses.txt")
      ? readFileSync("drizzle/initial/incluses.txt", "utf8")
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"))
      : [];
    expect(upTo, "relancer pnpm db:initial après une nouvelle migration").toBe(last ? `drizzle/${last}` : folded.at(-1));
  });
  it("ne crée aucune ligne : seulement des tables et des vues", () => {
    const text = readFileSync("drizzle/initial/schema.sql", "utf8");
    expect(text).not.toMatch(/^\s*INSERT\s/im);
    expect(text).toMatch(/CREATE TABLE `users`/);
    expect(text).toMatch(/VIEW `tx_lines`/);
  });
});
