#!/usr/bin/env node
// Fabrique ce qu'une version de Pécule publie en pièces jointes : l'archive prête à l'emploi (le serveur construit
// et ses dépendances d'exécution : ni build, ni pnpm sur le serveur), le fichier compose.yaml et leurs empreintes.
//
//   pnpm build && node scripts/paquet.mjs [--sortie dist/paquet]
//   node scripts/paquet.mjs --npm                 le paquet npm seul (aucun build demandé)
//
// Écrit dans le dossier de sortie :
//   pecule.tar.gz   pecule.zip   compose.yaml   SHA256SUMS   npm/
// `npm/` est le paquet « pecule » de npm : l'installateur seul (`scripts/pecule.mjs`), qui télécharge l'archive de la
// dernière version publiée. Il se publie par « npm publish dist/paquet/npm » — quand l'installateur change, pas à
// chaque version.
// Des noms sans numéro de version : la dernière version publiée se télécharge toujours à la même adresse
// (…/releases/latest/download/pecule.tar.gz), et une version précise à celle de son étiquette.
// Demande pnpm, tar et zip sur la machine qui construit (pas sur celle qui installe).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REPO } from "../src/lib/version.ts";

const HELP = `Fabrique les pièces jointes d'une version de Pécule (après « pnpm build »).

  node scripts/paquet.mjs [--sortie dist/paquet] [--npm]

  pecule.tar.gz, pecule.zip   l'archive prête à l'emploi : serveur construit, dépendances d'exécution, scripts
  compose.yaml                le fichier Docker Compose de la version
  SHA256SUMS                  l'empreinte de chacun
  npm/                        le paquet npm « pecule » : l'installateur, qui télécharge l'archive de la dernière version

  --npm    ne fabrique que le paquet npm (pas besoin de « pnpm build »)`;
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--npm") continue;
  if (argv[i] !== "--sortie") fail(`Option inconnue : ${argv[i]}\n\n${HELP}`);
  if (argv[++i] === undefined) fail("--sortie attend un dossier.");
}
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const out = path.resolve(argv.includes("--sortie") ? argv[argv.indexOf("--sortie") + 1] : "dist/paquet");
/** Nom des archives, le même à chaque version (voir plus haut). */
const name = "pecule";
/** Dossier de l'archive : son contenu se déplie dans « pecule/ ». */
const stage = path.join(out, "pecule");

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (r.error) fail(`${cmd} est introuvable sur cette machine.`);
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} a échoué :\n${(r.stderr || r.stdout).trim().split("\n").slice(-12).join("\n")}`);
  return r.stdout;
};

if ([root, path.dirname(root)].includes(out) || root.startsWith(`${out}${path.sep}`)) fail(`--sortie ${out} : le dossier de sortie ne peut pas être le dépôt ni l'un de ses parents.`);

// ---------- Le paquet npm : l'installateur seul ----------
/**
 * Le paquet « pecule » de npm ne porte pas l'appli : seulement `scripts/pecule.mjs`, qui télécharge l'archive de la
 * dernière version publiée sur GitHub et contrôle son empreinte. Une seule source pour l'appli, rien d'elle sur npm,
 * et un paquet qui n'a pas à être republié à chaque version.
 */
function npmPackage() {
  const dir = path.join(out, "npm");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
  cpSync("scripts/pecule.mjs", path.join(dir, "scripts", "pecule.mjs"));
  cpSync("scripts/lib/archive.mjs", path.join(dir, "scripts", "lib", "archive.mjs"));
  cpSync("npm/README.md", path.join(dir, "README.md"));
  cpSync("LICENSE", path.join(dir, "LICENSE"));
  const manifest = {
    name: pkg.name,
    version: pkg.version,
    description: `Self-hosted household finance tracker (installer). ${pkg.description}`,
    license: pkg.license,
    type: "module",
    bin: { pecule: "scripts/pecule.mjs" },
    files: ["scripts"],
    engines: pkg.engines,
    repository: { type: "git", url: `git+https://github.com/${DEFAULT_REPO}.git` },
    homepage: `https://github.com/${DEFAULT_REPO}#readme`,
    bugs: { url: `https://github.com/${DEFAULT_REPO}/issues` },
    keywords: ["finance", "budget", "personal-finance", "household", "self-hosted", "banking", "foyer", "auto-heberge"],
  };
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return dir;
}
if (argv.includes("--npm")) {
  console.log(`✓ Pécule ${pkg.version} — paquet npm dans ${path.relative(root, npmPackage())}`);
  process.exit(0);
}

