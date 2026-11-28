#!/usr/bin/env node
// Le superviseur de l'appli de bureau : Pécule sur l'ordinateur de celui qui s'en sert, sans serveur à tenir ni Docker.
// Il fait tout ce qui n'est pas la fenêtre — dossier des données, réglages tirés une fois, base MySQL embarquée,
// serveur attaché à la machine seule — et arrête tout proprement. La fenêtre de l'appli (la coque) le lance et
// charge l'adresse qu'il annonce ; lancé à la main, il ouvre Pécule dans le navigateur (--ouvrir).
//
//   node scripts/bureau.mjs --mysql <dossier de MySQL> [--donnees <dossier>] [--port 47800] [--ouvrir] [--json]
//   node scripts/bureau.mjs --etat [--donnees <dossier>] [--json]      l'appli tourne-t-elle, à quelle adresse ?
//   node scripts/bureau.mjs --arreter [--donnees <dossier>]            arrête celle qui tourne
//
// Rien ne sort de la machine : le serveur n'écoute que sur 127.0.0.1, la base n'a aucun port (un socket du dossier
// des données). Règles : src/lib/desktop.ts. Il lui faut le pilote du serveur (mysql2) : l'archive prête à l'emploi
// et le dépôt installé l'ont.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { chooseSocket, defaultDataDir, desktopLayout, desktopServerEnv, desktopUrl, firstPort, hasArgument, inheritedEnv, keptPort, mayRestart, mysqlArgs, mysqlInitArgs, parseLock, portCandidates, provisionSql } from "../src/lib/desktop.ts";
import { formatSettings, parseSettings, SETTINGS_FILE, settleSecrets, setupLink } from "../src/lib/settings-file.ts";

const HELP = `Lance Pécule sur cet ordinateur, avec sa propre base : l'appli de bureau, sans sa fenêtre.

  node scripts/bureau.mjs --mysql <dossier de MySQL> [--donnees <dossier>] [--port 47800] [--ouvrir] [--json]
  node scripts/bureau.mjs --etat [--donnees <dossier>] [--json]     l'appli tourne-t-elle, à quelle adresse ?
  node scripts/bureau.mjs --arreter [--donnees <dossier>]           arrête celle qui tourne

Crée au besoin le dossier des données (réglages, base, sauvegardes, journaux), démarre MySQL puis Pécule, et reste
là : Ctrl-C arrête tout proprement. Rien ne sort de la machine — Pécule n'écoute que sur 127.0.0.1, sa base n'a
aucun port.

  --mysql <dossier>     MySQL 8.4 déplié (le dossier qui porte bin/mysqld) ; sinon la variable PECULE_MYSQL, sinon
                        le dossier « mysql » posé à côté de celui de Pécule (ce que fait l'appli de bureau)
  --donnees <dossier>   dossier des données ; sinon PECULE_DONNEES, sinon celui du système
  --port <n>            port de Pécule ; choisi à la première ouverture, puis gardé
  --ouvrir              ouvre Pécule dans le navigateur une fois prêt
  --attache             s'arrête quand son entrée se ferme (la coque le lance ainsi : si elle disparaît, tout s'arrête)
  --coque               lancé par la fenêtre de l'appli : elle saura rendre au serveur le retour d'une banque
  --json                une ligne JSON par événement (demarrage, pret, arret, erreur)`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const KNOWN = new Map([["json", 0], ["ouvrir", 0], ["attache", 0], ["coque", 0], ["etat", 0], ["arreter", 0], ["mysql", 1], ["donnees", 1], ["port", 1]]);
for (let i = 0; i < argv.length; i++) {
  const name = argv[i].startsWith("--") ? argv[i].slice(2) : null;
  if (name === null || !KNOWN.has(name)) {
    console.error(`✗ Option inconnue : ${argv[i]}\n\n${HELP}`);
    process.exit(1);
  }
  i += KNOWN.get(name);
  if (KNOWN.get(name) && argv[i] === undefined) {
    console.error(`✗ --${name} attend une valeur.`);
    process.exit(1);
  }
}
const flag = (name) => argv.includes(`--${name}`);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const json = flag("json");

/** Racine de l'installation : le dossier qui porte `scripts/` et `dist/`. */
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.resolve(value("donnees") ?? (process.env.PECULE_DONNEES?.trim() || defaultDataDir({ platform: process.platform, home: os.homedir(), env: process.env })));
const layout = desktopLayout(dataDir, path.sep);
const settingsFile = path.join(layout.settingsDir, SETTINGS_FILE);
const logFile = path.join(layout.logs, "bureau.log");
const version = (() => {
  try {
    return String(JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version ?? "");
  } catch {
    return "";
  }
})();

