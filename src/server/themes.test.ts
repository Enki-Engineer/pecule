import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import { deviceSeasonMode, themesContext } from "./themes.ts";

const run = (header: string | undefined) => {
  let seen: string | null = null;
  themesContext({ get: (name: string) => (name.toLowerCase() === "x-themes" ? header : undefined) } as unknown as Request, {} as Response, () => {
    seen = deviceSeasonMode();
  });
  return seen;
};

describe("réglage des thèmes de l'appareil, vu du serveur", () => {
  it("suit ce que dit l'écran", () => {
    expect(run("tout")).toBe("tout");
    expect(run("fetes")).toBe("fetes");
    expect(run("aucun")).toBe("aucun");
  });

  it("vaut « aucun » sans en-tête ou devant une valeur inconnue (jeton, serveur MCP, ancien écran)", () => {
    expect(run(undefined)).toBe("aucun");
    expect(run("")).toBe("aucun");
    expect(run("n'importe quoi")).toBe("aucun");
  });

  it("vaut « aucun » hors d'une requête (tâche de fond)", () => {
    expect(deviceSeasonMode()).toBe("aucun");
  });
});
