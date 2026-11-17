import { describe, expect, it } from "vitest";
import { archiveCompatibility, chunkPlacement, isArchiveName, percent } from "./restore.ts";

describe("archive et version du code", () => {
  const known = ["drizzle/0001_a.sql", "drizzle/0002_b.sql", "drizzle/0003_c.sql", "drizzle/0004_d.sql"];

  it("accepte une archive de la même version ou d'une plus ancienne encore reprise", () => {
    expect(archiveCompatibility("drizzle/0004_d.sql", known, [])).toBe("ok");
    expect(archiveCompatibility("drizzle/0001_a.sql", known, [])).toBe("ok");
    expect(archiveCompatibility("drizzle/0002_b.sql", known, ["drizzle/0001_a.sql", "drizzle/0002_b.sql"])).toBe("ok");
  });

  it("refuse une archive d'une version plus récente", () => {
    expect(archiveCompatibility("drizzle/0005_e.sql", known, [])).toBe("trop-recente");
  });

  it("refuse une archive à qui il manque des migrations repliées", () => {
    expect(archiveCompatibility("drizzle/0001_a.sql", known, ["drizzle/0001_a.sql", "drizzle/0002_b.sql"])).toBe("trop-ancienne");
    expect(archiveCompatibility(null, known, ["drizzle/0001_a.sql"])).toBe("trop-ancienne");
  });

  it("laisse passer une base sans migration notée tant que rien n'est replié", () => {
    expect(archiveCompatibility(null, known, [])).toBe("ok");
  });
});

describe("morceaux d'archive", () => {
  it("écrit le morceau qui suit ce qui est déjà là", () => {
    expect(chunkPlacement(0, 0, 100)).toBe("ecrire");
    expect(chunkPlacement(400, 400, 100)).toBe("ecrire");
  });

  it("accepte sans le réécrire un morceau renvoyé après une coupure", () => {
    expect(chunkPlacement(500, 400, 100)).toBe("deja-recu");
    expect(chunkPlacement(500, 0, 100)).toBe("deja-recu");
  });

  it("refuse un trou ou un chevauchement", () => {
    expect(chunkPlacement(400, 500, 100)).toBe("decale");
    expect(chunkPlacement(450, 400, 100)).toBe("decale");
  });
});

describe("noms et avancement", () => {
  it("ne prend qu'un zip du dossier, jamais un chemin", () => {
    expect(isArchiveName("pecule-sauvegarde-2026-11-17-0810.zip")).toBe(true);
    expect(isArchiveName("pecule-avant-migration-2026-11-17-0810-m32-ab12cd34.zip")).toBe(true);
    expect(isArchiveName("../secret.zip")).toBe(false);
    expect(isArchiveName("dossier/archive.zip")).toBe(false);
    expect(isArchiveName(".cache.zip")).toBe(false);
    expect(isArchiveName("archive.zip.partiel")).toBe(false);
  });

  it("borne le pourcentage", () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(50, 200)).toBe(25);
    expect(percent(300, 200)).toBe(100);
  });
});
