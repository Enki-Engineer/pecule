#!/usr/bin/env node
// Installateur de Pécule, publié sur npm sous le nom « create-pecule » (npm refuse « pecule », trop proche d'un autre
// paquet) :
//
//   npm create pecule [dossier]            ou, avec des options :   npx create-pecule [dossier] [options]
//
// Il télécharge l'archive prête à l'emploi de la dernière version publiée (`pecule.tar.gz`, jointe à la version sur
// GitHub), contrôle son empreinte et la déplie dans un dossier : le même résultat que le téléchargement à la main.
// La suite est celle du guide — `node scripts/setup.mjs`, `node dist/server.mjs`, `node scripts/lien.mjs` —, et
// `node scripts/maj.mjs` met ensuite l'installation à jour. Le paquet npm ne porte que ce fichier : l'appli vient de
// la version publiée, et le paquet n'a pas à être republié à chaque version. Node seul, aucune dépendance.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, rmdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ARCHIVE, SUMS, downloadAsset, expectedSum, latestTag, sha256, untar } from "./lib/archive.mjs";

/** Dépôt des versions quand le paquet ne le dit pas (lancé depuis les sources). Le même que `src/lib/version.ts`. */
const DEFAULT_REPO = "Enki-Engineer/pecule";
/** Version de Node que demande Pécule (`engines` de son `package.json`). */
const NODE_MIN = 24;

const HELP = `Installe Pécule (suivi des finances d'un foyer, auto-hébergé) dans un dossier, sans Docker.

  npm create pecule [dossier]
  npx create-pecule [dossier] [options]      (avec « npm create », les options se donnent après « -- »)

Télécharge l'archive prête à l'emploi de la dernière version, contrôle son empreinte et la déplie dans <dossier>
(défaut : ./pecule). Il faut Node.js ${NODE_MIN} ou plus récent et une base MariaDB 10.6+ ou MySQL 8+ vide.

  --base "mysql://utilisateur:motdepasse@hote:3306/pecule"
                       règle aussi l'installation (node scripts/setup.mjs --base …) : la base est essayée
  --url https://…      adresse publique de l'installation (sans elle : http://localhost:<port>)
  --port 3000          port d'écoute
  --version 1.34.1     cette version plutôt que la dernière
  --archive <fichier>  une archive déjà téléchargée : aucun accès au réseau
  --depuis <adresse>   télécharge pecule.tar.gz et SHA256SUMS à cette adresse (miroir, serveur interne)
  --json               résultat pour un outil

Ensuite, dans le dossier : node dist/server.mjs (le serveur), node scripts/lien.mjs (le lien du premier
démarrage), node scripts/maj.mjs (les mises à jour). Dépôt privé : GITHUB_TOKEN dans l'environnement.
Avec Docker, ce paquet ne sert pas : le fichier compose.yaml de la version suffit.`;

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const json = argv.includes("--json");

function fail(message) {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`✗ ${message}`);
  process.exit(1);
}
const say = (line) => {
  if (!json) console.log(line);
};

/** Le paquet : sa version (celle de l'installateur) et le dépôt qui publie les versions de Pécule. */
function packageInfo() {
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(path.join(here, "..", "package.json"), "utf8"));
  } catch {
    // Fichier absent : le dépôt par défaut.
  }
  const repo = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(typeof pkg.repository === "string" ? pkg.repository : (pkg.repository?.url ?? ""))?.[1] ?? DEFAULT_REPO;
  return { version: typeof pkg.version === "string" ? pkg.version : null, repo };
}

if (argv.includes("--help") || argv.includes("-h") || argv[0] === "aide" || argv[0] === "help") {
  console.log(HELP);
  process.exit(0);
}
// « --version » seul : la version de l'installateur ; suivi d'un numéro, c'est la version de Pécule à installer.
if (argv[0] === "-v" || (argv[0] === "--version" && argv.length === 1)) {
  console.log(packageInfo().version ?? "?");
  process.exit(0);
}
// Sans rien : l'installation dans ./pecule, comme le veut « npm create ». Le mot « installer », que demandait la
// première forme de la commande, reste admis en tête.
const first = argv[0] === "installer" || argv[0] === "install" ? 1 : 0;