// ---------- Ce qui est dit, et ce qui est gardé au journal ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Journal du superviseur : jamais un secret, jamais le lien du premier démarrage. */
function note(line) {
  try {
    writeFileSync(logFile, `${new Date().toISOString()} ${line}\n`, { flag: "a", mode: 0o600 });
  } catch {
    // Dossier des journaux pas encore créé, ou disque plein : le superviseur continue.
  }
}
/** Un événement : une ligne JSON pour la coque, une phrase pour une personne. */
function say(event, text) {
  if (json) console.log(JSON.stringify(event));
  else if (text) console.log(text);
}
class Stop extends Error {
  constructor(message, fix) {
    super(message);
    this.fix = fix;
  }
}

// ---------- Processus ----------
const alive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
};
const ps = (pid, field) => (alive(pid) ? (spawnSync("ps", ["-o", `${field}=`, "-p", String(pid)], { encoding: "utf8" }).stdout ?? "").trim() : "");
/** Ligne de commande d'un processus (macOS, Linux) ; vide s'il n'existe plus ou si elle ne se lit pas. */
const commandOf = (pid) => ps(pid, "command");
/** Heure de lancement d'un processus, telle que la dit le système : avec son numéro, elle le désigne sans erreur. */
const startedAt = (pid) => ps(pid, "lstart");
const OWN_START = startedAt(process.pid);
/** Demande à un processus de s'arrêter et attend ; le tue s'il ne l'a pas fait au bout du délai. */
async function terminate(pid, graceMs) {
  if (!alive(pid)) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  const deadline = Date.now() + graceMs;
  while (alive(pid) && Date.now() < deadline) await sleep(100);
  if (alive(pid)) {
    note(`processus ${pid} : pas arrêté après ${Math.round(graceMs / 1000)} s, tué`);
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Parti entre-temps.
    }
    while (alive(pid)) await sleep(100);
  }
}
const portFree = (port) =>
  new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
async function getJson(url, headers) {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    return await r.json();
  } catch {
    return null;
  }
}
/** Seule une réponse de Pécule compte : une autre appli peut écouter sur ce port. */
const healthOf = async (port) => {
  const body = await getJson(`http://127.0.0.1:${port}/api/health`);
  return body && typeof body.phase === "string" ? body.phase : null;
};

// ---------- --etat, --arreter : celle qui tourne ----------
function readLock() {
  try {
    return parseLock(readFileSync(layout.lock, "utf8"));
  } catch {
    return null;
  }
}
/** Le texte du verrou ; `null` s'il n'y en a pas. */
function lockText() {
  try {
    return readFileSync(layout.lock, "utf8");
  } catch {
    return null;
  }
}
/**
 * Le superviseur que décrit le verrou tourne-t-il encore ? Un autre processus peut avoir repris son numéro — le
 * nôtre compris, après une coupure de courant : c'est son heure de lancement qui le distingue.
 */
const running = (lock) => !!lock && lock.pid !== process.pid && alive(lock.pid) && commandOf(lock.pid).includes("bureau.mjs") && (!lock.started || startedAt(lock.pid) === lock.started);
/** Le verrou est-il le nôtre ? */
const ownsLock = () => {
  const lock = readLock();
  return !!lock && lock.pid === process.pid && lock.started === OWN_START;
};
/** Ce qu'un superviseur disparu a laissé tourner : sa base, son serveur. */
function leftovers(raw) {
  const out = [];
  if (Number.isInteger(raw?.server) && hasArgument(commandOf(raw.server), `--bureau=${dataDir}`)) out.push({ what: "serveur", pid: raw.server, grace: 10_000 });
  let pid = Number.isInteger(raw?.mysql) ? raw.mysql : null;
  try {
    pid = Number(readFileSync(path.join(layout.database, "mysqld.pid"), "utf8").trim()) || pid;
  } catch {
    // Pas de base en marche d'après MySQL.
  }
  if (Number.isInteger(pid) && hasArgument(commandOf(pid), `--datadir=${layout.database}`)) out.push({ what: "base", pid, grace: 60_000 });
  return out;
}
const rawLock = () => {
  try {
    return JSON.parse(lockText() ?? "");
  } catch {
    return null;
  }
};

