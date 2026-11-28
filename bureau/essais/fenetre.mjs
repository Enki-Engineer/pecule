#!/usr/bin/env node
// La recette de l'appli de bureau, jouée dans sa vraie fenêtre (la WKWebView du Mac) et sans personne devant l'écran.
// La coque est lancée avec « --recette <socket> » : ce script lui envoie ses demandes (JavaScript à exécuter dans la
// page, élément de menu à jouer, état des fenêtres) et contrôle ce qui se passe. Dans ce mode, la coque garde ses
// données web à part, ne dérange pas une appli déjà ouverte, et n'ouvre rien hors d'elle (elle le note).
//
//   node bureau/essais/fenetre.mjs --appli <Pécule.app ou binaire>            l'appli fabriquée, telle qu'elle est livrée
//   node bureau/essais/fenetre.mjs --appli bureau/src-tauri/target/debug/pecule --mysql <dossier de MySQL>
//                                                                             la coque en développement, sur ce dépôt
//
// Options : --captures <dossier> (une image de la fenêtre à chaque étape), --garder (laisse le dossier de données),
// --seulement <nom> (un seul scénario).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const asked = value("appli");
if (!asked) {
  console.error("✗ --appli <Pécule.app ou binaire de la coque>");
  process.exit(1);
}
/** Le binaire de la coque : celui d'un « .app », ou celui qu'on donne. */
const binary = asked.endsWith(".app") ? path.join(asked, "Contents", "MacOS", "pecule") : path.resolve(asked);
if (!existsSync(binary)) {
  console.error(`✗ ${binary} est introuvable.`);
  process.exit(1);
}
const bundled = asked.endsWith(".app");
const mysql = value("mysql") ?? process.env.PECULE_MYSQL;
if (!bundled && !mysql) {
  console.error("✗ hors d'un « .app », la coque a besoin de --mysql <dossier de MySQL>.");
  process.exit(1);
}
// Chemin résolu : le dossier temporaire du Mac passe par un lien, que l\'appli et sa mise à jour n\'aiment pas.
const work = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pecule-recette-")));
const data = path.join(work, "donnees");
const socket = path.join(work, "recette.sock");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = value("captures") ? path.resolve(value("captures")) : null;
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const check = (ok, what, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? ` — ${detail}` : ""}`);
};
async function until(test, ms, what) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try {
      last = await test();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(200);
  }
  throw new Error(`délai dépassé : ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
}

