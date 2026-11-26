#!/usr/bin/env node
// Essai de la mise à jour de l'appli de bureau, de bout en bout et dans sa vraie fenêtre : une appli d'une version
// ancienne cherche une mise à jour, la télécharge, vérifie sa signature, se remplace et se rouvre — avec ses données
// et sa session. Avant cela : une version qui demande un palier, puis une archive abîmée, que l'appli refuse.
//
// Il faut deux fabrications (bureau/fabriquer.mjs, avec la clé de signature) : la version courante, et une ancienne
// qui cherche ses mises à jour sur cette machine :
//   node bureau/fabriquer.mjs --sortie dist/bureau
//   node bureau/fabriquer.mjs --sans-preparer --sortie dist/bureau-ancienne --config \
//     '{"version":"0.9.0","plugins":{"updater":{"endpoints":["http://127.0.0.1:47990/pecule-mac.json"],"dangerousInsecureTransportProtocol":true}}}'
//
//   node bureau/essais/maj.mjs [--ancienne dist/bureau-ancienne] [--nouvelle dist/bureau] [--port 47990]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recette, sleep, until } from "./lib/coque.mjs";

const argv = process.argv.slice(2);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const older = path.resolve(root, value("ancienne") ?? "dist/bureau-ancienne");
const newer = path.resolve(root, value("nouvelle") ?? "dist/bureau");
const port = Number(value("port") ?? 47990);
for (const f of [path.join(older, "Pecule-mac.zip"), path.join(newer, "Pecule-mac.app.tar.gz"), path.join(newer, "pecule-mac.json")]) {
  if (!existsSync(f)) {
    console.error(`✗ ${f} manque : voir l'en-tête de ce script pour les deux fabrications.`);
    process.exit(1);
  }
}
const manifest = JSON.parse(readFileSync(path.join(newer, "pecule-mac.json"), "utf8"));
const archive = readFileSync(path.join(newer, "Pecule-mac.app.tar.gz"));

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? ` — ${detail}` : ""}`);
};

// ---------- La page des versions, jouée sur cette machine ----------
/** Ce que la « page des versions » sert : la vraie mise à jour, une archive abîmée, ou une version qui demande un palier. */
let served = "vraie";
const releases = http.createServer((req, res) => {
  if (req.url.startsWith("/pecule-mac.json")) {
    const body = { ...manifest, platforms: { "darwin-aarch64": { ...manifest.platforms["darwin-aarch64"], url: `http://127.0.0.1:${port}/Pecule-mac.app.tar.gz` } } };
    // L'ancienne appli de l'essai est une 0.9.0 : « depuis » la laisse passer, sauf pour l'essai du palier.
    body.depuis = served === "palier" ? "0.9.5" : "0.1.0";
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  } else if (req.url.startsWith("/Pecule-mac.app.tar.gz")) {
    const body = Buffer.from(archive);
    // Un octet changé au milieu : l'archive n'est plus celle que la signature couvre.
    if (served === "abimee") body[Math.floor(body.length / 2)] ^= 0xff;
    res.writeHead(200, { "Content-Type": "application/gzip", "Content-Length": body.length }).end(body);
  } else res.writeHead(404).end();
});
await new Promise((resolve) => releases.listen(port, "127.0.0.1", resolve));

