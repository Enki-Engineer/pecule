#!/usr/bin/env node
// Fabrique l'appli de bureau de Pécule pour Mac (puce Apple) : « Pécule.app », qui embarque Node, un MySQL réduit à
// son serveur, et l'archive prête à l'emploi de la version. Node seul pour ce script ; la machine qui fabrique a
// besoin de pnpm (l'outil de Tauri est une dépendance de développement du dépôt) et de Rust.
//
//   node bureau/fabriquer.mjs [--sortie dist/bureau] [--preparer] [--sans-construire] [--sans-preparer] [--config <json>]
//   node bureau/fabriquer.mjs --signer [--sortie dist/bureau]     signe l'archive de mise à jour déjà fabriquée
//
//   --preparer          s'arrête avant la compilation de la coque : pièces, appli et icônes en place (développement)
//   --sans-construire   reprend dist/ tel qu'il est, sans relancer « pnpm build »
//   --sans-preparer     reprend les pièces, l'appli et les icônes déjà en place (une seconde fabrication, à la suite)
//   --config <json>     réglages de Tauri à poser par-dessus les siens (l'essai des mises à jour s'en sert)
//
// Écrit dans le dossier de sortie : Pecule-mac.zip (l'appli), Pecule-mac.app.tar.gz (la même, pour la mise à jour
// par l'appli), leurs empreintes, pecule-mac.sh (l'installation par une commande) et — si la clé qui signe les mises
// à jour est donnée (TAURI_SIGNING_PRIVATE_KEY : la clé, ou son fichier) — pecule-mac.json, que l'appli lit pour se
// mettre à jour. La clé ne sert qu'à cette dernière étape, que « --signer » joue seule : dans un flux automatique,
// rien de ce qui se télécharge ou se compile ne tourne avec elle.
//
// Les pièces viennent de leurs éditeurs, épinglées par leur empreinte (`bureau/pieces.json`) : une pièce qui ne la
// porte pas n'entre pas dans l'appli. Leurs licences sont jointes ; MySQL est distribué sous GPL version 2, tel que
// son éditeur le publie, sans modification.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const HELP = `Fabrique l'appli de bureau de Pécule pour Mac (puce Apple).

  node bureau/fabriquer.mjs [--sortie dist/bureau] [--preparer] [--sans-construire] [--sans-preparer] [--config <json>]
  node bureau/fabriquer.mjs --signer [--sortie dist/bureau]

  --preparer          pièces, appli et icônes en place, sans compiler la coque (développement)
  --sans-construire   reprend dist/ tel qu'il est, sans relancer « pnpm build »
  --sans-preparer     reprend les pièces, l'appli et les icônes déjà en place
  --config <json>     réglages de Tauri posés par-dessus les siens
  --signer            signe l'archive de mise à jour déjà fabriquée (TAURI_SIGNING_PRIVATE_KEY), et rien d'autre

Il faut pnpm et Rust (l'outil de Tauri vient avec les dépendances de développement : pnpm install).`;
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};
for (let i = 0; i < argv.length; i++) {
  if (["--preparer", "--sans-construire", "--sans-preparer", "--signer"].includes(argv[i])) continue;
  if (!["--sortie", "--config"].includes(argv[i]) || argv[++i] === undefined) fail(`Option inconnue ou incomplète : ${argv[i] ?? "--sortie"}\n\n${HELP}`);
}
// La signature seule se fait n'importe où : elle ne lit que l'archive déjà fabriquée.
if (!argv.includes("--signer") && (process.platform !== "darwin" || process.arch !== "arm64")) fail(`L'appli de bureau se fabrique sur un Mac à puce Apple (ici : ${process.platform} ${process.arch}).`);

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const tauri = path.join(here, "src-tauri");
const resources = path.join(tauri, "ressources");
const cache = path.join(here, ".pieces");
const out = path.resolve(root, argv.includes("--sortie") ? argv[argv.indexOf("--sortie") + 1] : "dist/bureau");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const pieces = JSON.parse(readFileSync(path.join(here, "pieces.json"), "utf8"));
const say = (line) => console.log(line);
/** L'outil de Tauri : celui des dépendances de développement du dépôt, à défaut celui de Cargo. */
const tauriCli = existsSync(path.join(root, "node_modules", ".bin", "tauri")) ? ["pnpm", ["exec", "tauri"]] : ["cargo", ["tauri"]];
const runTauri = (args, options) => run(tauriCli[0], [...tauriCli[1], ...args], options);
const mo = (octets) => `${(octets / 1_048_576).toFixed(1).replace(".", ",")} Mo`;

