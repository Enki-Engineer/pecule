#!/usr/bin/env node
// Donne le lien du premier démarrage d'une installation de Pécule : l'adresse de l'appli avec le code d'installation,
// à ouvrir pour créer le premier membre du foyer. Attend d'abord que le serveur soit prêt. Sans dépendance (Node seul).
//
//   node scripts/lien.mjs [--attente 120] [--fichier .env] [--url http://localhost:3000] [--json]
//   node scripts/lien.mjs --membre Alex                       lien d'inscription d'un membre (mot de passe oublié, appareil perdu)
//   docker compose exec pecule node scripts/lien.mjs          avec Docker, sans Node sur la machine
//
// Code de sortie 0 quand le serveur répond (lien donné, ou foyer déjà créé), 1 sinon. Ce qui est affiché est fait
// pour être remis à la personne qui installe, et ne sert qu'une fois : le lien qui porte le code d'installation, ou
// — quand le premier membre existe sans clé d'accès ni mot de passe — son lien d'inscription. Aucun autre secret ne
// sort d'ici.
import { loadSettings, localPort, run } from "./lib/reglages.mjs";

const HELP = `Donne le lien du premier démarrage de Pécule (l'adresse de l'appli avec le code d'installation).

  node scripts/lien.mjs [--attente 120] [--fichier .env] [--url http://localhost:3000] [--json]
  node scripts/lien.mjs --membre Alex                     lien d'inscription d'un membre déjà créé
  docker compose exec pecule node scripts/lien.mjs        avec Docker, sans Node sur la machine

Attend que le serveur soit prêt (--attente : secondes, 120 par défaut), puis affiche le lien à ouvrir pour créer le
premier membre du foyer. Une fois ce membre créé, le lien ne sert plus : la commande donne seulement l'adresse.
--membre <prénom> : un lien d'inscription pour ce membre, valable sept jours — il y crée une clé d'accès ou y choisit
un nouveau mot de passe. C'est le recours de qui a oublié son mot de passe ou perdu son appareil, administrateur compris.`;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const KNOWN = new Map([["json", 0], ["attente", 1], ["fichier", 1], ["url", 1], ["membre", 1]]);
for (let i = 0; i < argv.length; i++) {
  const name = argv[i].startsWith("--") ? argv[i].slice(2) : null;
  if (name === null || !KNOWN.has(name)) {
    console.error(`✗ Option inconnue : ${argv[i]}\n\n${HELP}`);
    process.exit(1);
  }
  i += KNOWN.get(name);
}
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const json = argv.includes("--json");
const fail = (message, fix) => {
  if (json) console.log(JSON.stringify({ ok: false, error: message, ...(fix ? { fix } : {}) }));
  else console.error(`✗ ${message}${fix ? `\n    → ${fix}` : ""}`);
  process.exit(1);
};

const settings = loadSettings({ file: value("fichier") });
const { env } = settings;
const port = localPort(settings);
const target = (value("url") ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
const appUrl = (env.APP_URL ?? value("url") ?? `http://localhost:${port}`).replace(/\/+$/, "");
const wait = Number(value("attente") ?? 120) * 1000;
if (!Number.isFinite(wait) || wait < 0) fail(`--attente attend un nombre de secondes : ${value("attente")}`);
const logs = settings.docker ? "docker compose logs pecule --tail 100" : "le journal du serveur ou de l'hébergeur";

// ---------- Attente du serveur ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(pathname) {
  try {
    const r = await fetch(`${target}${pathname}`, { signal: AbortSignal.timeout(8000) });
    return await r.json();
  } catch {
    return null;
  }
}
const deadline = Date.now() + wait;
let health = null;
let said = false;
for (;;) {
  const body = await get("/api/health");
  // Une autre appli peut écouter sur ce port : seule une réponse de Pécule compte.
  health = body && typeof body.phase === "string" ? body : null;
  if (health?.phase === "pret" || health?.phase === "echec" || Date.now() >= deadline) break;
  if (!json && !said) {
    console.log(`Pécule démarre (${target})…`);
    said = true;
  }
  await sleep(2000);
}
if (!health) fail(`Pécule ne répond pas sur ${target}.`, settings.docker ? `docker compose ps, puis ${logs}` : "démarrer le serveur (node dist/server.mjs), puis relancer cette commande");
if (health.phase === "echec") fail("Le démarrage de Pécule a échoué (la base refuse la connexion, ou une migration).", logs);
if (health.phase !== "pret") fail(`Pécule démarre encore après ${Math.round(wait / 1000)} s.`, `relancer cette commande ; si cela dure : ${logs}`);

// ---------- Premier démarrage ? ----------
const me = await get("/api/auth/me");
if (!me) fail("L'API de Pécule ne répond pas comme attendu.", logs);

