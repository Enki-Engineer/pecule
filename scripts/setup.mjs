#!/usr/bin/env node
// Prépare une installation de Pécule : écrit le fichier de réglages (.env) avec des secrets tirés au hasard,
// puis dit quoi lancer. Sans dépendance (Node seul), utilisable par une personne ou par un agent.
//
//   node scripts/setup.mjs --docker [--url https://pecule.exemple.fr] [--port 3000] [--proxy]
//       installation avec Docker Compose (l'appli et sa base). Facultatif : sans fichier .env, `docker compose up -d`
//       tire lui-même les secrets et les garde dans un volume ; cette commande sert à les choisir et à les tenir
//       dans un fichier, ou à régler l'adresse et le port d'un coup.
//   node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@hote:3306/pecule" [--url …] [--base-demo "mysql://…"]
//       installation sur un hébergement Node, avec une base MySQL ou MariaDB déjà créée
//   node scripts/setup.mjs --conteneur
//       dans le conteneur, lancé par le service « reglages » de compose.yaml : tire les secrets qui manquent (ou
//       reprend ceux que donne l'environnement) et les garde dans le dossier des réglages (SETTINGS_DIR)
//
// Options : --fichier <chemin> (défaut .env), --force (remplace un fichier existant), --json (résultat lisible par une machine).
import { randomBytes } from "node:crypto";
import { chmodSync, chownSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { describeDatabase, probeDatabase, supported } from "./lib/base.mjs";

const argv = process.argv.slice(2);
const HELP = `Prépare une installation de Pécule : écrit le fichier de réglages (.env), avec des secrets tirés au hasard.

  node scripts/setup.mjs --docker [--url https://pecule.exemple.fr] [--port 3000] [--proxy]
      Docker Compose : l'appli et sa base. Sans --url : http://localhost:<port>. Avec une adresse en https, Caddy
      est lancé avec Pécule et obtient le certificat ; --proxy s'il y a déjà un proxy https devant Pécule.
      Facultatif : sans fichier .env, « docker compose up -d » tire lui-même les secrets et les garde dans un volume.
  node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@hote:3306/pecule" [--url …] [--port 3000] [--base-demo "mysql://…"]
      hébergement Node, avec une base MySQL ou MariaDB déjà créée. Sans --url : http://localhost:<port>.
      La base est essayée avant d'écrire quoi que ce soit : si elle ne répond pas, la commande le dit.
      Sur une machine partagée, donne plutôt l'adresse par la variable PECULE_BASE (et PECULE_BASE_DEMO) : les
      arguments d'une commande, mot de passe compris, se lisent par « ps » depuis un autre compte.

Options : --fichier <chemin> (défaut .env) · --force (remplace un fichier existant) · --json (résultat pour un outil)
Le lien du premier démarrage se redemande à tout moment : node scripts/lien.mjs`;
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const KNOWN = new Map([["docker", 0], ["conteneur", 0], ["proxy", 0], ["force", 0], ["json", 0], ["base", 1], ["base-demo", 1], ["url", 1], ["port", 1], ["fichier", 1]]);
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
const secret = (bytes) => randomBytes(bytes).toString("hex");

// ---------- Dans le conteneur : les réglages gardés par l'installation ----------
if (flag("conteneur")) {
  await keepSettings();
  process.exit(0);
}

/**
 * Service « reglages » de compose.yaml. Chaque secret est celui que donne l'environnement (un .env à côté de
 * compose.yaml), sinon celui qui est déjà gardé, sinon un tirage : une installation d'avant garde les siens, une
 * installation neuve n'a rien à écrire. Rien n'est affiché des valeurs. Rejouable à chaque démarrage.
 *
 * Le service tourne en administrateur du conteneur : un volume neuf appartient au compte de la première image qui
 * l'a monté, pas forcément à celui du serveur. Les réglages sont donc rendus ici au compte du serveur — celui du
 * dossier de données de l'image —, et ce que lit MariaDB reste à l'administrateur de son conteneur.
 */
async function keepSettings() {
  // Les règles sont pures et testées (src/lib/settings-file.ts) ; l'image emporte ce fichier avec les scripts.
  const { composeDatabaseUrls, DATABASE_SECRETS, demoInitSql, formatSettings, KEPT_ADDRESS, parseSettings, recoverDatabasePasswords, refusals, SERVER_SECRETS, settleSecrets, SETTINGS_FILE } = await import("../src/lib/settings-file.ts");
  const dir = process.env.SETTINGS_DIR?.trim();
  if (!dir) fail("SETTINGS_DIR n'est pas donné : --conteneur se lance dans le conteneur de Pécule (service « reglages » de compose.yaml).");
  const file = path.join(dir, SETTINGS_FILE);
  const root = process.getuid?.() === 0;
  // Compte du serveur : celui du dossier qui porte le dossier des réglages (`data`, créé dans l'image pour lui).
  const owner = statSync(path.dirname(path.resolve(dir)));
  const write = (target, text, mode, toServer) => {
    // Sous un nom provisoire d'abord : le fichier lu par le serveur n'est jamais à moitié écrit.
    const partial = `${target}.partiel`;
    writeFileSync(partial, text, { mode });
    chmodSync(partial, mode);
    if (root && toServer) chownSync(partial, owner.uid, owner.gid);
    renameSync(partial, target);
  };
  try {
    mkdirSync(dir, { recursive: true });
    if (root) chownSync(dir, owner.uid, owner.gid);
    // Ce qui est déjà gardé : les secrets du serveur dans son fichier de réglages, les mots de passe de la base dans
    // le volume que MariaDB lit à la création de sa base (un fichier chacun).
    const init = process.env.BASE_INIT_DIR?.trim();
    let kept = existsSync(file) ? parseSettings(readFileSync(file, "utf8")) : {};
    if (init) for (const [name, hidden] of Object.entries(DATABASE_SECRETS)) if (existsSync(path.join(init, hidden))) kept[name] = readFileSync(path.join(init, hidden), "utf8").trim();
    // Le volume de la base perdu : ses mots de passe se retrouvent dans les adresses que le serveur garde.
    kept = recoverDatabasePasswords(kept);
    const settled = settleSecrets(process.env, kept, secret);
    // MariaDB a-t-il déjà créé sa base ? Son volume est monté ici en lecture seule (BASE_DATA_DIR) pour cette question.
    const data = process.env.BASE_DATA_DIR?.trim();
    const databaseExists = !!data && existsSync(data) && readdirSync(data).length > 0;

    // Garde-fous, avant d'écrire quoi que ce soit. Docker Compose lit aussi les variables du terminal, et le projet
    // porte le même nom d'un dossier à l'autre : ni une variable exportée pour un autre projet, ni un démarrage lancé
    // sans le fichier .env de l'installation ne doivent la dérégler en silence.
    const effective = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
    const address = effective ? { effective, explicit: !!(process.env.ADDRESS_GIVEN ?? "").trim() } : undefined;
    const refused = process.env.FORCE_SETTINGS === "1" ? [] : refusals(process.env, kept, settled, address, databaseExists);
    if (refused.length) {
      const say = (r) =>
        r.reason === "base"
          ? "Cette installation a déjà une base, mais rien ne donne ici ses réglages (ni son fichier .env, ni ses réglages gardés) : en tirer de nouveaux la rendrait injoignable, et illisibles les clés qu'elle garde. Relance depuis le dossier de l'installation, celui qui porte son .env — « docker compose ls -a » dit lequel. Si ses réglages sont perdus pour de bon, une sauvegarde complète se restaure dans une installation neuve (docs/guide/installation.md)."
          : r.reason === "court"
          ? `${r.name}, donné par l'environnement, est trop court (${r.min} caractères au moins) : il vient sans doute d'un autre projet. Retire-le de ton terminal (unset ${r.name}) ou corrige-le dans .env.`
          : r.reason === "chiffrement"
            ? "Le secret qui chiffre les clés gardées en base (SECRET_KEY, à défaut API_TOKEN) ne serait plus celui de cette installation : la clé de la banque et celle de l'IA deviendraient illisibles. Une variable du terminal ou de .env le remplace-t-elle ? Pour changer le jeton d'administration d'une installation sans SECRET_KEY, donne d'abord à SECRET_KEY la valeur de l'ancien jeton."
            : r.reason === "remplace"
              ? `${r.name}, donné par l'environnement, n'est pas celui que cette installation garde : il le remplacerait. Une variable de ce nom est-elle exportée dans ton terminal pour un autre projet ? Retire-la (unset ${r.name}). Pour changer ce secret exprès, écris-le dans .env et passe outre comme indiqué ci-dessous.`
            : `Cette installation de Pécule est servie à ${r.from} ; lancée d'ici, elle passerait à ${r.to}. Le fichier .env de son dossier manque sans doute : relance depuis ce dossier, ou écris l'adresse voulue dans .env (APP_URL, ou PECULE_PORT pour un essai sur la machine).`;
      fail(`${refused.map(say).join("\n  ")}\n  Rien n'a été modifié ; Pécule reste arrêté tant que ce démarrage n'aboutit pas. Passer outre, en connaissance de cause : docker compose run --rm -e FORCE_SETTINGS=1 reglages, puis docker compose up -d`);
    }

    // Le serveur ne reçoit que ses propres secrets et l'adresse de ses deux bases : pas le mot de passe de
    // l'administrateur de la base. Sans volume pour la base, tout reste dans ce fichier, faute d'autre endroit.
    const forServer = Object.fromEntries(Object.entries(settled.values).filter(([name]) => !init || SERVER_SECRETS.includes(name)));
    // L'adresse de ce démarrage est gardée avec eux : c'est elle que le garde-fou comparera au suivant.
    const values = { ...forServer, ...composeDatabaseUrls({ DB_PASSWORD: settled.values.DB_PASSWORD, DEMO_DB_PASSWORD: settled.values.DEMO_DB_PASSWORD }), [KEPT_ADDRESS]: address?.effective ?? kept[KEPT_ADDRESS] ?? "" };
    const text = formatSettings(values, "Réglages gardés par cette installation de Pécule (scripts/setup.mjs --conteneur). Ne jamais publier ce fichier.");
    // Réécrit à chaque passage : le fichier appartient au compte du serveur, et à lui seul.
    write(file, text, 0o600, true);

    // Ce que le conteneur MariaDB lit une seule fois, à la création de sa base : ses mots de passe et la base de la démo.
    if (init) {
      mkdirSync(init, { recursive: true });
      // Le dossier est parcouru par le compte « mysql » du conteneur de la base.
      chmodSync(init, 0o755);
      // Fichiers cachés : MariaDB ne joue que ce qui porte une extension connue, et ne voit pas ceux-ci. Il les lit
      // en administrateur de son conteneur, avant de passer au compte « mysql ».
      for (const [name, hidden] of Object.entries(DATABASE_SECRETS)) write(path.join(init, hidden), settled.values[name], 0o600, false);
      // Joué par le compte « mysql » : lisible de tous dans ce volume, que seul le conteneur de la base monte.
      write(path.join(init, "10-demo.sql"), demoInitSql(settled.values.DEMO_DB_PASSWORD), 0o644, false);
    }
    if (json) console.log(JSON.stringify({ ok: true, file, drawn: settled.drawn, given: settled.given }));
    else {
      const parts = [settled.drawn.length ? `${settled.drawn.length} tiré${settled.drawn.length > 1 ? "s" : ""} au hasard` : null, // Nommés (un nom n'est pas un secret) : un jeton pris dans une variable du terminal ne passe pas inaperçu.
        settled.given.length ? `repris de l'environnement (fichier .env ou variables du terminal) : ${settled.given.join(", ")}` : null].filter(Boolean);
      console.log(`✓ Réglages de l'installation gardés dans ${file}${parts.length ? ` (secrets : ${parts.join(", ")})` : " (rien de nouveau)"}.`);
    }
  } catch (e) {
    const denied = e && typeof e === "object" && (e.code === "EACCES" || e.code === "EPERM" || e.code === "EROFS");
    const where = (e && typeof e === "object" && typeof e.path === "string" && e.path) || dir;
    fail(denied ? `${where} n'est pas inscriptible par le compte du conteneur (uid ${process.getuid?.() ?? "?"}) : le service « reglages » de compose.yaml doit tourner en administrateur (user: "0:0"), et un dossier monté depuis la machine doit lui être ouvert.` : `Réglages impossibles à garder : ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------- Sur la machine : le fichier .env ----------
const docker = flag("docker");
// L'adresse de la base porte son mot de passe : la variable PECULE_BASE la donne sans l'écrire parmi les arguments
// de la commande, que tout compte de la machine peut lire (« ps »).
const base = value("base") ?? (process.env.PECULE_BASE?.trim() || undefined);
const file = value("fichier") ?? ".env";
const port = Number(value("port") ?? 3000);
const url = (value("url") ?? `http://localhost:${port}`).replace(/\/+$/, "");

if (!docker && !base) fail("Indique --docker (Docker Compose) ou --base \"mysql://…\" (base déjà créée).");
if (docker && base) fail("--docker fournit sa propre base : ne donne pas --base.");
if (!Number.isInteger(port) || port < 1 || port > 65535) fail(`Port invalide : ${value("port")}`);
let parsed;
try {
  parsed = new URL(url);
} catch {
  fail(`Adresse invalide : ${url}`);
}
const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
if (parsed.protocol !== "https:" && !local) fail(`${url} : il faut une adresse en https (les clés d'accès l'exigent), ou http://localhost pour un essai sur sa propre machine.`);
if (base && !/^mysql:\/\/[^:]+:[^@]*@[^/]+\/[^/?]+/.test(base)) fail("--base : attendu « mysql://utilisateur:motdepasse@hote:3306/nom_de_la_base ».");
if (flag("proxy") && !docker) fail("--proxy ne vaut qu'avec --docker (il retient Caddy, que Docker Compose lancerait).");
if (existsSync(file) && !flag("force")) fail(`${file} existe déjà : rien n'a été modifié (--force pour le remplacer, --fichier pour écrire ailleurs).`);

// Un Pécule répond déjà sur ce port, sans fichier de réglages ici : il tient les siens de son environnement (les
// variables d'un hébergeur). Un .env écrit à côté de lui s'y ajouterait au prochain démarrage — une clé de
// chiffrement neuve, là où il n'en avait pas, rendrait illisibles les clés qu'il garde en base.
if (!docker && !flag("force")) {
  const answering = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.json())
    .then((body) => typeof body?.phase === "string")
    .catch(() => false);
  if (answering) fail(`Un Pécule répond déjà sur le port ${port}, et ${file} n'existe pas : ses réglages lui viennent de son environnement (les variables de l'hébergeur). Rien n'a été écrit — un fichier .env ici pourrait remplacer sa clé de chiffrement au prochain démarrage. Pour une autre installation : --port <autre>, ou --fichier <ailleurs> ; pour écrire quand même : --force.`);
}

// La base donnée répond-elle ? Essayée avant d'écrire les réglages, quand le pilote du serveur est à portée (archive
// prête à l'emploi, dépôt installé) : une adresse fausse se voit ici, pas au premier démarrage.
const database = base ? await probeDatabase(base) : null;
const databaseOk = !database || (database.reachable && supported(database.version));

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
// Caddy (https avec certificat automatique) n'est lancé que pour une adresse publique, et sans autre proxy devant.
const caddy = docker && !local && !flag("proxy");
if (docker) {
  lines.push(`DB_PASSWORD=${secret(16)}`, `DEMO_DB_PASSWORD=${secret(16)}`, `DB_ROOT_PASSWORD=${secret(16)}`, `PECULE_PORT=${port}`);
  if (!local) lines.push(`PECULE_DOMAIN=${parsed.hostname}`);
  // Le profil « https » de compose.yaml : inscrit ici, « docker compose up -d » suffit, à l'installation comme ensuite.
  if (caddy) lines.push("COMPOSE_PROFILES=https");
} else {
  lines.push(`PORT=${port}`, `DATABASE_URL=${base}`);
  const demo = value("base-demo") ?? (process.env.PECULE_BASE_DEMO?.trim() || undefined);
  if (demo) lines.push(`DEMO_DATABASE_URL=${demo}`);
}
// Port déjà pris sur cette machine ? On prévient avant le démarrage (rien n'empêche d'écrire les réglages).
const busy = await new Promise((resolve) => {
  const probe = createServer();
  probe.once("error", () => resolve(true));
  probe.once("listening", () => probe.close(() => resolve(false)));
  probe.listen(port, "127.0.0.1");
});
// Écrit à côté, déjà fermé (0600), puis mis à sa place : les secrets ne passent jamais par un fichier aux droits de
// celui qu'il remplace (--force), et une écriture interrompue ne laisse pas un fichier à moitié écrit.
const draft = `${file}.${randomBytes(6).toString("hex")}.partiel`;
writeFileSync(draft, `${lines.join("\n")}\n`, { mode: 0o600 });
chmodSync(draft, 0o600);
renameSync(draft, file);

// Le lien du premier démarrage porte le code : il n'y a plus qu'un prénom à donner à l'écran.
const link = `${url}/#code=${setupCode}`;
// Le dépôt se construit avant de démarrer ; l'archive prête à l'emploi est déjà construite.
const start = docker ? "docker compose up -d" : existsSync("src/server") ? "pnpm install --frozen-lockfile && pnpm build && node dist/server.mjs" : "node dist/server.mjs";
const next = [
  start,
  `ouvrir ${link} : l'écran « Bienvenue dans Pécule » demande ton prénom (le code d'installation est dans le lien)`,
  "créer ta clé d'accès (Face ID, Touch ID ou code de l'appareil), puis relier une banque ou importer un fichier dans Réglages → Comptes et connexions",
];
const warnings = [
  busy ? `Le port ${port} est déjà pris sur cette machine : choisis-en un autre avec --port (et --force pour réécrire ${file}).` : null,
  !databaseOk ? `Attention, ${describeDatabase(database)}. Les réglages sont écrits ; corrige l'adresse de la base (--base, avec --force) avant de démarrer.` : null,
  database?.reachable && database.tables > 0 ? `La base porte déjà ${database.tables} tables : Pécule s'installe dans une base vide, ou reprend la sienne.` : null,
].filter(Boolean);
const warning = warnings.length ? warnings.join(" ") : null;
// database : la base essayée (`reachable`, sa version, ses tables) ; absent quand rien n'a pu être essayé.
if (json) console.log(JSON.stringify({ ok: true, file, url, port, portBusy: busy, mode: docker ? "docker" : "node", https: caddy ? "caddy" : local ? "aucun" : "proxy", ...(database ? { database } : {}), installationCode: setupCode, link, start, next, ...(warning ? { warning } : {}) }));
else {
  console.log(`✓ ${file} écrit (adresse ${url}, ${docker ? "Docker Compose" : databaseOk && database ? describeDatabase(database) : "base fournie"}).`);
  for (const w of warnings) console.log(`⚠ ${w}`);
  console.log(`\nLien du premier démarrage (il ne sert qu'une fois ; node scripts/lien.mjs le redonne) :\n  ${link}\n`);
  console.log(`Code d'installation, si l'écran le demande : ${setupCode}\n`);
  console.log("Ensuite :");
  next.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
  console.log("\nVérifier à tout moment : node scripts/doctor.mjs");
}
