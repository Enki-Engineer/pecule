import { describe, expect, it } from "vitest";
import { alertOf, describeError, entryScript, errorSignature, screenPath, worthReporting } from "./client-errors.ts";

describe("erreurs d'affichage remontées", () => {
  it("tait ce qui n'est pas une panne de Pécule", () => {
    expect(worthReporting("TypeError: Cannot read properties of undefined (reading 'history')")).toBe(true);
    for (const noise of [
      "",
      "   ",
      "Script error.",
      "ResizeObserver loop completed with undelivered notifications.",
      "TypeError: Failed to fetch",
      "TypeError: Load failed",
      "AbortError: The operation was aborted.",
      "TypeError: Failed to fetch dynamically imported module: https://exemple.test/assets/Budget-ab12.js",
      "TypeError: Importing a module script failed.",
      "ApiError: Trop de demandes : réessaie dans un instant.",
      "ApiError: Conversation introuvable",
      "NetworkError: La connexion Internet semble interrompue.",
    ])
      expect(worthReporting(noise), noise).toBe(false);
    expect(worthReporting("TypeError: x is not a function", "at f (chrome-extension://abcdef/content.js:1:2)")).toBe(false);
    expect(worthReporting("TypeError: x is not a function", "at f (https://exemple.test/assets/index-ab12.js:1:2)")).toBe(true);
    // Le mot au milieu d'un message ne suffit pas : seul un refus du serveur, nommé en tête, est tu.
    expect(worthReporting("TypeError: ApiError: x is not a constructor")).toBe(true);
  });

  it("décrit ce qui a été lancé, quelle qu'en soit la forme", () => {
    const e = new RangeError("Invalid time value");
    expect(describeError(e).message).toBe("RangeError: Invalid time value");
    expect(describeError(e).stack).toContain("RangeError");
    expect(describeError("texte nu")).toEqual({ message: "texte nu", stack: "" });
    expect(describeError({ message: "objet" })).toEqual({ message: "objet", stack: "" });
    expect(describeError(undefined)).toEqual({ message: "", stack: "" });
    expect(describeError(42).message).toBe("42");
  });

  it("reconnaît la même erreur à son message et à la première ligne de sa pile", () => {
    const chrome = "TypeError: a\n    at Courbe (https://exemple.test/assets/index-ab12.js:10:5)\n    at div";
    const later = "TypeError: a\n    at Courbe (https://exemple.test/assets/index-ab12.js:10:5)\n    at span";
    const safari = "Courbe@https://exemple.test/assets/index-ab12.js:10:5\ndiv";
    expect(errorSignature("TypeError: a", chrome)).toBe(errorSignature("TypeError: a", later));
    expect(errorSignature("TypeError: a", chrome)).not.toBe(errorSignature("TypeError: b", chrome));
    expect(errorSignature("TypeError: a", safari)).toContain("Courbe@");
    expect(errorSignature("TypeError: a")).toBe("TypeError: a\n");
  });

  it("ne garde de l'adresse que le chemin de l'écran", () => {
    expect(screenPath("https://exemple.test/operations?q=loyer&a_classer=1#haut")).toBe("/operations");
    expect(screenPath("/patrimoine/crypto?source=3")).toBe("/patrimoine/crypto");
    expect(screenPath("")).toBe("/");
  });

  it("lit le fichier d'entrée d'une page construite", () => {
    expect(entryScript('<head><script type="module" crossorigin src="/assets/index-Ab12_cd.js"></script></head>')).toBe("index-Ab12_cd.js");
    expect(entryScript('<script src="/theme-init.js"></script>')).toBeNull();
    expect(entryScript('<script type="module" src="/src/client/app.tsx"></script>')).toBeNull();
  });

  it("écrit une alerte qui regroupe par écran et par erreur, et dit sur quelle construction tournait l'appareil", () => {
    const report = { kind: "rendu" as const, message: "TypeError: Cannot read properties of undefined (reading 'history')", stack: "TypeError: …\n    at Courbe (index-ab12.js:1:2)", component: "\n    at Courbe\n    at Crypto", path: "/patrimoine/crypto", build: "index-ab12.js" };
    const stale = alertOf(report, { member: "Camille", agent: "Mozilla/5.0", current: "index-ef34.js" });
    expect(stale.message).toBe("Écran en panne (/patrimoine/crypto) : TypeError: Cannot read properties of undefined (reading 'history')");
    expect(stale.details).toContain("Membre : Camille");
    expect(stale.details).toContain("pas celle en service (index-ef34.js)");
    expect(stale.details).toContain("Composants :\nat Courbe");
    const fresh = alertOf(report, { member: "Camille", agent: "", current: "index-ab12.js" });
    expect(fresh.details).toContain("index-ab12.js — celle en service");
    expect(fresh.details).toContain("Navigateur : inconnu");
    expect(fresh.message).toBe(stale.message);
    const script = alertOf({ kind: "promesse", message: "x".repeat(900), path: "/" }, { member: "Alex", agent: "", current: null });
    expect(script.message.startsWith("Erreur de script à l'écran (/) : xxx")).toBe(true);
    expect(script.message.length).toBeLessThan(360);
    expect(script.details).toContain("Construction de l'écran : inconnue");
    expect(script.details).not.toContain("Pile :");
    const full = alertOf({ kind: "script", message: "Error: a", path: "https://exemple.test/operations?q=loyer#haut" }, { member: "Alex", agent: "", current: null });
    expect(full.message).toBe("Erreur de script à l'écran (/operations) : Error: a");
    expect(full.details).not.toContain("loyer");
  });
});