// Chemin résolu : le dossier temporaire du Mac passe par un lien, que l\'appli et sa mise à jour n\'aiment pas.
const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pecule-recette-maj-")));
const socket = path.join(work, "recette.sock");
const data = path.join(work, "donnees");
const app = path.join(work, "Pécule.app");
const r = recette(socket);
const versionOnDisk = () => (spawnSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", path.join(app, "Contents", "Info.plist")], { encoding: "utf8" }).stdout ?? "").trim();
const lastUpdate = async () => (await r.journal("maj")).at(-1);

let shell = null;
try {
  spawnSync("ditto", ["-x", "-k", path.join(older, "Pecule-mac.zip"), work]);
  check(versionOnDisk() === "0.9.0", "l'appli de départ est l'ancienne (0.9.0)", versionOnDisk());
  shell = spawn(path.join(app, "Contents", "MacOS", "pecule"), ["--recette", socket, "--donnees", data], { stdio: "ignore" });
  await until(() => existsSync(socket), 20_000, "la coque n'a pas ouvert son socket de recette");
  await until(async () => (await r.state()).origine, 180_000, "Pécule n'est pas prêt");
  check((await r.state()).version === "0.9.0", "elle se dit en 0.9.0");

  // Un foyer et une session, pour voir qu'ils traversent la mise à jour.
  await r.waitText("Bienvenue dans Pécule");
  await r.js("(localStorage.clear(), 1)");
  await r.fill("Ton prénom", "Alex");
  await r.click("Créer le foyer");
  await r.waitPath((p) => p === "/inscription", "le foyer ne se crée pas");
  await r.click("Plus tard");
  await r.waitPath((p) => p.startsWith("/bienvenue"), "la présentation ne s'ouvre pas");

  // ---------- 1. Une version qui demande un palier : rien ne s'installe ----------
  served = "palier";
  await r.ask({ menu: "maj" });
  let said = await until(async () => ((await lastUpdate())?.maj === "palier" ? lastUpdate() : null), 30_000, "le palier n'est pas dit");
  check(said.texte.includes(manifest.version) && said.texte.includes("0.9.5") && versionOnDisk() === "0.9.0", "une version qui demande un palier : l'appli le dit et ne s'installe pas", said.texte);

  // ---------- 2. Une archive abîmée : la signature ne la couvre pas, l'appli la refuse et reprend ----------
  served = "abimee";
  await r.ask({ menu: "maj" });
  said = await until(async () => ((await lastUpdate())?.maj === "echec" ? lastUpdate() : null), 180_000, "l'archive abîmée n'est pas refusée");
  check(versionOnDisk() === "0.9.0", "une archive abîmée est refusée : l'appli en place n'est pas touchée", (await r.journal("maj")).map((j) => j.detail ?? j.maj).join(" | "));
  await until(async () => (await r.state()).origine, 120_000, "Pécule ne reprend pas après une mise à jour refusée");
  const still = await until(() => r.jsAsync(`return (await fetch("/api/auth/me")).json()`), 30_000, "la page ne reprend pas");
  check(still.user?.name === "Alex", "… et Pécule reprend, session comprise");

  // ---------- 3. La vraie mise à jour ----------
  served = "vraie";
  const before = shell.pid;
  const t0 = Date.now();
  await r.ask({ menu: "maj" });
  // L'appli se remplace et se rouvre : son socket revient, avec la nouvelle version.
  await until(async () => (await r.state().catch(() => null))?.version === manifest.version, 300_000, "l'appli ne revient pas dans la nouvelle version");
  check(true, `l'appli s'est mise à jour et rouverte en ${manifest.version} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  check(versionOnDisk() === manifest.version, "l'appli en place est la nouvelle", versionOnDisk());
  check(spawnSync("codesign", ["--verify", "--strict", app]).status === 0, "sa signature est intacte");
  await until(async () => (await r.state()).origine, 180_000, "Pécule ne redémarre pas après la mise à jour");
  const after = await until(() => r.jsAsync(`return (await fetch("/api/auth/me")).json()`), 60_000, "la page ne répond pas après la mise à jour");
  check(after.user?.name === "Alex", "le foyer et la session ont traversé la mise à jour", JSON.stringify(after).slice(0, 120));
  check(!(spawnSync("ps", ["-p", String(before)]).stdout ?? "").includes("pecule"), "l'ancienne appli n'est plus là");

  // ---------- 4. La nouvelle appli cherche à son tour : sur la vraie page des versions, cette fois ----------
  await r.ask({ menu: "maj" });
  said = await until(async () => (["a-jour", "injoignable", "palier"].includes((await lastUpdate())?.maj) ? lastUpdate() : null), 60_000, "la nouvelle appli ne dit rien de sa recherche");
  check(true, `une nouvelle recherche, sur la page des versions de GitHub, répond sans rien casser (« ${said.maj} »)`);
} catch (e) {
  failures++;
  console.error(`✗ ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  // Ce que la coque a noté, pour comprendre.
  const seen = await r.state().catch(() => null);
  if (seen) console.error(`  version ${seen.version}, statut ${JSON.stringify(seen.statut?.titre)}, journal : ${JSON.stringify(seen.journal)}`);
  else console.error("  la coque ne répond plus");
} finally {
  await r.ask({ quitter: true }).catch(() => undefined);
  await sleep(4000);
  spawnSync("pkill", ["-f", `${app}/Contents/MacOS/pecule`]);
  releases.closeAllConnections();
  releases.close();
  if (argv.includes("--garder")) console.log(`Dossier gardé : ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} contrôle(s) en échec` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
