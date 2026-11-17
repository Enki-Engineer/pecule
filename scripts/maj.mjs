#!/usr/bin/env node
// Met à jour une installation de Pécule : sauvegarde complète, nouvelle version, attente du redémarrage, contrôle.
// Sans dépendance (Node seul). À lancer depuis la racine du dépôt, sur la machine qui fait tourner Pécule.
//
//   node scripts/maj.mjs                       dernière version publiée
//   node scripts/maj.mjs --verifier            dit seulement où en est l'installation
//   node scripts/maj.mjs --version 1.22.0      une version précise (palier, ou retour à une version)
//
// Docker : récupère l'image publiée et relance le conteneur (`--source` : la construit depuis le dépôt).
// Node : `pnpm install` et `pnpm build`, puis le serveur est à redémarrer (`--redemarrer "<commande>"` le fait).
// Code de sortie 0 si l'installation est à jour et répond, 1 sinon. Aucun secret n'est affiché.
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { cleanVersion, compareVersions, DEFAULT_REPO, DOCKER_IMAGE, updateState } from "../src/lib/version.ts";

const HELP = `Met à jour une installation de Pécule.

  node scripts/maj.mjs [options]

  --verifier            dit où en est l'installation (version en service, dernière publiée) et s'arrête
  --version <x.y.z>     installe cette version au lieu de la dernière (palier, ou retour en arrière)
  --oui                 ne demande pas de confirmation
  --sans-sauvegarde     ne télécharge pas de sauvegarde avant (déconseillé)
  --source              Docker : construit l'image depuis le dépôt au lieu de récupérer celle qui est publiée
  --redemarrer "<cmd>"  Node : commande qui redémarre le serveur une fois le build fait
  --fichier <.env>      fichier de réglages (par défaut .env)
  --url <adresse>       adresse du serveur (par défaut http://127.0.0.1:<port>)
  --json                résultat de --verifier en JSON

Étapes : sauvegarde complète dans data/sauvegardes, récupération de la version, redémarrage, attente de
« pret » sur /api/health, puis diagnostic. Les migrations de la base s'appliquent au démarrage.`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const KNOWN = new Set(["--verifier", "--version", "--oui", "--sans-sauvegarde", "--source", "--redemarrer", "--fichier", "--url", "--json"]);
const WITH_VALUE = new Set(["--version", "--redemarrer", "--fichier", "--url"]);
for (let i = 0; i < argv.length; i++) {
  if (!KNOWN.has(argv[i])) fail(`Option inconnue : ${argv[i]} (--help liste les options).`);
  if (WITH_VALUE.has(argv[i]) && (argv[++i] === undefined || argv[i].startsWith("--"))) fail(`${argv[i - 1]} attend une valeur.`);
}
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const json = flag("json");

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const say = (line) => {
  if (!json) console.log(line);
};

// La racine du dépôt : compose.yaml, .git et les autres scripts s'y trouvent, d'où que la commande soit lancée.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(root);

// ---------- Réglages ----------
const file = value("fichier") ?? ".env";
const env = {};
if (existsSync(file))
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
const docker = !!env.DB_PASSWORD && !env.DATABASE_URL;
const repo = /^[\w.-]+\/[\w.-]+$/.test(env.UPDATE_REPO ?? "") ? env.UPDATE_REPO : DEFAULT_REPO;
const target = (value("url") ?? `http://127.0.0.1:${env.PECULE_PORT ?? env.PORT ?? "3000"}`).replace(/\/+$/, "");
const token = process.env.PECULE_API_TOKEN ?? env.API_TOKEN ?? "";
const auth = token ? { Authorization: `Bearer ${token}` } : {};
const asked = value("version");
if (asked !== undefined && !cleanVersion(asked)) fail(`Version illisible : ${asked} (attendu : 1.22.0).`);

// ---------- Lectures ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, headers = {}, ms = 8000) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
    return { status: r.status, body: await r.json().catch(() => null) };
  } catch {
    return { status: 0, body: null };
  }
}

/** Santé du serveur : `null` s'il ne répond pas (ou si autre chose que Pécule écoute sur ce port). */
async function health() {
  const { body } = await getJson(`${target}/api/health`);
  return body && typeof body.phase === "string" ? body : null;
}

