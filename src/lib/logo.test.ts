import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asFond, asHomeTheme, homeIconId, logoId, logoSrc, LOGO_FONDS, LOGO_THEMES, manifestSrc, tabIconSrc, touchIconSrc, type LogoId } from "./logo.ts";
import { SEASONS } from "./seasons.ts";

describe("logo", () => {
  it("le thème du moment prime sur le fond choisi", () => {
    expect(logoId(null, "nuit")).toBe("nuit");
    expect(logoId("noel", "nuit")).toBe("noel");
  });

  it("retombe sur le fond pétrole quand la valeur gardée est inconnue", () => {
    expect(asFond(null)).toBe("petrole");
    expect(asFond("violet")).toBe("petrole");
    expect(asFond("sable")).toBe("sable");
  });

  it("l'icône de l'écran d'accueil est le thème choisi, sinon le coffre de tous les jours", () => {
    expect(homeIconId(null, "foret")).toBe("foret");
    expect(homeIconId("base", "foret")).toBe("foret");
    expect(homeIconId("halloween", "foret")).toBe("halloween");
    expect(asHomeTheme("toString")).toBeNull();
  });

  it("propose les dix thèmes de l'année", () => {
    expect([...LOGO_THEMES].sort()).toEqual(Object.keys(SEASONS).sort());
  });

  it("chaque déclinaison a ses fichiers (node scripts/logo.mjs)", () => {
    const ids: LogoId[] = [...LOGO_FONDS.map((f) => f.id), ...LOGO_THEMES];
    for (const id of ids) {
      for (const src of [logoSrc(id), tabIconSrc(id), touchIconSrc(id), manifestSrc(id), `/icons/coffre/${id}-192.png`, `/icons/coffre/${id}-512.png`]) {
        expect(existsSync(`public${src}`), src).toBe(true);
      }
      // Le logo porte les calques que l'écran de connexion anime.
      const svg = readFileSync(`public${logoSrc(id)}`, "utf8");
      for (const layer of ["c-open", "c-closed", "c-halo", "c-sparks"]) expect(svg, `${id} ${layer}`).toContain(`class="${layer}"`);
    }
  });

  it("le script d'apparence connaît les mêmes fonds et les mêmes thèmes", () => {
    const init = readFileSync("public/theme-init.js", "utf8");
    expect(init).toContain(JSON.stringify(LOGO_FONDS.map((f) => f.id)));
    for (const id of LOGO_THEMES) expect(init, id).toContain(`"${id}"`);
  });
});
