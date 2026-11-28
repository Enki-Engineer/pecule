/*
 * L'appli de bureau : Pécule sur l'ordinateur de celui qui s'en sert, sans serveur à tenir ni Docker. Elle embarque
 * Node, MySQL et l'archive prête à l'emploi ; un superviseur (`scripts/bureau.mjs`) crée le dossier des données, tire
 * les réglages, lance la base puis le serveur, et les arrête proprement. La fenêtre (la coque) ne fait que l'afficher.
 *
 * Ce qui tient l'ensemble :
 *   - rien ne sort de la machine : le serveur ne s'attache qu'à la boucle locale, et la base n'a aucun port — le
 *     serveur la joint par un socket du dossier des données, que seul le compte de la personne peut ouvrir ;
 *   - l'adresse est `http://127.0.0.1:<port>` : pas de clé d'accès à cette adresse (`src/lib/address.ts`), on y entre
 *     par mot de passe ; le port est choisi une fois et gardé, ce que l'appareil retient (thème, agencement) en dépend ;
 *   - la base est réglée pour un foyer, pas pour un serveur : environ 165 Mo de mémoire au lieu de 500.
 *
 * Fonctions pures, partagées par le superviseur et les tests. Node lit ce fichier tel quel dans le superviseur :
 * seulement de la syntaxe TypeScript effaçable.
 */
import { sqlString, type SecretName } from "./settings-file.ts";

/** L'appli de bureau n'écoute que sur la machine elle-même. */
export const DESKTOP_HOST = "127.0.0.1";
/** Port essayé d'abord (sous la plage que le système distribue au hasard) ; s'il est pris, les suivants. */
export const DESKTOP_PORT = 47800;
/** Combien de ports sont essayés à la première ouverture. */
export const DESKTOP_PORT_TRIES = 20;
/** Nom du dossier des données. Sans accent : il entre dans des chemins que lisent MySQL et le système. */
export const DESKTOP_FOLDER = "Pecule";

/** Adresse de l'appli de bureau pour un port. */
export const desktopUrl = (port: number): string => `http://${DESKTOP_HOST}:${port}`;

/**
 * Le premier port essayé dépend du compte : deux comptes du même ordinateur ne retiennent pas le même port le jour
 * où l'autre n'était pas ouvert — le second ne démarrerait plus.
 */
export const firstPort = (uid?: number | null): number => DESKTOP_PORT + (typeof uid === "number" && Number.isInteger(uid) && uid >= 0 ? uid % 50 : 0);

/** Les ports à essayer à la première ouverture, dans l'ordre. */
export const portCandidates = (first: number = DESKTOP_PORT): number[] => Array.from({ length: DESKTOP_PORT_TRIES }, (_, i) => first + i);

export type DataDirContext = {
  platform: string;
  /** Dossier personnel du compte. */
  home: string;
  /** Variables d'environnement utiles : APPDATA (Windows), XDG_DATA_HOME (Linux). */
  env?: Record<string, string | undefined>;
};

/** Dossier des données de l'appli de bureau, là où chaque système range celles des applis. */
export function defaultDataDir(c: DataDirContext): string {
  const join = (...parts: string[]) => parts.join(c.platform === "win32" ? "\\" : "/");
  if (c.platform === "darwin") return join(c.home, "Library", "Application Support", DESKTOP_FOLDER);
  if (c.platform === "win32") return join(c.env?.APPDATA?.trim() || join(c.home, "AppData", "Roaming"), DESKTOP_FOLDER);
  return join(c.env?.XDG_DATA_HOME?.trim() || join(c.home, ".local", "share"), DESKTOP_FOLDER.toLowerCase());
}

export type DesktopLayout = {
  root: string;
  /** Réglages gardés (secrets, port) : `pecule.env`, fermé. */
  settingsDir: string;
  /** Dossier de données de MySQL. */
  database: string;
  /** Création de la base en cours : renommé en `database` une fois achevée. */
  databaseDraft: string;
  /** Sauvegardes écrites par le serveur. */
  backups: string;
  logs: string;
  /** Ce que l'instance en marche dit d'elle (processus, adresse) : il n'y en a qu'une par dossier de données. */
  lock: string;
};

/** Ce que porte le dossier des données. */
export function desktopLayout(root: string, sep: "/" | "\\" = "/"): DesktopLayout {
  const at = (name: string) => `${root}${sep}${name}`;
  return { root, settingsDir: at("reglages"), database: at("base"), databaseDraft: at("base.partiel"), backups: at("sauvegardes"), logs: at("journaux"), lock: at("bureau.json") };
}

/**
 * Longueur que le système accepte pour le chemin d'un socket (104 octets sur macOS, 108 sur Linux, zéro final
 * compris) ; MySQL pose à côté un fichier « .lock », qui en ajoute cinq.
 */
