#!/usr/bin/env node
// Diagnostic d'une installation de Pécule : réglages, base, serveur, premier démarrage, version. Sans dépendance (Node seul).
//
//   node scripts/doctor.mjs [--fichier .env] [--url http://localhost:3000] [--json]
//   docker compose exec pecule node scripts/doctor.mjs      avec Docker, sans Node sur la machine
//
// Code de sortie 0 si rien ne bloque, 1 sinon. Aucun secret n'est affiché.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { addressInfo } from "./lib/adresse.mjs";
import { describeDatabase, probeDatabase, supported } from "./lib/base.mjs";
import { dockerState, loadSettings, localPort, ROOT, run } from "./lib/reglages.mjs";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("Diagnostic d'une installation de Pécule.\n\n  node scripts/doctor.mjs [--fichier .env] [--url http://localhost:3000] [--json]\n  docker compose exec pecule node scripts/doctor.mjs      avec Docker, sans Node sur la machine\n\nContrôle Node, les réglages, le serveur, son démarrage, le premier membre et la version en service. Code de sortie 1 si quelque chose bloque.");
  process.exit(0);
}
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const json = argv.includes("--json");
const checks = [];
const check = (id, ok, message, fix) => checks.push({ id, ok, message, ...(ok || !fix ? {} : { fix }) });

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
check("node", major >= 24, `Node ${process.versions.node}`, "Installer Node 24 ou plus récent (ou utiliser Docker).");

// 2. Réglages : le fichier .env de la machine, ou ceux que l'installation garde dans son volume (Docker).
const settings = loadSettings({ file: value("fichier") });
const { env, docker, inside } = settings;

// La version des fichiers installés ici : celle du conteneur, de l'archive ou du dépôt. Avec Docker, lancé depuis la
// machine, ce dossier ne dit rien de l'image ; la version en service se lit plus bas, auprès du serveur.
if (inside || !docker) {
  try {
    const manifest = path.join(ROOT, "package.json");
    const version = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")).version : null;
    if (typeof version === "string") checks.push({ id: "installe", ok: true, version, message: `Pécule ${version} installé ici` });
  } catch {
    /* fichier illisible : la ligne est simplement absente */
  }
}
const count = Object.keys(env).filter((k) => /^[A-Z0-9_]+$/.test(k)).length;

// Le serveur répond-il ? Lu d'abord : un serveur en marche sans fichier de réglages tient les siens de son environnement.
const port = localPort(settings);
const target = (value("url") ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
const logs = docker ? "docker compose logs pecule --tail 100" : "le journal du serveur ou de l'hébergeur";
let health = null;
try {
  const r = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(8000) });
  const body = await r.json();
  // Une autre appli peut écouter sur ce port : seule une réponse de Pécule compte.
  health = body && typeof body.phase === "string" ? body : null;
} catch {
  /* serveur arrêté ou injoignable */
}

// Docker ne répond pas : rien de ce qui suit ne peut être lu dans les conteneurs.
const engine = !inside && (docker || settings.dir) ? dockerState() : "pret";
if (docker && engine !== "pret") check("docker", false, engine === "absent" ? "Docker (avec Compose) est introuvable sur cette machine" : "Docker est installé mais ne répond pas", engine === "absent" ? "Installer Docker : https://docs.docker.com/get-docker/" : "Démarrer Docker, puis relancer cette commande.");
// Un fichier Compose ici, et Docker arrêté : si Pécule est tenu par Docker, rien ne peut le dire tant qu'il ne répond pas.
else if (!docker && settings.dir && engine === "arrete" && !health) check("docker", false, "Docker est installé mais ne répond pas : impossible de dire si Pécule est tenu par Docker ici", "Démarrer Docker, puis relancer cette commande.");
if (inside) check("reglages", settings.kept, settings.kept ? `Réglages gardés par l'installation (${settings.keptFile})` : `Réglages gardés introuvables (${settings.keptFile})`, "Le service « reglages » de compose.yaml n'a pas tourné : docker compose up -d");
else if (settings.file) check("reglages", true, `${settings.file} trouvé (${count} réglages${settings.kept ? ", complétés par ceux que l'installation garde dans son volume" : ""})`);
else if (docker) check("reglages", true, settings.kept ? "Pas de fichier .env : les réglages sont gardés par l'installation, dans le volume « pecule-reglages »" : "Pas de fichier .env : avec Docker il est facultatif, l'installation garde ses réglages dans un volume");
// Pas de fichier, mais un Pécule répond : ses réglages lui viennent de son environnement (les variables d'un
// hébergeur). Surtout ne pas conseiller d'en écrire : un .env posé à côté de lui pourrait remplacer sa clé de chiffrement.
else if (health) check("reglages", true, "Pas de fichier de réglages ici : le serveur répond, ses réglages lui viennent de son environnement (variables de l'hébergeur)");
else if (settings.dir && engine === "arrete") {
  // Signalé plus haut : Docker ne répond pas.
} else if (settings.dir) check("reglages", false, "Rien n'est installé dans ce dossier encore (ni réglages, ni conteneur)", "Avec Docker : docker compose up -d — sur un hébergement Node.js : node scripts/setup.mjs --base \"mysql://…\" --url https://…");
else check("reglages", false, `${settings.asked} introuvable`, "node scripts/setup.mjs --base \"mysql://…\" --url https://…");

