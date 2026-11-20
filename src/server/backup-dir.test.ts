import path from "node:path";
import { describe, expect, it } from "vitest";
import { chooseBackupDir, installFolderName, type BackupDirContext } from "./backup-dir.ts";

const root = path.resolve("/srv/versions/42/pecule");
const home = path.resolve("/home/alex");
const inside = path.join(root, "data", "sauvegardes");
const base: BackupDirContext = { root, home, appUrl: "https://pecule.exemple.fr", production: true, container: false, writable: () => true, hasServerArchives: () => false };

describe("dossier d'une installation", () => {
  it("porte l'adresse de l'appli, avec son port s'il y en a un", () => {
    expect(installFolderName("https://pecule.exemple.fr")).toBe("pecule.exemple.fr");
    expect(installFolderName("https://Pecule.Exemple.fr/")).toBe("pecule.exemple.fr");
    expect(installFolderName("http://localhost:3000")).toBe("localhost-3000");
    expect(installFolderName("http://[::1]:3000")).toBe("1-3000");
  });

  it("ne sort jamais du dossier commun", () => {
    for (const url of ["pas une adresse", "", "https://../..", "https://a/../../b"]) {
      const name = installFolderName(url);
      expect(name).toMatch(/^[a-z0-9][a-z0-9.-]*$/);
      expect(name).not.toContain("..");
    }
  });
});

describe("dossier des sauvegardes du serveur", () => {
  it("par défaut : dans le compte du serveur, hors de l'installation", () => {
    expect(chooseBackupDir(base)).toEqual({ dir: path.join(home, "pecule-sauvegardes", "pecule.exemple.fr"), reason: "compte" });
  });

  it("BACKUP_DIR l'emporte sur tout", () => {
    const explicit = path.resolve("/mnt/disque/pecule");
    expect(chooseBackupDir({ ...base, explicit, container: true, hasServerArchives: () => true })).toEqual({ dir: explicit, reason: "reglage" });
  });

  it("dans un conteneur : le dossier de l'installation, qui est le volume", () => {
    expect(chooseBackupDir({ ...base, container: true })).toEqual({ dir: inside, reason: "conteneur" });
  });

  it("une installation qui a déjà ses archives garde son dossier", () => {
    expect(chooseBackupDir({ ...base, hasServerArchives: (dir) => dir === inside })).toEqual({ dir: inside, reason: "existant" });
  });

  it("sans dossier personnel utilisable, ou non inscriptible : repli dans l'installation", () => {
    for (const h of [undefined, null, "", "/", "relatif"]) expect(chooseBackupDir({ ...base, home: h })).toEqual({ dir: inside, reason: "installation" });
    expect(chooseBackupDir({ ...base, writable: () => false })).toEqual({ dir: inside, reason: "installation" });
  });

  it("hors production : rien ne s'écrit dans le dossier personnel", () => {
    expect(chooseBackupDir({ ...base, production: false })).toEqual({ dir: inside, reason: "installation" });
  });

  it("deux installations du même compte ont chacune leur dossier", () => {
    const a = chooseBackupDir(base).dir;
    const b = chooseBackupDir({ ...base, appUrl: "https://autre.exemple.fr" }).dir;
    expect(a).not.toBe(b);
    expect(path.dirname(a)).toBe(path.dirname(b));
  });
});