/**
 * Version en service. `route: false` : un Pécule d'avant la 1.22.0, qui ne sait pas la dire ; `member: false` :
 * installation neuve, sans membre encore (rien à sauvegarder).
 */
async function running() {
  if (!(await health())) return { up: false };
  // Tant qu'aucun membre n'existe, le jeton d'administration n'agit au nom de personne : la question est posée à part.
  if ((await getJson(`${target}/api/auth/me`)).body?.setup === true) return { up: true, route: true, member: false };
  const { status, body } = await getJson(`${target}/api/updates`, auth);
  if (status === 200 && body && typeof body.version === "string") return { up: true, route: true, member: true, version: body.version };
  if (status === 401 || status === 403) return { up: true, route: true, member: true, refused: true };
  return { up: true, route: false, member: true };
}

/** Dernière version publiée et, si elle le dit, la plus ancienne depuis laquelle elle s'installe directement. */
async function published() {
  const gh = { "User-Agent": "Pecule", Accept: "application/vnd.github+json" };
  const { status, body } = await getJson(`https://api.github.com/repos/${repo}/releases/latest`, gh, 10_000);
  const version = status === 200 ? cleanVersion(body?.tag_name) : null;
  if (!version) return { version: null, reason: status === 404 ? "aucune version publiée (ou dépôt privé)" : status === 0 ? "GitHub injoignable" : `GitHub a répondu ${status}` };
  const pkg = await getJson(`https://raw.githubusercontent.com/${repo}/${encodeURIComponent(body.tag_name)}/package.json`, { "User-Agent": "Pecule" }, 10_000);
  return { version, tag: body.tag_name, depuis: cleanVersion(pkg.body?.pecule?.depuis) };
}

// ---------- Commandes ----------
function run(cmd, args, opts = {}) {
  say(`  $ ${[cmd, ...args].join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: json ? "ignore" : "inherit", env: { ...process.env, ...(opts.env ?? {}) }, shell: opts.shell ?? false });
  return r.status === 0;
}
function output(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}
const has = (cmd) => spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0;

async function confirm(question) {
  if (flag("oui")) return true;
  if (!process.stdin.isTTY) fail("Confirmation impossible sans terminal : relance avec --oui.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`${question} [o/N] `)).trim().toLowerCase();
  rl.close();
  return ["o", "oui", "y", "yes"].includes(answer);
}

// ---------- Sauvegarde ----------
/** Un zip complet se termine par sa table des matières : sans elle, le téléchargement a été coupé. */
function zipComplete(file) {
  const size = statSync(file).size;
  const len = Math.min(size, 66_000);
  const buf = Buffer.alloc(len);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buf, 0, len, size - len);
  } finally {
    closeSync(fd);
  }
  return buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) >= 0;
}

async function backup() {
  const dir = path.resolve("data/sauvegardes");
  mkdirSync(dir, { recursive: true });
  const started = Date.now();
  const res = await fetch(`${target}/api/backup`, { headers: auth }).catch(() => null);
  if (!res?.ok || !res.body) {
    const body = res ? await res.json().catch(() => ({})) : {};
    throw new Error(`/api/backup → ${res ? `HTTP ${res.status} ${body.error ?? ""}`.trim() : "pas de réponse"}`);
  }
  const name = /filename="([^"/\\]+\.zip)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `pecule-sauvegarde-${new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "")}.zip`;
  const dest = path.join(dir, name);
  // Écrite sous un nom provisoire : le nom final ne désigne jamais qu'une archive complète.
  const partial = `${dest}.partiel`;
  try {
    // L'archive porte toutes les données du foyer : lisible par son seul propriétaire.
    await pipeline(Readable.fromWeb(res.body), createWriteStream(partial, { mode: 0o600 }));
    if (!zipComplete(partial)) throw new Error("archive incomplète (téléchargement coupé)");
    // Relecture complète (empreinte de chaque fichier) quand les outils du dépôt sont installés.
    const tsx = path.join("node_modules", ".bin", "tsx");
    if (existsSync(tsx) && !run(tsx, ["scripts/sauvegarde.ts", "--verifier", partial])) throw new Error("l'archive ne correspond pas à son manifeste");
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
  renameSync(partial, dest);
  say(`✓ Sauvegarde : ${dest} (${(statSync(dest).size / 1_048_576).toFixed(1).replace(".", ",")} Mo, ${Math.round((Date.now() - started) / 1000)} s)`);
  return dest;
}

// ---------- Déroulé ----------
const now = await running();
const latest = asked ? { version: cleanVersion(asked), tag: `v${cleanVersion(asked)}`, depuis: null } : await published();
const current = now.version ?? null;
const state = current && latest.version ? updateState(current, latest.version, latest.depuis) : null;

if (flag("verifier")) {
  if (json) console.log(JSON.stringify({ ok: now.up === true, mode: docker ? "docker" : "node", running: current, latest: latest.version, state: state?.kind ?? "inconnu", ...(state?.kind === "palier" ? { palier: state.palier } : {}) }, null, 1));
  else {
    console.log(!now.up ? `✗ Pécule ne répond pas sur ${target}` : current ? `✓ Pécule ${current} en service (${docker ? "Docker" : "Node"})` : now.refused ? "· Version en service inconnue : le jeton d'administration du fichier de réglages est refusé" : now.member === false ? "· Installation neuve : pas encore de membre" : "· Version en service antérieure à la 1.22.0 (elle ne sait pas dire sa version)");
    console.log(latest.version ? `· Dernière version publiée : ${latest.version}` : `· Dernière version publiée inconnue : ${latest.reason}`);
    if (state?.kind === "a-jour") console.log("\nRien à faire : l'installation est à jour.");
    else if (state?.kind === "palier") console.log(`\nLa version ${state.version} ne reprend pas une base aussi ancienne : installe d'abord la ${state.palier}.\n  node scripts/maj.mjs --version ${state.palier}`);
    else if (state?.kind === "disponible") console.log("\nUne mise à jour est disponible :\n  node scripts/maj.mjs");
  }
  process.exit(now.up ? 0 : 1);
}

