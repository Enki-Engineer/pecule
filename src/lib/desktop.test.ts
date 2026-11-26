import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addressInfo } from "./address.ts";
import {
  chooseSocket,
  defaultDataDir,
  DESKTOP_FLAG,
  DESKTOP_HOST,
  DESKTOP_PORT,
  DESKTOP_SHELL_FLAG,
  bankAuthLink,
  bankReturnOrigin,
  desktopDatabaseUrls,
  desktopLayout,
  desktopServerEnv,
  desktopUrl,
  firstPort,
  hasArgument,
  inheritedEnv,
  keptPort,
  mayRestart,
  mysqlArgs,
  mysqlInitArgs,
  parseLock,
  portCandidates,
  provisionSql,
  RESTART_LIMIT,
  RESTART_WINDOW_MS,
  SOCKET_PATH_MAX,
} from "./desktop.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const paths = { basedir: "/appli/mysql", datadir: "/donnees/base", socket: "/donnees/base.sock", log: "/donnees/journaux/mysql.log" };
const passwords = { DB_PASSWORD: "aa11", DEMO_DB_PASSWORD: "bb22", DB_ROOT_PASSWORD: "cc33" };

describe("adresse de l'appli de bureau", () => {
  it("la machine seule, en http : on y entre par mot de passe, jamais par clé d'accès", () => {
    expect(desktopUrl(DESKTOP_PORT)).toBe("http://127.0.0.1:47800");
    expect(addressInfo(desktopUrl(DESKTOP_PORT))).toEqual({ kind: "local", ip: true, passkeys: false });
  });

  it("essaie des ports sous la plage que le système distribue au hasard", () => {
    const ports = portCandidates();
    expect(ports[0]).toBe(DESKTOP_PORT);
    expect(new Set(ports).size).toBe(ports.length);
    expect(Math.max(...ports)).toBeLessThan(49152);
  });

  it("ne reprend des réglages qu'un port qui en est un", () => {
    expect(keptPort({ PORT: "47803" })).toBe(47803);
    for (const bad of ["", "80", "abc", "70000", "47800.5"]) expect(keptPort({ PORT: bad }), bad).toBeNull();
    expect(keptPort({})).toBeNull();
  });
});

describe("dossier des données", () => {
  it("là où chaque système range les données des applis", () => {
    expect(defaultDataDir({ platform: "darwin", home: "/Users/alex" })).toBe("/Users/alex/Library/Application Support/Pecule");
    expect(defaultDataDir({ platform: "linux", home: "/home/alex" })).toBe("/home/alex/.local/share/pecule");
    expect(defaultDataDir({ platform: "linux", home: "/home/alex", env: { XDG_DATA_HOME: "/data" } })).toBe("/data/pecule");
    expect(defaultDataDir({ platform: "win32", home: "C:\\Users\\alex", env: { APPDATA: "C:\\Users\\alex\\AppData\\Roaming" } })).toBe("C:\\Users\\alex\\AppData\\Roaming\\Pecule");
  });

  it("range réglages, base, sauvegardes et journaux à part", () => {
    const l = desktopLayout("/donnees");
    expect(l).toEqual({ root: "/donnees", settingsDir: "/donnees/reglages", database: "/donnees/base", databaseDraft: "/donnees/base.partiel", backups: "/donnees/sauvegardes", logs: "/donnees/journaux", lock: "/donnees/bureau.json" });
  });
});

describe("socket de la base", () => {
  const c = { tmp: "/var/folders/ab/T/", uid: 501, hash: "0123456789abcdef0123" };

  it("dans le dossier des données quand le chemin tient", () => {
    expect(chooseSocket("/Users/alex/Library/Application Support/Pecule", c)).toEqual({ path: "/Users/alex/Library/Application Support/Pecule/base.sock", privateDir: null });
  });

  it("dans un dossier fermé du dossier temporaire quand il est trop long pour le système", () => {
    const long = `/Users/${"a".repeat(80)}/Library/Application Support/Pecule`;
    const choice = chooseSocket(long, c);
    expect(choice).toEqual({ path: "/var/folders/ab/T/pecule-501/0123456789ab.sock", privateDir: "/var/folders/ab/T/pecule-501" });
    expect(choice.path.length).toBeLessThanOrEqual(SOCKET_PATH_MAX);
  });

  it("compte en octets : un nom de compte accentué pèse plus que ses lettres", () => {
    const root = `/Users/${"é".repeat(30)}/Library/Application Support/Pecule`;
    expect(`${root}/base.sock`.length).toBeLessThanOrEqual(SOCKET_PATH_MAX);
    expect(chooseSocket(root, c).privateDir).not.toBeNull();
  });
});

