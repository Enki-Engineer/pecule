import { describe, expect, it } from "vitest";
import { acceptFile, cleanPath, estimateUsd, isSafe, near, sum } from "./imports.ts";

describe("import massif : tri des fichiers", () => {
  it("accepte les documents et les exports bancaires", () => {
    expect(acceptFile("Impôts/2025/avis.pdf", 120_000)).toEqual({ ok: true, mime: "application/pdf" });
    expect(acceptFile("photo.JPG", 900_000)).toEqual({ ok: true, mime: "image/jpeg" });
    expect(acceptFile("banque/export.ofx", 4_000)).toEqual({ ok: true, mime: "application/x-ofx" });
  });
  it("écarte les fichiers techniques, vides, trop gros ou inconnus", () => {
    expect(acceptFile(".DS_Store", 6_000).ok).toBe(false);
    expect(acceptFile("dossier/.cache/avis.pdf", 6_000).ok).toBe(false);
    expect(acceptFile("~$brouillon.pdf", 6_000).ok).toBe(false);
    expect(acceptFile("archive.zip", 6_000).ok).toBe(false);
    expect(acceptFile("vide.pdf", 0).ok).toBe(false);
    expect(acceptFile("enorme.pdf", 21 * 1024 * 1024).ok).toBe(false);
  });
  it("nettoie un chemin", () => {
    expect(cleanPath("..\\Finances\\./Impôts//avis.pdf")).toBe("Finances/Impôts/avis.pdf");
  });
});

describe("import massif : coût et contrôles", () => {
  const price = { input: 4, output: 20 };
  it("n'estime rien pour un export bancaire, et plus pour un long PDF", () => {
    expect(estimateUsd(5_000, "text/csv", price)).toBe(0);
    expect(estimateUsd(600_000, "application/pdf", price)).toBeGreaterThan(estimateUsd(60_000, "application/pdf", price));
    expect(estimateUsd(60_000, "application/pdf", price)).toBeLessThan(0.15);
  });
  it("compare des montants à la tolérance près", () => {
    expect(near(100, 100.004)).toBe(true);
    expect(near(100, 100.02)).toBe(false);
    expect(near(1000, 1004, 0.01, 0.005)).toBe(true);
    expect(near(null, 3)).toBe(false);
    expect(sum([0.1, 0.2, null])).toBe(0.3);
  });
  it("ne dit « sûr » que sans doute, sans échec et sans changement", () => {
    const ok = { status: "a_relire", checks: [{ ok: true, label: "x" }], confidence: "haute", changes: 0 };
    expect(isSafe(ok)).toBe(true);
    expect(isSafe({ ...ok, confidence: "moyenne" })).toBe(false);
    expect(isSafe({ ...ok, changes: 1 })).toBe(false);
    expect(isSafe({ ...ok, checks: [{ ok: false, label: "x" }] })).toBe(false);
    expect(isSafe({ ...ok, checks: [] })).toBe(false);
    expect(isSafe({ ...ok, status: "valide" })).toBe(false);
  });
});