const WITH_VALUE = new Set(["--base", "--url", "--port", "--version", "--archive", "--depuis"]);
const options = {};
let folder = null;
for (let i = first; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") continue;
  if (WITH_VALUE.has(a)) {
    const v = argv[++i];
    if (v === undefined || v.startsWith("--")) fail(`${a} attend une valeur.`);
    options[a.slice(2)] = v;
  } else if (a.startsWith("-")) fail(`Option inconnue : ${a} (--help liste les options).`);
  else if (folder !== null) fail(`Un seul dossier : ${folder} ou ${a} ?`);
  else folder = a;
}

const major = Number(process.versions.node.split(".")[0]);
if (major < NODE_MIN) fail(`Pécule demande Node.js ${NODE_MIN} ou plus récent (ici : ${process.versions.node}). Installe-le depuis https://nodejs.org, puis relance.`);

const info = packageInfo();
const asked = options.version?.replace(/^v/, "");
if (asked !== undefined && !/^\d+\.\d+\.\d+$/.test(asked)) fail(`Version illisible : ${options.version} (attendu : 1.34.1).`);
const given = options.archive ? path.resolve(options.archive) : null;
if (given && !existsSync(given)) fail(`Archive introuvable : ${given}`);
if (options.port !== undefined && !/^\d{2,5}$/.test(options.port)) fail(`Port illisible : ${options.port}`);

const target = path.resolve(folder ?? "pecule");
if (existsSync(target)) {
  if (existsSync(path.join(target, "dist", "server.mjs"))) fail(`Pécule est déjà installé dans ${target} : pour le mettre à jour, lance « node scripts/maj.mjs » dans ce dossier.`);
  let names;
  try {
    names = readdirSync(target);
  } catch {
    fail(`${target} existe et n'est pas un dossier.`);
  }
  if (names.length) fail(`${target} n'est pas vide : donne un dossier vide ou qui n'existe pas encore.`);
}
const parent = path.dirname(target);
try {
  mkdirSync(parent, { recursive: true });
} catch (e) {
  fail(`Le dossier ${parent} ne peut pas être créé : ${e.message}`);
}

// Dossier de travail à côté de la destination : la mise en place n'est qu'un renommage sur le même disque.
let work;
try {
  work = mkdtempSync(path.join(parent, ".pecule-installation-"));
} catch (e) {
  fail(`Impossible d'écrire dans ${parent} : ${e.message}`);
}
/** Renonce : le dossier de travail repart, rien d'autre n'a été créé. */
const giveUp = (message) => {
  rmSync(work, { recursive: true, force: true });
  fail(message);
};

