#!/usr/bin/env node
// Prépare une installation de Pécule : écrit le fichier de réglages (.env) avec des secrets tirés au hasard,
// puis dit quoi lancer. Sans dépendance (Node seul), utilisable par une personne ou par un agent.
//
//   node scripts/setup.mjs --docker [--url https://pecule.exemple.fr] [--port 3000]
//       installation avec Docker Compose (l'appli et sa base)
//   node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@hote:3306/pecule" [--url …] [--base-demo "mysql://…"]
//       installation sur un hébergement Node, avec une base MySQL ou MariaDB déjà créée
//
// Options : --fichier <chemin> (défaut .env), --force (remplace un fichier existant), --json (résultat lisible par une machine).
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";

const argv = process.argv.slice(2);
const HELP = `Prépare une installation de Pécule : écrit le fichier de réglages (.env), avec des secrets tirés au hasard.

  node scripts/setup.mjs --docker [--url https://pecule.exemple.fr] [--port 3000]
      Docker Compose : l'appli et sa base. Sans --url : http://localhost:<port>.
  node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@hote:3306/pecule" [--url …] [--port 3000] [--base-demo "mysql://…"]
      hébergement Node, avec une base MySQL ou MariaDB déjà créée.

Options : --fichier <chemin> (défaut .env) · --force (remplace un fichier existant) · --json (résultat pour un outil)`;
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const KNOWN = new Map([["docker", 0], ["force", 0], ["json", 0], ["base", 1], ["base-demo", 1], ["url", 1], ["port", 1], ["fichier", 1]]);
for (let i = 0; i < argv.length; i++) {
  const name = argv[i].startsWith("--") ? argv[i].slice(2) : null;
  if (name === null || !KNOWN.has(name)) {
    console.error(`✗ Option inconnue : ${argv[i]}\n\n${HELP}`);
    process.exit(1);
  }
  i += KNOWN.get(name);
}
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const json = flag("json");
const fail = (message) => {
  if (json) console.log(JSON.stringify({ ok: false, error: message }));
  else console.error(`✗ ${message}`);
  process.exit(1);
};

const docker = flag("docker");
const base = value("base");
const file = value("fichier") ?? ".env";
const port = Number(value("port") ?? 3000);
const url = (value("url") ?? `http://localhost:${port}`).replace(/\/+$/, "");

if (!docker && !base) fail("Indique --docker (Docker Compose) ou --base \"mysql://…\" (base déjà créée).");
if (docker && base) fail("--docker fournit sa propre base : ne donne pas --base.");
let parsed;
try {
  parsed = new URL(url);
} catch {
  fail(`Adresse invalide : ${url}`);
}
const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
if (parsed.protocol !== "https:" && !local) fail(`${url} : il faut une adresse en https (les clés d'accès l'exigent), ou http://localhost pour un essai sur sa propre machine.`);
if (base && !/^mysql:\/\/[^:]+:[^@]*@[^/]+\/[^/?]+/.test(base)) fail("--base : attendu « mysql://utilisateur:motdepasse@hote:3306/nom_de_la_base ».");
if (existsSync(file) && !flag("force")) fail(`${file} existe déjà : rien n'a été modifié (--force pour le remplacer, --fichier pour écrire ailleurs).`);

const secret = (bytes) => randomBytes(bytes).toString("hex");
const apiToken = secret(24);
// Code du premier démarrage : il crée le premier membre puis ne sert plus (ce n'est pas le jeton d'administration).
const setupCode = secret(12);
const lines = [
  "# Réglages de Pécule — écrit par scripts/setup.mjs. Ne jamais publier ce fichier.",
  `APP_URL=${url}`,
  `API_TOKEN=${apiToken}`,
  `SETUP_CODE=${setupCode}`,
  `SYNC_TOKEN=${secret(24)}`,
  // Chiffre les clés gardées en base (banque, IA) : à garder avec les sauvegardes, jamais à changer sans les ressaisir.
  `SECRET_KEY=${secret(32)}`,
  "NODE_ENV=production",
];
if (docker) {
  lines.push(`DB_PASSWORD=${secret(16)}`, `DEMO_DB_PASSWORD=${secret(16)}`, `DB_ROOT_PASSWORD=${secret(16)}`, `PECULE_PORT=${port}`);
  if (!local) lines.push(`PECULE_DOMAIN=${parsed.hostname}`);
} else {
  lines.push(`PORT=${port}`, `DATABASE_URL=${base}`);
  const demo = value("base-demo");
  if (demo) lines.push(`DEMO_DATABASE_URL=${demo}`);
}
// Port déjà pris sur cette machine ? On prévient avant le démarrage (rien n'empêche d'écrire les réglages).
const busy = await new Promise((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(true));
  probe.once("listening", () => probe.close(() => resolve(false)));
  probe.listen(port, "127.0.0.1");
});
writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
chmodSync(file, 0o600); // un fichier déjà là (--force) garde sinon ses anciens droits

const start = docker ? (local ? "docker compose up -d --build" : "docker compose --profile https up -d --build") : "pnpm install --frozen-lockfile && pnpm build && node dist/server.mjs";
const next = [
  start,
  `ouvrir ${url} : l'écran « Bienvenue dans Pécule » demande ton prénom et le code d'installation`,
  "créer ta clé d'accès (Face ID, Touch ID ou code de l'appareil), puis relier une banque ou importer un fichier dans Réglages → Comptes et connexions",
];
const warning = busy ? `Le port ${port} est déjà pris sur cette machine : choisis-en un autre avec --port (et --force pour réécrire ${file}).` : null;
if (json) console.log(JSON.stringify({ ok: true, file, url, port, portBusy: busy, mode: docker ? "docker" : "node", installationCode: setupCode, start, next, ...(warning ? { warning } : {}) }));
else {
  console.log(`✓ ${file} écrit (adresse ${url}, ${docker ? "Docker Compose" : "base fournie"}).`);
  if (warning) console.log(`⚠ ${warning}`);
  console.log(`\nCode d'installation (demandé une seule fois, au premier démarrage ; il ne sert plus ensuite) :\n  ${setupCode}\n`);
  console.log("Ensuite :");
  next.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  console.log("\nVérifier à tout moment : node scripts/doctor.mjs");
}
