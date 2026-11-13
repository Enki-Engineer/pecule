import { describe, expect, it } from "vitest";
import { createSealer } from "./secret.ts";

describe("chiffrement des secrets gardés en base", () => {
  const sealer = createSealer("un-secret-de-serveur-de-plus-de-32-caracteres");

  it("rend ce qu'on lui a confié", () => {
    const sealed = sealer.seal("sk-ant-clé-d'essai");
    expect(sealed).not.toContain("sk-ant");
    expect(sealer.open(sealed)).toBe("sk-ant-clé-d'essai");
  });

  it("ne chiffre jamais deux fois pareil", () => {
    expect(sealer.seal("même clé")).not.toBe(sealer.seal("même clé"));
  });

  it("refuse une valeur chiffrée avec un autre secret, altérée ou mal formée", () => {
    const sealed = sealer.seal("clé");
    expect(createSealer("un-autre-secret-de-serveur-tout-aussi-long").open(sealed)).toBeNull();
    const parts = sealed.split(":");
    parts[3] = Buffer.from("autre chose").toString("base64");
    expect(sealer.open(parts.join(":"))).toBeNull();
    for (const bad of ["", "en clair", "v2:a:b:c", "v1:a:b"]) expect(sealer.open(bad), bad).toBeNull();
  });
});
