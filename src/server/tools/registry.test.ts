import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolError, inputError, jsonSchema } from "./registry.ts";

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
