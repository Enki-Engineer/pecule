import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSettings as parseForScripts, run } from "../../scripts/lib/reglages.mjs";
import { doctorCommand, linkCommand, updateCommand, versionCommand } from "./install.ts";
import { DATABASE_SECRETS, parseSettings, SECRET_NAMES } from "./settings-file.ts";
import { DOCKER_IMAGE } from "./version.ts";

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const compose = read("compose.yaml");
const dockerfile = read("Dockerfile");

/** Le bloc d'un service de compose.yaml (de son nom jusqu'au service suivant). */
function service(name: string): string {
  const start = compose.indexOf(`\n  ${name}:\n`);
  expect(start, `service « ${name} » de compose.yaml`).toBeGreaterThan(-1);
  const rest = compose.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[a-z][a-z-]*:\n|\nvolumes:\n/);
  return next < 0 ? rest : rest.slice(0, next + 3);
}

/** Les variables qu'un service reçoit : « - NOM » (lue dans .env si elle y est) ou « - NOM=valeur ». */
const passed = (block: string) => [...block.matchAll(/^ {6}- ([A-Z][A-Z0-9_]*)(=.*)?$/gm)].map((m) => ({ name: m[1], fixed: m[2] !== undefined }));

/** Les réglages que lit le serveur (clés du schéma de src/server/env.ts). */
function serverSettings(): string[] {
  const source = read("src/server/env.ts");
  const body = source.slice(source.indexOf("const schema = z.object({"), source.indexOf("const parsed = schema.safeParse"));
  return [...body.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
}

describe("commandes d'une installation", () => {
  it("Docker : tout passe par docker compose, sans rien d'autre sur la machine", () => {
    expect(linkCommand("docker")).toBe("docker compose exec pecule node scripts/lien.mjs");
    expect(doctorCommand("docker")).toBe("docker compose exec pecule node scripts/doctor.mjs");
    expect(updateCommand("docker")).toBe("docker compose pull && docker compose up -d");
    expect(versionCommand("docker", "1.40.0")).toBe(`PECULE_IMAGE=${DOCKER_IMAGE}:1.40.0 docker compose up -d`);
  });

  it("Node : les scripts livrés avec le serveur", () => {
    expect(linkCommand("node")).toBe("node scripts/lien.mjs");
    expect(doctorCommand("node")).toBe("node scripts/doctor.mjs");
    expect(updateCommand("node")).toBe("node scripts/maj.mjs");
    expect(versionCommand("node", "1.40.0")).toBe("node scripts/maj.mjs --version 1.40.0");
  });

  it("appli de bureau : aucune commande à montrer, l'appli fait le geste elle-même", () => {
    expect(linkCommand("bureau")).toBeNull();
    expect(doctorCommand("bureau")).toBeNull();
    expect(updateCommand("bureau")).toBeNull();
    expect(versionCommand("bureau", "1.40.0")).toBeNull();
  });

  it("les scripts annoncent une commande telle qu'elle se tape sur la machine", () => {
    expect(run({ inside: true, docker: true, file: null }, "node scripts/lien.mjs")).toBe(linkCommand("docker"));
    expect(run({ inside: false, docker: true, file: null }, "node scripts/lien.mjs")).toBe(linkCommand("docker"));
    // Les réglages sont dans un fichier .env de la machine : le script les lit sur place.
    expect(run({ inside: false, docker: true, file: ".env" }, "node scripts/lien.mjs")).toBe("node scripts/lien.mjs");
    expect(run({ inside: false, docker: false, file: ".env" }, "node scripts/lien.mjs")).toBe(linkCommand("node"));
  });
});

describe("compose.yaml", () => {
  // Ce que compose.yaml ou l'image fixent eux-mêmes : le port dans le conteneur et l'interface où le serveur y écoute
  // (toutes : c'est Docker qui publie le port, PECULE_BIND dit où), les adresses des deux bases (gardées avec les
  // secrets), le mode production.
  const SET_BY_INSTALL = ["NODE_ENV", "PORT", "LISTEN_HOST", "DATABASE_URL", "DEMO_DATABASE_URL"];

  it("transmet au serveur tous ses réglages, sans exiger de fichier .env", () => {
    const block = service("pecule");
    const names = passed(block).map((v) => v.name);
    for (const name of serverSettings()) if (!SET_BY_INSTALL.includes(name)) expect(names, `${name} : à ajouter à l'environnement du service « pecule » de compose.yaml`).toContain(name);
    // Un fichier .env obligatoire empêcherait « docker compose up -d » dans un dossier qui n'a que compose.yaml.
    expect(compose).not.toMatch(/^\s*env_file:/m);
    // Jamais le port du conteneur, son interface d'écoute ni une adresse de base venus de .env : les deux premiers
    // casseraient la publication du port, la dernière désignerait une base hors du réseau des conteneurs.
    for (const name of ["PORT", "LISTEN_HOST", "DATABASE_URL", "DEMO_DATABASE_URL"]) expect(names).not.toContain(name);
  });

  it("ne laisse pas .env déplacer les sauvegardes hors de leur volume", () => {
    const backup = passed(service("pecule")).find((v) => v.name === "BACKUP_DIR");
    expect(backup?.fixed).toBe(true);
    expect(service("pecule")).toContain("pecule-sauvegardes:/app/data/sauvegardes");
  });

  it("le service « reglages » reçoit tous les secrets qu'il peut reprendre d'un fichier .env", () => {
    const block = service("reglages");
    const names = passed(block).map((v) => v.name);
    for (const name of SECRET_NAMES) expect(names, `${name} : à ajouter au service « reglages »`).toContain(name);
    // Il reçoit l'adresse du démarrage telle que le serveur la reçoit, pour refuser qu'elle change en silence.
    const address = (b: string) => /^ {6}- APP_URL=(.*)$/m.exec(b)?.[1];
    expect(address(block)).toBeTruthy();
    expect(address(block)).toBe(address(service("pecule")));
    expect(block).toContain("- ADDRESS_GIVEN=${APP_URL:-}${PECULE_PORT:-}");
    // Et le volume de la base, en lecture seule : une base déjà là sans ses réglages n'en reçoit pas de nouveaux.
    expect(block).toContain("- BASE_DATA_DIR=/app/data/base\n");
    expect(block).toContain("- pecule-base:/app/data/base:ro\n");
    expect(block).toContain('command: ["node", "scripts/setup.mjs", "--conteneur"]');
    // Il écrit dans des volumes neufs, dont le propriétaire dépend de la première image qui les monte.
    expect(block).toContain('user: "0:0"');
  });

  it("l'appli et la base attendent que les réglages soient gardés", () => {
    for (const name of ["pecule", "base"]) expect(service(name)).toMatch(/depends_on:\n\s+reglages:\n\s+condition: service_completed_successfully/);
    // MariaDB lit ses mots de passe là où « reglages » les écrit.
    expect(service("reglages")).toContain("pecule-base-init:/app/data/base-init");
    expect(service("base")).toContain("pecule-base-init:/docker-entrypoint-initdb.d:ro");
    expect(service("base")).toContain(`MARIADB_PASSWORD_FILE: /docker-entrypoint-initdb.d/${DATABASE_SECRETS.DB_PASSWORD}\n`);
    expect(service("base")).toContain(`MARIADB_ROOT_PASSWORD_FILE: /docker-entrypoint-initdb.d/${DATABASE_SECRETS.DB_ROOT_PASSWORD}\n`);
    // Le serveur ne monte que ses réglages : jamais le volume qui porte les mots de passe de la base.
    expect(service("pecule")).not.toContain("pecule-base-init");
  });

  it("garde le même projet où que soit rangé le fichier", () => {
    expect(compose).toMatch(/^name: pecule$/m);
    // La base de développement a son propre projet : sinon lancer l'un remplacerait le conteneur « base » de l'autre.
    expect(read("compose.dev.yaml")).toMatch(/^name: pecule-local$/m);
  });
});

describe("image Docker", () => {
  it("emporte les commandes de l'installation et ce qu'elles lisent", () => {
    for (const file of ["scripts/setup.mjs", "scripts/doctor.mjs", "scripts/lien.mjs", "scripts/importer.mjs", "scripts/lib", "src/lib/settings-file.ts"]) expect(dockerfile, `${file} : à copier dans l'image`).toContain(`/app/${file}`);
    expect(dockerfile).toMatch(/SETTINGS_DIR=\/app\/data\/reglages/);
    // Le volume des réglages et celui de la base se montent sur des dossiers que l'image crée.
    for (const dir of ["data/sauvegardes", "data/reglages", "data/base-init"]) expect(dockerfile).toContain(dir);
  });

  it("le diagnostic et le lien se lancent sans rien d'autre que Node : aucun fichier TypeScript importé", () => {
    for (const file of ["scripts/doctor.mjs", "scripts/lien.mjs", "scripts/importer.mjs", "scripts/lib/reglages.mjs", "scripts/lib/adresse.mjs"]) expect(read(file), file).not.toMatch(/from\s+["'][^"']+\.ts["']/);
  });
});

describe("réglages lus par les scripts", () => {
  it("même lecture d'un fichier de réglages que le serveur", () => {
    const text = ["# en-tête", "APP_URL=https://pecule.exemple.fr", "  API_TOKEN = abc  ", 'SECRET_KEY="entre guillemets"', "VIDE=", "#COMMENTEE=non", "pas une ligne", "DB_PASSWORD='a=b'", "PECULE_PORT=3322"].join("\r\n");
    expect(parseForScripts(text)).toEqual(parseSettings(text));
  });
});

describe("consignes pour un agent IA", () => {
  const skill = read("skills/pecule/SKILL.md");
  const header = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
  const field = (name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(header)?.[1] ?? "";

  it("la compétence du dépôt est la copie exacte de celle qui se distribue", () => {
    expect(read(".claude/skills/pecule/SKILL.md")).toBe(skill);
  });

  it("son en-tête se lit par un lecteur YAML strict, dans les limites de la norme", () => {
    // Le nom est celui du dossier ; les installateurs (npx skills, gh skill) refusent le reste.
    expect(field("name")).toBe("pecule");
    const description = field("description");
    expect(description.length).toBeGreaterThan(40);
    expect(description.length).toBeLessThanOrEqual(1024);
    // Sur une ligne et sans guillemets : ni « : » ni « # » précédé d'une espace, qu'un lecteur strict refuse.
    expect(description).not.toMatch(/: | #|^["'>|]/);
    for (const line of header.split("\n")) expect(line, `en-tête : ${line.slice(0, 40)}`).toMatch(/^[a-z][a-z-]*: \S/);
    expect(skill.split("\n").length).toBeLessThan(500);
  });

  it("le catalogue de plugins désigne le dossier de la compétence, et lui seul", () => {
    const market = JSON.parse(read(".claude-plugin/marketplace.json")) as { name: string; plugins: { name: string; source: string }[] };
    expect(market.plugins).toHaveLength(1);
    // Tout le dossier désigné est copié chez celui qui installe le plugin : jamais la racine du dépôt.
    expect(market.plugins[0]).toMatchObject({ name: "pecule", source: "./skills" });
    const plugin = JSON.parse(read("skills/.claude-plugin/plugin.json")) as { name: string; skills: string };
    expect(plugin).toMatchObject({ name: "pecule", skills: "./" });
  });

  it("AGENTS.md reste lisible d'un trait par tout agent, et donne les commandes de l'installation", () => {
    const agents = read("AGENTS.md");
    // Plusieurs agents coupent un fichier de consignes trop long (24 000 octets pour le plus strict).
    expect(Buffer.byteLength(agents, "utf8")).toBeLessThan(20_000);
    expect(agents.split("\n").length).toBeLessThan(200);
    // Un agent n'a pas de terminal interactif : ses commandes dans le conteneur portent « -T ».
    const forAgent = (command: string) => command.replace("docker compose exec pecule", "docker compose exec -T pecule");
    for (const command of [forAgent(linkCommand("docker") ?? ""), forAgent(doctorCommand("docker") ?? ""), updateCommand("docker") ?? "", "node scripts/lien.mjs", "node scripts/doctor.mjs", "node scripts/maj.mjs"]) expect(agents, command).toContain(command);
    expect(agents).not.toMatch(/docker compose exec (?!-T )/);
    // Les adresses stables des pièces jointes d'une version, et celle des consignes elles-mêmes.
    for (const url of ["releases/latest/download/compose.yaml", "releases/latest/download/pecule.tar.gz", "raw.githubusercontent.com/Enki-Engineer/pecule/stable/AGENTS.md"]) expect(agents, url).toContain(url);
    for (const file of ["README.md", "README.fr.md", "docs/guide/installer-avec-une-ia.md", "skills/pecule/SKILL.md"]) expect(read(file), file).toContain("raw.githubusercontent.com/Enki-Engineer/pecule/stable/AGENTS.md");
  });
});