const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
const base = options.depuis ?? null;
// Un miroir se joint en https : en clair, l'archive et ses empreintes pourraient être remplacées ensemble en chemin.
if (base && !/^https:\/\//i.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(base)) giveUp(`--depuis : il faut une adresse en https (ici : ${base}).`);
let tag = asked ? `v${asked}` : null;
let archive = given;
// Empreintes : le SHA256SUMS joint à la version, ou celui posé à côté d'une archive donnée.
let sums = null;
try {
  if (given) {
    const beside = path.join(path.dirname(given), SUMS);
    if (existsSync(beside)) sums = readFileSync(beside, "utf8");
  } else {
    archive = path.join(work, ARCHIVE);
    // La dernière version : son étiquette d'abord, pour que l'archive et ses empreintes soient celles de la même.
    if (!tag && !base) tag = await latestTag(info.repo, token);
    say(`Téléchargement de Pécule${tag ? ` ${tag.replace(/^v/, "")}` : ""}…`);
    await downloadAsset({ repo: info.repo, tag, name: ARCHIVE, dest: archive, token, base });
    await downloadAsset({ repo: info.repo, tag, name: SUMS, dest: path.join(work, SUMS), token, base });
    sums = readFileSync(path.join(work, SUMS), "utf8");
  }
} catch (e) {
  const missing = e?.status === 404 && !base;
  giveUp(
    missing
      ? `${tag ? `Pécule ${tag.replace(/^v/, "")}` : "Aucune version de Pécule"} n'est téléchargeable (${info.repo}) : ${tag ? "cette version n'est pas publiée" : "aucune n'est publiée"}, ou le dépôt est privé${token ? " et ce jeton n'y a pas accès" : " (donne alors GITHUB_TOKEN)"}. Rien n'a été installé.`
      : `L'archive n'a pas pu être téléchargée : ${e?.message ?? e}\n    Rien n'a été installé. Télécharge-la depuis la page de la version, puis relance avec --archive <fichier>.`,
  );
}

const wanted = sums ? expectedSum(sums, ARCHIVE) : null;
if (sums && !wanted && !given) giveUp(`${SUMS} ne connaît pas ${ARCHIVE} : rien n'a été installé.`);
let checked = false;
if (wanted) {
  if ((await sha256(archive)) !== wanted) giveUp(`L'empreinte de l'archive n'est pas celle de ${SUMS} (téléchargement abîmé, ou fichier remplacé) : rien n'a été installé.`);
  checked = true;
  // Dit ce que le contrôle prouve : l'archive est arrivée entière. Les empreintes viennent du même endroit qu'elle ;
  // son origine se vérifie par l'attestation de provenance de la version (docs/guide/mise-a-jour.md).
  say("✓ Archive arrivée intacte (empreinte contrôlée)");
} else say(`! Pas de fichier ${SUMS} à côté de l'archive : son empreinte n'est pas contrôlée.`);

if (!untar(archive, work)) giveUp("L'archive n'a pas pu être dépliée (la commande « tar » est-elle sur cette machine ?) : rien n'a été installé.");
const fresh = path.join(work, "pecule");
let incoming;
try {
  incoming = JSON.parse(readFileSync(path.join(fresh, "package.json"), "utf8"));
} catch {
  giveUp("Ce fichier n'est pas une archive de Pécule (pecule/package.json introuvable) : rien n'a été installé.");
}
if (!existsSync(path.join(fresh, "dist", "server.mjs"))) giveUp("L'archive ne porte pas de serveur construit (dist/server.mjs) : rien n'a été installé.");
const need = Number(/(\d+)/.exec(incoming.engines?.node ?? "")?.[1] ?? 0);
if (need > major) giveUp(`Pécule ${incoming.version} demande Node ${need} ou plus récent (ici : ${process.versions.node}) : rien n'a été installé.`);

try {
  if (existsSync(target)) rmdirSync(target);
  renameSync(fresh, target);
} catch (e) {
  giveUp(`Le dossier ${target} n'a pas pu être mis en place : ${e.message}`);
}
rmSync(work, { recursive: true, force: true });
say(`✓ Pécule ${incoming.version} est dans ${target}`);

// Réglages : la commande du guide, lancée dans le dossier. Son résultat est rendu tel quel.
const shown = path.relative(process.cwd(), target) || ".";
const setupArgs = options.base ? ["scripts/setup.mjs", "--base", options.base, ...(options.url ? ["--url", options.url] : []), ...(options.port ? ["--port", options.port] : [])] : null;
let setup = null;
if (setupArgs) {
  const r = spawnSync(process.execPath, [...setupArgs, ...(json ? ["--json"] : [])], { cwd: target, stdio: json ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" });
  if (json) {
    try {
      setup = JSON.parse(r.stdout);
    } catch {
      setup = { ok: false, error: (r.stdout ?? "").trim().slice(0, 500) };
    }
  } else setup = { ok: r.status === 0 };
  if (r.status !== 0) {
    if (json) console.log(JSON.stringify({ ok: false, version: incoming.version, dir: target, checked, setup, error: "Pécule est installé, mais ses réglages n'ont pas pu être écrits." }));
    else console.error(`✗ Pécule est installé dans ${target}, mais ses réglages n'ont pas pu être écrits : corrige ce que dit la commande ci-dessus, puis relance-la dans ce dossier (node scripts/setup.mjs --base …).`);
    process.exit(1);
  }
}

const next = [
  ...(setupArgs ? [] : ['node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule"']),
  "node dist/server.mjs",
  "node scripts/lien.mjs",
];
if (json) console.log(JSON.stringify({ ok: true, version: incoming.version, dir: target, checked, setup, next }));
else {
  console.log(`\nEnsuite, dans ce dossier (cd ${shown}) :`);
  if (!setupArgs) console.log(`  ${next[0]}    les réglages ; la base (MariaDB 10.6+ ou MySQL 8+, vide) est essayée`);
  console.log("  node dist/server.mjs     le serveur : à confier à un service (systemd, pm2, le gestionnaire de ton hébergeur)");
  console.log("  node scripts/lien.mjs    le lien du premier démarrage, à ouvrir dans un navigateur");
  console.log("Le guide complet : docs/guide/installation.md, dans ce dossier.");
}
