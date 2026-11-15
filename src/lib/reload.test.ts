import { describe, expect, it } from "vitest";
import { RELOAD_EVERY_MS, canReload } from "./reload.ts";

describe("canReload", () => {
  it("recharge une première fois, en ligne", () => {
    expect(canReload(null, 1_000_000, true)).toBe(true);
  });
  it("ne recharge pas hors ligne : la page de secours n'apporterait pas le morceau manquant", () => {
    expect(canReload(null, 1_000_000, false)).toBe(false);
  });
  it("ne recharge pas en boucle quand le rechargement n'a rien arrangé", () => {
    expect(canReload(1_000_000, 1_000_000 + RELOAD_EVERY_MS - 1, true)).toBe(false);
    expect(canReload(1_000_000, 1_000_000 + RELOAD_EVERY_MS, true)).toBe(true);
  });
});