// ---------- Le serveur construit ----------
if (!existsSync("dist/server.mjs") || !existsSync("dist/client/index.html")) fail("dist/ n'est pas construit : lance d'abord « pnpm build ».");
// La version inscrite dans le serveur est celle du paquet (un build resté d'une version précédente serait livré sous un faux nom).
if (!readFileSync("dist/server.mjs", "utf8").includes(JSON.stringify(pkg.version))) fail(`dist/server.mjs n'est pas la version ${pkg.version} : relance « pnpm build ».`);

// Seulement ce que cette commande écrit : jamais le dossier de sortie tout entier, qui peut porter autre chose.
const OUTPUTS = [`${name}.tar.gz`, `${name}.zip`, "compose.yaml", "SHA256SUMS"];
rmSync(stage, { recursive: true, force: true });
for (const file of OUTPUTS) rmSync(path.join(out, file), { force: true });
mkdirSync(path.join(stage, "dist"), { recursive: true });
for (const entry of ["server.mjs", "server.mjs.map", "client", "drizzle", "migrations"]) if (existsSync(path.join("dist", entry))) cpSync(path.join("dist", entry), path.join(stage, "dist", entry), { recursive: true });

// ---------- Scripts, guides, ce qu'un agent lit en ouvrant le dossier ----------
/** Scripts de l'installation : sans dépendance, ils tournent avec Node seul. */
const SCRIPTS = ["setup.mjs", "doctor.mjs", "lien.mjs", "maj.mjs", "importer.mjs"];
mkdirSync(path.join(stage, "scripts"), { recursive: true });
for (const file of SCRIPTS) cpSync(path.join("scripts", file), path.join(stage, "scripts", file));
cpSync("scripts/lib", path.join(stage, "scripts", "lib"), { recursive: true, filter: (src) => !/\.d\.mts$/.test(src) });
// Règles pures que lisent ces scripts (Node efface leurs types à la volée).
mkdirSync(path.join(stage, "src", "lib"), { recursive: true });
for (const file of ["version.ts", "settings-file.ts"]) cpSync(path.join("src", "lib", file), path.join(stage, "src", "lib", file));
for (const file of ["AGENTS.md", "LICENSE", ".env.example", "CHANGELOG.md"]) cpSync(file, path.join(stage, file));
// Les guides, sans les images du dépôt.
for (const dir of ["docs/guide", "docs/connecteurs"]) cpSync(dir, path.join(stage, dir), { recursive: true, filter: (src) => statSync(src).isDirectory() || src.endsWith(".md") });

// ---------- package.json de l'archive : ce qu'il faut pour tourner, rien pour construire ----------
const manifest = {
  name: pkg.name,
  private: true,
  version: pkg.version,
  type: pkg.type,
  description: pkg.description,
  engines: pkg.engines,
  pecule: pkg.pecule,
  scripts: { start: "node dist/server.mjs", setup: "node scripts/setup.mjs", doctor: "node scripts/doctor.mjs", lien: "node scripts/lien.mjs", maj: "node scripts/maj.mjs", importer: "node scripts/importer.mjs" },
  dependencies: pkg.dependencies,
  license: pkg.license,
};

// ---------- Dépendances d'exécution, à plat et sans lien symbolique ----------
// pnpm les installe d'après le fichier de verrouillage du dépôt (mêmes versions qu'en développement et que dans
// l'image), avec le vrai package.json, que le manifeste de l'archive remplace ensuite.
for (const file of ["package.json", "pnpm-lock.yaml"]) cpSync(file, path.join(stage, file));
writeFileSync(path.join(stage, "pnpm-workspace.yaml"), `${readFileSync("pnpm-workspace.yaml", "utf8").trimEnd()}\n# Archive : dépendances à plat, comme npm (aucun lien symbolique, un zip les porte sans dégât).\nnodeLinker: hoisted\n`);
run("pnpm", ["install", "--prod", "--frozen-lockfile", "--ignore-scripts", "--prefer-offline"], stage);
for (const leftover of ["pnpm-lock.yaml", "pnpm-workspace.yaml", "node_modules/.bin", "node_modules/.pnpm", "node_modules/.modules.yaml", "node_modules/.pnpm-workspace-state-v1.json", "node_modules/@types"]) rmSync(path.join(stage, leftover), { recursive: true, force: true });
writeFileSync(path.join(stage, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Jamais chargés par le serveur : déclarations de types et cartes des sources des paquets (la moitié de leur poids).
let pruned = 0;
const walk = (dir, visit) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full, entry);
  }
};
walk(path.join(stage, "node_modules"), (file) => {
  if (!/\.d\.[cm]?ts$|\.map$/.test(file)) return;
  pruned += lstatSync(file).size;
  rmSync(file);
});

