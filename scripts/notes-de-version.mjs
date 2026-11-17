#!/usr/bin/env node
// Notes d'une version : sa section de CHANGELOG.md, telle qu'elle est publiée avec la version sur GitHub
// (lignes recollées : GitHub garderait les retours à la ligne de la marge).
//
//   node scripts/notes-de-version.mjs [version] [--etiquette v1.22.0]
//
// Sans version : celle de package.json. `--etiquette` contrôle en plus que l'étiquette git poussée est bien celle de
// la version du paquet. Code de sortie 1 si la section manque ou si l'étiquette ne correspond pas.
import { readFileSync } from "node:fs";
import { changelogSection, cleanVersion, unwrapMarkdown } from "../src/lib/version.ts";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("Notes d'une version (sa section de CHANGELOG.md).\n\n  node scripts/notes-de-version.mjs [version] [--etiquette v1.22.0]");
  process.exit(0);
}
const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const tag = argv.includes("--etiquette") ? argv[argv.indexOf("--etiquette") + 1] : undefined;
const asked = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--etiquette");
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
console.log(unwrapMarkdown(notes));
