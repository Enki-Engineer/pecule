#!/usr/bin/env node
// Essai du premier usage de l'appli de bureau, sans sa fenêtre : le superviseur (scripts/bureau.mjs) sur un dossier de
// données jetable, et l'écran dans WebKit (le moteur de la fenêtre sur Mac). Premier démarrage par le lien, mots de
// l'appli de bureau, mot de passe, déconnexion, retour par mot de passe, « mot de passe oublié » par le superviseur,
// et ce que le serveur refuse (autre nom d'hôte, clé d'accès exigée).
//
//   node bureau/essais/parcours.mjs --mysql <dossier de MySQL> [--port 47920] [--captures <dossier>] [--chromium]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright-core";

const argv = process.argv.slice(2);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const mysql = value("mysql") ?? process.env.PECULE_MYSQL;
if (!mysql) {
  console.error("✗ --mysql <dossier de MySQL> (ou PECULE_MYSQL)");
  process.exit(1);
}
const port = Number(value("port") ?? 47920);
const shots = value("captures");
if (shots) mkdirSync(shots, { recursive: true });
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const data = mkdtempSync(path.join(os.tmpdir(), "pecule-essai-parcours-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PASSWORD = "une phrase de passe pour l'essai";
const OTHER = "une autre phrase, choisie apres l'oubli";

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? ` — ${detail}` : ""}`);
};

// ---------- Le superviseur, comme la coque le lance ----------
const sup = spawn(process.execPath, [path.join(root, "scripts", "bureau.mjs"), "--mysql", mysql, "--donnees", data, "--port", String(port), "--json", "--attache"], { stdio: ["pipe", "pipe", "inherit"] });
const events = [];
let buffer = "";
sup.stdout.on("data", (chunk) => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf("\n")) >= 0) {
    try {
      events.push(JSON.parse(buffer.slice(0, at)));
    } catch {
      // Une ligne qui n'est pas un événement.
    }
    buffer = buffer.slice(at + 1);
  }
});
const supExit = new Promise((resolve) => sup.once("exit", (code) => resolve(code)));
async function event(test, ms = 120_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const found = events.find(test);
    if (found) return found;
    await sleep(100);
  }
  throw new Error("le superviseur n'a pas répondu");
}
let asked = 0;
/** Une demande de la coque au superviseur, et sa réponse. */
async function ask(command) {
  const id = ++asked;
  sup.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
  return event((e) => e.etat === "reponse" && e.id === id, 20_000);
}
/** Une requête écrite à la main : `fetch` ne laisse pas choisir l'en-tête Host. */
const raw = (pathname, headers) =>
  new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, path: pathname, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    request.on("error", reject);
    request.end();
  });

let browser;
try {
  const ready = await event((e) => e.etat === "pret" || e.etat === "erreur");
  if (ready.etat !== "pret") throw new Error(`le superviseur n'a pas démarré : ${ready.message}`);
  const url = ready.url;

  // ---------- Ce que le serveur refuse avant tout écran ----------
  const rebind = await raw("/api/health", { Host: `pecule.exemple.fr:${port}` });
  check(rebind.status === 421, "un autre nom d'hôte que la machine est refusé (page d'un autre site pointée sur 127.0.0.1)", String(rebind.status));
  check((await raw("/api/health", { Host: `127.0.0.1:${port}` })).status === 200 && (await raw("/api/health", { Host: `localhost:${port}` })).status === 200, "127.0.0.1 et localhost sont servis");
  const access = await (await fetch(`${url}/api/auth/access`)).json();
  check(access.desktop === true && access.address === url && access.password === true, "le serveur se dit appli de bureau, à son adresse, mot de passe admis", JSON.stringify(access));

  // ---------- L'écran ----------
  const engine = argv.includes("--chromium") ? chromium : webkit;
  browser = await engine.launch(argv.includes("--chromium") ? { channel: "chrome" } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-FR" });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const errors = [];
  // Une requête coupée par un changement de page (WebKit le dit « due to access control checks ») n'est pas une erreur de l'appli.
  page.on("pageerror", (e) => /due to access control checks/.test(e.message) || errors.push(e.message));
  let n = 0;
  const shot = async (name) => {
    if (!shots) return;
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, "0")}-${name}.png`) }).catch(() => undefined);
  };
  const text = () => page.locator("body").innerText();

  // 1. Premier démarrage : le lien suffit, il n'y a qu'un prénom à donner.
  await page.goto(ready.ouvrir);
  await page.getByPlaceholder("Ton prénom").waitFor();
  check((await text()).includes("Code d'installation reçu avec le lien") && !(await page.getByPlaceholder("Code d'installation").count()), "premier démarrage : le code vient avec le lien, seul le prénom est demandé");
  await shot("bienvenue");
  await page.getByPlaceholder("Ton prénom").fill("Alex");
  await page.getByRole("button", { name: "Créer le foyer" }).click();
  await page.waitForURL(/\/inscription/);
  await page.getByText("Protège ton accès").waitFor();
  await page.getByPlaceholder("Nouveau mot de passe").waitFor();
  let body = await text();
  check(body.includes("Dans l'appli de bureau, ton accès se protège par un mot de passe.") && !/adresse IP|clé d'accès|serveur/.test(body), "« Protège ton accès » parle de l'appli de bureau, ni d'adresse IP ni de serveur", body.replace(/\n+/g, " | ").slice(0, 300));
  check(body.includes("Pécule s'ouvre sur cet ordinateur sans rien demander"), "« Plus tard » dit ce que cela veut dire sur cet ordinateur");
  await shot("proteger");

  // 2. Plus tard : la présentation de bienvenue s'ouvre, avec les mots de l'appli de bureau.
  await page.getByRole("button", { name: "Plus tard" }).click();
  await page.waitForURL(/\/bienvenue/);
  await page.getByText("Bienvenue, Alex.").waitFor();
  body = await text();
  check(body.includes("Tes données vivent sur cet ordinateur") && body.includes("son mot de passe et sa propre vue") && !/serveur|clé d'accès/.test(body), "présentation de bienvenue : « cet ordinateur », « mot de passe »", body.replace(/\n+/g, " | ").slice(0, 300));
  await shot("presentation");
  await page.getByRole("button", { name: "Passer" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/bienvenue"));
  // L'appli finit de s'ouvrir sur l'accueil avant qu'on l'emmène ailleurs.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(600);
  await shot("accueil");

  // 3. Réglages → Compte et sécurité : pas de clé d'accès à ajouter ni à exiger, un mot de passe à choisir.
  await page.goto(`${url}/reglages/compte`);
  await page.getByText("Pas de mot de passe").waitFor();
  body = await text();
  check(body.includes("sans mot de passe, Pécule s'ouvre sur cet ordinateur sans rien demander") && !body.includes("Ajouter cet appareil") && !body.includes("Exiger une clé d'accès"), "réglages : ni « Ajouter cet appareil » ni « Exiger une clé d'accès »", body.replace(/\n+/g, " | ").slice(0, 400));
  await shot("reglages-compte");
  await page.getByRole("button", { name: "Choisir un mot de passe" }).click();
  await page.getByPlaceholder("Nouveau mot de passe").fill(PASSWORD);
  await page.getByPlaceholder("Encore une fois").fill(PASSWORD);
  check(!(await text()).includes("circulent en clair"), "aucune mise en garde sur le http : rien ne circule sur un réseau");
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await page.getByText("Mot de passe choisi").waitFor();
  check(true, "mot de passe choisi dans les réglages");

  // 3 bis. Sans la fenêtre de l'appli (un navigateur ouvert sur le même Pécule), l'écran ne propose pas ce qu'elle seule sait faire.
  await page.goto(`${url}/reglages/apparence`);
  await page.getByText("Densité").waitFor();
  body = await text();
  check(!body.includes("Taille de l'affichage") && !body.includes("Icône dans le Dock"), "hors de la fenêtre de l'appli, ni « Taille de l'affichage » ni « Icône dans le Dock »");

  // 4. Déconnexion, puis retour par prénom et mot de passe.
  await context.clearCookies();
  await page.goto(`${url}/`);
  await page.getByPlaceholder("Mot de passe", { exact: true }).waitFor();
  body = await text();
  check(body.includes("Mot de passe oublié ? Ouvre le menu Aide de l'appli") && !/clé d'accès|Face ID/.test(body), "connexion : le mot de passe d'office, et l'oubli renvoie au menu de l'appli", body.replace(/\n+/g, " | ").slice(0, 300));
  await shot("connexion");
  await page.getByPlaceholder("Ton prénom").fill("Alex");
  await page.getByPlaceholder("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
  check(me.user?.name === "Alex" && me.desktop === true, "retour par prénom et mot de passe");

  // 5. Mot de passe oublié : la coque demande un lien au superviseur, le membre y choisit un nouveau mot de passe.
  await context.clearCookies();
  const forgot = await ask({ commande: "lien" });
  check(typeof forgot.lien === "string" && forgot.lien.startsWith(`${url}/inscription?jeton=`) && forgot.membre === "Alex", "« Mot de passe oublié… » : le superviseur donne le lien d'inscription du seul membre", JSON.stringify({ ...forgot, lien: forgot.lien ? "…" : forgot.lien }));
  await page.goto(forgot.lien);
  await page.getByPlaceholder("Nouveau mot de passe").waitFor();
  check(!(await page.getByPlaceholder("Mot de passe actuel").count()), "le lien ne redemande pas le mot de passe oublié");
  await page.getByPlaceholder("Nouveau mot de passe").fill(OTHER);
  await page.getByPlaceholder("Encore une fois").fill(OTHER);
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/inscription"));
  await context.clearCookies();
  const login = (password) => fetch(`${url}/api/auth/password/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: url }, body: JSON.stringify({ name: "Alex", password }) }).then((r) => r.status);
  check((await login(PASSWORD)) !== 200 && (await login(OTHER)) === 200, "l'ancien mot de passe ne vaut plus, le nouveau ouvre");
  check(!readFileSync(path.join(data, "journaux", "bureau.log"), "utf8").includes("jeton="), "le lien n'est pas écrit au journal du superviseur");

  // 6. Un second membre : le superviseur demande lequel.
  const token = /^API_TOKEN=(.+)$/m.exec(readFileSync(path.join(data, "reglages", "pecule.env"), "utf8"))[1];
  const admin = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const added = await fetch(`${url}/api/auth/users`, { method: "POST", headers: admin, body: JSON.stringify({ name: "Camille" }) });
  check(added.ok, "second membre créé", String(added.status));
  const which = await ask({ commande: "lien" });
  check(Array.isArray(which.membres) && which.membres.includes("Alex") && which.membres.includes("Camille") && !which.lien, "plusieurs membres : le superviseur rend leurs prénoms, sans lien", JSON.stringify(which));
  const hers = await ask({ commande: "lien", membre: "Camille" });
  check(typeof hers.lien === "string" && hers.membre === "Camille", "… puis le lien du membre choisi");
  check(typeof (await ask({ commande: "lien", membre: "Léo" })).erreur === "string", "un prénom inconnu est refusé");

  // 6 bis. L'administrateur fait choisir son mot de passe au nouveau membre, dans la fenêtre même (pas de lien à porter ailleurs).
  await page.goto(`${url}/connexion`);
  await page.getByPlaceholder("Ton prénom").fill("Alex");
  await page.getByPlaceholder("Mot de passe", { exact: true }).fill(OTHER);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.goto(`${url}/reglages/compte`);
  await page.getByText("Pas encore de mot de passe").waitFor();
  check(!(await text()).includes("Lien d'inscription") && !(await text()).includes("iPhone"), "réglages : pas de lien à envoyer sur un autre appareil, un bouton « Choisir son mot de passe »");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Choisir son mot de passe" }).click();
  await page.waitForURL(/\/inscription\?jeton=/);
  await page.getByPlaceholder("Nouveau mot de passe").fill(PASSWORD);
  await page.getByPlaceholder("Encore une fois").fill(PASSWORD);
  await page.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/inscription"));
  const her = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
  check(her.user?.name === "Camille", "le nouveau membre choisit son mot de passe ici, et entre dans sa session", JSON.stringify(her.user));

  // 7. La règle « clé d'accès exigée » ne vaut pas dans l'appli de bureau, même reprise d'une sauvegarde de serveur.
  const policy = await fetch(`${url}/api/auth/policy`, { method: "PUT", headers: admin, body: JSON.stringify({ passkeysOnly: true }) });
  const after = await (await fetch(`${url}/api/auth/access`)).json();
  check(after.password === true, "le mot de passe reste admis quoi que dise la règle du foyer", `${policy.status} ${JSON.stringify(after)}`);

  check(errors.length === 0, "aucune erreur dans la page", errors.join(" | ").slice(0, 300));
} catch (e) {
  failures++;
  console.error(`✗ ${e instanceof Error ? e.message.split("\n")[0] : e}`);
} finally {
  await Promise.race([browser?.close().catch(() => undefined), sleep(8000)]);
  sup.stdin.end();
  await Promise.race([supExit, sleep(90_000)]);
  rmSync(data, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} contrôle(s) en échec` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
