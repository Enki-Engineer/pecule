#!/usr/bin/env node
// Notes d'une version, telles qu'elles sont publiées avec elle sur GitHub : le tableau « Installer ou mettre à
// jour » (les formats de la version et l'adresse de ses pièces jointes), puis sa section de CHANGELOG.md (lignes
// recollées : GitHub garderait les retours à la ligne de la marge).
//
//   node scripts/notes-de-version.mjs [version] [--etiquette v1.22.0] [--depot proprietaire/depot]
//
// Sans version : celle de package.json. `--etiquette` contrôle en plus que l'étiquette git poussée est bien celle de
// la version du paquet. `--depot` : le dépôt qui publie (à défaut GITHUB_REPOSITORY, puis celui du projet). Code de
// sortie 1 si la section manque ou si l'étiquette ne correspond pas.
import { readFileSync } from "node:fs";
import { releaseNotes } from "../src/lib/release-notes.ts";
import { changelogSection, cleanVersion, DEFAULT_REPO, unwrapMarkdown } from "../src/lib/version.ts";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("Notes d'une version : ses formats, puis sa section de CHANGELOG.md.\n\n  node scripts/notes-de-version.mjs [version] [--etiquette v1.22.0] [--depot proprietaire/depot]");
  process.exit(0);
}
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const tag = argv.includes("--etiquette") ? argv[argv.indexOf("--etiquette") + 1] : undefined;
const given = argv.includes("--depot") ? argv[argv.indexOf("--depot") + 1] : process.env.GITHUB_REPOSITORY;
const repo = /^[\w.-]+\/[\w.-]+$/.test(given ?? "") ? given : DEFAULT_REPO;
const asked = argv.find((a, i) => !a.startsWith("--") && !["--etiquette", "--depot"].includes(argv[i - 1]));
const version = cleanVersion(asked ?? pkg.version);
if (!version) {
  console.error(`Version illisible : ${asked ?? pkg.version}`);
  process.exit(1);
}
if (tag !== undefined && (tag !== `v${version}` || version !== cleanVersion(pkg.version))) {
  console.error(`L'étiquette ${tag} ne correspond pas à la version ${pkg.version} de package.json (attendu : v${cleanVersion(pkg.version)}).`);
  process.exit(1);
}
const notes = changelogSection(readFileSync(new URL("CHANGELOG.md", root), "utf8"), version);
if (!notes) {
  console.error(`CHANGELOG.md n'a pas de section « ## ${version} ».`);
  process.exit(1);
}
// CHANGELOG.md est coupé à la marge ; GitHub garderait chaque retour à la ligne.
process.stdout.write(releaseNotes(version, unwrapMarkdown(notes), repo));
