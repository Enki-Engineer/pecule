import { describe, expect, it } from "vitest";
import { cleanModulesOff, moduleOfPath, pathEnabled } from "./modules.ts";

describe("écrans facultatifs", () => {
  it("rattache une adresse à son écran", () => {
    expect(moduleOfPath("/immobilier")).toBe("immobilier");
    expect(moduleOfPath("/immobilier/3")).toBe("immobilier");
    expect(moduleOfPath("/patrimoine/crypto?vue=1")).toBe("crypto");
    expect(moduleOfPath("/patrimoine")).toBeNull();
    expect(moduleOfPath("/impots/")).toBe("impots");
    expect(moduleOfPath("/")).toBeNull();
    expect(moduleOfPath("/immobilier-autre")).toBeNull();
  });
  it("ne garde que des écrans connus, dans l'ordre du référentiel", () => {
    expect(cleanModulesOff(["retraite", "inconnu", "crypto", "crypto"])).toEqual(["crypto", "retraite"]);
    expect(cleanModulesOff("crypto")).toEqual([]);
    expect(cleanModulesOff(null)).toEqual([]);
  });
  it("dit si une adresse reste affichable", () => {
    expect(pathEnabled("/immobilier/2", ["immobilier"])).toBe(false);
    expect(pathEnabled("/immobilier/2", ["crypto"])).toBe(true);
    expect(pathEnabled("/operations", ["immobilier", "crypto"])).toBe(true);
  });
});
