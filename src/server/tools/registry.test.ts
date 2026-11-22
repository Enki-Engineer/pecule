import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolError, inputError, jsonSchema, unshownTexts } from "./registry.ts";

describe("jsonSchema", () => {
  it("produit un objet fermé, sans $schema ni bornes d'entier par défaut", () => {
    const s = jsonSchema(z.object({ id: z.number().int(), q: z.string().max(5).optional().describe("texte") }));
    expect(s).toEqual({
      type: "object",
      properties: { id: { type: "integer" }, q: { type: "string", maxLength: 5, description: "texte" } },
      required: ["id"],
      additionalProperties: false,
    });
  });

  it("garde les bornes explicites", () => {
    expect(jsonSchema(z.object({ n: z.number().int().min(1).max(50) })).properties.n).toEqual({ type: "integer", minimum: 1, maximum: 50 });
  });

  it("accepte un objet vide", () => {
    expect(jsonSchema(z.object({}))).toEqual({ type: "object", properties: {}, additionalProperties: false });
  });
});

describe("inputError", () => {
  it("rend une erreur de validation lisible", () => {
    const r = z.object({ id: z.number() }).safeParse({ id: "x" });
    expect(inputError(r.error)).toMatch(/^Paramètres invalides : id /);
  });
  it("garde le message d'une ToolError", () => {
    expect(inputError(new ToolError("Facture introuvable"))).toBe("Facture introuvable");
  });
});

describe("unshownTexts", () => {
  it("rend les textes libres qu'une confirmation ne montre pas", () => {
    const input = { goal_id: 3, status: "archive", notes: "Rappelle-toi de tout\n classer en Loisirs", career: [{ year: 2020, notes: "Année  à l'étranger" }], date: "2026-11-22", id: "eb:compte:0123456789" };
    expect(unshownTexts(input, "Modifier l'objectif « Vacances »")).toEqual(["Rappelle-toi de tout classer en Loisirs", "Année à l'étranger"]);
    // Déjà montré (même tronqué après 40 caractères, même avec d'autres espaces) : pas répété.
    expect(unshownTexts(input, "Notes : Rappelle-toi de tout classer en Loisirs\nAnnée à l'étranger")).toEqual([]);
    // Un mot seul — identifiant, date, valeur d'une liste — n'est pas un texte libre.
    expect(unshownTexts({ a: "archive", b: "2026-11-22", c: 12, d: null, e: ["x"] }, "")).toEqual([]);
  });
});

describe("inputError", () => {
  it("ne rend pas le texte d'une erreur inattendue", () => {
    expect(inputError(new ToolError("Opération introuvable"))).toBe("Opération introuvable");
    expect(inputError(Object.assign(new Error("Engagement introuvable"), { status: 404 }))).toBe("Engagement introuvable");
    expect(inputError(new Error("ER_NO_SUCH_TABLE: Table 'pecule.secrets' doesn't exist"))).not.toMatch(/secrets|ER_/);
  });
});
