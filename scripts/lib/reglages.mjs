// Réglages d'une installation de Pécule, tels que les scripts les lisent (doctor, lien, maj) : où qu'ils soient
// gardés, et sans jamais en afficher la valeur. Sans dépendance (Node seul, toute version).
//
//   - dans le conteneur (SETTINGS_DIR est donné) : l'environnement, complété par les réglages gardés dans le volume ;
//   - sur la machine : le fichier .env du dossier courant, sinon celui de la racine de l'installation ;
//   - sur la machine, avec Docker et sans secrets dans .env : ceux que l'installation garde dans son volume, lus dans
//     le conteneur.
//
// Même règle que le serveur (src/lib/settings-file.ts) : ce que donne l'environnement l'emporte sur ce qui est gardé.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Racine de l'installation : le dossier qui porte `scripts/`. */
export const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
/** Où l'image garde les réglages de l'installation (volume « pecule-reglages »). */
const KEPT_IN_CONTAINER = "/app/data/reglages/pecule.env";
const COMPOSE_FILES = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"];

/**
 * Lit « CLÉ=valeur » par ligne, comme le serveur (`src/lib/settings-file.ts`, un test compare) : `#` commence un
 * commentaire — en début de ligne, ou après une valeur sans guillemets —, les guillemets autour d'une valeur sont retirés.
 */
export function parseSettings(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const quoted = /^(["'])(.*)\1$/.exec(m[2]);
    out[m[1]] = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, "");
  }
  return out;
}

/** Complète `env` par `kept` : une valeur absente ou vide reçoit la valeur gardée, jamais l'inverse. */
function complete(env, kept) {
  for (const [k, v] of Object.entries(kept)) if (!env[k] && v) env[k] = v;
  return env;
}

/** Le dossier (courant, sinon la racine) qui porte un fichier Compose ; `null` s'il n'y en a pas. */
export function composeDir() {
  for (const dir of [process.cwd(), ROOT]) if (COMPOSE_FILES.some((f) => existsSync(path.join(dir, f)))) return dir;
  return null;
}

const docker = (args, dir) => spawnSync("docker", args, { cwd: dir ?? undefined, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Docker sur cette machine : « pret », « arrete » (installé, mais il ne répond pas) ou « absent ». */
export function dockerState() {
  if (docker(["compose", "version"]).status !== 0) return "absent";
  return docker(["info", "--format", "{{.ServerVersion}}"]).status === 0 ? "pret" : "arrete";
}

/**
 * Le service « pecule » de ce dossier Compose a-t-il un conteneur, en marche ou arrêté ? Lui seul compte : un autre
 * conteneur du même projet (la base de développement d'un dépôt, par exemple) ne dit pas que Pécule est installé ici.
 */
function composeInstalled(dir) {
  const r = docker(["compose", "ps", "-a", "-q", "pecule"], dir);
  return r.status === 0 && r.stdout.trim() !== "";
}

/**
 * Les réglages que l'installation garde dans son volume, lus dans le conteneur, avec l'adresse que compose.yaml lui
 * a donnée (APP_URL) ; `null` s'il ne tourne pas.
 */
function keptInContainer(dir) {
  const r = docker(["compose", "exec", "-T", "pecule", "sh", "-c", `cat ${KEPT_IN_CONTAINER} 2>/dev/null; echo; echo "APP_URL=$APP_URL"`], dir);
  return r.status === 0 && r.stdout ? parseSettings(r.stdout) : null;
}

/** Port de la machine sur lequel compose.yaml publie Pécule (« 127.0.0.1:3000 » → « 3000 ») ; `null` s'il ne tourne pas. */
function publishedPort(dir) {
  const r = docker(["compose", "port", "pecule", "3000"], dir);
  const m = r.status === 0 ? /:(\d+)\s*$/.exec(r.stdout.trim()) : null;
  return m ? m[1] : null;
}

/**
 * Réglages de l'installation.
 *   env      les réglages (jamais affichés par l'appelant, sauf le code d'installation de `lien`)
 *   inside   la commande tourne dans le conteneur de Pécule
 *   docker   l'installation est tenue par Docker Compose
 *   fresh    rien n'est installé ici encore : ni fichier de réglages, ni conteneur
 *   file     le fichier .env lu sur la machine (`null` dans le conteneur, ou s'il n'existe pas) ; `asked` : celui qui était cherché
 *   kept     des réglages gardés par l'installation ont été lus (dans son volume) ; `keptFile` : leur fichier, dans le conteneur
 *   dir      dossier du fichier Compose, où lancer `docker compose` (`null` s'il n'y en a pas)
 */
export function loadSettings({ file: asked } = {}) {
  const keptDir = process.env.SETTINGS_DIR?.trim();
  if (keptDir) {
    const keptFile = path.join(keptDir, "pecule.env");
    const kept = existsSync(keptFile) ? parseSettings(readFileSync(keptFile, "utf8")) : null;
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (v) env[k] = v;
    return { env: complete(env, kept ?? {}), inside: true, docker: true, fresh: false, file: null, asked: null, kept: !!kept, keptFile, dir: null };
  }
  const candidate = asked ?? (existsSync(".env") ? ".env" : path.join(ROOT, ".env"));
  const file = existsSync(candidate) ? candidate : null;
  const env = file ? parseSettings(readFileSync(file, "utf8")) : {};
  const dir = composeDir();
  // Docker : le service « pecule » de ce dossier a un conteneur (quoi que dise .env : compose.yaml ne lit pas
  // DATABASE_URL), ou — Docker arrêté, conteneur pas encore créé — des mots de passe de base sans adresse de base
  // (fichier écrit par setup --docker). Un fichier Compose seul ne dit rien : le dépôt en porte un, quelle que soit la
  // façon dont Pécule est installé.
  const viaCompose = (!!dir && composeInstalled(dir)) || (!!env.DB_PASSWORD && !env.DATABASE_URL);
  let kept = false;
  if (viaCompose && dir) {
    if (!env.API_TOKEN) {
      const found = keptInContainer(dir);
      if (found) {
        // Les adresses des bases gardées valent sur le réseau des conteneurs, pas ici.
        delete found.DATABASE_URL;
        delete found.DEMO_DATABASE_URL;
        complete(env, found);
        kept = true;
      }
    }
    // Le port réellement publié, quand le fichier .env ne le dit pas (valeur d'origine, ou donnée autrement).
    if (!env.PECULE_PORT) {
      const port = publishedPort(dir);
      if (port) env.PECULE_PORT = port;
    }
  }
  return { env, inside: false, docker: viaCompose, fresh: !file && !viaCompose, file, asked: candidate, kept, keptFile: null, dir };
}

/** Port où joindre le serveur depuis là où tourne la commande. */
export const localPort = (s) => (s.inside ? (s.env.PORT ?? "3000") : (s.env.PECULE_PORT ?? s.env.PORT ?? "3000"));

/**
 * Une commande `node scripts/…` telle que la personne doit la taper sur sa machine : par `docker compose exec` quand
 * les réglages sont gardés dans le conteneur (elle y est déjà passée pour lancer celle-ci, ou la machine ne les a pas).
 */
export const run = (s, command) => (s.inside || (s.docker && !s.file) ? `docker compose exec pecule ${command}` : command);