if (flag("etat")) {
  const lock = readLock();
  const on = running(lock);
  const phase = on && lock.port ? await healthOf(lock.port) : null;
  // Un superviseur tué a pu laisser sa base ou son serveur derrière lui.
  const left = on ? [] : leftovers(rawLock()).map((l) => l.what);
  if (json) console.log(JSON.stringify({ ok: true, running: on, ready: phase === "pret", url: on ? lock.url || null : null, pid: on ? lock.pid : null, version: on ? lock.version : null, leftovers: left, dataDir }));
  else console.log(on ? `✓ Pécule tourne${phase === "pret" ? "" : " (il démarre encore)"}${lock.url ? ` : ${lock.url}` : ""}` : left.length ? `Pécule ne tourne plus, mais il a laissé en marche : ${left.join(", ")}. « --arreter » les arrête.` : `Pécule ne tourne pas (dossier des données : ${dataDir}).`);
  process.exit(on ? 0 : 1);
}
if (flag("arreter")) {
  const lock = readLock();
  if (!running(lock)) {
    // Plus de superviseur ; ce qu'il aurait laissé tourner s'arrête quand même.
    const left = leftovers(rawLock());
    for (const l of left) await terminate(l.pid, l.grace);
    if (json) console.log(JSON.stringify({ ok: true, stopped: left.length > 0, leftovers: left.map((l) => l.what) }));
    else console.log(left.length ? `✓ Arrêté : ${left.map((l) => l.what).join(", ")} (restés d'un lancement précédent).` : "Pécule ne tourne pas : rien à arrêter.");
    process.exit(0);
  }
  process.kill(lock.pid, "SIGTERM");
  // Arrêté : son processus n'est plus un superviseur (un processus fini que son parent n'a pas encore relevé garde son numéro).
  const deadline = Date.now() + 90_000;
  while (running(lock) && Date.now() < deadline) await sleep(200);
  const stopped = !running(lock);
  if (json) console.log(JSON.stringify({ ok: stopped, stopped }));
  else console.log(stopped ? "✓ Pécule est arrêté." : "✗ Pécule ne s'est pas arrêté en 90 s.");
  process.exit(stopped ? 0 : 1);
}

// ---------- Démarrage ----------
/** Ce que le superviseur a lancé : rien d'autre ne s'arrête à la fin. */
const children = { mysql: null, server: null };
let stopping = false;
let lockHeld = false;
let port = 0;
let settings = {};
let socket = "";

function writeLock() {
  const text = JSON.stringify({ pid: process.pid, started: OWN_START, port, url: port ? desktopUrl(port) : "", since: new Date().toISOString(), version, mysql: children.mysql?.pid ?? null, server: children.server?.pid ?? null });
  const draft = `${layout.lock}.${process.pid}.partiel`;
  writeFileSync(draft, `${text}\n`, { mode: 0o600 });
  renameSync(draft, layout.lock);
}

/**
 * Dossier fermé aux autres comptes de la machine. `root` : le dossier des données lui-même, qui peut avoir été donné
 * à la main (--donnees) — on ne s'installe que dans un dossier vide, ou déjà le nôtre.
 */
function privateDir(dir, { root = false } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") return;
  const info = lstatSync(dir);
  if (info.isSymbolicLink()) throw new Stop(`${dir} est un lien vers un autre dossier : Pécule veut le dossier lui-même.`, "donner le dossier visé (--donnees)");
  // Un dossier qui ne serait pas le nôtre (dossier temporaire partagé) : on n'y pose rien.
  if (!info.isDirectory() || (typeof process.getuid === "function" && info.uid !== process.getuid())) throw new Stop(`${dir} n'appartient pas à ce compte : Pécule n'y écrit pas.`);
  if (root) {
    const names = readdirSync(dir).filter((name) => name !== ".DS_Store");
    if (names.length && !names.includes("reglages")) throw new Stop(`${dir} porte autre chose que des données de Pécule : rien n'y a été touché.`, "donner un dossier vide, ou qui n'existe pas encore (--donnees)");
  }
  if ((info.mode & 0o077) !== 0) chmodSync(dir, 0o700);
}

/** Un journal qui a grossi laisse la place à un neuf (le précédent est gardé une fois). */
function rotate(file) {
  try {
    if (statSync(file).size > 2_000_000) renameSync(file, `${file}.1`);
  } catch {
    // Pas encore de journal.
  }
}