// Les secrets ne se contrôlent que s'ils sont lisibles d'ici (fichier .env, ou conteneur en marche).
const known = inside || !!settings.file || settings.kept;
if (known) {
  for (const name of ["API_TOKEN", "SYNC_TOKEN"]) {
    // Avec Docker et un fichier .env sans secrets, ils sont dans le volume : rien à signaler tant que le conteneur ne tourne pas.
    if (docker && !env[name] && !inside && !settings.kept) continue;
    check(name.toLowerCase(), (env[name] ?? "").length >= 32, `${name} ${env[name] ? `(${env[name].length} caractères)` : "absent"}`, `${name} : 32 caractères au moins (node scripts/setup.mjs --force en tire un).`);
  }
  let appUrl = null;
  try {
    appUrl = new URL(env.APP_URL ?? (docker ? `http://localhost:${localPort(settings)}` : ""));
  } catch {
    /* signalé ci-dessous */
  }
  // Ce que l'adresse permet (scripts/lib/adresse.mjs) : la clé d'accès, ou le mot de passe seulement.
  const address = appUrl ? addressInfo(appUrl.href) : null;
  const how = !address
    ? ""
    : address.passkeys
      ? " — connexion par clé d'accès, ou par mot de passe"
      : address.kind === "reseau"
        ? " — réseau de la maison, en http : connexion par mot de passe (pas de clé d'accès), tout y circule en clair"
        : " — une adresse IP : connexion par mot de passe (une clé d'accès ne s'y crée pas ; un nom de domaine en https, ou http://localhost, la permet)";
  check("app_url", !!address && address.kind !== "public", `APP_URL ${env.APP_URL ?? (appUrl ? `${appUrl.origin} (par défaut)` : "absent")}${how}`, "APP_URL : une adresse en https (un nom de domaine : clé d'accès), http://localhost pour un essai sur la machine, ou l'adresse privée de la machine sur le réseau de la maison (http://192.168.1.20:3000 : mot de passe). Jamais en http sur une adresse publique.");
  if (address && checks.length) Object.assign(checks[checks.length - 1], { address: address.kind, signIn: address.passkeys ? "cle" : "mot-de-passe" });
  const ownBase = /^mysql:\/\//.test(env.DATABASE_URL ?? "");
  check("base", docker || ownBase, docker ? (ownBase && !inside ? "Base donnée par DATABASE_URL" : "Base fournie par Docker Compose") : `DATABASE_URL ${env.DATABASE_URL ? "présent" : "absent"}`, "DATABASE_URL=mysql://utilisateur:motdepasse@hote:3306/base (ou Docker : docker compose up -d).");
  // La base elle-même, quand son adresse vaut d'ici (pas celle du réseau des conteneurs, lue depuis la machine) et que
  // le pilote du serveur est à portée : répond-elle, quelle version, vide ou déjà remplie ?
  if (ownBase && (inside || !docker)) {
    const probe = await probeDatabase(env.DATABASE_URL);
    if (probe) {
      const text = describeDatabase(probe);
      const fine = probe.reachable && supported(probe.version);
      checks.push({ id: "base_jointe", ok: fine, message: `${text[0].toUpperCase()}${text.slice(1)}`, ...(probe.reachable ? { version: probe.version, tables: probe.tables } : {}), ...(fine ? {} : { fix: probe.reachable ? "Passer à MariaDB 10.6 ou MySQL 8, ou plus récent." : "Vérifier l'hôte, l'utilisateur, le mot de passe et le nom de la base dans DATABASE_URL, et que la base existe." }) });
    }
  }
}