export const SOCKET_PATH_MAX = 96;

export type SocketChoice = {
  path: string;
  /** Dossier à créer, fermé aux autres comptes, quand le socket ne tient pas dans le dossier des données. */
  privateDir: string | null;
};

/**
 * Où MySQL pose son socket : dans le dossier des données, que seul le compte peut ouvrir. Un chemin trop long pour le
 * système (un nom de compte long suffit) : dans un dossier fermé du dossier temporaire, sous un nom tiré du dossier
 * des données (`hash`, donné par l'appelant).
 */
export function chooseSocket(root: string, c: { tmp: string; uid: number | string; hash: string; bytes?: (text: string) => number }): SocketChoice {
  const bytes = c.bytes ?? ((text: string) => new TextEncoder().encode(text).length);
  const inside = `${root}/base.sock`;
  if (bytes(inside) <= SOCKET_PATH_MAX) return { path: inside, privateDir: null };
  const privateDir = `${c.tmp.replace(/\/+$/, "")}/pecule-${c.uid}`;
  return { path: `${privateDir}/${c.hash.slice(0, 12)}.sock`, privateDir };
}

export type MysqlPaths = {
  /** Dossier de MySQL (celui qui porte `bin/mysqld`). */
  basedir: string;
  datadir: string;
  socket: string;
  /** Journal des erreurs de MySQL. */
  log: string;
};

/** Ce que tout lancement de `mysqld` reçoit : aucun fichier de réglages du système n'est lu (`--no-defaults`, en tête). */
const mysqlCommon = (p: Pick<MysqlPaths, "basedir" | "datadir" | "log">): string[] => ["--no-defaults", `--basedir=${p.basedir}`, `--datadir=${p.datadir}`, `--lc-messages-dir=${p.basedir}/share`, `--log-error=${p.log}`];

/** Crée un dossier de données neuf. L'administrateur de la base naît sans mot de passe : il en reçoit un au premier démarrage, et rien n'écoute d'ici là. */
export const mysqlInitArgs = (p: Pick<MysqlPaths, "basedir" | "datadir" | "log">): string[] => [...mysqlCommon(p), "--initialize-insecure"];

/**
 * Lance la base de l'appli de bureau : aucun port (socket seul), et des réglages de foyer — sans eux, MySQL se
 * prépare à servir des centaines de connexions et prend un demi-gigaoctet.
 */
export function mysqlArgs(p: MysqlPaths): string[] {
  return [
    ...mysqlCommon(p),
    `--socket=${p.socket}`,
    `--pid-file=${p.datadir}/mysqld.pid`,
    // Aucun port : ni celui de MySQL, ni celui de son protocole X.
    "--skip-networking",
    "--mysqlx=OFF",
    "--skip-name-resolve",
    // Aucun fichier lu ni écrit sur le disque à la demande d'une requête.
    "--secure-file-priv=NULL",
    "--local-infile=OFF",
    "--character-set-server=utf8mb4",
    "--collation-server=utf8mb4_unicode_ci",
    // Mémoire : sans les tables de mesure, avec un tampon et un journal à la taille d'un foyer.
    "--performance-schema=OFF",
    "--innodb-buffer-pool-size=64M",
    "--innodb-log-buffer-size=8M",
    "--innodb-redo-log-capacity=32M",
    "--key-buffer-size=16K",
    "--max-connections=30",
    "--table-open-cache=400",
    "--table-definition-cache=400",
    "--thread-cache-size=4",
    "--tmp-table-size=16M",
    "--max-heap-table-size=16M",
    // Le journal binaire sert à la réplication : ici, il ne ferait que remplir le disque.
    "--disable-log-bin",
  ];
}

/** Les mots de passe de la base de l'appli de bureau : les mêmes secrets que le conteneur MariaDB de `compose.yaml`. */
export type DatabasePasswords = Record<Extract<SecretName, "DB_PASSWORD" | "DEMO_DB_PASSWORD" | "DB_ROOT_PASSWORD">, string>;

/**
 * Ce que le superviseur joue à chaque démarrage, en administrateur de la base : son mot de passe, les deux bases et
 * leurs comptes. Tout se rejoue sans dégât — un premier démarrage coupé en route se termine au suivant, et un mot de
 * passe est toujours celui des réglages gardés. La démo a son propre compte : une session de démo ne peut pas lire la
 * vraie base, même par une erreur du code.
 */