/** Les dernières lignes d'un journal, pour dire pourquoi un démarrage a échoué. */
function tail(file, lines = 8) {
  try {
    return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

/**
 * Pose notre verrou, puis vérifie un instant plus tard qu'il est toujours le nôtre : de deux lancements au même
 * moment, un seul le garde (l'autre trouve celui du premier, et lui laisse la place).
 */
async function claim() {
  writeLock();
  await sleep(250 + Math.floor(Math.random() * 150));
  return ownsLock();
}

/** Prend le verrou du dossier des données : une seule appli par dossier. `false` : une autre tourne déjà. */
async function takeLock() {
  for (let attempt = 0; attempt < 8; attempt++) {
    let created = false;
    try {
      closeSync(openSync(layout.lock, "wx", 0o600));
      created = true;
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    if (created) {
      if (await claim()) return (lockHeld = true);
      continue;
    }
    const seen = lockText();
    const raw = rawLock();
    const lock = raw ? parseLock(JSON.stringify(raw)) : null;
    if (running(lock)) {
      const phase = lock.port ? await healthOf(lock.port) : null;
      say({ etat: "deja", url: lock.url || null, pret: phase === "pret", pid: lock.pid }, `Pécule tourne déjà${lock.url ? ` : ${lock.url}` : ""}.`);
      return false;
    }
    if (!raw && attempt < 3) {
      // Verrou vide : peut-être un autre lancement, au même instant. Lui laisser le temps d'écrire le sien.
      await sleep(400);
      continue;
    }
    // Un superviseur disparu sans rien arrêter (machine éteinte, processus tué) : ce qu'il avait lancé s'arrête d'abord.
    await stopLeftovers(raw);
    // Le verrou a changé pendant ce temps : un autre lancement l'a repris, c'est lui qu'il faut regarder.
    if (lockText() !== seen) continue;
    if (await claim()) return (lockHeld = true);
  }
  throw new Stop(`Le verrou ${layout.lock} ne se laisse pas prendre.`, "retirer ce fichier si Pécule ne tourne pas");
}

/**
 * Arrête la base et le serveur qu'un superviseur disparu a laissés — reconnus à leur ligne de commande, qui porte ce
 * dossier des données en argument (`leftovers`).
 */
async function stopLeftovers(raw) {
  for (const left of leftovers(raw)) {
    note(`${left.what} resté d'un lancement précédent (${left.pid}) : arrêté`);
    await terminate(left.pid, left.grace);
  }
}

/** Où est MySQL : --mysql, PECULE_MYSQL, ou le dossier « mysql » voisin de l'installation. */
function findMysql() {
  const given = value("mysql") ?? (process.env.PECULE_MYSQL?.trim() || undefined);
  const basedir = path.resolve(given ?? path.join(ROOT, "..", "mysql"));
  const binary = path.join(basedir, "bin", process.platform === "win32" ? "mysqld.exe" : "mysqld");
  if (!existsSync(binary)) throw new Stop(`MySQL est introuvable (${binary}).`, "donner son dossier : --mysql <dossier qui porte bin/mysqld>");
  // Un MySQL qu'un autre compte de la machine pourrait remplacer ne se lance pas avec les données de celui-ci.
  if (process.platform !== "win32") for (const place of [basedir, path.dirname(binary), binary]) if (statSync(place).mode & 0o002) throw new Stop(`${place} peut être modifié par d'autres comptes de cet ordinateur : Pécule ne lance pas ce MySQL.`, "le déplier dans un dossier à soi");
  return { basedir, binary };
}

/** Réglages de l'installation : lus, complétés par tirage la première fois, gardés dans un fichier fermé. */
function settle() {
  const kept = existsSync(settingsFile) ? parseSettings(readFileSync(settingsFile, "utf8")) : {};
  // Aucun secret ne vient de l'environnement : une variable du terminal ne règle pas ceux de l'appli de bureau (seuls
  // les dossiers se donnent ainsi : PECULE_DONNEES, PECULE_MYSQL).
  const settled = settleSecrets({}, kept, (bytes) => randomBytes(bytes).toString("hex"));
  // Une base est là, mais plus son mot de passe : en tirer un autre ne l'ouvrirait pas.
  if (existsSync(layout.database) && settled.drawn.includes("DB_ROOT_PASSWORD"))
    throw new Stop(`Le dossier des données porte une base (${layout.database}), mais plus ses réglages (${settingsFile}) : Pécule ne peut pas l'ouvrir.`, "remettre le fichier des réglages d'une copie du dossier ; à défaut, une sauvegarde complète se restaure dans un dossier de données neuf (--donnees)");
  return { ...kept, ...settled.values };
}
function keepSettings() {
  const text = formatSettings(settings, "Réglages de l'appli de bureau de Pécule (scripts/bureau.mjs). Ne jamais publier ce fichier.");
  const draft = `${settingsFile}.${process.pid}.partiel`;
  writeFileSync(draft, text, { mode: 0o600 });
  chmodSync(draft, 0o600);
  renameSync(draft, settingsFile);
}

/** Le port de Pécule : celui qu'on demande, sinon celui qui est gardé, sinon le premier libre. Toujours libre à la sortie. */
async function choosePort() {
  const asked = value("port");
  if (asked !== undefined && !/^\d{4,5}$/.test(asked)) throw new Stop(`Port illisible : ${asked}`);
  const kept = asked !== undefined ? Number(asked) : keptPort(settings);
  if (kept) {
    if (await portFree(kept)) return kept;
    const other = (await healthOf(kept)) !== null;
    throw new Stop(`Le port ${kept} de cet ordinateur est déjà pris${other ? " par un autre Pécule" : " par un autre programme"}.`, `fermer ce programme, ou choisir un autre port (--port <n>) — ce que cet appareil retient de l'écran (thème, agencement) repartira de zéro`);
  }
  const candidates = portCandidates(firstPort(typeof process.getuid === "function" ? process.getuid() : null));
  for (const candidate of candidates) if (await portFree(candidate)) return candidate;
  throw new Stop(`Aucun port libre entre ${candidates[0]} et ${candidates.at(-1)}.`, "en donner un : --port <n>");
}

/** Crée le dossier de données de MySQL : dans un dossier provisoire, renommé une fois la création achevée. */
function initDatabase(mysql) {
  if (existsSync(layout.database)) return false;
  rmSync(layout.databaseDraft, { recursive: true, force: true });
  say({ etat: "demarrage", etape: "creation" }, "Création de la base (une seule fois)…");
  const log = path.join(layout.logs, "mysql-creation.log");
  rmSync(log, { force: true });
  const r = spawnSync(mysql.binary, mysqlInitArgs({ basedir: mysql.basedir, datadir: layout.databaseDraft, log }), { stdio: "ignore", timeout: 300_000, env: inheritedEnv(process.env) });
  if (r.status !== 0) {
    rmSync(layout.databaseDraft, { recursive: true, force: true });
    throw new Stop(`La base n'a pas pu être créée${r.error ? ` : ${r.error.message}` : ""}.\n${tail(log)}`, `le détail est dans ${log}`);
  }
  renameSync(layout.databaseDraft, layout.database);
  note("base créée");
  return true;
}

/** Lance MySQL et attend qu'il réponde ; puis joue, en administrateur de la base, ce qui règle ses comptes. */
async function startDatabase(mysql) {
  const log = path.join(layout.logs, "mysql.log");
  rotate(log);
  say({ etat: "demarrage", etape: "base" }, "Démarrage de la base…");
  // Dans son propre groupe : un Ctrl-C du terminal n'arrive qu'au superviseur, qui arrête le serveur puis la base, dans cet ordre.
  const child = spawn(mysql.binary, mysqlArgs({ basedir: mysql.basedir, datadir: layout.database, socket, log }), { stdio: "ignore", detached: true, env: inheritedEnv(process.env) });
  children.mysql = child;
  let exited = null;
  child.once("exit", (code, signal) => {
    exited = { code, signal };
    children.mysql = null;
    if (!stopping) void fail(new Stop(`La base s'est arrêtée (${signal ?? `code ${code}`}).\n${tail(log)}`, `le détail est dans ${log}`));
  });
  child.once("error", (e) => {
    exited = { code: null, signal: e.message };
  });
  writeLock();

  const mysql2 = await import("mysql2/promise").catch(() => null);
  if (!mysql2) throw new Stop("Le pilote de la base (mysql2) est introuvable.", "lancer le superviseur depuis l'archive prête à l'emploi, ou depuis le dépôt installé (pnpm install)");
  // Une reprise après une coupure de courant peut durer : on attend tant que MySQL travaille, cinq minutes au plus.
  const deadline = Date.now() + 300_000;
  let last = "";
  while (Date.now() < deadline) {
    if (exited) throw new Stop(`La base ne démarre pas (${exited.signal ?? `code ${exited.code}`}).\n${tail(log)}`, `le détail est dans ${log}`);
    if (stopping) return;
    // L'administrateur de la base : son mot de passe gardé, ou aucun si la création vient de se faire.
    for (const password of [settings.DB_ROOT_PASSWORD, ""]) {
      let connection;
      try {
        connection = await mysql2.createConnection({ socketPath: socket, user: "root", password, connectTimeout: 4000 });
        for (const statement of provisionSql({ DB_PASSWORD: settings.DB_PASSWORD, DEMO_DB_PASSWORD: settings.DEMO_DB_PASSWORD, DB_ROOT_PASSWORD: settings.DB_ROOT_PASSWORD })) await connection.query(statement);
        const [[row]] = await connection.query("SELECT VERSION() AS version");
        note(`base prête (MySQL ${row.version})`);
        return;
      } catch (e) {
        last = e?.code ?? e?.message ?? String(e);
        if (e?.code !== "ER_ACCESS_DENIED_ERROR") break;
      } finally {
        await connection?.end().catch(() => undefined);
      }
    }
    if (last === "ER_ACCESS_DENIED_ERROR") throw new Stop("La base refuse le mot de passe gardé dans les réglages.", `le fichier ${settingsFile} n'est pas celui de cette base`);
    await sleep(250);
  }
  throw new Stop(`La base ne répond pas après cinq minutes (${last}).\n${tail(log)}`, `le détail est dans ${log}`);
}

const serverFalls = [];
/** Numéro du serveur qui a dit lui-même, par son canal, qu'il tient le port : la seule preuve que ce port est le nôtre. */
let listening = 0;
/** Lance le serveur de Pécule, attaché à la machine seule. Tombé seul, il est relancé — quelques fois. */
function startServer() {
  const log = path.join(layout.logs, "serveur.log");
  // « --use-system-ca » : le serveur se fie aussi aux certificats que l'ordinateur reconnaît (ceux qu'un réseau
  // d'entreprise y a posés, par exemple), comme le fait un navigateur — sans cela, derrière un tel réseau, ni la
  // banque ni les cours ne se laisseraient joindre (un Node qui ne connaît pas cette option s'en passe). Le dossier
  // des données, en argument que le serveur ne lit pas, fait reconnaître ce processus comme le nôtre.
  const systemCa = process.allowedNodeEnvironmentFlags.has("--use-system-ca") ? ["--use-system-ca"] : [];
  const child = spawn(process.execPath, [...systemCa, path.join(ROOT, "dist", "server.mjs"), `--bureau=${dataDir}`], {
    cwd: ROOT,
    env: desktopServerEnv({ port, socket, settings, backups: layout.backups, parent: process.env, shell: flag("coque") }),
    // Un canal relie le serveur à son superviseur : il y annonce son écoute, et s'arrête de lui-même si le canal se rompt.
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    detached: true,
  });
  // Ce que dit le serveur est gardé au journal, chaque ligne à son heure : c'est ce qui permet de rapprocher une
  // erreur du moment où elle s'est produite.
  for (const stream of [child.stdout, child.stderr]) {
    let rest = "";
    const keep = (lines) => {
      if (!lines.length) return;
      try {
        appendFileSync(log, lines.map((line) => `${new Date().toISOString()} ${line}\n`).join(""), { mode: 0o600 });
      } catch {
        // Disque plein : le serveur continue.
      }
    };
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = `${rest}${chunk}`.split("\n");
      rest = lines.pop() ?? "";
      keep(lines);
    });
    stream.on("end", () => keep(rest ? [rest] : []));
    stream.on("error", () => undefined);
  }
  children.server = child;
  child.on("message", (message) => {
    if (message?.pecule === "ecoute" && Number(message.port) === port) listening = child.pid;
  });
  child.on("error", () => undefined);
  child.once("exit", (code, signal) => {
    children.server = null;
    listening = 0;
    if (stopping) return;
    note(`serveur arrêté seul (${signal ?? `code ${code}`})`);
    serverFalls.push(Date.now());
    if (!mayRestart(serverFalls.slice(0, -1), Date.now())) return void fail(new Stop(`Pécule s'arrête sans cesse.\n${tail(log)}`, `le détail est dans ${log}`));
    setTimeout(() => {
      if (stopping) return;
      note("serveur relancé");
      startServer();
      writeLock();
    }, 1500);
  });
}

/**
 * Attend que le serveur ait fini de démarrer. Une base bien remplie est sauvegardée avant de recevoir une migration :
 * cela peut durer. Un démarrage en échec est retenté par le serveur une minute plus tard ; on le laisse faire une fois.
 */
async function waitServer() {
  const log = path.join(layout.logs, "serveur.log");
  const deadline = Date.now() + 900_000;
  let failingSince = 0;
  while (Date.now() < deadline) {
    if (stopping) return false;
    // Tant que notre serveur n'a pas dit qu'il écoute, ce qui répond sur ce port n'est pas lui : on ne s'y fie pas.
    const phase = listening && listening === children.server?.pid ? await healthOf(port) : null;
    if (phase === "pret") return true;
    if (phase !== "echec") failingSince = 0;
    else if (!failingSince) failingSince = Date.now();
    else if (Date.now() - failingSince > 100_000) throw new Stop(`Pécule n'arrive pas à démarrer.\n${tail(log)}`, `le détail est dans ${log}`);
    await sleep(300);
  }
  throw new Stop(`Pécule ne répond pas après un quart d'heure.\n${tail(log)}`, `le détail est dans ${log}`);
}

/**
 * Ouvre Pécule dans le navigateur. Le lien du premier démarrage porte le code d'installation : il ne passe pas par
 * la ligne de commande (un autre compte de la machine la lirait), mais par une page du dossier des données, fermé,
 * qui y renvoie et disparaît.
 */
function openInBrowser(url) {
  let target = url;
  if (url.includes("#")) {
    const page = path.join(dataDir, "ouvrir.html");
    writeFileSync(page, `<!doctype html><meta charset="utf-8"><title>Pécule</title><script>location.replace(${JSON.stringify(url)})</script>\n`, { mode: 0o600 });
    setTimeout(() => rmSync(page, { force: true }), 20_000).unref();
    target = page;
  }
  const [command, args] = process.platform === "darwin" ? ["open", [target]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", target]] : ["xdg-open", [target]];
  spawn(command, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
}

// ---------- Arrêt ----------
/** Arrête le serveur puis la base, rend le verrou. Rejouable : un second appel attend le premier. */
let stopped = null;
function shutdown(code = 0) {
  stopped ??= (async () => {
    stopping = true;
    const server = children.server?.pid;
    const mysql = children.mysql?.pid;
    if (server) await terminate(server, 10_000);
    // MySQL écrit ce qu'il a en mémoire avant de rendre la main : on lui laisse une minute.
    if (mysql) await terminate(mysql, 60_000);
    rmSync(path.join(dataDir, "ouvrir.html"), { force: true });
    // Seul notre propre verrou se retire : celui d'un autre lancement reste.
    if (lockHeld && ownsLock())
      try {
        unlinkSync(layout.lock);
      } catch {
        // Déjà retiré.
      }
    note("arrêt");
    say({ etat: "arret" }, "Pécule est arrêté.");
    process.exit(code);
  })();
  return stopped;
}
async function fail(e) {
  if (stopping) return;
  const message = e instanceof Error ? e.message : String(e);
  note(`erreur : ${message.split("\n")[0]}`);
  if (json) console.log(JSON.stringify({ etat: "erreur", message, ...(e?.fix ? { fix: e.fix } : {}), journaux: layout.logs }));
  else console.error(`✗ ${message}${e?.fix ? `\n    → ${e.fix}` : ""}`);
  await shutdown(1);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void shutdown(0));
process.on("uncaughtException", (e) => void fail(e));
process.on("unhandledRejection", (e) => void fail(e));

/**
 * Un lien pour entrer, demandé par la coque (menu « Mot de passe oublié… ») : celui du premier démarrage tant que le
 * foyer n'a personne, sinon le lien d'inscription d'un membre — il y choisit un nouveau mot de passe. Le jeton
 * d'administration des réglages le permet : tenir la machine, c'est en être l'hôte, comme pour `scripts/lien.mjs`.
 * Plusieurs membres et aucun de nommé : leurs prénoms, pour que la coque demande lequel. Le lien n'est jamais journalisé.
 */
async function entryLink(member) {
  if (!port || !children.server) return { erreur: "Pécule n'est pas encore prêt." };
  const url = desktopUrl(port);
  const me = await getJson(`${url}/api/auth/me`);
  if (!me) return { erreur: "Pécule ne répond pas." };
  if (me.setup === true) return { lien: setupLink(url, settings.SETUP_CODE), premier: true };
  const headers = { Authorization: `Bearer ${settings.API_TOKEN}` };
  const names = ((await getJson(`${url}/api/auth/users`, headers))?.users ?? []).map((u) => u.name).filter((n) => typeof n === "string");
  if (!names.length) return { erreur: "Les membres du foyer ne se laissent pas lire." };
  const name = member ?? (names.length === 1 ? names[0] : null);
  if (!name) return { membres: names };
  if (!names.includes(name)) return { erreur: `Aucun membre ne s'appelle « ${name} ».`, membres: names };
  try {
    const r = await fetch(`${url}/api/admin/enrollment/${encodeURIComponent(name)}`, { method: "POST", headers, signal: AbortSignal.timeout(8000) });
    const link = r.ok ? (await r.json()).link : null;
    if (typeof link !== "string") return { erreur: `Le lien n'a pas pu être créé (réponse ${r.status}).` };
    note(`lien d'inscription donné à la coque pour un membre`);
    return { lien: link, membre: name };
  } catch (e) {
    return { erreur: `Le lien n'a pas pu être créé : ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------- Ce que la coque demande en cours de route (une ligne JSON par demande, sur l'entrée) ----------
function listen() {
  if (!flag("attache")) return;
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let ask = null;
    try {
      ask = JSON.parse(line);
    } catch {
      return;
    }
    if (ask?.commande === "arreter") void shutdown(0);
    else if (ask?.commande === "lien") void entryLink(typeof ask.membre === "string" ? ask.membre : null).then((answer) => console.log(JSON.stringify({ etat: "reponse", id: ask.id ?? null, ...answer })));
  });
  // L'entrée se ferme : la coque a disparu, rien ne doit rester derrière elle.
  lines.once("close", () => void shutdown(0));
}

try {
  privateDir(dataDir, { root: true });
  for (const dir of [layout.settingsDir, layout.backups, layout.logs]) privateDir(dir);
  rotate(logFile);
  rotate(path.join(layout.logs, "serveur.log"));
  if (!(await takeLock())) process.exit(0);
  note(`démarrage (Pécule ${version}, Node ${process.versions.node})`);
  listen();
  say({ etat: "demarrage", etape: "reglages" });
  const mysql = findMysql();
  if (!existsSync(path.join(ROOT, "dist", "server.mjs"))) throw new Stop(`Le serveur de Pécule n'est pas construit (${path.join(ROOT, "dist", "server.mjs")}).`, "depuis le dépôt : pnpm build");
  // Une base ou un serveur restés d'un lancement tué, sans verrou pour les nommer.
  await stopLeftovers(null);
  settings = settle();
  port = await choosePort();
  settings.PORT = String(port);
  keepSettings();
  const choice = chooseSocket(dataDir, { tmp: os.tmpdir(), uid: typeof process.getuid === "function" ? process.getuid() : "u", hash: createHash("sha256").update(dataDir).digest("hex"), bytes: (text) => Buffer.byteLength(text) });
  if (choice.privateDir) privateDir(choice.privateDir);
  socket = choice.path;
  writeLock();

  // Dernier contrôle avant de lancer quoi que ce soit : ce dossier de données est toujours à nous.
  if (!ownsLock()) throw new Stop("Un autre lancement de Pécule a pris ce dossier de données.");
  initDatabase(mysql);
  await startDatabase(mysql);
  if (!stopping) {
    say({ etat: "demarrage", etape: "serveur" }, "Démarrage de Pécule…");
    startServer();
    writeLock();
    if (await waitServer()) {
      const url = desktopUrl(port);
      // Installation neuve : le lien du premier démarrage porte le code, il n'y a qu'un prénom à donner.
      const me = await getJson(`${url}/api/auth/me`);
      const first = me?.setup === true && !!settings.SETUP_CODE;
      const open = first ? setupLink(url, settings.SETUP_CODE) : url;
      note(`prêt (${url})`);
      if (json) console.log(JSON.stringify({ etat: "pret", url, ouvrir: open, premier: first, version, donnees: dataDir }));
      else {
        console.log(`✓ Pécule est prêt : ${url}`);
        if (first) console.log(`  Première ouverture — ce lien crée ton foyer (il ne sert qu'une fois) :\n\n  ${open}\n`);
        console.log(`  Données : ${dataDir}\n  Ctrl-C arrête Pécule.`);
      }
      if (flag("ouvrir")) openInBrowser(open);
    }
  }
} catch (e) {
  await fail(e);
}