// 3. Serveur (joint plus haut)
check("serveur", !!health, health ? `Serveur joint sur ${target}` : `Pécule ne répond pas sur ${target}`, docker ? `docker compose up -d, puis ${logs}` : settings.fresh ? "Installer d'abord Pécule (ligne précédente)." : "node dist/server.mjs (dépôt : pnpm build d'abord), ou voir le journal de l'hébergeur");
if (health) {
  check("demarrage", health.ok === true && health.phase === "pret", `Démarrage : ${health.phase}`, health.phase === "echec" ? `La base refuse la connexion ou une migration a échoué : ${logs}` : `Le serveur applique encore ses migrations : réessayer dans un instant, puis ${logs}`);
  try {
    const me = await (await fetch(`${target}/api/auth/me`, { signal: AbortSignal.timeout(8000) })).json();
    checks.push({ id: "premier_demarrage", ok: true, message: me.setup ? `Aucun membre encore : le lien du premier démarrage se demande par « ${run(settings, "node scripts/lien.mjs")} »` : "Le foyer a ses membres", todo: me.setup === true });
    checks.push({ id: "demo", ok: true, message: me.demoAvailable ? "Mode démo disponible" : "Mode démo non configuré (DEMO_DATABASE_URL), facultatif" });
    // Version en service et mise à jour publiée : réservé à l'administrateur, donc lu avec le jeton des réglages.
    if (!me.setup && env.API_TOKEN) {
      // Un Pécule d'avant la 1.22.0 n'a pas cette route : la ligne est alors simplement absente.
      const r = await fetch(`${target}/api/updates`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
      const u = r?.ok ? await r.json().catch(() => null) : null;
      if (u && typeof u.version === "string") {
        const newer = u.state?.kind && u.state.kind !== "a-jour" ? u.state : null;
        // La commande que l'installation annonce elle-même (un Pécule plus ancien ne la donne pas).
        const update = typeof u.command === "string" && u.command ? u.command : "node scripts/maj.mjs";
        const palier = newer?.kind === "palier" ? (typeof u.commandPalier === "string" && u.commandPalier ? u.commandPalier : `node scripts/maj.mjs --version ${newer.palier}`) : null;
        checks.push({
          id: "version",
          ok: true,
          version: u.version,
          message: !newer
            ? `Pécule ${u.version}${u.enabled && u.checkedAt ? ", à jour" : ""}`
            : palier
              ? `Pécule ${u.version} — la version ${newer.version} est publiée ; installer d'abord la ${newer.palier} : ${palier}`
              : `Pécule ${u.version} — la version ${newer.version} est disponible : ${update}`,
          todo: !!newer,
        });
      }
      // Dernière sauvegarde de toute sorte (un Pécule d'avant la 1.24.0 ne la donne pas : la ligne est alors absente).
      const rb = await fetch(`${target}/api/backup/info`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
      const b = rb?.ok ? await rb.json().catch(() => null) : null;
      // Où le serveur garde ses sauvegardes, et si ce dossier survit à une mise à jour (un Pécule plus ancien ne le dit pas).
      if (b && typeof b.dir === "string" && typeof b.dirReason === "string") {
        // Avec Docker, c'est compose.yaml qui règle BACKUP_DIR, sur le volume « pecule-sauvegardes ».
        const why = { reglage: docker ? "volume pecule-sauvegardes" : "réglé par BACKUP_DIR", compte: "dans le compte du serveur, hors de l'installation", installation: "dans l'installation, faute de dossier personnel inscriptible" }[b.dirReason] ?? b.dirReason;
        const fragile = b.dirReason === "installation";
        checks.push({
          id: "dossier_sauvegardes",
          ok: true,
          dir: b.dir,
          reason: b.dirReason,
          message: `Sauvegardes du serveur : ${b.dir} (${why})${fragile ? " — si l'hébergeur installe chaque version dans un dossier neuf, elles n'y survivent pas : donner un dossier fixe par BACKUP_DIR" : ""}`,
          todo: fragile,
        });
      }
      if (b && "latest" in b) {
        const days = b.latest ? Math.floor((Date.now() - b.latest) / 86_400_000) : null;
        const auto = b.auto?.auto ? (b.state?.echec ? "sauvegardes automatiques en échec" : "sauvegardes automatiques actives") : "sauvegardes automatiques éteintes";
        checks.push({
          id: "sauvegarde",
          ok: true,
          days,
          message: days === null ? `Aucune sauvegarde encore (${auto}) : Réglages → Compte et sécurité` : `Dernière sauvegarde : ${days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`} (${auto})`,
          todo: days === null || days >= 30 || (b.auto?.auto && !!b.state?.echec),
        });
      }
    }
  } catch {
    check("api", false, "L'API ne répond pas comme attendu", `Voir ${logs}.`);
  }
}

const ok = checks.every((c) => c.ok);
// mode : comment Pécule est installé ici — « docker », « node », ou « aucun » tant que rien ne l'est.
if (json) console.log(JSON.stringify({ ok, mode: docker ? "docker" : settings.fresh && !health ? "aucun" : "node", checks }, null, 1));
else {
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.message}${c.fix ? `\n    → ${c.fix}` : ""}`);
  console.log(ok ? "\nRien ne bloque." : "\nÀ corriger : les lignes marquées ✗.");
}
process.exit(ok ? 0 : 1);