say(`Pécule — mise à jour (${docker ? "Docker" : "Node"}, ${target})`);
say(current ? `· Version en service : ${current}` : !now.up ? "· Le serveur ne répond pas" : "· Version en service inconnue (antérieure à la 1.22.0, ou jeton refusé)");
say(latest.version ? `· Version à installer : ${latest.version}` : `· Dernière version publiée inconnue (${latest.reason}) : ce que le dépôt ou l'image donne de plus récent sera installé`);

if (!asked && state?.kind === "a-jour") {
  say("\n✓ Rien à faire : l'installation est à jour.");
  process.exit(0);
}
if (!asked && state?.kind === "palier") fail(`La version ${state.version} ne reprend pas une base aussi ancienne : installe d'abord la ${state.palier}, puis relance la mise à jour.\n    node scripts/maj.mjs --version ${state.palier}`);
if (asked && current && compareVersions(latest.version, current) < 0)
  say(`\n! ${latest.version} est plus ancienne que la version en service. La base ne revient pas en arrière : si une migration a été\n  appliquée depuis, restaure d'abord une sauvegarde d'avant (docs/guide/mise-a-jour.md).`);

const git = existsSync(".git") && has("git");
if (git && output("git", ["status", "--porcelain", "--untracked-files=no"])) fail("Des fichiers du dépôt sont modifiés (git status) : range ou annule ces modifications avant de mettre à jour.");
if (docker && !has("docker")) fail("Docker est introuvable sur cette machine.");
if (!docker && !has("pnpm")) fail("pnpm est introuvable (corepack enable, ou npm install -g pnpm).");

if (!(await confirm(`\nMettre à jour maintenant ? Pécule sera indisponible le temps du redémarrage.`))) {
  say("Rien n'a été fait.");
  process.exit(0);
}

// 1. Sauvegarde
if (flag("sans-sauvegarde")) say("\n! Sauvegarde passée (--sans-sauvegarde).");
else if (now.up && now.member === false) say("\n· Installation neuve, sans membre : rien à sauvegarder.");
else if (!now.up) fail("Le serveur ne répond pas : la sauvegarde est impossible. Démarre-le d'abord, ou relance avec --sans-sauvegarde si tu en as déjà une.");
else {
  say("\nSauvegarde complète…");
  try {
    await backup();
  } catch (e) {
    fail(`Sauvegarde impossible : ${e.message}\n    Rien n'a été modifié. Vérifie API_TOKEN dans ${file}, ou télécharge la sauvegarde depuis Réglages → Compte et sécurité puis relance avec --sans-sauvegarde.`);
  }
}