function run(command, args, options = {}) {
  const r = spawnSync(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (r.error) fail(`${command} est introuvable sur cette machine.`);
  if (r.status !== 0) fail(`${command} ${args.join(" ")} a échoué :\n${`${r.stdout}${r.stderr}`.trim().split("\n").slice(-25).join("\n")}`);
  return r.stdout;
}
const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex"))).on("error", reject);
  });
function sizeOf(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) total += entry.isDirectory() ? sizeOf(path.join(dir, entry.name)) : statSync(path.join(dir, entry.name)).size;
  return total;
}

function dereference(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const real = realpathSync(full);
      rmSync(full);
      cpSync(real, full, { recursive: true });
    } else if (entry.isDirectory()) dereference(full);
  }
}

// ---------- 1. Les pièces : Node et MySQL, tels que leurs éditeurs les publient ----------
async function piece(name) {
  const p = pieces[name];
  const archive = path.join(cache, path.basename(new URL(p.url).pathname));
  mkdirSync(cache, { recursive: true });
  if (!existsSync(archive) || (await sha256(archive)) !== p.sha256) {
    say(`  téléchargement de ${name} ${p.version}…`);
    const response = await fetch(p.url);
    if (!response.ok || !response.body) fail(`${p.url} : réponse ${response.status}.`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${archive}.partiel`));
    // L'empreinte épinglée dans pieces.json : ce qui ne la porte pas n'entre pas dans l'appli.
    const got = await sha256(`${archive}.partiel`);
    if (got !== p.sha256) {
      rmSync(`${archive}.partiel`, { force: true });
      fail(`${name} ${p.version} : l'empreinte du fichier téléchargé (${got}) n'est pas celle de bureau/pieces.json. Rien n'a été déplié.`);
    }
    cpSync(`${archive}.partiel`, archive);
    rmSync(`${archive}.partiel`, { force: true });
  }
  const target = path.join(resources, name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  // Seulement les fichiers nommés : du MySQL de 640 Mo, il reste son serveur (76 Mo).
  run("tar", ["-xzf", archive, "-C", target, "--strip-components=1", ...p.fichiers.map((f) => `${p.racine}/${f}`)]);
  for (const f of p.fichiers) if (!existsSync(path.join(target, f))) fail(`${name} ${p.version} : ${f} manque dans l'archive de l'éditeur.`);
  // Un lien de l'archive devient le fichier qu'il désigne : l'appli ne porte aucun lien (une copie les perdrait).
  dereference(target);
  return target;
}

async function prepareParts() {
  say("Pièces (bureau/pieces.json) :");
  const node = await piece("node");
  const mysql = await piece("mysql");
  // Elles tournent, sur cette machine, telles qu'elles sont dans l'appli.
  const nodeVersion = run(path.join(node, "bin", "node"), ["--version"]).trim();
  if (nodeVersion !== `v${pieces.node.version}`) fail(`Le Node déplié dit ${nodeVersion}, pas v${pieces.node.version}.`);
  const mysqlVersion = run(path.join(mysql, "bin", "mysqld"), ["--no-defaults", "--version"]).trim();
  if (!mysqlVersion.includes(pieces.mysql.version)) fail(`Le MySQL déplié ne dit pas sa version ${pieces.mysql.version} : ${mysqlVersion}`);
  // Aucune bibliothèque de MySQL ne manque : celles qu'il cherche à côté de lui sont toutes là.
  for (const line of run("otool", ["-L", path.join(mysql, "bin", "mysqld")]).split("\n")) {
    const lib = /^\s+@loader_path\/(\S+)/.exec(line)?.[1];
    if (lib && !existsSync(path.join(mysql, "bin", lib))) fail(`MySQL cherche ${lib}, qui n'est pas dans bureau/pieces.json.`);
  }
  // Le Node de l'appli doit suffire à Pécule.
  const need = Number(/(\d+)/.exec(pkg.engines?.node ?? "")?.[1] ?? 0);
  if (Number(pieces.node.version.split(".")[0]) < need) fail(`Pécule demande Node ${need} ; bureau/pieces.json épingle ${pieces.node.version}.`);
  writeFileSync(
    path.join(resources, "LICENCES.txt"),
    `Pécule ${pkg.version} — appli de bureau. Ce qu'elle embarque, et sous quelle licence.

Pécule            ${pkg.license}                          appli/LICENSE
Node.js ${pieces.node.version.padEnd(10)}licence MIT (et celles de ses composants)   node/LICENSE
                  ${pieces.node.url}
MySQL ${pieces.mysql.version.padEnd(12)}GPL version 2                               mysql/LICENSE
                  ${pieces.mysql.url}

MySQL Community Server est distribué ici tel que son éditeur (Oracle) le publie, sans modification : le serveur
« mysqld » et les bibliothèques qu'il charge. Pécule le lance comme un programme à part et lui parle par un socket.
Ses sources : ${pieces.mysql.sources}.
`,
  );
  say(`  ✓ Node ${pieces.node.version} (${mo(sizeOf(node))}), MySQL ${pieces.mysql.version} (${mo(sizeOf(mysql))})`);
}

// ---------- 2. Pécule : l'archive prête à l'emploi de cette version ----------
function prepareApp() {
  say("Pécule :");
  if (!argv.includes("--sans-construire")) run("pnpm", ["build"]);
  const work = mkdtempSync(path.join(os.tmpdir(), "pecule-bureau-"));
  try {
    run(process.execPath, ["scripts/paquet.mjs", "--sortie", work]);
    const target = path.join(resources, "pecule");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    run("tar", ["-xzf", path.join(work, "pecule.tar.gz"), "-C", target, "--strip-components=1"]);
    for (const f of ["dist/server.mjs", "scripts/bureau.mjs", "src/lib/desktop.ts", "node_modules/mysql2/package.json", "LICENSE"]) if (!existsSync(path.join(target, f))) fail(`L'archive de Pécule ne porte pas ${f}.`);
    say(`  ✓ Pécule ${pkg.version} (${mo(sizeOf(target))})`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---------- 3. Icônes et mots de la coque ----------
function prepareShell() {
  // L'icône de l'appli web va d'un bord à l'autre ; celle d'une appli de Mac laisse une marge autour d'elle.
  const icon = readFileSync(path.join(root, "public", "icons", "icon.svg"), "utf8");
  const inner = /^<svg[^>]*viewBox="0 0 512 512"[^>]*>([\s\S]*)<\/svg>\s*$/.exec(icon)?.[1];
  if (!inner) fail("public/icons/icon.svg n'a plus la forme attendue (viewBox 0 0 512 512).");
  const work = mkdtempSync(path.join(os.tmpdir(), "pecule-icone-"));
  try {
    const padded = path.join(work, "icone.svg");
    writeFileSync(padded, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><g transform="translate(100 100) scale(1.609375)">${inner}</g></svg>\n`);
    runTauri(["icon", padded, "--output", path.join(tauri, "icons")], { cwd: tauri });
    for (const extra of ["android", "ios"]) rmSync(path.join(tauri, "icons", extra), { recursive: true, force: true });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  cpSync(path.join(root, "public", "icons", "icon.svg"), path.join(tauri, "demarrage", "logo.svg"));
  say("  ✓ icônes");
}

// ---------- 4. La coque, puis l'appli ----------
function build() {
  say("Coque (Rust, Tauri) :");
  // L'archive de mise à jour se fait ici, et se signe à part (`sign`) : la clé n'entre pas dans cette étape.
  const config = ["--config", JSON.stringify({ bundle: { createUpdaterArtifacts: false } })];
  if (argv.includes("--config")) config.push("--config", argv[argv.indexOf("--config") + 1]);
  // « --locked » : les paquets de Rust sont ceux de Cargo.lock, pas plus récents.
  runTauri(["build", "--bundles", "app", ...config, "--", "--locked"], { cwd: tauri, stdio: ["ignore", "inherit", "inherit"], encoding: undefined });
  const app = path.join(tauri, "target", "release", "bundle", "macos", "Pécule.app");
  if (!existsSync(app)) fail(`${app} n'a pas été fabriquée.`);
  const inside = path.join(app, "Contents", "Resources");
  for (const f of ["node/bin/node", "mysql/bin/mysqld", "appli/scripts/bureau.mjs", "appli/node_modules/mysql2/package.json", "LICENCES.txt"]) if (!existsSync(path.join(inside, f))) fail(`L'appli ne porte pas ${f}.`);
  // Signée sans certificat (« ad hoc ») : sur une puce Apple, rien ne se lance sans signature. Celle de Node et celle
  // de MySQL sont celles de leurs éditeurs.
  run("codesign", ["--verify", "--strict", app]);
  for (const f of ["node/bin/node", "mysql/bin/mysqld"]) run("codesign", ["--verify", path.join(inside, f)]);
  if (run(path.join(inside, "node", "bin", "node"), ["--version"]).trim() !== `v${pieces.node.version}`) fail("Le Node de l'appli ne se lance pas.");
  say(`  ✓ Pécule.app (${mo(sizeOf(app))})`);
  return app;
}

const ZIP = "Pecule-mac.zip";
const UPDATE = "Pecule-mac.app.tar.gz";
const MANIFEST = "pecule-mac.json";

async function publish(app) {
  mkdirSync(out, { recursive: true });
  for (const f of [ZIP, UPDATE, `${UPDATE}.sig`, MANIFEST, "SHA256SUMS-mac"]) rmSync(path.join(out, f), { force: true });
  // « ditto » garde les signatures et les droits des fichiers, qu'un zip ordinaire abîmerait.
  run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, path.join(out, ZIP)]);
  // La même appli, dans la forme que l'appli sait déplier sur elle-même pour se mettre à jour.
  run("tar", ["-czf", path.join(out, UPDATE), "-C", path.dirname(app), path.basename(app)], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
  cpSync(path.join(here, "pecule-mac.sh"), path.join(out, "pecule-mac.sh"));
  const sums = [];
  for (const f of [ZIP, UPDATE, "pecule-mac.sh"]) sums.push(`${await sha256(path.join(out, f))}  ${f}`);
  writeFileSync(path.join(out, "SHA256SUMS-mac"), `${sums.join("\n")}\n`);
  say(`✓ Pécule ${versionOf(app)} pour Mac — dans ${path.relative(root, out) || out}`);
  for (const f of [ZIP, UPDATE]) say(`  ${f.padEnd(24)} ${mo(statSync(path.join(out, f)).size)}`);
}

/** La version que porte l'appli fabriquée (celle du dépôt, sauf réglage d'essai). */
const versionOf = (app) => run("plutil", ["-extract", "CFBundleShortVersionString", "raw", path.join(app, "Contents", "Info.plist")]).trim();

// ---------- 5. La signature de l'archive de mise à jour ----------
/**
 * Signe l'archive de mise à jour et écrit `pecule-mac.json`, que l'appli lit pour savoir si une version plus récente
 * est publiée, où la prendre, et quelle signature elle doit porter. Sans la clé : rien, et l'appli fabriquée ne
 * peut pas servir de mise à jour.
 */
function sign() {
  const key = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim();
  const archive = path.join(out, UPDATE);
  if (!key) return void say("  (pas de pecule-mac.json : la clé qui signe les mises à jour, TAURI_SIGNING_PRIVATE_KEY, n'est pas donnée)");
  if (!existsSync(archive)) fail(`${archive} manque : fabrique d'abord l'appli.`);
  rmSync(`${archive}.sig`, { force: true });
  // La clé elle-même, ou le chemin de son fichier : jamais sur la ligne de commande, que d'autres comptes liraient.
  const env = { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key };
  if (existsSync(key)) {
    delete env.TAURI_SIGNING_PRIVATE_KEY;
    env.TAURI_SIGNING_PRIVATE_KEY_PATH = key;
  }
  if (env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD !== undefined) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD.trim();
  // La signature couvre aussi la version : l'appli refuse une archive ancienne qu'on lui annoncerait comme nouvelle.
  runTauri(["signer", "sign", "--app-version", pkg.version, archive], { cwd: tauri, env });
  if (!existsSync(`${archive}.sig`)) fail("L'archive de mise à jour n'a pas été signée.");
  // La version est celle du dépôt ; `depuis` : celle à partir de laquelle on vient droit à elle (plus ancienne, il
  // faut un palier, et l'appli le dit).
  const repo = /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(pkg.repository?.url ?? pkg.repository ?? "")?.[1] ?? "Enki-Engineer/pecule";
  const manifest = { version: pkg.version, depuis: pkg.pecule?.depuis ?? null, pub_date: new Date().toISOString(), platforms: { "darwin-aarch64": { url: `https://github.com/${repo}/releases/download/v${pkg.version}/${UPDATE}`, signature: readFileSync(`${archive}.sig`, "utf8").trim() } } };
  writeFileSync(path.join(out, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(`${archive}.sig`, { force: true });
  say(`  ✓ ${MANIFEST} (archive de mise à jour signée)`);
}

if (argv.includes("--signer")) {
  sign();
  process.exit(0);
}
if (!argv.includes("--sans-preparer")) {
  await prepareParts();
  prepareApp();
  prepareShell();
}
if (argv.includes("--preparer")) {
  say(`✓ Prêt pour compiler la coque (cd bureau/src-tauri && pnpm exec tauri build).`);
  process.exit(0);
}
await publish(build());
sign();