export function provisionSql(p: DatabasePasswords): string[] {
  const account = (user: string, database: string, password: string) => [
    `CREATE DATABASE IF NOT EXISTS ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE USER IF NOT EXISTS '${user}'@'localhost' IDENTIFIED BY ${sqlString(password)}`,
    `ALTER USER '${user}'@'localhost' IDENTIFIED BY ${sqlString(password)}`,
    `GRANT ALL PRIVILEGES ON ${database}.* TO '${user}'@'localhost'`,
  ];
  return [`ALTER USER 'root'@'localhost' IDENTIFIED BY ${sqlString(p.DB_ROOT_PASSWORD)}`, ...account("pecule", "pecule", p.DB_PASSWORD), ...account("pecule_demo", "pecule_demo", p.DEMO_DB_PASSWORD)];
}

/** Adresse d'une base jointe par socket, telle que la lit le pilote du serveur. */
const socketUrl = (user: string, password: string, database: string, socket: string) => `mysql://${user}:${encodeURIComponent(password)}@localhost/${database}?socketPath=${encodeURIComponent(socket)}`;

/** Adresses des deux bases de l'appli de bureau (la base, celle de la démo). */
export function desktopDatabaseUrls(socket: string, p: Pick<DatabasePasswords, "DB_PASSWORD" | "DEMO_DB_PASSWORD">): { DATABASE_URL: string; DEMO_DATABASE_URL: string } {
  return { DATABASE_URL: socketUrl("pecule", p.DB_PASSWORD, "pecule", socket), DEMO_DATABASE_URL: socketUrl("pecule_demo", p.DEMO_DB_PASSWORD, "pecule_demo", socket) };
}

/** Ce qui dit au serveur qu'il tourne dans l'appli de bureau (`src/server/install.ts`). */
export const DESKTOP_FLAG = "PECULE_BUREAU";

/**
 * Ce qui dit au serveur que la fenêtre de l'appli (la coque) est là. Elle seule sait rendre au serveur le retour d'une
 * banque : Enable Banking exige une adresse de retour en https, que l'appli de bureau n'a pas. L'adresse déclarée chez
 * lui est alors `https://localhost:<port>/…` — personne ne la sert : la coque la reconnaît avant que la fenêtre n'y
 * aille, et rend le même chemin au serveur local. Sans la coque (superviseur lancé à la main, Pécule ouvert dans un
 * navigateur), ce retour n'arriverait nulle part : l'adresse reste celle de l'appli, en http, et l'écran dit qu'il
 * faut du https.
 */
export const DESKTOP_SHELL_FLAG = "PECULE_BUREAU_COQUE";

/** Adresse que la banque rappelle dans l'appli de bureau : jamais servie, reconnue par la coque. */
export const desktopReturnOrigin = (port: number | string): string => `https://localhost:${port}`;

/**
 * D'où la banque revient : l'adresse de l'appli partout, sauf dans la fenêtre de l'appli de bureau. `env` : ce que le
 * serveur a reçu ; `appUrl` : son adresse.
 */
export function bankReturnOrigin(env: Record<string, string | undefined>, appUrl: string): string {
  const url = new URL(appUrl);
  return env[DESKTOP_FLAG] === "1" && env[DESKTOP_SHELL_FLAG] === "1" && url.port ? desktopReturnOrigin(url.port) : url.origin;
}

/** Ce que la coque reconnaît pour ouvrir l'accord d'une banque dans sa propre fenêtre. */
export const SHELL_BANK_SCHEME = "pecule-banque";

/**
 * L'adresse où l'écran part donner l'accord chez la banque. Partout, celle de la banque. Dans la fenêtre de l'appli
 * de bureau, la même, emballée : la coque ne laisse jamais la fenêtre de Pécule quitter Pécule — tout autre lien
 * extérieur part dans le navigateur —, et ouvre celle-ci dans une fenêtre à part, qui se referme au retour.
 */
export function bankAuthLink(env: Record<string, string | undefined>, url: string): string {
  return env[DESKTOP_FLAG] === "1" && env[DESKTOP_SHELL_FLAG] === "1" ? `${SHELL_BANK_SCHEME}://ouvrir?vers=${encodeURIComponent(url)}` : url;
}

/** Secrets que le serveur reçoit (les mots de passe de la base ne lui arrivent que dans l'adresse de ses deux bases). */
const SERVER_SETTINGS = ["API_TOKEN", "SETUP_CODE", "SYNC_TOKEN", "SECRET_KEY"] as const;

export type ServerEnvContext = {
  port: number;
  socket: string;
  /** Les réglages gardés (secrets). */
  settings: Record<string, string | undefined>;
  backups: string;
  /** Ce que le superviseur a lui-même reçu : seul ce qu'il faut à un processus pour tourner en est repris. */
  parent: Record<string, string | undefined>;
  /** Lancé par la fenêtre de l'appli (la coque) : elle rendra au serveur le retour de la banque. */
  shell?: boolean;
};

/** Variables que tout processus reprend de son parent ; rien d'autre ne passe. */
const INHERITED = ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "TZ", "SystemRoot", "APPDATA", "TEMP"];