// ---------- Contrôles ----------
// Chaque dépendance du manifeste se résout depuis l'archive, et rien n'y est un lien symbolique.
const resolver = createRequire(path.join(stage, "package.json"));
for (const dep of Object.keys(manifest.dependencies)) {
  if (!existsSync(path.join(stage, "node_modules", dep, "package.json"))) fail(`${dep} manque dans les dépendances de l'archive.`);
  try {
    resolver.resolve(`${dep}/package.json`);
  } catch {
    // Un paquet qui ne publie pas son package.json par ses « exports » : sa présence, contrôlée plus haut, suffit.
  }
}
const links = [];
walk(stage, (file, entry) => {
  if (entry.isSymbolicLink()) links.push(path.relative(stage, file));
});
if (links.length) fail(`L'archive contient des liens symboliques (un zip ne les porte pas partout) : ${links.slice(0, 5).join(", ")}`);

// ---------- Mode d'emploi posé dans l'archive ----------
writeFileSync(
  path.join(stage, "LISEZ-MOI.txt"),
  `Pécule ${pkg.version} — archive prête à l'emploi (English below)

Le serveur est déjà construit, avec ses dépendances : il ne faut que Node.js ${pkg.engines.node.replace(">=", "").split(".")[0]} ou plus récent, et une base MySQL 8 ou
MariaDB 10.6 (ou plus récente), vide. Aucun build, aucun gestionnaire de paquets.

  1. node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule" --url https://pecule.exemple.fr
       écrit le fichier .env (secrets tirés au hasard) et affiche le lien du premier démarrage
       essai sur sa propre machine : sans --url, l'adresse est http://localhost:3000
  2. node dist/server.mjs
       le serveur crée la base au premier démarrage (hébergeur : fichier d'entrée dist/server.mjs, aucun build)
  3. node scripts/lien.mjs
       redonne le lien à ouvrir pour créer le premier membre du foyer

Contrôler : node scripts/doctor.mjs        Mettre à jour : node scripts/maj.mjs
Guides : docs/guide/installation.md, docs/guide/mise-a-jour.md — un agent IA lit AGENTS.md.
Avec Docker, plus simple : le fichier compose.yaml de la même version suffit (docs/guide/installation.md).

---

Pécule ${pkg.version} — ready-to-run archive

The server is already built, with its dependencies: all you need is Node.js ${pkg.engines.node.replace(">=", "").split(".")[0]} or later and an empty MySQL 8 or
MariaDB 10.6+ database. No build, no package manager.

  1. node scripts/setup.mjs --base "mysql://user:password@127.0.0.1:3306/pecule" --url https://pecule.example.com
  2. node dist/server.mjs
  3. node scripts/lien.mjs        prints the link to open to create the first household member

Check: node scripts/doctor.mjs        Update: node scripts/maj.mjs
The guides are in French (docs/guide/); an AI agent reads AGENTS.md and can do the installation for you.
`,
);

// ---------- Archives, compose.yaml, empreintes ----------
run("tar", ["-czf", `${name}.tar.gz`, "pecule"], out);
run("zip", ["-q", "-r", "-X", `${name}.zip`, "pecule"], out);
cpSync("compose.yaml", path.join(out, "compose.yaml"));
const files = OUTPUTS.filter((file) => file !== "SHA256SUMS");
const sums = files.map((file) => `${createHash("sha256").update(readFileSync(path.join(out, file))).digest("hex")}  ${file}`);
writeFileSync(path.join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);

const mo = (octets) => `${(octets / 1_048_576).toFixed(1).replace(".", ",")} Mo`;
let unpacked = 0;
walk(stage, (file) => (unpacked += lstatSync(file).size));
rmSync(stage, { recursive: true, force: true });
npmPackage();
console.log(`✓ Pécule ${pkg.version} — pièces jointes dans ${path.relative(root, out) || out}`);
for (const file of files) console.log(`  ${file.padEnd(name.length + 8)} ${mo(statSync(path.join(out, file)).size)}`);
console.log(`  SHA256SUMS\n  npm/           le paquet npm (l'installateur seul)\n  (archive dépliée : ${mo(unpacked)} ; ${mo(pruned)} de types et de cartes des sources retirés des dépendances)`);
