import path from "node:path";

/*
 * Où le serveur garde ses sauvegardes (celles d'avant migration, les automatiques, celle que la commande de mise à
 * jour dépose). Personne n'a à le régler : le dossier est choisi pour survivre à une mise à jour, quel que soit
 * l'hébergement.
 *
 *   1. BACKUP_DIR, quand celui qui héberge en donne un ;
 *   2. dans un conteneur (Docker), `data/sauvegardes` de l'installation : c'est le volume « pecule-sauvegardes » ;
 *   3. `data/sauvegardes` de l'installation quand le serveur y a déjà écrit des archives : une installation en
 *      service garde son dossier, rien n'est déplacé ;
 *   4. sinon, un dossier du compte qui fait tourner Pécule, hors de l'installation :
 *      `~/pecule-sauvegardes/<adresse de l'appli>`. Certains hébergeurs installent chaque nouvelle version dans un
 *      dossier neuf : des archives rangées dans l'installation n'y survivraient pas à une mise en ligne ;
 *   5. à défaut (compte sans dossier personnel, ou non inscriptible), `data/sauvegardes` de l'installation.
 *
 * Hors production (développement, tests), toujours `data/sauvegardes` : rien ne s'écrit dans le dossier personnel de
 * celui qui travaille sur le code. Fonctions pures : le système de fichiers est donné par l'appelant (`archives.ts`).
 */

/** Pourquoi ce dossier : réglé par BACKUP_DIR, volume d'un conteneur, déjà utilisé, dossier du compte, ou repli dans l'installation. */
export type BackupDirReason = "reglage" | "conteneur" | "existant" | "compte" | "installation";
export type BackupDirChoice = { dir: string; reason: BackupDirReason };

/** Dossier commun, dans le compte du serveur, aux sauvegardes de toutes les installations de Pécule qu'il héberge. */
export const HOME_FOLDER = "pecule-sauvegardes";

/**
 * Nom du sous-dossier d'une installation : l'adresse où elle est servie (« pecule.exemple.fr », « localhost-3000 »).
 * Deux installations du même compte ne mélangent pas leurs archives, et on reconnaît la sienne en ouvrant le dossier.
 */
export function installFolderName(appUrl: string): string {
  let host = "pecule";
  try {
    const u = new URL(appUrl);
    host = `${u.hostname}${u.port ? `-${u.port}` : ""}`;
  } catch {
    // Adresse illisible : un nom fixe.
  }
  const clean = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.-]+|[.-]+$/g, "");
  return clean || "pecule";
}

export type BackupDirContext = {
  /** BACKUP_DIR, s'il est donné. */
  explicit?: string;
  /** Racine de l'installation (le dossier qui porte `package.json`). */
  root: string;
  /** Dossier personnel du compte qui fait tourner le serveur ; vide ou absent s'il n'en a pas. */
  home?: string | null;
  /** Adresse de l'appli (APP_URL). */
  appUrl: string;
  production: boolean;
  /** Le serveur tourne dans un conteneur. */
  container: boolean;
  /** Le dossier (ou, s'il n'existe pas encore, son premier parent qui existe) est-il inscriptible ? */
  writable: (dir: string) => boolean;
  /** Le serveur a-t-il déjà écrit des archives dans ce dossier (automatiques ou d'avant migration) ? */
  hasServerArchives: (dir: string) => boolean;
};

/** Un dossier personnel utilisable : un chemin absolu qui n'est pas la racine du disque. */
const usableHome = (home: string | null | undefined): home is string => !!home && path.isAbsolute(home) && path.resolve(home) !== path.parse(path.resolve(home)).root;

export function chooseBackupDir(c: BackupDirContext): BackupDirChoice {
  const inside = path.join(c.root, "data", "sauvegardes");
  if (c.explicit) return { dir: path.resolve(c.explicit), reason: "reglage" };
  if (c.container) return { dir: inside, reason: "conteneur" };
  if (!c.production) return { dir: inside, reason: "installation" };
  if (c.hasServerArchives(inside)) return { dir: inside, reason: "existant" };
  if (usableHome(c.home)) {
    const dir = path.join(path.resolve(c.home), HOME_FOLDER, installFolderName(c.appUrl));
    if (c.writable(dir)) return { dir, reason: "compte" };
  }
  return { dir: inside, reason: "installation" };
}
