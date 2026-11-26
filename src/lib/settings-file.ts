/*
 * Réglages gardés par l'installation elle-même, à côté de ceux que donne l'environnement.
 *
 * Avec Docker, celui qui installe n'a ni fichier `.env` à écrire ni Node à avoir sur sa machine : le service
 * « reglages » de `compose.yaml` (`node scripts/setup.mjs --conteneur`) tire une fois les secrets de l'installation
 * et les garde dans le volume « pecule-reglages » ; le serveur les y lit à chaque démarrage (`src/server/env.ts`).
 *
 * Deux règles tiennent tout :
 *   - ce que donne l'environnement (un `.env` posé à côté de `compose.yaml`) l'emporte sur ce qui est gardé : une
 *     installation d'avant garde ses secrets, et celui qui veut choisir les siens le peut toujours ;
 *   - rien n'est jamais tiré à la place d'un secret que l'installation a déjà, ni à côté d'un jeton d'administration
 *     donné sans `SECRET_KEY` : ce jeton chiffre alors les clés gardées en base, un secret tiré les rendrait illisibles.
 *
 * Fonctions pures, partagées par le serveur, `scripts/setup.mjs` et les tests. Node lit ce fichier tel quel dans les
 * scripts : seulement de la syntaxe TypeScript effaçable (pas d'`enum`, pas de propriété déclarée dans un constructeur).
 */

/** Nom du fichier des réglages gardés, dans le dossier des réglages (SETTINGS_DIR). */
export const SETTINGS_FILE = "pecule.env";

/** Secrets d'une installation, et leur longueur en octets tirés au hasard (écrits en hexadécimal : deux fois plus de caractères). */
export const SECRETS = {
  /** Jeton d'administration de secours. */
  API_TOKEN: 24,
  /** Code demandé une seule fois, pour créer le premier membre. */
  SETUP_CODE: 12,
  /** Jeton qui ne sert qu'à déclencher une synchronisation. */
  SYNC_TOKEN: 24,
  /** Chiffre les clés gardées en base (banque, IA, notifications). */
  SECRET_KEY: 32,
  /** Mots de passe du conteneur MariaDB : la base, celle de la démo, l'administrateur de la base. */
  DB_PASSWORD: 16,
  DEMO_DB_PASSWORD: 16,
  DB_ROOT_PASSWORD: 16,
} as const;

export type SecretName = keyof typeof SECRETS;
export const SECRET_NAMES = Object.keys(SECRETS) as SecretName[];

/**
 * Mots de passe du conteneur MariaDB. Ils ne sont gardés que dans le volume que ce conteneur lit à la création de sa
 * base (un fichier chacun), jamais avec les réglages du serveur : celui-ci ne reçoit que l'adresse de ses deux bases,
 * pas le mot de passe de l'administrateur de la base.
 */
export const DATABASE_SECRETS = { DB_PASSWORD: ".mot-de-passe", DB_ROOT_PASSWORD: ".mot-de-passe-root", DEMO_DB_PASSWORD: ".mot-de-passe-demo" } as const satisfies Partial<Record<SecretName, string>>;
/** Secrets du serveur, gardés dans son fichier de réglages (`SETTINGS_FILE`). */
export const SERVER_SECRETS = SECRET_NAMES.filter((name) => !(name in DATABASE_SECRETS));

/**
 * Secrets qui ne se tirent qu'avec le jeton d'administration : donné sans eux par une installation d'avant, ce jeton
 * tient lieu de l'un (il chiffre les clés gardées en base) et de l'autre (il sert de code d'installation).
 */
const WITH_API_TOKEN: SecretName[] = ["SECRET_KEY", "SETUP_CODE"];

export type Settings = Record<string, string>;

/**
 * Lit un fichier de réglages : « CLÉ=valeur » par ligne, guillemets facultatifs autour de la valeur. `#` commence un
 * commentaire, en début de ligne ou après une valeur sans guillemets (« A=1 # pourquoi »), comme le lit le serveur.
 */
