#!/usr/bin/env node
// Diagnostic d'une installation de Pécule : réglages, base, serveur, premier démarrage, version. Sans dépendance (Node seul).
//
//   node scripts/doctor.mjs [--fichier .env] [--url http://localhost:3000] [--json]
//
// Code de sortie 0 si rien ne bloque, 1 sinon. Aucun secret n'est affiché.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log("Diagnostic d'une installation de Pécule.\n\n  node scripts/doctor.mjs [--fichier .env] [--url http://localhost:3000] [--json]\n\nContrôle Node, les réglages, le serveur, son démarrage, le premier membre et la version en service. Code de sortie 1 si quelque chose bloque.");
  process.exit(0);
}
const value = (name) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const json = argv.includes("--json");
// Sans --fichier : le .env du dossier courant, sinon celui de la racine du dépôt (le script peut être lancé d'ailleurs).
const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = value("fichier") ?? (existsSync(".env") ? ".env" : path.join(here, ".env"));
const checks = [];
const check = (id, ok, message, fix) => checks.push({ id, ok, message, ...(ok || !fix ? {} : { fix }) });

// 1. Node
const major = Number(process.versions.node.split(".")[0]);
check("node", major >= 24, `Node ${process.versions.node}`, "Installer Node 24 ou plus récent (ou utiliser Docker).");

// 2. Réglages
const env = {};
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  check("reglages", true, `${file} trouvé (${Object.keys(env).length} réglages)`);
} else check("reglages", false, `${file} introuvable`, "node scripts/setup.mjs --docker   (ou --base \"mysql://…\")");

const docker = !!env.DB_PASSWORD && !env.DATABASE_URL;
if (existsSync(file)) {
  for (const name of ["API_TOKEN", "SYNC_TOKEN"]) check(name.toLowerCase(), (env[name] ?? "").length >= 32, `${name} ${env[name] ? `(${env[name].length} caractères)` : "absent"}`, `${name} : 32 caractères au moins (node scripts/setup.mjs --force en tire un).`);
  let appUrl = null;
  try {
    appUrl = new URL(env.APP_URL ?? "");
  } catch {
    /* signalé ci-dessous */
  }
  const local = !!appUrl && ["localhost", "127.0.0.1"].includes(appUrl.hostname);
  check("app_url", !!appUrl && (appUrl.protocol === "https:" || local), `APP_URL ${env.APP_URL ?? "absent"}`, "APP_URL : une adresse en https, ou http://localhost pour un essai local (les clés d'accès l'exigent).");
  check("base", docker || /^mysql:\/\//.test(env.DATABASE_URL ?? ""), docker ? "Base fournie par Docker Compose" : `DATABASE_URL ${env.DATABASE_URL ? "présent" : "absent"}`, "DATABASE_URL=mysql://utilisateur:motdepasse@hote:3306/base (ou setup --docker).");
}

// 3. Serveur
const port = env.PECULE_PORT ?? env.PORT ?? "3000";
const target = (value("url") ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
let health = null;
try {
  const r = await fetch(`${target}/api/health`, { signal: AbortSignal.timeout(8000) });
  const body = await r.json();
  // Une autre appli peut écouter sur ce port : seule une réponse de Pécule compte.
  health = body && typeof body.phase === "string" ? body : null;
} catch {
  /* serveur arrêté ou injoignable */
}
check("serveur", !!health, health ? `Serveur joint sur ${target}` : `Pécule ne répond pas sur ${target}`, docker ? "docker compose up -d, puis docker compose logs pecule" : "pnpm build && node dist/server.mjs (ou voir le journal de l'hébergeur)");
if (health) {
  check("demarrage", health.ok === true && health.phase === "pret", `Démarrage : ${health.phase}`, "Le serveur applique encore ses migrations, ou la base refuse la connexion : voir son journal.");
  try {
    const me = await (await fetch(`${target}/api/auth/me`, { signal: AbortSignal.timeout(8000) })).json();
    checks.push({ id: "premier_demarrage", ok: true, message: me.setup ? "Aucun membre encore : ouvrir l'appli pour créer le premier (code d'installation = SETUP_CODE du fichier de réglages, sinon API_TOKEN)" : "Le foyer a ses membres", todo: me.setup === true });
    checks.push({ id: "demo", ok: true, message: me.demoAvailable ? "Mode démo disponible" : "Mode démo non configuré (DEMO_DATABASE_URL), facultatif" });
    // Version en service et mise à jour publiée : réservé à l'administrateur, donc lu avec le jeton du fichier de réglages.
    if (!me.setup && env.API_TOKEN) {
      // Un Pécule d'avant la 1.22.0 n'a pas cette route : la ligne est alors simplement absente.
      const r = await fetch(`${target}/api/updates`, { headers: { Authorization: `Bearer ${env.API_TOKEN}` }, signal: AbortSignal.timeout(8000) }).catch(() => null);
      const u = r?.ok ? await r.json().catch(() => null) : null;
      if (u && typeof u.version === "string") {
        const newer = u.state?.kind && u.state.kind !== "a-jour" ? u.state : null;
        checks.push({
          id: "version",
          ok: true,
          version: u.version,
          message: !newer
            ? `Pécule ${u.version}${u.enabled && u.checkedAt ? ", à jour" : ""}`
            : newer.kind === "palier"
              ? `Pécule ${u.version} — la version ${newer.version} est publiée ; installer d'abord la ${newer.palier} : node scripts/maj.mjs --version ${newer.palier}`
              : `Pécule ${u.version} — la version ${newer.version} est disponible : node scripts/maj.mjs`,
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
          message: days === null ? `Aucune sauvegarde encore (${auto}) : pnpm sauvegarde, ou Réglages → Compte et sécurité` : `Dernière sauvegarde : ${days === 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`} (${auto})`,
          todo: days === null || days >= 30 || (b.auto?.auto && !!b.state?.echec),
        });
      }
    }
  } catch {
    check("api", false, "L'API ne répond pas comme attendu", "Voir le journal du serveur.");
  }
}

const ok = checks.every((c) => c.ok);
if (json) console.log(JSON.stringify({ ok, checks }, null, 1));
else {
  for (const c of checks) console.log(`${c.ok ? "✓" : "✗"} ${c.message}${c.fix ? `\n    → ${c.fix}` : ""}`);
  console.log(ok ? "\nRien ne bloque." : "\nÀ corriger : les lignes marquées ✗.");
}
process.exit(ok ? 0 : 1);