/** L'environnement réduit d'un processus lancé par le superviseur (la base, le serveur) : ce qu'il lui faut pour tourner, rien du terminal. */
export function inheritedEnv(parent: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of INHERITED) if (parent[name]) env[name] = parent[name]!;
  return env;
}

/**
 * L'environnement du serveur de l'appli de bureau, complet et fermé : ni les variables du terminal, ni un fichier
 * `.env` qui traînerait là où il est lancé n'y ajoutent rien — une clé d'un autre projet n'entre pas dans cette
 * installation, et sa base ne peut pas être détournée.
 */
export function desktopServerEnv(c: ServerEnvContext): Record<string, string> {
  const env = inheritedEnv(c.parent);
  for (const name of SERVER_SETTINGS) if (c.settings[name]) env[name] = c.settings[name]!;
  return {
    ...env,
    NODE_ENV: "production",
    PORT: String(c.port),
    LISTEN_HOST: DESKTOP_HOST,
    APP_URL: desktopUrl(c.port),
    ...desktopDatabaseUrls(c.socket, { DB_PASSWORD: c.settings.DB_PASSWORD ?? "", DEMO_DB_PASSWORD: c.settings.DEMO_DB_PASSWORD ?? "" }),
    // Personne entre la fenêtre et le serveur.
    TRUST_PROXY: "0",
    BACKUP_DIR: c.backups,
    [DESKTOP_FLAG]: "1",
    ...(c.shell ? { [DESKTOP_SHELL_FLAG]: "1" } : {}),
    // Aucun fichier `.env` du dossier courant n'est lu.
    DOTENV_CONFIG_PATH: c.backups.startsWith("/") ? "/dev/null" : "NUL",
  };
}

/** Combien de fois le serveur est relancé après un arrêt inattendu, et sur quelle durée. */
export const RESTART_LIMIT = 5;
export const RESTART_WINDOW_MS = 10 * 60_000;

/** Le serveur s'est arrêté seul : le relancer, ou renoncer s'il vient déjà de tomber plusieurs fois ? `falls` : les heures de ses arrêts. */
export function mayRestart(falls: number[], now: number): boolean {
  return falls.filter((at) => now - at < RESTART_WINDOW_MS).length < RESTART_LIMIT;
}

/** Ce que le superviseur écrit de lui pendant qu'il tourne (fichier `bureau.json` du dossier des données). */
export type DesktopLock = {
  pid: number;
  /** Heure de lancement du superviseur, telle que la dit le système : un autre processus qui reprendrait son numéro n'est pas lui. */
  started: string;
  port: number;
  url: string;
  since: string;
  version: string;
};

/** Lit ce fichier ; `null` s'il est absent, abîmé ou d'une autre forme. */
export function parseLock(text: string): DesktopLock | null {
  try {
    const v = JSON.parse(text) as Partial<DesktopLock> | null;
    if (!v || !Number.isInteger(v.pid) || !Number.isInteger(v.port) || typeof v.url !== "string") return null;
    return { pid: v.pid!, started: typeof v.started === "string" ? v.started : "", port: v.port!, url: v.url, since: typeof v.since === "string" ? v.since : "", version: typeof v.version === "string" ? v.version : "" };
  } catch {
    return null;
  }
}

/**
 * La ligne de commande d'un processus porte-t-elle cet argument, en entier ? « --bureau=/donnees » ne reconnaît pas
 * « --bureau=/donnees-voisin » : c'est à cela qu'on reconnaît la base et le serveur d'un dossier de données.
 */
export const hasArgument = (command: string, argument: string): boolean => command.endsWith(argument) || command.includes(`${argument} `);

/** Le port gardé dans les réglages ; `null` s'il n'y en a pas, ou s'il n'est pas un port. */
export function keptPort(settings: Record<string, string | undefined>): number | null {
  const n = Number((settings.PORT ?? "").trim());
  return Number.isInteger(n) && n >= 1024 && n <= 65535 ? n : null;
}

// ---------- Taille de l'affichage ----------

/** Tailles d'affichage proposées dans les réglages de l'appli de bureau, en pour cent. */
export const ZOOM_LEVELS = [75, 80, 90, 100, 110, 125] as const;
/** La fenêtre écrit la taille en cours sur la page (`data-pecule-zoom`, en pour cent) et le dit par cet événement. */
export const ZOOM_DATASET = "peculeZoom";
export const ZOOM_EVENT = "pecule-zoom";

/** La taille que la fenêtre a écrite sur la page ; 100 si elle n'a rien dit, ou rien de lisible. */
export function shownZoom(written: string | undefined): number {
  const value = Number(written);
  return Number.isFinite(value) && value >= 25 && value <= 400 ? Math.round(value) : 100;
}
