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
  it("ne dépend d'aucun moteur : une installation neuve démarre sur MariaDB 10.6 comme sur MySQL 8", () => {
    const text = readFileSync("drizzle/initial/schema.sql", "utf8");
    // Une collation prise au serveur de celui qui a écrit le fichier (« utf8mb4_uca1400_ai_ci » de MariaDB 11) est
    // inconnue ailleurs : chaque table dit la sienne, celle de Pécule ou la comparaison binaire.
    const tables = text.match(/^\) ENGINE=.*$/gm) ?? [];
    expect(tables.length).toBeGreaterThan(50);
    for (const options of tables) expect(options).toMatch(/ DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_(unicode_ci|bin);$/);
    expect([...new Set(text.match(/COLLATE[= ]\w+/g))].sort()).toEqual(["COLLATE=utf8mb4_bin", "COLLATE=utf8mb4_unicode_ci"]);
    // Le « ! » de MariaDB à la place de NOT : MySQL annonce le retirer.
    expect(text).not.toMatch(/!exists\(/i);
  });
  it("ne crée aucune ligne : seulement des tables et des vues", () => {
    const text = readFileSync("drizzle/initial/schema.sql", "utf8");
    expect(text).not.toMatch(/^\s*INSERT\s/im);
    expect(text).toMatch(/CREATE TABLE `users`/);
    expect(text).toMatch(/VIEW `tx_lines`/);
  });
});
