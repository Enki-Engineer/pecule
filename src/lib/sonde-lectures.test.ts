import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cheminDe, HORS_SONDE, lectures } from "../../scripts/sonde/lectures.mjs";

/** Routes de lecture déclarées par les routeurs montés sous /api (`api.get("/…")`, `xxxApi.get("/…")`). */
function declared(): string[] {
  const dir = new URL("../server/routes/", import.meta.url);
  const out = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")))
    for (const m of readFileSync(new URL(file, dir), "utf8").matchAll(/\b(?:api|\w+Api)\.get\(\s*"(\/[^"]*)"/g)) out.add(m[1]);
  return [...out].sort();
}

describe("sonde des lectures", () => {
  const calls = lectures("2026-11-15");
  const probed = new Set(calls.map(cheminDe));

  it("appelle chaque route de lecture sans identifiant, ou dit pourquoi elle reste dehors", () => {
    const missing = declared().filter((route) => !route.includes(":") && !probed.has(route) && !(route in HORS_SONDE));
    expect(missing, "route de lecture absente de scripts/sonde/lectures.mjs (ou de HORS_SONDE, avec sa raison)").toEqual([]);
  });

  it("ne garde hors de la sonde que des routes qui existent", () => {
    const routes = new Set(declared());
    expect(Object.keys(HORS_SONDE).filter((route) => !routes.has(route))).toEqual([]);
  });

  it("couvre le détail d'une période et suit le jour donné", () => {
    expect(probed.has("/months/2026-11")).toBe(true);
    expect(calls).toContain("/analysis/compare?from=2026-11-01&to=2026-11-30&base=prev");
    expect(lectures("2027-01-03")).toContain("/months/2026-12");
    expect(new Set(calls).size).toBe(calls.length);
  });
});
