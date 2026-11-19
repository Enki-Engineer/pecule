import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asFond, asHomeTheme, asLogoId, DEFAULT_FOND, HOME_ICON_COOKIE, homeIconId, logoId, logoSrc, LOGO_FONDS, LOGO_THEMES, manifestSrc, pageWithHomeIcon, tabIconSrc, touchIconSrc, type LogoId } from "./logo.ts";
import { SEASONS } from "./seasons.ts";

describe("logo", () => {
  it("le thème du moment prime sur le fond choisi", () => {
    expect(logoId(null, "nuit")).toBe("nuit");
    expect(logoId("noel", "nuit")).toBe("noel");
  });

  it("retombe sur le fond sable quand la valeur gardée est inconnue", () => {
    expect(DEFAULT_FOND).toBe("sable");
    expect(asFond(null)).toBe("sable");
    expect(asFond("violet")).toBe("sable");
    expect(asFond("petrole")).toBe("petrole");
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

  it("le script d'apparence connaît les mêmes fonds, les mêmes thèmes, le même fond d'origine et le même cookie", () => {
    const init = readFileSync("public/theme-init.js", "utf8");
    expect(init).toContain(JSON.stringify(LOGO_FONDS.map((f) => f.id)));
    for (const id of LOGO_THEMES) expect(init, id).toContain(`"${id}"`);
    expect(init).toContain(`fond = "${DEFAULT_FOND}"`);
    expect(init).toContain(`"${HOME_ICON_COOKIE}="`);
  });

  it("avant tout choix, la page, le manifeste et les notifications portent le fond d'origine", () => {
    const page = readFileSync("index.html", "utf8");
    expect(page).toContain(`<link rel="manifest" href="/manifest.webmanifest" />`);
    expect(page).toContain(`<link rel="icon" href="${tabIconSrc(DEFAULT_FOND)}"`);
    expect(page).toContain(`<link rel="apple-touch-icon" href="${touchIconSrc(DEFAULT_FOND)}" />`);
    expect(readFileSync("public/manifest.webmanifest", "utf8")).toBe(readFileSync(`public${manifestSrc(DEFAULT_FOND)}`, "utf8"));
    for (const [copie, taille] of [["apple-touch-icon", 180], ["icon-192", 192], ["icon-512", 512]] as const) {
      expect(readFileSync(`public/icons/${copie}.png`).equals(readFileSync(`public/icons/coffre/${DEFAULT_FOND}-${taille}.png`)), copie).toBe(true);
    }
    const sw = readFileSync("public/sw.js", "utf8");
    expect(sw.match(/\/icons\/coffre\/[a-z0-9-]+-192\.png/g)).toEqual([`/icons/coffre/${DEFAULT_FOND}-192.png`, `/icons/coffre/${DEFAULT_FOND}-192.png`]);
  });

  it("ne reconnaît dans le cookie qu'un logo de la liste", () => {
    expect(asLogoId("foret")).toBe("foret");
    expect(asLogoId("halloween")).toBe("halloween");
    for (const v of [undefined, null, "", "violet", "toString", `sable" onload="x`, ["sable"], 3]) expect(asLogoId(v)).toBeNull();
  });

  it("le serveur écrit dans la page le manifeste et l'icône de l'appli installée", () => {
    const page = readFileSync("index.html", "utf8");
    const ids: LogoId[] = [...LOGO_FONDS.map((f) => f.id), ...LOGO_THEMES];
    for (const id of ids) {
      const sent = pageWithHomeIcon(page, id);
      expect(sent, id).toContain(`<link rel="manifest" href="${manifestSrc(id)}" />`);
      expect(sent, id).toContain(`<link rel="apple-touch-icon" href="${touchIconSrc(id)}" />`);
      // Rien d'autre ne change : ni l'onglet (le script d'apparence le règle selon le thème du jour), ni le reste de la page.
      expect(sent.replace(manifestSrc(id), "/manifest.webmanifest").replace(touchIconSrc(id), touchIconSrc(DEFAULT_FOND)), id).toBe(page);
    }
  });
});