export function parseSettings(text: string): Settings {
  const out: Settings = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const quoted = /^(["'])(.*)\1$/.exec(m[2]);
    out[m[1]] = quoted ? quoted[2] : m[2].replace(/\s+#.*$/, "");
  }
  return out;
}

/** Écrit un fichier de réglages, dans l'ordre donné, sous une ligne d'en-tête. Une valeur vide n'est pas écrite. */
export function formatSettings(values: Settings, header: string): string {
  const lines = Object.entries(values)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v}`);
  return `${[`# ${header}`, ...lines].join("\n")}\n`;
}

export type Settled = {
  /** Les secrets de l'installation, dans l'ordre de `SECRETS` ; un secret laissé de côté n'y figure pas. */
  values: Partial<Record<SecretName, string>>;
  /** Tirés au hasard cette fois-ci. */
  drawn: SecretName[];
  /** Donnés par l'environnement. */
  given: SecretName[];
};

/**
 * Les secrets d'une installation. Pour chacun : ce que donne l'environnement, sinon ce qui est déjà gardé, sinon un
 * tirage — sauf `SECRET_KEY` et `SETUP_CODE`, qui ne se tirent jamais à côté d'un jeton d'administration déjà là.
 */
export function settleSecrets(given: Record<string, string | undefined>, kept: Settings, draw: (bytes: number) => string): Settled {
  const out: Settled = { values: {}, drawn: [], given: [] };
  const has = (name: SecretName) => (given[name] ?? "").trim() || (kept[name] ?? "").trim();
  // Le jeton d'administration existe déjà : l'installation n'est pas neuve, ce qui lui manque ne s'invente pas.
  const established = !!has("API_TOKEN");
  for (const name of SECRET_NAMES) {
    const fromEnv = (given[name] ?? "").trim();
    const fromFile = (kept[name] ?? "").trim();
    if (fromEnv) {
      out.values[name] = fromEnv;
      out.given.push(name);
    } else if (fromFile) out.values[name] = fromFile;
    else if (!(established && WITH_API_TOKEN.includes(name))) {
      out.values[name] = draw(SECRETS[name]);
      out.drawn.push(name);
    }
  }
  return out;
}

/** Longueur minimale des secrets que lit le serveur (les seuils de `src/server/env.ts`). */
export const MIN_LENGTH = { API_TOKEN: 32, SYNC_TOKEN: 32, SECRET_KEY: 32, SETUP_CODE: 16 } as const satisfies Partial<Record<SecretName, number>>;

/** Adresse où l'installation était servie à son dernier démarrage, gardée avec ses réglages. */
export const KEPT_ADDRESS = "KEPT_APP_URL";

/** Ce qui chiffre les clés gardées en base : `SECRET_KEY`, à défaut le jeton d'administration. */
const sealing = (values: Record<string, string | undefined>) => (values.SECRET_KEY ?? "").trim() || (values.API_TOKEN ?? "").trim();

export type Refusal =
  /** Une base existe déjà, et rien ne donne son mot de passe : en tirer un autre la rendrait injoignable. */
  | { reason: "base" }
  /** Un secret donné par l'environnement est plus court que ce que le serveur accepte : il vient sans doute d'ailleurs. */
  | { reason: "court"; name: SecretName; min: number }
  /** Ce qui chiffre les clés gardées en base changerait : elles deviendraient illisibles. */
  | { reason: "chiffrement" }
  /** L'adresse de l'installation changerait sans que rien ne l'ait demandé : le fichier `.env` de son dossier manque. */
  | { reason: "adresse"; from: string; to: string }
  /**
   * Un secret donné par l'environnement remplacerait celui que l'installation garde. Une variable du même nom exportée
   * dans le terminal pour un autre projet suffit : le jeton d'administration changerait sans que personne l'ait voulu.
   */
  | { reason: "remplace"; name: SecretName };

/**
 * Ce qui empêche de reprendre tels quels les réglages donnés à ce démarrage. Docker Compose lit aussi les variables
 * du terminal : une variable de même nom exportée pour un autre projet, ou un démarrage lancé d'un dossier qui n'a
 * pas le fichier `.env` de l'installation, ne doivent pas la dérégler en silence.
 *   settled   les secrets retenus (`settleSecrets`)
 *   kept      ce que l'installation gardait avant ce démarrage
 *   address   l'adresse de ce démarrage, et si elle a été demandée (APP_URL ou PECULE_PORT donnés) ou n'est que la valeur d'origine
 *   databaseExists   le conteneur MariaDB a déjà créé sa base (son volume n'est pas vide)
 */
export function refusals(given: Record<string, string | undefined>, kept: Settings, settled: Settled, address?: { effective: string; explicit: boolean }, databaseExists = false): Refusal[] {
  const out: Refusal[] = [];
  // Une base déjà là dont le mot de passe vient d'être tiré : les réglages de cette installation ne sont pas arrivés
  // jusqu'ici (son fichier .env manque, ou le volume de ses réglages a été perdu). Rien d'autre n'a de sens à contrôler.
  if (databaseExists && settled.drawn.includes("DB_PASSWORD")) return [{ reason: "base" }];
  for (const [name, min] of Object.entries(MIN_LENGTH) as [SecretName, number][]) {
    const value = (given[name] ?? "").trim();
    if (value && value.length < min) out.push({ reason: "court", name, min });
  }
  // Une installation déjà en service ne change jamais de secret de chiffrement sans qu'on le veuille.
  const before = sealing(kept);
  if (before && sealing(settled.values) !== before) out.push({ reason: "chiffrement" });
  // Aucun secret déjà gardé ne se remplace en silence. Le secret de chiffrement a son propre refus, plus parlant ; un
  // mot de passe de la base ne compte que si la base existe (avant, le changer est sans effet).
  const sealer: SecretName = (kept.SECRET_KEY ?? "").trim() || (given.SECRET_KEY ?? "").trim() ? "SECRET_KEY" : "API_TOKEN";
  for (const name of SECRET_NAMES) {
    const now = (given[name] ?? "").trim();
    const was = (kept[name] ?? "").trim();
    if (!now || !was || now === was || name === sealer || name === "SECRET_KEY") continue;
    if (name in DATABASE_SECRETS && !databaseExists) continue;
    out.push({ reason: "remplace", name });
  }
  const from = (kept[KEPT_ADDRESS] ?? "").trim();
  const to = (address?.effective ?? "").trim().replace(/\/+$/, "");
  if (from && to && from !== to && !address?.explicit) out.push({ reason: "adresse", from, to });
  return out;
}

/** Le mot de passe que porte l'adresse d'une base (« mysql://utilisateur:motdepasse@… ») ; `null` s'il n'y en a pas. */
export function passwordFromUrl(url: string | undefined): string | null {
  try {
    const password = new URL(url ?? "").password;
    return password ? decodeURIComponent(password) : null;
  } catch {
    return null;
  }
}

/**
 * Retrouve dans les adresses gardées les mots de passe de la base qui ne seraient plus gardés à part (le volume que
 * MariaDB lit à sa création a été perdu) : on ne tire jamais un mot de passe que l'installation connaît encore.
 */
export function recoverDatabasePasswords(kept: Settings): Settings {
  const out = { ...kept };
  for (const [name, url] of [["DB_PASSWORD", kept.DATABASE_URL], ["DEMO_DB_PASSWORD", kept.DEMO_DATABASE_URL]] as const) {
    const password = (out[name] ?? "").trim() ? null : passwordFromUrl(url);
    if (password) out[name] = password;
  }
  return out;
}

/** Complète l'environnement par les réglages gardés : une variable absente ou vide reçoit la valeur gardée, jamais l'inverse. */
export function mergeSettings(env: Record<string, string | undefined>, kept: Settings): string[] {
  const added: string[] = [];
  for (const [key, value] of Object.entries(kept)) {
    if ((env[key] ?? "") !== "" || value === "") continue;
    env[key] = value;
    added.push(key);
  }
  return added;
}

/** Une chaîne dans une instruction SQL de MariaDB ou MySQL (apostrophes et barres obliques inverses doublées). */
export const sqlString = (text: string) => `'${text.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;

/** Un mot de passe dans l'adresse d'une base (`mysql://utilisateur:motdepasse@…`). */
const urlPart = (text: string) => encodeURIComponent(text);

/** Nom du service de la base dans `compose.yaml` : c'est son nom d'hôte sur le réseau des conteneurs. */
export const COMPOSE_DB_HOST = "base";

/** Adresses des deux bases du conteneur MariaDB de `compose.yaml` (la base, celle de la démo). */
export function composeDatabaseUrls(passwords: { DB_PASSWORD: string; DEMO_DB_PASSWORD: string }): { DATABASE_URL: string; DEMO_DATABASE_URL: string } {
  return {
    DATABASE_URL: `mysql://pecule:${urlPart(passwords.DB_PASSWORD)}@${COMPOSE_DB_HOST}:3306/pecule`,
    DEMO_DATABASE_URL: `mysql://pecule_demo:${urlPart(passwords.DEMO_DB_PASSWORD)}@${COMPOSE_DB_HOST}:3306/pecule_demo`,
  };
}

/**
 * Ce que le conteneur MariaDB joue une fois, à la création de sa base : la base du mode démo (données fictives) et
 * son utilisateur à part — une session de démo ne peut pas lire la vraie base, même par une erreur du code.
 */
export function demoInitSql(demoPassword: string): string {
  return [
    "-- Base du mode démo de Pécule, créée avec le conteneur MariaDB (écrit par scripts/setup.mjs --conteneur).",
    "CREATE DATABASE IF NOT EXISTS pecule_demo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;",
    `CREATE USER IF NOT EXISTS 'pecule_demo'@'%' IDENTIFIED BY ${sqlString(demoPassword)};`,
    "GRANT ALL PRIVILEGES ON pecule_demo.* TO 'pecule_demo'@'%';",
    "FLUSH PRIVILEGES;",
    "",
  ].join("\n");
}

/**
 * Lien du premier démarrage : l'adresse de l'appli avec le code d'installation dans le fragment, que le navigateur
 * n'envoie jamais au serveur (il ne figure donc dans aucun journal). L'écran « Bienvenue dans Pécule » le lit et le retire.
 */
export function setupLink(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/+$/, "")}/#code=${encodeURIComponent(code)}`;
}

/** Le code d'installation porté par un lien de premier démarrage (`#code=…`) ; `null` s'il n'y en a pas. */
export function setupCodeFromHash(hash: string): string | null {
  const m = /^#?(?:.*&)?code=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).trim() || null;
  } catch {
    return null;
  }
}
