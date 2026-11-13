import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { bankLogoKey, bankLogoUse, bankLogoVariant, decentIcon, iconSide, isEnableBankingLogo, parseBankLogoKey, pngInk, pngSize } from "./bank-logos.ts";

/** Bloc d'un fichier PNG : longueur, nom, données, puis un contrôle que la lecture ne vérifie pas. */
const chunk = (name: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set([...name].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  return out;
};

/**
 * Petit PNG fabriqué pour l'essai : `type` 0 (gris), 2 (couleur), 4 (gris + transparence) ou 6 (couleur +
 * transparence) ; `lines` donne, pour chaque ligne, son filtre puis ses valeurs déjà filtrées. Les données sont
 * réparties en deux blocs IDAT, comme le fait un vrai fichier.
 */
const png = (width: number, height: number, type: number, lines: number[][], depth = 8, interlace = 0) => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([depth, type, 0, 0, interlace], 8);
  const packed = deflateSync(Uint8Array.from(lines.flat()));
  const half = Math.ceil(packed.length / 2);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", packed.subarray(0, half)), chunk("IDAT", packed.subarray(half)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

const inflate = (data: Uint8Array) => inflateSync(data);

describe("clé d'un logo de banque", () => {
  it("se compose du pays et du nom de la banque, et se relit", () => {
    expect(bankLogoKey("fr", "Banque de Nantes")).toBe("bank:FR:Banque de Nantes");
    expect(parseBankLogoKey("bank:FR:Banque de Nantes")).toEqual({ country: "FR", name: "Banque de Nantes" });
    expect(parseBankLogoKey("bank:fr:Banque de Nantes")).toBeNull();
    expect(parseBankLogoKey("bank:FR:")).toBeNull();
    expect(parseBankLogoKey("d:exemple.fr")).toBeNull();
    expect(parseBankLogoKey(`bank:FR:${"x".repeat(121)}`)).toBeNull();
  });
});

describe("adresse du logo", () => {
  it("n'accepte que le service d'images d'Enable Banking", () => {
    expect(isEnableBankingLogo("https://enablebanking.com/brands/FR/Banque%20de%20Nantes/")).toBe(true);
    expect(isEnableBankingLogo("http://enablebanking.com/brands/FR/Banque/")).toBe(false);
    expect(isEnableBankingLogo("https://enablebanking.com.exemple.fr/brands/FR/Banque/")).toBe(false);
    expect(isEnableBankingLogo("https://exemple.fr/brands/FR/Banque/")).toBe(false);
    expect(isEnableBankingLogo("https://enablebanking.com/ailleurs")).toBe(false);
    expect(isEnableBankingLogo("pas une adresse")).toBe(false);
  });

  it("demande la variante qui tient dans un carré", () => {
    expect(bankLogoVariant("https://enablebanking.com/brands/FR/Banque/")).toBe("https://enablebanking.com/brands/FR/Banque/-/preview/192x192/-/format/png/");
    expect(bankLogoVariant("https://enablebanking.com/brands/FR/Banque")).toBe("https://enablebanking.com/brands/FR/Banque/-/preview/192x192/-/format/png/");
  });
});

describe("pngSize", () => {
  it("lit la taille dans l'en-tête", () => {
    expect(pngSize(png(192, 44, 6, []))).toEqual({ width: 192, height: 44 });
    expect(pngSize(png(0, 44, 6, []))).toBeNull();
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(pngSize(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
  });
});

describe("icône d'un site", () => {
  /** Fichier ICO réduit à son en-tête et à ses entrées : une image par côté donné (256 s'écrit 0). */
  const ico = (...sides: number[]) => {
    const bytes = new Uint8Array(6 + 16 * sides.length);
    bytes.set([0, 0, 1, 0, sides.length, 0]);
    sides.forEach((side, i) => bytes.set([side % 256, side % 256], 6 + i * 16));
    return bytes;
  };

  it("mesure une icône PNG ou ICO, pas les autres formats", () => {
    expect(iconSide(png(180, 120, 6, []))).toBe(180);
    expect(iconSide(ico(16, 48, 32))).toBe(48);
    expect(iconSide(ico(256))).toBe(256);
    expect(iconSide(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(40).fill(0)]))).toBeNull();
    expect(iconSide(new Uint8Array(0))).toBeNull();
  });

  it("tient pour bonne une icône d'au moins 96 points, quel que soit son poids", () => {
    expect(decentIcon(png(180, 180, 6, []))).toBe(true);
    expect(decentIcon(png(48, 48, 6, []))).toBe(false);
    expect(decentIcon(ico(16, 32))).toBe(false);
    expect(decentIcon(ico(256))).toBe(true);
  });

  it("juge au poids un format qu'elle ne mesure pas", () => {
    expect(decentIcon(new Uint8Array(5000).fill(0xff))).toBe(true);
    expect(decentIcon(new Uint8Array(900).fill(0xff))).toBe(false);
  });
});

describe("pngInk", () => {
  it("vaut 0 pour du blanc ou du transparent, 1 pour un aplat noir", () => {
    // Couleur + transparence, 2 × 1 : un point noir opaque, un point noir entièrement transparent.
    expect(pngInk(png(2, 1, 6, [[0, 0, 0, 0, 255, 0, 0, 0, 0]]), inflate)).toBeCloseTo(0.5);
    // Couleur, 2 × 2 : tout blanc.
    expect(pngInk(png(2, 2, 2, [[0, 255, 255, 255, 255, 255, 255], [0, 255, 255, 255, 255, 255, 255]]), inflate)).toBe(0);
    // Gris, 1 × 1 : noir.
    expect(pngInk(png(1, 1, 0, [[0, 0]]), inflate)).toBe(1);
    // Gris + transparence, 2 × 1 : noir à moitié transparent, blanc opaque.
    expect(pngInk(png(2, 1, 4, [[0, 0, 128, 255, 255]]), inflate)).toBeCloseTo(0.251, 2);
  });

  it("compte une couleur vive comme un noir, un gris clair à peine", () => {
    expect(pngInk(png(1, 1, 2, [[0, 255, 128, 0]]), inflate)).toBe(1);
    expect(pngInk(png(1, 1, 2, [[0, 230, 230, 230]]), inflate)).toBeCloseTo(0.098, 3);
  });

  it("défait les filtres des lignes (gauche, dessus, moyenne, Paeth)", () => {
    // Gris, 3 × 4. Ligne 1 « gauche » : 10, 20, 30. Ligne 2 « dessus » : 15, 25, 35. Ligne 3 « moyenne » : 9, 19, 29.
    // Ligne 4 « Paeth » : 9, 19, 29 encore (chaque écart est nul par rapport au point retenu).
    const lines = [
      [1, 10, 10, 10],
      [2, 5, 5, 5],
      [3, 9 - (15 >> 1), 19 - ((9 + 25) >> 1), 29 - ((19 + 35) >> 1)],
      [4, 0, 0, 0],
    ];
    const values = [10, 20, 30, 15, 25, 35, 9, 19, 29, 9, 19, 29];
    const expected = values.reduce((s, v) => s + (1 - v / 255), 0) / values.length;
    expect(pngInk(png(3, 4, 0, lines), inflate)).toBeCloseTo(expected, 6);
  });

  it("renonce devant un format qu'il ne lit pas", () => {
    expect(pngInk(png(1, 1, 3, [[0, 0]]), inflate)).toBeNull(); // palette
    expect(pngInk(png(1, 1, 0, [[0, 0, 0]], 16), inflate)).toBeNull(); // 16 bits
    expect(pngInk(png(1, 1, 0, [[0, 0]], 8, 1), inflate)).toBeNull(); // entrelacé
    expect(pngInk(png(1, 1, 0, [[7, 0]]), inflate)).toBeNull(); // filtre inconnu
    expect(pngInk(png(4, 4, 0, [[0, 0]]), inflate)).toBeNull(); // données trop courtes
    expect(pngInk(png(2000, 2000, 0, []), inflate)).toBeNull(); // trop grande pour une vignette
    expect(
      pngInk(png(1, 1, 0, [[0, 0]]), () => {
        throw new Error("données illisibles");
      }),
    ).toBeNull();
    expect(pngInk(new Uint8Array([1, 2, 3]), inflate)).toBeNull();
  });
});

describe("bankLogoUse", () => {
  const logo = (width: number, height: number, ink: number | null = 0.3) => ({ width, height, ink });

  it("préfère l'icône du site quand elle est bonne, quelle que soit la forme du logo", () => {
    expect(bankLogoUse(logo(192, 192), true)).toBe("site");
    expect(bankLogoUse(logo(192, 44), true)).toBe("site");
    expect(bankLogoUse(null, true)).toBe("site");
  });

  it("à défaut, montre le logo, carré ou allongé", () => {
    expect(bankLogoUse(logo(192, 192), false)).toBe("logo");
    expect(bankLogoUse(logo(192, 44), false)).toBe("logo");
    expect(bankLogoUse(logo(192, 24), false)).toBe("logo");
    expect(bankLogoUse(logo(192, 96, null), false)).toBe("logo");
  });

  it("renonce à un logo démesurément allongé, trop pâle ou illisible", () => {
    expect(bankLogoUse(logo(192, 20), false)).toBe("aucun");
    expect(bankLogoUse(logo(20, 192), false)).toBe("aucun");
    expect(bankLogoUse(logo(192, 39, 0.03), false)).toBe("aucun");
    expect(bankLogoUse(null, false)).toBe("aucun");
  });
});
