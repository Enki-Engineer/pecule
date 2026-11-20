import { DEFAULT_REPO, DOCKER_IMAGE } from "./version.ts";

/*
 * Notes d'une version publiée sur GitHub : un tableau « Installer ou mettre à jour », qui rend visibles les formats
 * sous lesquels la version est livrée, puis ce qui change (la section de CHANGELOG.md). Le tableau est encadré de
 * deux repères : l'appli, qui montre ces notes à l'administrateur avec la commande de son installation à lui, ne
 * garde que ce qui change. Fonctions pures, partagées par `scripts/notes-de-version.mjs`, le serveur et les tests.
 */

/** Repères qui encadrent le tableau des formats dans les notes d'une version. */
export const INSTALL_START = "<!-- installer -->";
export const INSTALL_END = "<!-- /installer -->";

/** Pièces jointes d'une version : les mêmes noms d'une version à l'autre (`scripts/paquet.mjs`). */
export const RELEASE_FILES = { compose: "compose.yaml", tar: "pecule.tar.gz", zip: "pecule.zip", sums: "SHA256SUMS" } as const;

/** L'image Docker d'un dépôt : celle du projet, ou celle d'une copie (`ghcr.io/<propriétaire>/<dépôt>`, en minuscules). */
const imageOf = (repo: string) => (repo === DEFAULT_REPO ? DOCKER_IMAGE : `ghcr.io/${repo.toLowerCase()}`);

/** Le tableau « Installer ou mettre à jour » d'une version, avec les adresses de ses pièces jointes. */
export function installBlock(version: string, repo: string = DEFAULT_REPO): string {
  const tag = `v${version}`;
  const site = `https://github.com/${repo}`;
  const file = (name: string) => `[\`${name}\`](${site}/releases/download/${tag}/${name})`;
  const doc = (name: string) => `${site}/blob/${tag}/docs/guide/${name}.md`;
  return [
    INSTALL_START,
    "## Installer ou mettre à jour",
    "",
    "| Format | Pour qui | Installer | Mettre à jour |",
    "| --- | --- | --- | --- |",
    `| **Docker** | Un ordinateur, un serveur, un NAS : le plus simple | ${file(RELEASE_FILES.compose)}, puis \`docker compose up -d\` | \`docker compose pull && docker compose up -d\` |`,
    `| **Archive prête à l'emploi** | Un hébergement Node.js, sans Docker ni build | ${file(RELEASE_FILES.tar)} ou ${file(RELEASE_FILES.zip)} | \`node scripts/maj.mjs\` |`,
    `| **Sources** | Contribuer, construire soi-même | \`git clone -b ${tag} ${site}.git\` | \`node scripts/maj.mjs\` |`,
    "",
    `Image : \`${imageOf(repo)}:${version}\` (amd64 et arm64) · empreintes des fichiers : ${file(RELEASE_FILES.sums)}`,
    "",
    `Pas à pas : [installer](${doc("installation")}) · [installer avec une IA](${doc("installer-avec-une-ia")}) · [mettre à jour](${doc("mise-a-jour")})`,
    "",
    "## Ce qui change",
    INSTALL_END,
  ].join("\n");
}

/** Les notes complètes d'une version : le tableau des formats, puis ce qui change. */
export const releaseNotes = (version: string, changes: string, repo: string = DEFAULT_REPO): string => `${installBlock(version, repo)}\n\n${changes.trim()}\n`;

/** Ce qui change dans une version, sans le tableau des formats : ce que l'appli montre à l'administrateur. */
export function releaseChanges(notes: string): string {
  let out = notes;
  for (;;) {
    const start = out.indexOf(INSTALL_START);
    if (start < 0) break;
    const end = out.indexOf(INSTALL_END, start);
    // Un repère de fin perdu : tout ce qui suit le premier repère est gardé tel quel, plutôt que des notes vides.
    if (end < 0) {
      out = out.slice(0, start) + out.slice(start + INSTALL_START.length);
      break;
    }
    out = out.slice(0, start) + out.slice(end + INSTALL_END.length);
  }
  return out.trim();
}
