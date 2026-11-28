#!/usr/bin/env node
// Essai du serveur MCP de l'appli de bureau, tel qu'un assistant installé sur le même ordinateur s'y branche : le
// superviseur (scripts/bureau.mjs) sur un dossier de données jetable, un faux assistant qui suit le parcours d'un vrai
// (401, métadonnées, enregistrement, accord dans le navigateur, échange du code, appels d'outils, renouvellement), et
// le navigateur de la personne (WebKit), qui n'a pas la session de la fenêtre : elle s'y connecte par son mot de passe.
//
//   node bureau/essais/mcp.mjs --mysql <dossier de MySQL> [--port 47930] [--captures <dossier>] [--chromium]
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright-core";

const argv = process.argv.slice(2);
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
if (argv.includes("--help")) {
  console.log("node bureau/essais/mcp.mjs --mysql <dossier de MySQL> [--port 47930] [--captures <dossier>] [--chromium]");
  process.exit(0);
}
const mysql = value("mysql") ?? process.env.PECULE_MYSQL;
if (!mysql) {
  console.error("✗ --mysql <dossier de MySQL> (ou PECULE_MYSQL)");
  process.exit(1);
}
const port = Number(value("port") ?? 47930);
const shots = value("captures");
if (shots) mkdirSync(shots, { recursive: true });
const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const data = mkdtempSync(path.join(os.tmpdir(), "pecule-essai-mcp-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PASSWORD = "une phrase de passe pour l'essai";

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

// ---------- Le faux assistant : un programme de l'ordinateur, qui attend le retour sur une boucle locale ----------
const returns = [];
const assistant = http.createServer((req, res) => {
  returns.push(new URL(req.url, "http://127.0.0.1"));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("<!doctype html><title>Assistant</title><p>Retour reçu par l'assistant.</p>");
});
await new Promise((resolve) => assistant.listen(0, "127.0.0.1", resolve));
const callback = `http://127.0.0.1:${assistant.address().port}/callback`;

/** Un message JSON-RPC au serveur MCP, avec (ou sans) jeton. */
let sent = 0;
async function rpc(url, token, method, params) {
  const response = await fetch(`${url}/api/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++sent, method, ...(params ? { params } : {}) }),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, headers: response.headers, body };
}
const form = (fields) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() });

let browser;
try {
  const ready = await event((e) => e.etat === "pret" || e.etat === "erreur");
  if (ready.etat !== "pret") throw new Error(`le superviseur n'a pas démarré : ${ready.message}`);
  const url = ready.url;
  const engine = argv.includes("--chromium") ? chromium : webkit;
  browser = await engine.launch(argv.includes("--chromium") ? { channel: "chrome" } : {});
  let n = 0;
  const shot = async (page, name) => {
    if (!shots) return;
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(shots, `${String(++n).padStart(2, "0")}-${name}.png`) }).catch(() => undefined);
  };

  // ---------- 1. Le foyer, créé dans la fenêtre de l'appli, et son mot de passe ----------
  const fenetre = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-FR" });
  fenetre.setDefaultTimeout(20_000);
  const first = await fenetre.newPage();
  await first.goto(ready.ouvrir);
  await first.getByPlaceholder("Ton prénom").fill("Alex");
  await first.getByRole("button", { name: "Créer le foyer" }).click();
  await first.waitForURL(/\/inscription/);
  await first.getByPlaceholder("Nouveau mot de passe").fill(PASSWORD);
  await first.getByPlaceholder("Encore une fois").fill(PASSWORD);
  await first.getByRole("button", { name: "Enregistrer mon mot de passe" }).click();
  await first.waitForURL(/\/bienvenue/);
  await first.getByRole("button", { name: "Passer" }).click();
  await first.waitForURL((u) => !u.pathname.startsWith("/bienvenue"));
  // L'appli finit de s'ouvrir sur l'accueil avant qu'on l'emmène ailleurs.
  await first.waitForLoadState("networkidle").catch(() => undefined);
  await first.waitForTimeout(800);
  check(true, "foyer créé dans l'appli, mot de passe choisi");

  // ---------- 2. Ce que l'appli dit à qui veut y brancher un assistant ----------
  await first.goto(`${url}/reglages/connexions?c=applications`);
  await first.getByText(`${url}/api/mcp`).first().waitFor();
  const shown = await first.locator("body").innerText();
  check(shown.includes(`claude mcp add --transport http pecule ${url}/api/mcp`), "Réglages → Comptes et connexions donne l'adresse du serveur MCP de cet ordinateur, et la commande de Claude Code");
  check(/Un assistant installé sur cet ordinateur/.test(shown) && /ne peut pas joindre un Pécule qui ne sort pas de cet ordinateur/.test(shown) && !/Ajouter un connecteur personnalisé/.test(shown), "l'appli de bureau dit qui peut s'y brancher : un assistant de cet ordinateur, pas un assistant en ligne", shown.replace(/\n+/g, " | ").slice(-900, -300));
  await shot(first, "reglages-connexions");

  // ---------- 3. L'assistant découvre comment se connecter ----------
  const bare = await rpc(url, null, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "essai", version: "1" } });
  const hint = bare.headers.get("www-authenticate") ?? "";
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(hint)?.[1];
  check(bare.status === 401 && metadataUrl?.startsWith(url), "sans jeton, le serveur MCP répond 401 et dit où lire ses métadonnées", `${bare.status} ${hint}`);
  const resource = await (await fetch(metadataUrl)).json();
  check(resource.resource === `${url}/api/mcp` && resource.authorization_servers?.[0] === url, "la ressource protégée est le serveur MCP de cet ordinateur, autorisé par lui-même", JSON.stringify(resource));
  const server = await (await fetch(`${url}/.well-known/oauth-authorization-server`)).json();
  check(
    server.issuer === url && [server.authorization_endpoint, server.token_endpoint, server.registration_endpoint].every((e) => typeof e === "string" && e.startsWith(`${url}/`)) && server.code_challenge_methods_supported?.includes("S256"),
    "le serveur d'autorisation annonce ses adresses sur la machine, avec PKCE S256",
    JSON.stringify(server).slice(0, 300),
  );

  // ---------- 4. Enregistrement : une boucle locale est admise, une adresse inconnue du web ne l'est pas ----------
  const register = (redirect_uris) => fetch(server.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Assistant d'essai", redirect_uris }) });
  const elsewhere = await register(["https://assistant.exemple.invalid/retour"]);
  check(elsewhere.status >= 400 && elsewhere.status < 500, "un assistant qui reviendrait vers une adresse inconnue du web est refusé", String(elsewhere.status));
  const registered = await register([callback]);
  const client = await registered.json();
  check(registered.ok && typeof client.client_id === "string", "un programme de l'ordinateur (retour par boucle locale) s'enregistre", `${registered.status} ${JSON.stringify(client).slice(0, 200)}`);

  // ---------- 5. L'accord, dans le navigateur de la personne : il n'a pas la session de la fenêtre ----------
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(12).toString("base64url");
  const authorize = new URL(server.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: client.client_id, redirect_uri: callback, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, resource: `${url}/api/mcp` }))
    authorize.searchParams.set(k, v);
  const navigateur = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "fr-FR" });
  navigateur.setDefaultTimeout(20_000);
  const page = await navigateur.newPage();
  await page.goto(authorize.toString());
  await page.getByPlaceholder("Mot de passe", { exact: true }).waitFor();
  check(true, "le navigateur, sans session, demande d'abord de se connecter");
  await shot(page, "connexion");
  await page.getByPlaceholder("Ton prénom").fill("Alex");
  await page.getByPlaceholder("Mot de passe", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.getByRole("button", { name: "Autoriser" }).waitFor();
  const consent = await page.locator("body").innerText();
  check(/programme de cet ordinateur/.test(consent) && consent.includes("Assistant d'essai") && consent.includes("Alex"), "après la connexion, l'accord revient : il dit que le retour se fait vers un programme de cet ordinateur, et dans la vue de qui", consent.replace(/\n+/g, " | ").slice(0, 400));
  check(!/serveur/i.test(consent.replace(/serveur MCP/gi, "")), "l'écran d'accord ne parle pas de « serveur » à tenir");
  await shot(page, "accord");
  await page.getByRole("button", { name: "Autoriser" }).click();
  await page.getByText("Retour reçu par l'assistant.").waitFor();
  const back = returns.at(-1);
  check(back?.pathname === "/callback" && back.searchParams.get("state") === state && back.searchParams.get("iss") === url && !!back.searchParams.get("code"), "le navigateur revient vers l'assistant avec son code, l'état rendu tel quel", back?.search.replace(/code=[^&]+/, "code=…"));

  // ---------- 6. Le code s'échange une fois, avec le bon vérifieur ----------
  const exchange = (code_verifier) => fetch(server.token_endpoint, form({ grant_type: "authorization_code", code: back.searchParams.get("code"), code_verifier, client_id: client.client_id, redirect_uri: callback, resource: `${url}/api/mcp` }));
  const wrong = await exchange(randomBytes(48).toString("base64url"));
  check(wrong.status === 400, "un autre vérifieur PKCE ne donne pas de jeton", String(wrong.status));
  const granted = await exchange(verifier);
  const tokens = await granted.json();
  check(granted.ok && typeof tokens.access_token === "string" && typeof tokens.refresh_token === "string" && tokens.token_type === "Bearer", "le code s'échange contre un jeton d'accès et un jeton de renouvellement", `${granted.status} ${JSON.stringify(Object.keys(tokens))}`);
  const again = await exchange(verifier);
  check(again.status === 400, "le même code ne s'échange pas deux fois", String(again.status));

  // ---------- 7. L'assistant parle au serveur MCP ----------
  // Rejouer le code a révoqué l'accès qu'il avait ouvert (c'est la règle) : l'assistant refait donc un accord, proprement.
  const revoked = await rpc(url, tokens.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "essai", version: "1" } });
  check(revoked.status === 401, "un code rejoué révoque l'accès qu'il avait ouvert", String(revoked.status));
  const verifier2 = randomBytes(48).toString("base64url");
  authorize.searchParams.set("code_challenge", createHash("sha256").update(verifier2).digest("base64url"));
  await page.goto(authorize.toString());
  await page.getByRole("button", { name: "Autoriser" }).click();
  await page.getByText("Retour reçu par l'assistant.").waitFor();
  const code2 = returns.at(-1).searchParams.get("code");
  const live = await (await fetch(server.token_endpoint, form({ grant_type: "authorization_code", code: code2, code_verifier: verifier2, client_id: client.client_id, redirect_uri: callback, resource: `${url}/api/mcp` }))).json();
  const init = await rpc(url, live.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "essai", version: "1" } });
  check(init.status === 200 && init.body?.result?.serverInfo?.name && init.body.result.capabilities?.tools, "initialize : le serveur MCP se présente et annonce ses outils", JSON.stringify(init.body).slice(0, 300));
  const listed = await rpc(url, live.access_token, "tools/list");
  const tools = listed.body?.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  check(tools.length > 20 && names.includes("get_overview") && names.includes("read_manual"), `tools/list : ${tools.length} outils, dont get_overview et read_manual`, names.slice(0, 12).join(", "));
  check(!names.includes("categorize_transactions"), "en lecture seule (l'accord donné), les outils qui écrivent ne sont pas proposés", names.filter((x) => /^(add|update|delete|set|categorize)_/.test(x)).join(", "));
  const overview = await rpc(url, live.access_token, "tools/call", { name: "get_overview", arguments: {} });
  const overviewText = overview.body?.result?.content?.[0]?.text ?? "";
  check(overview.status === 200 && !overview.body?.result?.isError && overviewText.length > 20, "tools/call get_overview répond, sur la base de cet ordinateur", JSON.stringify(overview.body).slice(0, 300));
  const manual = await rpc(url, live.access_token, "tools/call", { name: "read_manual", arguments: { query: "appli pour Mac" } });
  const manualText = manual.body?.result?.content?.[0]?.text ?? "";
  check(manual.status === 200 && /Mac/.test(manualText), "tools/call read_manual trouve l'article de l'appli pour Mac", manualText.slice(0, 200));
  const refused = await rpc(url, live.access_token, "tools/call", { name: "categorize_transactions", arguments: {} });
  check(!!refused.body?.error || refused.body?.result?.isError === true, "un outil qui écrit, appelé quand même, est refusé", JSON.stringify(refused.body).slice(0, 200));

  // ---------- 8. Renouvellement, puis retrait de l'accès depuis l'appli ----------
  const renewedResponse = await fetch(server.token_endpoint, form({ grant_type: "refresh_token", refresh_token: live.refresh_token, client_id: client.client_id, resource: `${url}/api/mcp` }));
  const renewed = await renewedResponse.json();
  check(renewedResponse.ok && renewed.access_token && renewed.access_token !== live.access_token, "le jeton se renouvelle sans repasser par le navigateur", `${renewedResponse.status} ${JSON.stringify(renewed).slice(0, 160)}`);
  check((await rpc(url, renewed.access_token, "tools/list")).status === 200 && (await rpc(url, live.access_token, "tools/list")).status === 401, "le nouveau jeton sert, l'ancien ne vaut plus");
  await first.goto(`${url}/reglages/connexions?c=applications`);
  await first.getByText("Assistant d'essai").first().waitFor();
  check(true, "l'appli montre l'assistant connecté, dans Réglages → Comptes et connexions");
  await shot(first, "assistant-connecte");
  const grants = await first.evaluate(() => fetch("/api/oauth/grants").then((r) => r.json()));
  const mine = grants.grants ?? [];
  const removed = await first.evaluate((id) => fetch(`/api/oauth/grants/${id}`, { method: "DELETE", headers: { "Content-Type": "application/json" } }).then((r) => r.status), mine[0]?.id);
  const after = await rpc(url, renewed.access_token, "tools/list");
  check(removed < 300 && after.status === 401, "l'accès retiré depuis l'appli, l'assistant est refusé aussitôt", `${removed} ${after.status} ${JSON.stringify(mine).slice(0, 200)}`);

  // ---------- 9. Le jeton d'administration de l'installation (un script, un assistant en ligne de commande) ----------
  const token = /^API_TOKEN=(.+)$/m.exec(readFileSync(path.join(data, "reglages", "pecule.env"), "utf8"))?.[1];
  const byToken = await rpc(url, token, "tools/list");
  check(byToken.status === 200 && (byToken.body?.result?.tools ?? []).some((t) => t.name === "categorize_transactions"), "le jeton d'administration de cet ordinateur ouvre aussi le serveur MCP, actions comprises", String(byToken.status));

  // ---------- 10. Une page d'un autre site ne peut pas appeler le serveur MCP ----------
  const cross = await fetch(`${url}/api/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://ailleurs.exemple.invalid", Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  check(cross.status === 403, "une demande venue de la page d'un autre site est refusée, même avec un jeton", String(cross.status));
} catch (e) {
  failures++;
  console.error(`✗ ${e instanceof Error ? e.message.split("\n")[0] : e}`);
} finally {
  await Promise.race([browser?.close().catch(() => undefined), sleep(8000)]);
  assistant.close();
  sup.stdin.end();
  await Promise.race([supExit, sleep(90_000)]);
  rmSync(data, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} contrôle(s) en échec` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
