#!/usr/bin/env node
// Essai du superviseur de l'appli de bureau (scripts/bureau.mjs), sans fenêtre : cycle de vie complet sur un dossier
// de données jetable — création, second lancement, arrêt propre, reprise, serveur tué, base tuée, superviseur tué,
// coque disparue, port pris, réglages perdus. Demande un MySQL 8.4 déplié et le serveur construit (pnpm build).
//
//   node bureau/essais/cycle.mjs --mysql <dossier de MySQL> [--port 47900] [--garder]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const mysql = value("mysql") ?? process.env.PECULE_MYSQL;
if (!mysql) {
  console.error("✗ --mysql <dossier de MySQL> (ou PECULE_MYSQL)");
  process.exit(1);
}
const port = Number(value("port") ?? 47900);
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const script = path.join(root, "scripts", "bureau.mjs");
const data = mkdtempSync(path.join(os.tmpdir(), "pecule-essai-bureau-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (test, ms, what) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await test()) return;
    await sleep(150);
  }
  throw new Error(`délai dépassé : ${what}`);
};

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? ` — ${detail}` : ""}`);
};

/** Lance le superviseur ; rend ses événements au fil de l'eau. */
function launch(extra = [], { attached = false } = {}) {
  const child = spawn(process.execPath, [script, "--mysql", mysql, "--donnees", data, "--port", String(port), "--json", ...(attached ? ["--attache"] : []), ...extra], { stdio: [attached ? "pipe" : "ignore", "pipe", "pipe"] });
  const events = [];
  let buffer = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      try {
        events.push(JSON.parse(line));
      } catch {
        events.push({ etat: "illisible", line });
      }
    }
  });
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const last = (etat) => events.findLast((e) => e.etat === etat);
  const settle = async (ms = 120_000) => {
    await until(() => last("pret") || last("erreur") || last("deja") || child.exitCode !== null, ms, "le superviseur ne dit rien");
    return last("pret") ?? last("erreur") ?? last("deja") ?? null;
  };
  return { child, events, exit, last, settle, stderr: () => stderr };
}
const run = (...args) => spawnSync(process.execPath, [script, "--donnees", data, ...args], { encoding: "utf8" });
const lock = () => JSON.parse(readFileSync(path.join(data, "bureau.json"), "utf8"));
const health = async () => {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) })).json()).phase;
  } catch {
    return null;
  }
};
const listeners = () => (spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" }).stdout ?? "").split("\n").filter((l) => l.includes("LISTEN"));

try {
  // ---------- 1. Première ouverture ----------
  let t0 = Date.now();
  let a = launch();
  let ready = await a.settle();
  check(ready?.etat === "pret", `première ouverture : prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s`, JSON.stringify(a.events.at(-1)) + a.stderr());
  if (ready?.etat !== "pret") throw new Error("le premier démarrage a échoué : la suite n'a pas de sens");
  check(ready.premier === true && /^http:\/\/127\.0\.0\.1:\d+\/#code=[0-9a-f]{24}$/.test(ready.ouvrir), "lien du premier démarrage donné");
  check(a.events.some((e) => e.etape === "creation"), "la base a été créée");
  const l = listeners();
  check(l.length === 1 && l[0].includes(`127.0.0.1:${port}`), "le serveur n'écoute que sur 127.0.0.1", l.join(" | "));
  const mode = (file) => (statSync(path.join(data, file)).mode & 0o777).toString(8);
  check(mode(".") === "700" && mode("reglages/pecule.env") === "600" && mode("bureau.json") === "600", "dossier des données et réglages fermés aux autres comptes", `${mode(".")} ${mode("reglages/pecule.env")}`);
  const first = lock();
  const mysqldCommand = spawnSync("ps", ["-o", "command=", "-p", String(first.mysql)], { encoding: "utf8" }).stdout;
  check(mysqldCommand.includes("--skip-networking") && mysqldCommand.includes("--no-defaults"), "la base tourne sans port ni réglages du système");
  const settingsText = readFileSync(path.join(data, "reglages/pecule.env"), "utf8");
  const logs = ["bureau.log", "serveur.log", "mysql.log"].map((f) => readFileSync(path.join(data, "journaux", f), "utf8")).join("\n");
  const secrets = [...settingsText.matchAll(/^(?:API_TOKEN|SETUP_CODE|SYNC_TOKEN|SECRET_KEY|DB_PASSWORD|DEMO_DB_PASSWORD|DB_ROOT_PASSWORD)=(.+)$/gm)].map((m) => m[1]);
  check(secrets.length === 7 && secrets.every((s) => !logs.includes(s)), "aucun secret dans les journaux");
  const serverLines = readFileSync(path.join(data, "journaux", "serveur.log"), "utf8").split("\n").filter(Boolean);
  check(serverLines.length > 0 && serverLines.every((line) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /.test(line)), "chaque ligne du journal du serveur porte son heure", serverLines.find((line) => !/^\d{4}-/.test(line)));
  const serverCommand = spawnSync("ps", ["-o", "command=", "-p", String(first.server)], { encoding: "utf8" }).stdout;
  check(serverCommand.includes("--use-system-ca"), "le serveur se fie aussi aux certificats que l'ordinateur reconnaît (réseau d'entreprise)", serverCommand.trim().slice(0, 160));
  const me = await (await fetch(`http://127.0.0.1:${port}/api/auth/me`)).json();
  check(me.setup === true && me.demoAvailable === true && me.setupCommand == null, "installation neuve, démo disponible, aucune commande à montrer", JSON.stringify(me));

  // ---------- 2. --etat, second lancement ----------
  let r = run("--etat", "--json");
  let state = JSON.parse(r.stdout);
  check(r.status === 0 && state.running && state.ready && state.url === `http://127.0.0.1:${port}`, "--etat : en marche, prêt");
  const b = launch();
  const again = await b.settle(20_000);
  const bExit = await b.exit;
  check(again?.etat === "deja" && again.pret === true && bExit.code === 0, "second lancement : « déjà en marche », sans rien toucher", JSON.stringify(again));
  check((await health()) === "pret" && lock().pid === first.pid, "le premier tourne toujours");

  // ---------- 3. Arrêt propre ----------
  t0 = Date.now();
  r = run("--arreter", "--json");
  const aExit = await a.exit;
  check(r.status === 0 && aExit.code === 0 && a.last("arret"), `--arreter : arrêt propre en ${((Date.now() - t0) / 1000).toFixed(1)} s`, r.stdout + r.stderr);
  check(!alive(first.mysql) && !alive(first.server) && !existsSync(path.join(data, "bureau.json")) && !existsSync(path.join(data, "base.sock")), "ni base, ni serveur, ni verrou, ni socket ne restent");
  check(/Shutdown complete|Shutting down mysqld/.test(readFileSync(path.join(data, "journaux/mysql.log"), "utf8")), "MySQL a fermé sa base lui-même");
  r = run("--etat", "--json");
  check(r.status === 1 && JSON.parse(r.stdout).running === false, "--etat : arrêté");

  // ---------- 4. Reprise, serveur tué ----------
  t0 = Date.now();
  a = launch();
  ready = await a.settle();
  check(ready?.etat === "pret" && !a.events.some((e) => e.etape === "creation"), `reprise : prêt en ${((Date.now() - t0) / 1000).toFixed(1)} s, sans recréer la base`);
  check(readFileSync(path.join(data, "reglages/pecule.env"), "utf8") === settingsText, "les réglages n'ont pas changé");
  let now = lock();
  process.kill(now.server, "SIGKILL");
  await until(async () => lock().server && lock().server !== now.server && (await health()) === "pret", 30_000, "serveur relancé");
  check(true, "serveur tué : relancé par le superviseur");

  // ---------- 5. Base tuée ----------
  now = lock();
  process.kill(now.mysql, "SIGKILL");
  let end = await a.exit;
  check(end.code === 1 && a.last("erreur") && !alive(now.server), "base tuée : le superviseur le dit et arrête tout", JSON.stringify(a.events.at(-2)));

  // ---------- 6. Superviseur tué : le serveur s'arrête de lui-même, la base attend qu'on vienne l'arrêter ----------
  a = launch();
  ready = await a.settle();
  check(ready?.etat === "pret", "reprise après une base tuée (MySQL répare sa base)");
  now = lock();
  process.kill(now.pid, "SIGKILL");
  await a.exit;
  await until(() => !alive(now.server), 15_000, "le serveur reste après son superviseur");
  check(alive(now.mysql) && (await health()) === null, "superviseur tué : le serveur s'arrête de lui-même, plus rien ne répond ; la base reste");
  r = run("--etat", "--json");
  state = JSON.parse(r.stdout);
  check(state.running === false && state.leftovers.includes("base"), "--etat le dit : plus de superviseur, une base restée en marche", r.stdout);
  r = run("--arreter", "--json");
  check(JSON.parse(r.stdout).stopped === true && !alive(now.mysql), "--arreter arrête la base restée", r.stdout);

  // Deux lancements au même instant sur un verrou périmé : un seul démarre, l'autre lui laisse la place.
  a = launch();
  ready = await a.settle();
  now = lock();
  process.kill(now.pid, "SIGKILL");
  await a.exit;
  const [one, two] = [launch(), launch()];
  const [first1, first2] = await Promise.all([one.settle(), two.settle()]);
  const outcomes = [first1?.etat, first2?.etat].sort().join("+");
  check(outcomes === "deja+pret", "deux lancements simultanés après un superviseur tué : un seul démarre", outcomes);
  check(!alive(now.mysql) && !alive(now.server), "… et ce que l'ancien avait laissé est arrêté");
  const mysqlds = (spawnSync("ps", ["-axo", "command="], { encoding: "utf8" }).stdout ?? "").split("\n").filter((line) => line.includes(`--datadir=${path.join(data, "base")} `));
  check(mysqlds.length === 1, "une seule base tourne sur ce dossier", String(mysqlds.length));
  a = first1?.etat === "pret" ? one : two;
  await (first1?.etat === "pret" ? two : one).exit;
  check(existsSync(path.join(data, "bureau.json")) && lock().pid === a.child.pid, "le perdant, en partant, ne retire pas le verrou du gagnant");

  // ---------- 7. Coque disparue (entrée fermée) ----------
  run("--arreter");
  await a.exit;
  a = launch([], { attached: true });
  ready = await a.settle();
  now = lock();
  a.child.stdin.end();
  end = await a.exit;
  check(ready?.etat === "pret" && end.code === 0 && !alive(now.mysql) && !alive(now.server), "entrée fermée (la coque a disparu) : tout s'arrête proprement");
  a = launch([], { attached: true });
  ready = await a.settle();
  now = lock();
  a.child.stdin.write('{"commande":"arreter"}\n');
  end = await a.exit;
  check(ready?.etat === "pret" && end.code === 0 && !alive(now.mysql), "commande « arreter » de la coque : arrêt propre");

  // ---------- 8 bis. Port pris pendant le démarrage, par un programme qui se fait passer pour Pécule ----------
  const fake = http.createServer((req, res) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(req.url.startsWith("/api/health") ? { ok: true, phase: "pret" } : { user: null, setup: true })));
  a = launch();
  // Dès que la base démarre, avant que le serveur n'ouvre son port : c'est le moment qu'un autre compte guetterait.
  await until(() => a.events.some((e) => e.etape === "base"), 60_000, "la base ne démarre pas");
  await new Promise((resolve) => fake.listen(port, "127.0.0.1", resolve));
  const lured = await a.settle(90_000);
  end = await a.exit;
  check(lured?.etat === "erreur" && !a.last("pret") && end.code === 1, "un programme qui prend le port et répond comme Pécule n'est pas pris pour lui : pas de « prêt », pas de lien donné", JSON.stringify(lured)?.slice(0, 200));
  check(/déjà pris|ne peut pas écouter/.test(readFileSync(path.join(data, "journaux/serveur.log"), "utf8")), "le serveur dit que son port est pris, et s'arrête");
  fake.closeAllConnections();
  await new Promise((resolve) => fake.close(resolve));

  // ---------- 8. Port pris par un autre programme ----------
  const held = new Set();
  const squatter = createServer((connection) => held.add(connection)).listen(port, "127.0.0.1");
  await new Promise((resolve) => squatter.once("listening", resolve));
  a = launch();
  let said = await a.settle(30_000);
  end = await a.exit;
  check(said?.etat === "erreur" && /déjà pris par un autre programme/.test(said.message) && end.code === 1, "port pris : refus clair, rien n'est lancé", JSON.stringify(said));
  for (const connection of held) connection.destroy();
  await new Promise((resolve) => squatter.close(resolve));

  // ---------- 9. Réglages perdus alors que la base existe ----------
  renameSync(path.join(data, "reglages/pecule.env"), path.join(data, "reglages/pecule.env.ecarte"));
  a = launch();
  said = await a.settle(30_000);
  end = await a.exit;
  check(said?.etat === "erreur" && /plus ses réglages/.test(said.message) && !existsSync(path.join(data, "reglages/pecule.env")), "réglages perdus : refus, aucun secret tiré à la place", JSON.stringify(said));
  renameSync(path.join(data, "reglages/pecule.env.ecarte"), path.join(data, "reglages/pecule.env"));

  // ---------- 10. Ctrl-C ----------
  a = launch();
  ready = await a.settle();
  now = lock();
  a.child.kill("SIGINT");
  end = await a.exit;
  check(ready?.etat === "pret" && end.code === 0 && !alive(now.mysql) && !alive(now.server), "Ctrl-C : arrêt propre");
} catch (e) {
  failures++;
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
} finally {
  spawnSync(process.execPath, [script, "--donnees", data, "--arreter"]);
  if (argv.includes("--garder")) console.log(`Dossier gardé : ${data}`);
  else rmSync(data, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} contrôle(s) en échec` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
