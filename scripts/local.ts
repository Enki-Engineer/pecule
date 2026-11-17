/**
 * Pécule en local, sans toucher à la production : une base MariaDB dans Docker (compose.dev.yaml)
 * et le serveur du build local branché dessus.
 *
 *   pnpm local base            lance la base, crée `pecule` et `pecule_demo`, écrit `.env.dev.local` s'il manque
 *   pnpm local copie [zip]     remplace `pecule` par une sauvegarde complète (la plus récente de data/sauvegardes),
 *                              puis coupe ce qui sort de la machine (appareils abonnés aux notifications, sessions, jetons)
 *   pnpm local vide            remplace `pecule` par une base vide (premier démarrage : les migrations la créent)
 *   pnpm local serveur         démarre `dist/server.mjs` sur cette base (`pnpm build` d'abord)
 *   pnpm local dev             mode développement sur cette base : serveur relancé et écran rechargé à chaque modification
 *   pnpm local arret           arrête la base (les données restent dans le volume Docker)
 *
 * Le serveur local ne synchronise rien (SYNC_INTERVAL_MINUTES=0) : ni banque, ni crypto, ni notification.
 */
import { execFileSync, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const ROOT = "mysql://root:pecule-local@127.0.0.1:3316";
const ENV_FILE = ".env.dev.local";
const PORT = 3210;
const [cmd, arg] = process.argv.slice(2);

const compose = (...args: string[]) => execFileSync("docker", ["compose", "-f", "compose.dev.yaml", ...args], { stdio: "inherit" });
const root = () => mysql.createConnection({ uri: ROOT, multipleStatements: true });

async function base() {
  compose("up", "-d", "--wait");
  const c = await root();
  await c.query("CREATE DATABASE IF NOT EXISTS pecule; CREATE DATABASE IF NOT EXISTS pecule_demo");
  await c.end();
  if (!existsSync(ENV_FILE)) {
    writeFileSync(
      ENV_FILE,
      [
        "# Pécule en local (écrit par `pnpm local base`) — jamais dans le dépôt.",
        "NODE_ENV=production",
        `PORT=${PORT}`,
        `DATABASE_URL=${ROOT}/pecule`,
        `DEMO_DATABASE_URL=${ROOT}/pecule_demo`,
        `APP_URL=http://localhost:${PORT}`,
        `API_TOKEN=${randomBytes(24).toString("hex")}`,
        `SYNC_TOKEN=${randomBytes(24).toString("hex")}`,
        "SYNC_INTERVAL_MINUTES=0",
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
    console.log(`✓ ${ENV_FILE} écrit`);
  }
  console.log(`✓ base locale prête : ${ROOT.replace(/:[^:@]+@/, ":…@")}/pecule`);
}

async function reset() {
  const c = await root();
  await c.query("DROP DATABASE IF EXISTS pecule; CREATE DATABASE pecule");
  await c.end();
}

async function copie() {
  const dir = "data/sauvegardes";
  const file = arg ?? (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".zip")).sort().map((f) => path.join(dir, f)).pop() : undefined);
  if (!file) throw new Error("Aucune sauvegarde : `pnpm sauvegarde` d'abord, ou donne le chemin d'une archive.");
  const { restoreBackup } = await import("../src/server/backup.ts");
  const { fileSource } = await import("../src/server/zip.ts");
  await reset();
  console.log(`Restauration de ${file}…`);
  const src = await fileSource(file);
  const conn = await mysql.createConnection({ uri: `${ROOT}/pecule`, charset: "utf8mb4", timezone: "Z", dateStrings: true, multipleStatements: true });
  try {
    const { manifest, problems } = await restoreBackup(src, conn, () => {});
    if (problems.length) throw new Error(`${problems.length} écart(s) à la restauration : ${problems.slice(0, 5).join(" ; ")}`);
    // Rien de ce qui sert à joindre un appareil ou à entrer dans la vraie appli ne reste dans la copie.
    for (const t of ["push_subscriptions", "sessions", "api_tokens", "enrollment_tokens", "auth_challenges", "oauth_codes", "oauth_requests", "oauth_grants"]) {
      await conn.query(`DELETE FROM \`${t}\``).catch(() => {});
    }
    // La copie n'écrit pas de sauvegarde à la place de la vraie installation.
    await conn.query("DELETE FROM app_kv WHERE `key` IN ('sauvegarde:reglages', 'sauvegarde:etat')").catch(() => {});
    console.log(`✓ copie du ${manifest.creeLe.slice(0, 10)} en place : ${manifest.totaux.lignes.toLocaleString("fr-FR")} lignes, dernière migration ${manifest.derniereMigration}`);
  } finally {
    await conn.end();
    await src.close?.();
  }
}

function serveur() {
  if (!existsSync(ENV_FILE)) throw new Error("`pnpm local base` d'abord.");
  if (!existsSync("dist/server.mjs")) throw new Error("`pnpm build` d'abord.");
  const token = /^API_TOKEN=(.+)$/m.exec(readFileSync(ENV_FILE, "utf8"))?.[1];
  console.log(`Pécule local : http://localhost:${PORT}  (jeton d'administration : ${token?.slice(0, 6)}… dans ${ENV_FILE})`);
  const child = spawn("node", ["dist/server.mjs"], { stdio: "inherit", env: { ...process.env, DOTENV_CONFIG_PATH: ENV_FILE } });
  child.on("exit", (code) => process.exit(code ?? 0));
}

function dev() {
  if (!existsSync(ENV_FILE)) throw new Error("`pnpm local base` d'abord.");
  console.log(`Pécule en développement : http://localhost:${PORT}`);
  // NODE_ENV posé ici l'emporte sur celui du fichier de réglages (dotenv ne remplace pas une variable déjà là).
  const child = spawn("pnpm", ["exec", "tsx", "watch", "server.ts"], { stdio: "inherit", env: { ...process.env, DOTENV_CONFIG_PATH: ENV_FILE, NODE_ENV: "development" } });
  child.on("exit", (code) => process.exit(code ?? 0));
}

switch (cmd) {
  case "base":
    await base();
    break;
  case "copie":
    await copie();
    break;
  case "vide":
    await reset();
    console.log("✓ base `pecule` vide");
    break;
  case "serveur":
    serveur();
    break;
  case "dev":
    dev();
    break;
  case "arret":
    compose("stop");
    break;
  default:
    console.log("Usage : pnpm local base | copie [archive.zip] | vide | serveur | dev | arret");
    process.exitCode = 1;
}