describe("MySQL embarqué", () => {
  const args = mysqlArgs(paths);

  it("ne lit aucun réglage du système : --no-defaults vient en tête", () => {
    expect(args[0]).toBe("--no-defaults");
    expect(mysqlInitArgs(paths)[0]).toBe("--no-defaults");
  });

  it("n'ouvre aucun port", () => {
    expect(args).toContain("--skip-networking");
    expect(args).toContain("--mysqlx=OFF");
    expect(args).toContain("--socket=/donnees/base.sock");
    expect(args.some((a) => /^--(port|bind-address)/.test(a))).toBe(false);
  });

  it("ne lit ni n'écrit de fichier à la demande d'une requête", () => {
    expect(args).toContain("--secure-file-priv=NULL");
    expect(args).toContain("--local-infile=OFF");
  });

  it("porte le jeu de caractères et la collation de Pécule, et des réglages de foyer", () => {
    for (const a of ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci", "--performance-schema=OFF", "--disable-log-bin", "--innodb-buffer-pool-size=64M"]) expect(args).toContain(a);
  });

  it("crée la base sans jamais écouter : seul le dossier de données change entre création et démarrage", () => {
    const init = mysqlInitArgs({ ...paths, datadir: "/donnees/base.partiel" });
    expect(init).toContain("--initialize-insecure");
    expect(init).toContain("--datadir=/donnees/base.partiel");
    expect(init.some((a) => a.startsWith("--socket") || a.startsWith("--port"))).toBe(false);
  });
});

describe("comptes de la base", () => {
  const sql = provisionSql(passwords);

  it("donne son mot de passe à l'administrateur de la base avant tout", () => {
    expect(sql[0]).toBe("ALTER USER 'root'@'localhost' IDENTIFIED BY 'cc33'");
  });

  it("sépare la démo de la vraie base : un compte chacune, sans droit sur l'autre", () => {
    expect(sql).toContain("GRANT ALL PRIVILEGES ON pecule.* TO 'pecule'@'localhost'");
    expect(sql).toContain("GRANT ALL PRIVILEGES ON pecule_demo.* TO 'pecule_demo'@'localhost'");
    expect(sql.filter((s) => s.startsWith("GRANT"))).toHaveLength(2);
    expect(sql.join("\n")).not.toMatch(/\*\.\*|'%'/);
  });

  it("se rejoue sans dégât, et remet toujours le mot de passe des réglages", () => {
    for (const s of sql.filter((x) => x.startsWith("CREATE"))) expect(s).toMatch(/^CREATE (DATABASE|USER) IF NOT EXISTS /);
    expect(sql).toContain("ALTER USER 'pecule'@'localhost' IDENTIFIED BY 'aa11'");
    expect(sql).toContain("ALTER USER 'pecule_demo'@'localhost' IDENTIFIED BY 'bb22'");
  });

  it("écrit un mot de passe comme une chaîne SQL, quoi qu'il contienne", () => {
    expect(provisionSql({ ...passwords, DB_PASSWORD: "a'b\\c" })).toContain("ALTER USER 'pecule'@'localhost' IDENTIFIED BY 'a''b\\\\c'");
  });

  it("joint les deux bases par le socket, le mot de passe encodé dans l'adresse", () => {
    const urls = desktopDatabaseUrls("/donnees/Application Support/base.sock", { DB_PASSWORD: "a/b@c", DEMO_DB_PASSWORD: "bb22" });
    const real = new URL(urls.DATABASE_URL);
    expect(real.pathname).toBe("/pecule");
    expect(decodeURIComponent(real.password)).toBe("a/b@c");
    expect(real.searchParams.get("socketPath")).toBe("/donnees/Application Support/base.sock");
    const demo = new URL(urls.DEMO_DATABASE_URL);
    expect([demo.username, demo.pathname]).toEqual(["pecule_demo", "/pecule_demo"]);
  });
});

describe("environnement du serveur", () => {
  const settings = { API_TOKEN: "a".repeat(48), SETUP_CODE: "b".repeat(24), SYNC_TOKEN: "c".repeat(48), SECRET_KEY: "d".repeat(64), ...passwords, PORT: "47800" };
  const env = desktopServerEnv({ port: 47800, socket: "/donnees/base.sock", settings, backups: "/donnees/sauvegardes", parent: { PATH: "/usr/bin", HOME: "/Users/alex", DATABASE_URL: "mysql://ailleurs", AI_FOUNDRY_API_KEY: "une-cle-d-un-autre-projet", FINTA_API_KEY: "finta_x", NODE_OPTIONS: "--inspect" } });

  it("n'écoute que sur la machine, à l'adresse de l'appli de bureau", () => {
    expect(env.LISTEN_HOST).toBe(DESKTOP_HOST);
    expect(env.APP_URL).toBe("http://127.0.0.1:47800");
    expect(env.PORT).toBe("47800");
    expect(env.TRUST_PROXY).toBe("0");
    expect(env.NODE_ENV).toBe("production");
    expect(env[DESKTOP_FLAG]).toBe("1");
  });

  it("ne laisse rien entrer du terminal ni d'un fichier .env", () => {
    expect(env.DATABASE_URL).toContain("socketPath=");
    expect(env.AI_FOUNDRY_API_KEY).toBeUndefined();
    expect(env.FINTA_API_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.DOTENV_CONFIG_PATH).toBe("/dev/null");
    expect(env.PATH).toBe("/usr/bin");
  });

  it("donne au serveur ses secrets, pas le mot de passe de l'administrateur de la base", () => {
    for (const name of ["API_TOKEN", "SETUP_CODE", "SYNC_TOKEN", "SECRET_KEY"] as const) expect(env[name]).toBe(settings[name]);
    expect(env.DB_ROOT_PASSWORD).toBeUndefined();
    expect(Object.values(env).join(" ")).not.toContain("cc33");
    expect(env.BACKUP_DIR).toBe("/donnees/sauvegardes");
  });

  it("ne règle que ce que le serveur lit, ou ce qui le fait reconnaître", () => {
    const source = read("src/server/env.ts");
    const known = [...source.slice(source.indexOf("const schema = z.object({"), source.indexOf("const parsed = schema.safeParse")).matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
    const system = ["PATH", "HOME", DESKTOP_FLAG, DESKTOP_SHELL_FLAG, "DOTENV_CONFIG_PATH"];
    for (const name of Object.keys(env)) expect([...known, ...system], name).toContain(name);
  });
});

describe("retour de la banque", () => {
  const app = "http://127.0.0.1:47800";

  it("revient à l'adresse de l'appli partout, sauf dans la fenêtre de l'appli de bureau", () => {
    expect(bankReturnOrigin({}, "https://pecule.exemple.fr")).toBe("https://pecule.exemple.fr");
    expect(bankReturnOrigin({}, "http://localhost:3000")).toBe("http://localhost:3000");
    // Superviseur lancé à la main, Pécule ouvert dans un navigateur : personne n'intercepterait le retour.
    expect(bankReturnOrigin({ [DESKTOP_FLAG]: "1" }, app)).toBe(app);
    // Le drapeau de la coque seul ne vaut rien : un serveur ordinaire ne se laisse pas dérouter par une variable.
    expect(bankReturnOrigin({ [DESKTOP_SHELL_FLAG]: "1" }, "https://pecule.exemple.fr")).toBe("https://pecule.exemple.fr");
    expect(bankReturnOrigin({ [DESKTOP_FLAG]: "1", [DESKTOP_SHELL_FLAG]: "1" }, app)).toBe("https://localhost:47800");
  });

  it("l'accord part dans une fenêtre à part de l'appli de bureau, sans rien changer ailleurs", () => {
    const eb = "https://tilisy.enablebanking.com/auth?x=1&y=é";
    expect(bankAuthLink({}, eb)).toBe(eb);
    expect(bankAuthLink({ [DESKTOP_FLAG]: "1" }, eb)).toBe(eb);
    const wrapped = new URL(bankAuthLink({ [DESKTOP_FLAG]: "1", [DESKTOP_SHELL_FLAG]: "1" }, eb));
    expect(wrapped.protocol).toBe("pecule-banque:");
    expect(wrapped.searchParams.get("vers")).toBe(eb);
  });

  it("le superviseur ne pose le drapeau de la coque que lancé par elle", () => {
    const base = { port: 47800, socket: "/donnees/base.sock", settings: {}, backups: "/donnees/sauvegardes", parent: {} };
    expect(desktopServerEnv(base)[DESKTOP_SHELL_FLAG]).toBeUndefined();
    expect(desktopServerEnv({ ...base, shell: true })[DESKTOP_SHELL_FLAG]).toBe("1");
  });
});

describe("serveur tombé seul", () => {
  it("est relancé, sauf s'il vient de tomber plusieurs fois de suite", () => {
    const now = 1_000_000_000;
    expect(mayRestart([], now)).toBe(true);
    expect(mayRestart(Array.from({ length: RESTART_LIMIT - 1 }, (_, i) => now - i * 1000), now)).toBe(true);
    expect(mayRestart(Array.from({ length: RESTART_LIMIT }, (_, i) => now - i * 1000), now)).toBe(false);
    // D'anciennes chutes ne comptent plus.
    expect(mayRestart(Array.from({ length: RESTART_LIMIT }, () => now - RESTART_WINDOW_MS - 1), now)).toBe(true);
  });
});

describe("verrou de l'instance", () => {
  it("se relit, et rend null pour un fichier vide, abîmé ou d'une autre forme", () => {
    expect(parseLock('{"pid":12,"started":"Thu Nov 26 01:00:00 2026","port":47800,"url":"http://127.0.0.1:47800","since":"2026-11-26T00:00:00.000Z","version":"1.49.0"}')).toEqual({ pid: 12, started: "Thu Nov 26 01:00:00 2026", port: 47800, url: "http://127.0.0.1:47800", since: "2026-11-26T00:00:00.000Z", version: "1.49.0" });
    for (const bad of ["", "{", "null", "[]", '{"pid":"12","port":1,"url":""}', '{"pid":12}']) expect(parseLock(bad), bad).toBeNull();
  });
});

describe("processus du superviseur", () => {
  it("reconnaît un argument entier, pas le début d'un autre", () => {
    const command = "/appli/node /appli/dist/server.mjs --bureau=/donnees/Application Support/Pecule";
    expect(hasArgument(command, "--bureau=/donnees/Application Support/Pecule")).toBe(true);
    expect(hasArgument(`${command}-voisin`, "--bureau=/donnees/Application Support/Pecule")).toBe(false);
    expect(hasArgument("mysqld --datadir=/d/base --socket=/d/base.sock", "--datadir=/d/base")).toBe(true);
    expect(hasArgument("mysqld --datadir=/d/base.partiel --x", "--datadir=/d/base")).toBe(false);
  });

  it("donne à chaque compte de l'ordinateur son premier port", () => {
    expect(firstPort(501)).not.toBe(firstPort(502));
    expect(firstPort(undefined)).toBe(DESKTOP_PORT);
    for (const uid of [0, 501, 502, 1000, 65534, 4_000_000_000]) expect(Math.max(...portCandidates(firstPort(uid)))).toBeLessThan(49152);
  });

  it("ne passe à la base et au serveur que ce qu'il faut pour tourner", () => {
    expect(inheritedEnv({ PATH: "/usr/bin", HOME: "/Users/alex", MYSQL_PWD: "x", NODE_OPTIONS: "--inspect", LD_PRELOAD: "x", DYLD_INSERT_LIBRARIES: "x" })).toEqual({ PATH: "/usr/bin", HOME: "/Users/alex" });
  });
});

describe("superviseur", () => {
  const script = read("scripts/bureau.mjs");

  it("est livré avec l'archive, avec les règles qu'il lit", () => {
    const paquet = read("scripts/paquet.mjs");
    expect(paquet).toMatch(/const SCRIPTS = \[[^\]]*"bureau\.mjs"/);
    for (const file of [...script.matchAll(/from "\.\.\/src\/lib\/([\w-]+\.ts)"/g)].map((m) => m[1])) expect(paquet, `${file} : à copier dans l'archive`).toContain(`"${file}"`);
  });

  it("n'importe que des règles que Node lit telles quelles (syntaxe effaçable)", () => {
    for (const file of ["src/lib/desktop.ts", "src/lib/settings-file.ts"]) expect(read(file), file).not.toMatch(/^\s*(export\s+)?(enum|namespace)\s/m);
  });
});

describe("fabrication de l'appli", () => {
  const pieces = JSON.parse(read("bureau/pieces.json")) as Record<string, { version: string; url: string; sha256: string; racine: string; fichiers: string[] }>;
  const conf = JSON.parse(read("bureau/src-tauri/tauri.conf.json")) as { identifier: string; app: { withGlobalTauri?: boolean; security: { csp: string; capabilities?: unknown[] } }; bundle: { resources: Record<string, string>; macOS: { signingIdentity: string } }; plugins: { updater: { pubkey: string; endpoints: string[]; dangerousInsecureTransportProtocol?: boolean; requireSignedVersion?: boolean } } };

  it("n'embarque que des pièces prises chez leur éditeur, en https, épinglées par leur empreinte", () => {
    expect(Object.keys(pieces).sort()).toEqual(["mysql", "node"]);
    expect(new URL(pieces.node.url).origin).toBe("https://nodejs.org");
    expect(new URL(pieces.mysql.url).origin).toBe("https://cdn.mysql.com");
    for (const [name, p] of Object.entries(pieces)) {
      expect(p.sha256, name).toMatch(/^[0-9a-f]{64}$/);
      expect(p.url, name).toContain(p.version);
      expect(p.url, name).toContain("arm64");
      for (const f of p.fichiers) expect(f.startsWith("/") || f.includes(".."), `${name} ${f}`).toBe(false);
    }
    // Le Node de l'appli suffit à Pécule, et MySQL reste une version que Pécule annonce (8 ou plus récent).
    const need = Number(/(\d+)/.exec((JSON.parse(read("package.json")) as { engines: { node: string } }).engines.node)?.[1]);
    expect(Number(pieces.node.version.split(".")[0])).toBeGreaterThanOrEqual(need);
    expect(Number(pieces.mysql.version.split(".")[0])).toBeGreaterThanOrEqual(8);
    expect(pieces.mysql.fichiers).toContain("bin/mysqld");
    expect(pieces.mysql.fichiers).toContain("LICENSE");
  });

  it("garde l'identité de l'appli : en changer orphelinerait la session et les réglages gardés par la fenêtre", () => {
    expect(conf.identifier).toBe("org.pecule.bureau");
  });

  it("ne donne aucun pouvoir à la page : ni API de Tauri, ni permission déclarée", () => {
    expect(conf.app.withGlobalTauri ?? false).toBe(false);
    expect(conf.app.security.capabilities ?? []).toEqual([]);
    expect(conf.app.security.csp).toContain("default-src 'self'");
    expect(() => read("bureau/src-tauri/capabilities/default.json")).toThrow();
  });

  it("ne cherche ses mises à jour qu'en https, sur la page des versions, signées par la clé du projet", () => {
    expect(conf.plugins.updater.endpoints).toEqual(["https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule-mac.json"]);
    expect(conf.plugins.updater.dangerousInsecureTransportProtocol ?? false).toBe(false);
    expect(conf.plugins.updater.pubkey.length).toBeGreaterThan(80);
    // La signature couvre la version : une archive ancienne annoncée comme nouvelle est refusée.
    expect(conf.plugins.updater.requireSignedVersion).toBe(true);
    expect(read("bureau/fabriquer.mjs")).toContain('"--app-version", pkg.version');
  });

  it("range Node, MySQL et Pécule là où le superviseur et la coque les cherchent", () => {
    expect(conf.bundle.resources).toMatchObject({ "ressources/node": "node", "ressources/mysql": "mysql", "ressources/pecule": "appli" });
    const shell = read("bureau/src-tauri/src/main.rs");
    for (const dir of ['join("node")', 'join("mysql")', 'join("appli")']) expect(shell).toContain(dir);
    // Le superviseur cherche MySQL à côté du dossier de Pécule.
    expect(read("scripts/bureau.mjs")).toContain('path.join(ROOT, "..", "mysql")');
  });

  it("laisse aux pages leurs vraies confirmations : aucune extension ne remplace confirm() par une promesse", () => {
    const cargo = read("bureau/src-tauri/Cargo.toml");
    // tauri-plugin-dialog remplace `window.confirm` par une fonction asynchrone dans chaque page : « if (!confirm(…)) »
    // n'arrêterait plus rien. Les dialogues sont ceux de la coque (src/dialogues.rs).
    expect(cargo).not.toContain("tauri-plugin-dialog");
    // Et pas d'« instance unique » par un socket du dossier temporaire, que tout compte de la machine peut prendre.
    expect(cargo).not.toContain("tauri-plugin-single-instance");
    expect(read("bureau/src-tauri/src/dialogues.rs")).toContain("runJavaScriptConfirmPanelWithMessage");
  });

  it("la clé qui signe les mises à jour ne va que sur une machine qui n'a rien compilé, pour une version", () => {
    const publication = read(".github/workflows/publication.yml");
    const signing = publication.slice(publication.indexOf("\n  signature:"), publication.indexOf("\n  publication:"));
    // Un secret d'environnement ne se lit que d'une étape du flux appelant : la signature n'est pas dans le flux appelé.
    expect(signing).toContain("environment: publication");
    expect(signing).toContain("pnpm install --frozen-lockfile --ignore-scripts");
    expect(signing).toContain("needs: bureau");
    expect(publication).toMatch(/\n  publication:\n    needs: signature\n/);
    expect(publication.replace(signing, "")).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(read(".github/workflows/bureau.yml")).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
  });

  it("montre au démarrage le logo de l'appli", () => {
    expect(read("bureau/src-tauri/demarrage/logo.svg")).toBe(read("public/icons/icon.svg"));
  });
});