// 2. Le code du dépôt (compose.yaml, scripts et, hors Docker, l'appli elle-même)
if (git) {
  say("\nDépôt…");
  if (!run("git", ["fetch", "--tags", "--prune", "origin"])) fail("git fetch a échoué : le dépôt d'origine est-il joignable ?");
  const branch = output("git", ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const ok = asked ? run("git", ["checkout", "--detach", latest.tag]) : branch ? run("git", ["pull", "--ff-only"]) : latest.tag ? run("git", ["checkout", "--detach", latest.tag]) : false;
  if (!ok) fail(asked || !branch ? `La version ${latest.tag ?? "demandée"} est introuvable dans le dépôt.` : "git pull a échoué (la branche a divergé ?) : rien d'autre n'a été modifié.");
} else say("\n· Pas de dépôt git ici : le code de ce dossier est gardé tel quel.");

// 3. La nouvelle version
say(docker ? "\nImage et conteneur…" : "\nConstruction…");
// Ce qui tourne après une construction, c'est le code de ce dossier ; après une image récupérée, la version publiée.
const checkout = () => cleanVersion(JSON.parse(readFileSync("package.json", "utf8")).version);
let expected = latest.version;
// Le serveur a-t-il été relancé par cette commande ? Sinon, « pret » peut encore être l'ancienne version qui répond.
let restarted = true;
if (docker) {
  // Une version précise : son image, pour cette commande seulement (un `docker compose up` ultérieur reprend l'image du fichier de réglages).
  const compose = { env: asked ? { PECULE_IMAGE: `${DOCKER_IMAGE}:${latest.version}` } : {} };
  const build = flag("source") || !run("docker", ["compose", "pull", "pecule"], compose);
  if (build && !flag("source")) say("! L'image publiée n'a pas pu être récupérée : construction depuis le dépôt.");
  if (build) expected = checkout();
  if (!run("docker", ["compose", "up", "-d", ...(build ? ["--build"] : []), "pecule"], compose)) fail("docker compose up a échoué : l'ancien conteneur tourne peut-être encore (docker compose ps, docker compose logs pecule).");
} else {
  if (!run("pnpm", ["install", "--frozen-lockfile"]) || !run("pnpm", ["build"])) fail("La construction a échoué : l'ancienne version tourne toujours, rien n'a été remplacé.");
  expected = checkout();
  const restart = value("redemarrer");
  if (restart) {
    if (!run(restart, [], { shell: true })) fail("La commande de redémarrage a échoué.");
  } else {
    restarted = false;
    say("\n→ Redémarre maintenant le serveur (bouton de l'hébergeur, systemctl restart, pm2 restart…). J'attends la nouvelle version.");
  }
}

// 4. Attente du redémarrage. La santé seule ne suffit pas : tant que le serveur n'a pas été relancé, c'est l'ancienne
// version qui répond « pret ». La version en service fait foi quand le serveur sait la dire.
say("\nAttente du redémarrage…");
const deadline = Date.now() + (restarted ? 6 : 20) * 60_000;
let seen = null;
let done = false;
let failed = false;
while (Date.now() < deadline && !done && !failed) {
  await sleep(3000);
  const h = await health();
  if (!h) restarted = true;
  if (!h || h.phase === "demarrage") continue;
  if (h.phase === "echec") failed = true;
  else {
    seen = await running();
    done = expected && seen.version ? compareVersions(seen.version, expected) === 0 : restarted;
  }
}
if (!done) {
  console.error(`\n✗ ${failed ? "Le démarrage a échoué (une migration, ou la base)" : !(await health()) ? "Pécule ne répond pas" : `La version en service est toujours ${seen?.version ?? current ?? "l'ancienne"} : le serveur n'a pas été redémarré`}.`);
  console.error(`    Journal : ${docker ? "docker compose logs pecule --tail 100" : "celui du serveur ou de l'hébergeur"}`);
  console.error("    Revenir en arrière : docs/guide/mise-a-jour.md, « Revenir à la version précédente ».");
  process.exit(1);
}
say(seen?.version ? `✓ Pécule ${seen.version} est en service.` : "✓ Pécule a redémarré.");

// 5. Diagnostic
say("");
const healthy = spawnSync(process.execPath, ["scripts/doctor.mjs", "--fichier", file, "--url", target], { stdio: json ? "ignore" : "inherit" }).status === 0;
process.exit(healthy ? 0 : 1);