// ---------- Lien d'inscription d'un membre (mot de passe oublié, appareil perdu) ----------
const member = value("membre")?.trim();
if (member) {
  if (me.setup === true) fail("Ce foyer n'a pas encore de membre : le lien du premier démarrage se demande sans --membre.");
  // Le jeton d'administration des réglages : avoir la main sur le serveur, c'est ce qui prouve qu'on en est l'hôte.
  if (!env.API_TOKEN) fail("Le jeton d'administration n'est pas lisible d'ici.", settings.docker ? `docker compose exec pecule node scripts/lien.mjs --membre ${member}` : "lancer la commande dans le dossier de l'installation, celui qui porte son .env");
  const r = await fetch(`${target}/api/admin/enrollment/${encodeURIComponent(member)}`, { method: "POST", headers: { Authorization: `Bearer ${env.API_TOKEN}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (r?.status === 404) fail(`Aucun membre ne s'appelle « ${member} ».`, "le prénom s'écrit comme dans Réglages → Compte et sécurité");
  const link = r?.ok ? (await r.json().catch(() => ({}))).link : null;
  if (typeof link !== "string") fail(`Le lien d'inscription n'a pas pu être créé${r ? ` (réponse ${r.status})` : ""}.`, logs);
  if (json) console.log(JSON.stringify({ ok: true, setup: false, url: appUrl, member, link }));
  else console.log(`✓ Lien d'inscription de ${member} (valable sept jours) : il y crée une clé d'accès, ou y choisit un nouveau mot de passe.\n\n  ${link}\n`);
  process.exit(0);
}
if (me.setup !== true) {
  // Le premier membre a donné son prénom, mais n'a choisi ni clé d'accès ni mot de passe, et sa session s'est perdue :
  // personne ne peut plus entrer. Le jeton d'administration des réglages redonne alors son lien d'inscription.
  const stuck = await enrollmentForKeyless();
  if (stuck) {
    if (json) console.log(JSON.stringify({ ok: true, setup: false, url: appUrl, member: stuck.name, link: stuck.link }));
    else {
      console.log(`✓ Pécule est prêt. Le foyer a son premier membre (${stuck.name}), mais il n'a encore ni clé d'accès ni mot de passe.`);
      console.log(`  Ouvre ce lien pour en créer un (valable sept jours) :\n\n  ${stuck.link}\n`);
    }
    process.exit(0);
  }
  if (json) console.log(JSON.stringify({ ok: true, setup: false, url: appUrl }));
  else console.log(`✓ Pécule est prêt, et le foyer a déjà ses membres : ${appUrl}\n  Un nouveau membre s'ajoute dans Réglages → Compte et sécurité.\n  Mot de passe oublié, appareil perdu : ${run(settings, "node scripts/lien.mjs --membre <prénom>")} donne à ce membre un lien d'inscription.`);
  process.exit(0);
}

/** Lien d'inscription de l'administrateur quand aucun membre n'a encore de clé d'accès ni de mot de passe ; `null` dans tous les autres cas. */
async function enrollmentForKeyless() {
  if (!env.API_TOKEN) return null;
  const headers = { Authorization: `Bearer ${env.API_TOKEN}` };
  try {
    const r = await fetch(`${target}/api/auth/users`, { headers, signal: AbortSignal.timeout(8000) });
    const users = r.ok ? ((await r.json()).users ?? []) : [];
    if (!users.length || users.some((u) => (u.passkeys ?? []).length > 0 || u.hasPassword === true)) return null;
    const first = users.find((u) => u.role === "admin") ?? users[0];
    const e = await fetch(`${target}/api/admin/enrollment/${encodeURIComponent(first.name)}`, { method: "POST", headers, signal: AbortSignal.timeout(8000) });
    const link = e.ok ? (await e.json()).link : null;
    return typeof link === "string" ? { name: first.name, link } : null;
  } catch {
    return null;
  }
}
const code = env.SETUP_CODE;
if (!code) {
  // Installation d'avant, sans SETUP_CODE : le jeton d'administration en tient lieu. Il ne se met pas dans un lien.
  const where = env.API_TOKEN
    ? "la valeur d'API_TOKEN dans les réglages du serveur"
    : settings.docker
      ? "gardé dans le conteneur : docker compose exec pecule node scripts/lien.mjs"
      : "la valeur de SETUP_CODE (à défaut API_TOKEN) dans les réglages du serveur";
  if (json) console.log(JSON.stringify({ ok: true, setup: true, url: appUrl, link: null, code: null, note: `Code d'installation : ${where}.` }));
  else console.log(`✓ Pécule est prêt. Ouvre ${appUrl} : l'écran « Bienvenue dans Pécule » demande ton prénom et le code d'installation.\n  Code d'installation : ${where}.`);
  process.exit(0);
}
const link = `${appUrl}/#code=${encodeURIComponent(code)}`;
if (json) console.log(JSON.stringify({ ok: true, setup: true, url: appUrl, link, code }));
else {
  console.log("✓ Pécule est prêt. Ouvre ce lien pour créer ton foyer (il ne sert qu'une fois) :\n");
  console.log(`  ${link}\n`);
  console.log("L'écran « Bienvenue dans Pécule » demande ton prénom, puis te propose de protéger ton accès : une clé d'accès (Face ID, Touch ID ou le code de l'appareil), ou un mot de passe.");
  console.log("Ouvre bien cette adresse-là, et pas une variante (127.0.0.1, une adresse IP) : une clé d'accès ne vaut qu'à l'adresse de l'installation.");
  console.log(`Code d'installation, si l'écran le demande : ${code}`);
}