// ---------- La coque ----------
let shell = null;
/** Lance la coque ; `env` : ce qui change pour ce lancement (un MySQL introuvable, par exemple). */
async function launch(env = {}) {
  // Une coque restée d'un scénario qui a échoué laisse la place.
  if (shell && shell.exitCode === null) await quit();
  rmSync(socket, { force: true });
  const dev = bundled ? {} : { PECULE_COQUE_NODE: process.execPath, PECULE_COQUE_MYSQL: path.resolve(mysql), PECULE_COQUE_PECULE: root };
  shell = spawn(binary, ["--recette", socket, "--donnees", data], { env: { ...process.env, ...dev, ...env }, stdio: "ignore" });
  shell.exited = new Promise((resolve) => shell.once("exit", (code) => resolve(code)));
  return until(() => existsSync(socket), 20_000, "la coque n'a pas ouvert son socket de recette");
}
let sent = 0;
/** Une demande à la coque, et sa réponse. */
function ask(request) {
  return new Promise((resolve, reject) => {
    const id = ++sent;
    const connection = net.connect(socket);
    let buffer = "";
    const timer = setTimeout(() => (connection.destroy(), reject(new Error("la coque ne répond pas"))), 25_000);
    connection.on("error", (e) => (clearTimeout(timer), reject(e)));
    connection.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      clearTimeout(timer);
      connection.end();
      resolve(JSON.parse(buffer));
    });
    connection.write(`${JSON.stringify({ id, ...request })}\n`);
  });
}
/** La valeur d'une expression JavaScript, dans une fenêtre de la coque. */
async function js(expression, fenetre = "main") {
  const r = await ask({ js: `JSON.stringify((() => { try { return { v: ${expression} }; } catch (e) { return { e: String(e) }; } })())`, fenetre });
  if (r.erreur) throw new Error(r.erreur);
  const out = typeof r.valeur === "string" ? JSON.parse(r.valeur) : r.valeur;
  if (out?.e) throw new Error(out.e);
  return out?.v;
}
/** La valeur d'une promesse : lancée dans la page, puis relevée. */
async function jsAsync(body, fenetre = "main", ms = 20_000) {
  const key = `r${++sent}`;
  await js(`(window.__recette = window.__recette || {}, (async () => { ${body} })().then((v) => (window.__recette.${key} = { v: v === undefined ? null : v }), (e) => (window.__recette.${key} = { e: String(e) })), 1)`, fenetre);
  const out = await until(() => js(`(window.__recette && window.__recette.${key}) || null`, fenetre), ms, "la page ne rend pas de résultat");
  if (out.e) throw new Error(out.e);
  return out.v;
}
const state = () => ask({ etat: true });
let shot = 0;
/** Une image de la page, rendue par la fenêtre elle-même. */
async function capture(name, fenetre = "main") {
  if (!shots) return;
  await sleep(700);
  const r = await ask({ capture: path.join(shots, `${String(++shot).padStart(2, "0")}-${name}.png`), fenetre });
  if (r.erreur) console.log(`  (capture « ${name} » impossible : ${r.erreur})`);
}
const windowOf = async (label) => (await state()).fenetres.find((f) => f.label === label);
const mainPath = async () => {
  const main = await windowOf("main");
  return main ? new URL(main.url).pathname : null;
};
const text = (fenetre = "main") => js("document.body.innerText", fenetre);
/** Remplit un champ que React tient : par le mutateur du navigateur, puis l'événement que React écoute. */
const fill = (placeholder, content) =>
  js(`(() => { const el = [...document.querySelectorAll("input")].find((i) => i.placeholder === ${JSON.stringify(placeholder)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, ${JSON.stringify(content)}); el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const click = (label, fenetre = "main") =>
  js(`(() => { const el = [...document.querySelectorAll("button, a")].find((b) => b.innerText.trim() === ${JSON.stringify(label)} && !b.disabled); if (!el) return false; el.click(); return true; })()`, fenetre);
const waitText = (needle, fenetre = "main") => until(async () => (await text(fenetre)).includes(needle), 20_000, `« ${needle} » n'apparaît pas`);
const waitPath = (test, what) => until(async () => test((await mainPath()) ?? ""), 20_000, what);
/** La fenêtre principale est sur Pécule, page chargée : avant cela, ce qu'on y lance part avec l'écran de démarrage. */
const waitApp = () =>
  until(async () => (await windowOf("main"))?.url.startsWith(origin) && (await js("document.readyState === 'complete' && location.origin")) === origin, 120_000, "la fenêtre ne revient pas sur Pécule");
const journal = async (kind) => (await state()).journal.filter((j) => kind in j);
const lockOf = () => JSON.parse(readFileSync(path.join(data, "bureau.json"), "utf8"));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function quit() {
  await ask({ quitter: true }).catch(() => undefined);
  await Promise.race([shell.exited, sleep(100_000)]);
}

// ---------- Une fausse banque : elle renvoie vers l'adresse de retour, comme Enable Banking ----------
let bankReturn = "";
/** Les témoins que la fausse banque a reçus : elle est sur la machine, comme Pécule — et ne doit pourtant pas voir les siens. */
const bankCookies = [];
const bank = http.createServer((req, res) => {
  const url = new URL(req.url, "http://banque");
  if (req.headers.cookie) bankCookies.push(req.headers.cookie);
  if (url.pathname === "/accord") {
    // L'écran de la banque : un bouton, puis le retour par une redirection du serveur (302), comme la vraie.
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(`<!doctype html><title>Banque d'essai</title><h1>Banque d'essai</h1><a id="ok" href="/valide?mode=${url.searchParams.get("mode") ?? "302"}">Donner mon accord</a>`);
  } else if (url.pathname === "/valide") {
    if (url.searchParams.get("mode") === "js") res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><script>location.href = ${JSON.stringify(bankReturn)}</script>`);
    else res.writeHead(302, { Location: bankReturn }).end();
  } else res.writeHead(404).end();
});
await new Promise((resolve) => bank.listen(0, "127.0.0.1", resolve));
const bankUrl = `http://127.0.0.1:${bank.address().port}`;

const only = value("seulement");
const scenario = async (name, run) => {
  if (only && only !== name) return;
  console.log(`\n— ${name}`);
  try {
    await run();
  } catch (e) {
    failures++;
    console.error(`✗ ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    // Ce que la coque sait à cet instant, et ce que la fenêtre montre : de quoi comprendre sans y être.
    const seen = await state().catch(() => null);
    if (seen) console.error(`  fenêtres : ${JSON.stringify(seen.fenetres.map((f) => `${f.label} ${f.url.replace(/jeton=[^&]+/, "jeton=…")}`))} · statut : ${JSON.stringify(seen.statut?.titre)} · journal : ${JSON.stringify(seen.journal.slice(-5)).replace(/jeton=[^&"]+/g, "jeton=…")}`);
    else console.error("  la coque ne répond plus");
    const shown = await text().catch(() => "");
    if (shown) console.error(`  écran : ${shown.replace(/\n+/g, " | ").slice(0, 300)}`);
    await capture(`echec-${name.replace(/[^a-z0-9]+/gi, "-")}`).catch(() => undefined);
  }
};

let origin = "";
try {
  // ---------- 1. Première ouverture ----------
  await scenario("ouverture", async () => {
    const t0 = Date.now();
    await launch();
    await until(async () => (await state()).origine, 180_000, "Pécule n'est pas prêt");
    origin = (await state()).origine.replace(/\/$/, "");
    await waitText("Bienvenue dans Pécule");
    check(true, `la fenêtre s'ouvre sur le premier démarrage en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    check(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin), "Pécule est servi sur la machine seule", origin);
    check((await text()).includes("Code d'installation reçu avec le lien"), "le code d'installation est venu avec le lien : seul le prénom est demandé");
    await capture("premier-demarrage");
    const facts = await js("({ sur: window.isSecureContext, ipc: typeof window.__TAURI_INTERNALS__, tauri: typeof window.__TAURI__ })");
    check(facts.tauri === "undefined", "la page de Pécule ne reçoit aucune API de la coque", JSON.stringify(facts));
    // Ce que la fenêtre gardait d'une recette précédente ne compte pas.
    await js("(localStorage.clear(), sessionStorage.length)");
  });

  // ---------- 2. Premier usage, dans la vraie fenêtre ----------
  await scenario("premier usage", async () => {
    check(await fill("Ton prénom", "Alex"), "le prénom se saisit");
    await click("Créer le foyer");
    await waitPath((p) => p === "/inscription", "l'écran « Protège ton accès » ne s'ouvre pas");
    await waitText("Protège ton accès");
    await until(async () => (await js(`!!document.querySelector('input[placeholder="Nouveau mot de passe"]')`)), 20_000, "le formulaire du mot de passe n'apparaît pas");
    const body = await text();
    check(body.includes("Dans l'appli de bureau, ton accès se protège par un mot de passe.") && !/adresse IP|clé d'accès/.test(body), "« Protège ton accès » parle de l'appli de bureau", body.replace(/\n+/g, " | ").slice(0, 240));
    await capture("proteger");
    await click("Plus tard");
    await waitPath((p) => p.startsWith("/bienvenue"), "la présentation de bienvenue ne s'ouvre pas");
    await waitText("Tes données vivent sur cet ordinateur");
    await capture("presentation");
    await click("Passer");
    await waitPath((p) => !p.startsWith("/bienvenue"), "la présentation ne se ferme pas");
    await capture("accueil");
    const me = await jsAsync(`return (await fetch("/api/auth/me")).json()`);
    check(me.user?.name === "Alex" && me.desktop === true, "session ouverte dans la fenêtre", JSON.stringify(me).slice(0, 160));
    const eb = await jsAsync(`const r = await fetch("/api/bank/enable-banking"); return r.ok ? (await r.json()).redirectUrl : r.status`);
    check(eb === `https://localhost:${new URL(origin).port}/reglages/comptes`, "l'adresse de retour de la banque est celle que la coque reconnaît (https://localhost)", String(eb));
  });

  // ---------- 3. Menu ----------
  await scenario("menu", async () => {
    await ask({ menu: "manuel" });
    await waitPath((p) => p.startsWith("/manuel"), "« Manuel de Pécule » n'ouvre pas le manuel");
    // La page du manuel finit de s'ouvrir avant le geste suivant, comme pour une personne.
    await until(async () => (await js("document.readyState === 'complete' && location.pathname")) === "/manuel", 30_000, "le manuel ne s'affiche pas");
    check(true, "Aide → « Manuel de Pécule » ouvre le manuel");
    await ask({ menu: "site" });
    await ask({ menu: "donnees" });
    await ask({ menu: "journaux" });
    const j = (await state()).journal;
    check(j.some((x) => x.dehors?.startsWith("https://pecule.org")), "« Site de Pécule » part vers le navigateur");
    check(j.some((x) => x.dossier === data) && j.some((x) => x.dossier === path.join(data, "journaux")), "« Ouvrir le dossier des données » et « Ouvrir les journaux » visent ce dossier", JSON.stringify(j.filter((x) => x.dossier)));
    await ask({ menu: "oubli" });
    await until(async () => (await mainPath()) === "/inscription", 45_000, "« Mot de passe oublié… » n'ouvre pas le lien d'inscription");
    const main = await windowOf("main");
    check(new URL(main.url).searchParams.has("jeton"), "Aide → « Mot de passe oublié… » ouvre le lien d'inscription du membre");
    await waitText("Nouveau mot de passe").catch(() => undefined);
    check(await fill("Nouveau mot de passe", "une phrase de passe pour la recette"), "le nouveau mot de passe se saisit dans la fenêtre");
    await fill("Encore une fois", "une phrase de passe pour la recette");
    await click("Enregistrer mon mot de passe");
    await waitPath((p) => !p.startsWith("/inscription"), "le mot de passe ne s'enregistre pas");
    const access = await jsAsync(`return (await fetch("/api/auth/access")).json()`);
    check(access.hasPassword === true, "mot de passe enregistré");
  });

  // ---------- 4. Liens : la fenêtre de Pécule ne quitte jamais Pécule ----------
  await scenario("liens", async () => {
    // « Dehors », c'est tout ce qui n'est pas l'adresse de Pécule : ici la fausse banque, jamais un vrai site.
    const out = (name) => `${bankUrl}/dehors-${name}`;
    await js(`(window.open(${JSON.stringify(out("ouvert"))}, "_blank", "noopener"), 1)`);
    await js(`(() => { const a = document.createElement("a"); a.href = ${JSON.stringify(out("lien"))}; a.target = "_blank"; a.rel = "noreferrer"; document.body.append(a); a.click(); a.remove(); return 1; })()`);
    // Dans la même fenêtre, une navigation chasse la précédente : chacune attend que la coque ait tranché.
    const settled = async (kind, test) => until(async () => (await journal(kind)).some((x) => test(x[kind])), 10_000, `la coque ne tranche pas (${kind})`).catch(() => undefined);
    await js(`(window.location.assign(${JSON.stringify(out("meme-fenetre"))}), 1)`);
    await settled("dehors", (u) => u === out("meme-fenetre"));
    await js(`(window.location.assign("mailto:alex@exemple.invalid"), 1)`);
    await settled("dehors", (u) => u.startsWith("mailto:"));
    // Un schéma qui lancerait une autre appli du Mac (prise en main à distance, partage réseau) : refusé.
    await js(`(window.location.assign("vnc://exemple.invalid"), 1)`);
    await settled("refuse", (u) => u.startsWith("vnc:"));
    await js(`(window.location.assign("smb://exemple.invalid/partage"), 1)`);
    await settled("refuse", (u) => u.startsWith("smb:"));
    const gone = await until(async () => {
      const seen = (await journal("dehors")).map((x) => x.dehors);
      return ["ouvert", "lien", "meme-fenetre"].every((n) => seen.includes(out(n))) && seen.includes("mailto:alex@exemple.invalid") ? seen : null;
    }, 10_000, "les liens extérieurs ne sont pas rendus au navigateur").catch(async () => null);
    check(!!gone, "un lien extérieur part vers le navigateur : nouvelle fenêtre, même fenêtre ou autre schéma", JSON.stringify((await journal("dehors")).map((x) => x.dehors)));
    await until(async () => (await journal("refuse")).length >= 2, 10_000, "les schémas d'autres applis ne sont pas refusés").catch(() => undefined);
    const refused = (await journal("refuse")).map((x) => x.refuse);
    check(refused.some((u) => u.startsWith("vnc:")) && refused.some((u) => u.startsWith("smb:")) && !(await journal("dehors")).some((x) => /^(vnc|smb):/.test(x.dehors)), "un lien vers une autre appli du Mac (vnc, smb) est refusé, pas remis au système", JSON.stringify(refused));
    // Les boutons de l'écran de démarrage ne valent rien depuis une page de Pécule.
    await js(`(window.location.assign("pecule-action://reessayer"), 1)`);
    await sleep(500);
    const st = await state();
    check(st.origine === `${origin}/` && alive(lockOf().server), "« Réessayer », appelé depuis une page, ne relance rien");
    check(st.fenetres.find((f) => f.label === "main").url.startsWith(origin) && !st.fenetres.some((f) => f.label === "banque"), "la fenêtre reste sur Pécule, aucune autre ne s'ouvre", JSON.stringify(st.fenetres));
    await js(`(window.open("/api/health", "_blank", "noopener"), 1)`);
    const doc = await until(async () => (await state()).fenetres.find((f) => f.label.startsWith("document-")), 10_000, "un fichier de Pécule ne s'ouvre pas dans une fenêtre de l'appli");
    check(doc.url === `${origin}/api/health`, "un fichier de Pécule s'ouvre dans une fenêtre de l'appli", doc.url);
    await until(async () => (await text(doc.label)).includes('"pret"'), 10_000, "le fichier ne s'affiche pas");
    check(true, "… et s'y affiche");
    await ask({ fermer: true, fenetre: doc.label });
  });

  // ---------- 4 bis. Les confirmations des pages : une vraie question, une vraie réponse ----------
  await scenario("confirmations", async () => {
    const yes = await js(`confirm("Supprimer ce document ?")`);
    await ask({ dialogues: false });
    const no = await js(`confirm("Supprimer ce document ?")`);
    await ask({ dialogues: true });
    const asked = await journal("dialogue");
    check(yes === true && no === false, "confirm() rend la réponse donnée : oui, puis non", `${JSON.stringify(yes)} ${JSON.stringify(no)}`);
    check(asked.length === 2 && asked.every((d) => d.dialogue === "Supprimer ce document ?" && d.titre === "Pécule"), "la question est posée par la coque, au nom de Pécule", JSON.stringify(asked));
    check((await js(`(alert("Bien noté"), typeof confirm)`)) === "function" && (await journal("dialogue")).some((d) => d.dialogue === "Bien noté"), "alert() est montré lui aussi");
  });

  // ---------- 5. Banque : l'accord se donne dans sa fenêtre, le retour https revient au serveur local ----------
  for (const mode of ["302", "js"])
    await scenario(`banque (retour par ${mode === "302" ? "redirection du serveur" : "la page"})`, async () => {
      bankReturn = `https://localhost:${new URL(origin).port}/reglages/comptes?code=essai-${mode}&state=inconnu`;
      const before = (await journal("retour")).length;
      // Ce que le serveur rend à l'écran dans l'appli de bureau : l'adresse de la banque, emballée pour la coque.
      await js(`(window.location.assign(${JSON.stringify(`pecule-banque://ouvrir?vers=${encodeURIComponent(`${bankUrl}/accord?mode=${mode}`)}`)}), 1)`);
      const opened = await until(() => windowOf("banque"), 10_000, "la fenêtre de la banque ne s'ouvre pas");
      check(opened.url.startsWith(bankUrl), "l'accord s'ouvre dans la fenêtre de la banque", opened.url);
      check((await windowOf("main")).url.startsWith(origin), "la fenêtre de Pécule ne quitte pas Pécule");
      await waitText("Banque d'essai", "banque");
      await capture(`banque-${mode}`, "banque");
      await until(async () => (await windowOf("banque"))?.titre.startsWith("127.0.0.1 — "), 10_000, "le titre de la fenêtre ne dit pas chez qui l'on est");
      check(true, "le titre de la fenêtre dit chez qui l'on est");
      // Ce qu'une page de banque piégée tenterait : faire rejouer une adresse de Pécule par la fenêtre qui a la
      // session (ici, la sauvegarde complète), ou lancer une autre appli.
      const downloads = (await journal("telechargement")).length;
      for (const trap of [`${origin}/api/backup`, `https://localhost:${new URL(origin).port}/api/backup`, "vnc://exemple.invalid"]) await js(`(window.location.href = ${JSON.stringify(trap)}, 1)`, "banque");
      await sleep(1200);
      const after = await state();
      check((await journal("retour")).length === before && (await journal("telechargement")).length === downloads && after.fenetres.find((f) => f.label === "main").url.startsWith(origin) && after.fenetres.find((f) => f.label === "banque").url.startsWith(bankUrl), "la fenêtre de la banque ne fait rien rejouer par celle de Pécule, et ne lance aucune appli", JSON.stringify(after.journal.slice(-4)));
      await click("Donner mon accord", "banque");
      await until(async () => (await journal("retour")).length > before, 15_000, "le retour de la banque n'est pas reconnu");
      const back = (await journal("retour")).at(-1).retour;
      check(back === `${origin}/reglages/comptes?code=essai-${mode}&state=inconnu`, "le retour en https://localhost est rendu au serveur local, chemin et code intacts", back);
      await until(async () => !(await windowOf("banque")), 10_000, "la fenêtre de la banque ne se referme pas");
      // Le serveur a reçu le retour : il ne connaît pas cette demande, et ramène aux connexions.
      await waitPath((p) => p === "/reglages/connexions", "le serveur ne reçoit pas le retour");
      check(true, "la fenêtre de la banque se referme, Pécule reprend aux connexions");
      // La fenêtre de la banque n'a jamais eu le témoin de session de Pécule.
      check(!bankCookies.some((c) => c.includes("pecule_session")), "la banque n'a pas reçu le témoin de session de Pécule", bankCookies.join(" | "));
    });

  // ---------- 6. Téléchargement ----------
  await scenario("téléchargement", async () => {
    // La page revient tout juste de la banque : elle finit de se charger avant le geste, comme pour une personne.
    await waitApp();
    await sleep(500);
    await js(`(() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["essai de la recette"], { type: "text/plain" })); a.download = "recette.txt"; document.body.append(a); a.click(); a.remove(); return 1; })()`);
    const done = await until(async () => (await journal("telecharge")).at(-1), 15_000, "le téléchargement n'aboutit pas");
    const file = path.join(work, "recette.txt");
    check(done.ok === true && existsSync(file) && readFileSync(file, "utf8") === "essai de la recette", "un fichier fabriqué par la page se télécharge", JSON.stringify(done));
  });

  // ---------- 7. Taille de l'affichage et icône du Dock ----------
  await scenario("taille de l'affichage et icône du Dock", async () => {
    const widths = () => js("({ dedans: window.innerWidth, dehors: window.outerWidth })");
    await js(`(location.assign(${JSON.stringify(`${origin}/reglages/apparence`)}), 1)`);
    await waitPath((p) => p === "/reglages/apparence", "les réglages de l'apparence ne s'ouvrent pas");
    await waitText("Taille de l'affichage");
    // Au chargement, la fenêtre a posé dans le Dock le logo que la page annonce.
    const first = await until(async () => (await journal("icone")).at(-1), 15_000, "le logo de la page n'arrive pas au Dock");
    check(first.icone === "sable" && first.ok === true, "à l'ouverture, le Dock prend le logo choisi dans Pécule", JSON.stringify(first));
    const before = await widths();
    check(await click("75 %"), "« Taille de l'affichage » propose 75 %");
    await until(async () => (await state()).zoom === 0.75, 10_000, "la fenêtre ne passe pas à 75 %");
    const after = await until(async () => { const w = await widths(); return w.dedans > before.dedans * 1.2 ? w : null; }, 10_000, "la page ne s'élargit pas");
    check(Math.abs(after.dedans / before.dedans - 1 / 0.75) < 0.03, "à 75 %, la page voit une fenêtre plus large d'un tiers", JSON.stringify({ before, after }));
    check(JSON.parse(readFileSync(path.join(data, "fenetre.json"), "utf8")).zoom === 0.75, "la taille choisie est gardée dans le dossier des données");
    const chosen = () => js(`[...document.querySelectorAll("button")].filter((b) => / %$/.test(b.innerText.trim()) && b.getAttribute("aria-pressed") === "true").map((b) => b.innerText.trim()).join()`);
    await until(async () => (await chosen()) === "75 %", 10_000, "le réglage ne montre pas la taille en cours");
    check(true, "le réglage montre la taille en cours");
    await capture("taille-75");
    await ask({ menu: "zoom-plus" });
    await until(async () => (await state()).zoom === 0.8, 10_000, "le menu Présentation n'agrandit plus");
    check(JSON.parse(readFileSync(path.join(data, "fenetre.json"), "utf8")).zoom === 0.8, "une taille prise par le menu est gardée elle aussi");
    await until(async () => (await chosen()) === "80 %", 10_000, "le réglage ne suit pas le menu");
    check(true, "le réglage suit le menu Présentation");
    await js(`(location.assign("pecule-action://zoom?niveau=75"), 1)`);
    await until(async () => (await state()).zoom === 0.75, 10_000, "la page ne peut pas redemander 75 %");
    // Le logo : celui d'une fête, choisi à l'écran.
    check(await js(`(() => { const b = [...document.querySelectorAll("button")].filter((x) => x.innerText.trim() === "Noël").at(-1); if (!b) return false; b.click(); return true; })()`), "« Icône dans le Dock » propose le coffre de Noël");
    const posed = await until(async () => (await journal("icone")).find((x) => x.icone === "noel"), 15_000, "le logo choisi n'arrive pas au Dock");
    check(posed.ok === true && (await state()).icone === "noel", "un logo choisi à l'écran passe dans le Dock", JSON.stringify(posed));
    check((await text()).includes("Icône dans le Dock"), "le réglage parle du Dock");
    await capture("icone-dock");
    // L'image que l'appli donne au Dock : le logo, avec la marge et l'arrondi d'une icône de Mac.
    const drawn = path.join(shots ?? work, "icone-donnee-au-dock.png");
    const given = await ask({ dock: drawn });
    check(given.ok === true && statSync(drawn).size > 20_000, "l'appli donne au Dock une image du logo choisi", JSON.stringify(given));
    // Une adresse qui n'est pas un logo de Pécule ne va nulle part.
    await js(`(location.assign("pecule-action://icone?id=..%2F..%2Fapi%2Fhealth"), 1)`);
    await sleep(500);
    check((await state()).icone === "noel", "une demande d'icône qui n'est pas un logo est ignorée");
  });

  // ---------- 8. Fermer la fenêtre ne quitte pas ; quitter arrête tout ; la session revient ----------
  await scenario("fermeture et retour", async () => {
    await ask({ fermer: true });
    await sleep(600);
    const hidden = await windowOf("main");
    check(hidden && hidden.visible === false && alive(lockOf().mysql), "fermer la fenêtre la cache : Pécule tourne toujours");
    const lock = lockOf();
    const t0 = Date.now();
    await quit();
    check(!alive(lock.pid) && !alive(lock.mysql) && !alive(lock.server) && !existsSync(path.join(data, "bureau.json")), `quitter arrête le serveur et la base (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await launch();
    await until(async () => (await state()).origine, 120_000, "Pécule ne revient pas");
    await waitApp();
    const me = await until(() => jsAsync(`return (await fetch("/api/auth/me")).json()`, "main", 8_000), 60_000, "la page ne répond pas");
    check(me.user?.name === "Alex", "à la réouverture, la session est toujours là : Pécule s'ouvre sans rien demander", JSON.stringify(me).slice(0, 120));
    const back = await state();
    check(back.zoom === 0.75 && (await until(async () => (await journal("icone")).at(-1), 15_000, "le logo ne revient pas")).icone === "noel", "à la réouverture, la taille de l'affichage et le logo du Dock sont ceux qu'on avait choisis", JSON.stringify({ zoom: back.zoom, icone: back.icone }));
    await quit();
  });

  // ---------- 9. Un démarrage qui échoue se dit à l'écran ----------
  await scenario("échec au démarrage", async () => {
    if (bundled) return void console.log("  (sauté : l'appli livrée porte son MySQL)");
    await launch({ PECULE_COQUE_MYSQL: path.join(work, "pas-de-mysql") });
    const failed = await until(async () => ((await state()).statut.erreur ? (await state()).statut : null), 30_000, "l'échec n'est pas dit");
    await waitText("Réessayer");
    await capture("echec");
    const shown = await text();
    check(failed.detail.includes("MySQL est introuvable") && shown.includes("MySQL est introuvable") && shown.includes("Ouvrir les journaux"), "l'écran de démarrage dit ce qui manque, avec « Réessayer » et « Ouvrir les journaux »", shown.replace(/\n+/g, " | ").slice(0, 200));
    await click("Ouvrir les journaux");
    await until(async () => (await journal("dossier")).length > 0, 5_000, "« Ouvrir les journaux » ne fait rien");
    check(true, "« Ouvrir les journaux » ouvre le dossier des journaux");
    await quit();
  });
} catch (e) {
  failures++;
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
} finally {
  if (shell && shell.exitCode === null) await quit();
  if (shell && shell.exitCode === null) shell.kill("SIGKILL");
  bank.close();
  if (argv.includes("--garder")) console.log(`\nDossier gardé : ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} contrôle(s) en échec` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
