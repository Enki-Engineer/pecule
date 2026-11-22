import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_REPO } from "./version.ts";

/*
 * L'installateur du paquet npm (`scripts/pecule.mjs`) : joué pour de vrai, contre une petite archive servie par un
 * serveur local à la place de GitHub (`--depuis`). Ce qu'il promet : une archive dont l'empreinte est contrôlée,
 * dépliée dans un dossier vide, et rien de laissé derrière lui quand il renonce.
 */

const LAUNCHER = path.resolve("scripts/pecule.mjs");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string; engines: { node: string } };

type Result = { code: number; stdout: string; stderr: string; json: Record<string, unknown> | null };

/** Lance l'installateur sans bloquer le serveur local du test. */
function launch(args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve) => {
    execFile(process.execPath, [LAUNCHER, ...args], { cwd, env: { PATH: process.env.PATH ?? "" } }, (error, stdout, stderr) => {
      let json: Record<string, unknown> | null = null;
      try {
        json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Record<string, unknown>;
      } catch {
        // Sortie écrite pour un humain.
      }
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr, json });
    });
  });
}

let root: string;
let server: Server;
let good: string;
let tampered: string;

/** Une archive qui a la forme de celle d'une version : `pecule/package.json` et `pecule/dist/server.mjs`. */
function makeRelease(dir: string, opts: { sums?: "justes" | "fausses"; node?: string } = {}) {
  const stage = path.join(dir, "pecule");
  mkdirSync(path.join(stage, "dist"), { recursive: true });
  mkdirSync(path.join(stage, "scripts"), { recursive: true });
  writeFileSync(path.join(stage, "package.json"), JSON.stringify({ name: "pecule", version: pkg.version, engines: { node: opts.node ?? ">=24.0.0" } }));
  writeFileSync(path.join(stage, "dist", "server.mjs"), "// serveur\n");
  // Un faux « setup » : il dit ce qu'il a reçu, comme le vrai avec --json.
  writeFileSync(path.join(stage, "scripts", "setup.mjs"), 'console.log(JSON.stringify({ ok: true, recu: process.argv.slice(2) }));\n');
  expect(spawnSync("tar", ["-czf", "pecule.tar.gz", "pecule"], { cwd: dir }).status).toBe(0);
  rmSync(stage, { recursive: true });
  const sum = createHash("sha256").update(readFileSync(path.join(dir, "pecule.tar.gz"))).digest("hex");
  writeFileSync(path.join(dir, "SHA256SUMS"), `${opts.sums === "fausses" ? "0".repeat(64) : sum}  pecule.tar.gz\n`);
}

beforeAll(async () => {
  // Chemin réel : sur macOS le dossier temporaire est un lien, et l'installateur rend le dossier où il a écrit.
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "pecule-npm-")));
  for (const name of ["juste", "abimee", "vieux-node"]) mkdirSync(path.join(root, "versions", name), { recursive: true });
  makeRelease(path.join(root, "versions", "juste"));
  makeRelease(path.join(root, "versions", "abimee"), { sums: "fausses" });
  makeRelease(path.join(root, "versions", "vieux-node"), { node: ">=99.0.0" });
  server = createServer((req, res) => {
    const file = path.join(root, "versions", path.normalize(req.url ?? "/"));
    if (!file.startsWith(path.join(root, "versions")) || !existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200).end(readFileSync(file));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  good = `${base}/juste`;
  tampered = `${base}/abimee`;
});

afterAll(() => {
  server?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

const work = (name: string) => {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe("installateur du paquet npm", () => {
  it("déplie l'archive de la version dans le dossier, empreinte contrôlée, sans rien laisser à côté", async () => {
    const cwd = work("a");
    const r = await launch(["--depuis", good, "--json"], cwd);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json).toMatchObject({ ok: true, version: pkg.version, dir: path.join(cwd, "pecule"), checked: true, setup: null });
    expect(r.json?.next).toEqual(['node scripts/setup.mjs --base "mysql://utilisateur:motdepasse@127.0.0.1:3306/pecule"', "node dist/server.mjs", "node scripts/lien.mjs"]);
    expect(existsSync(path.join(cwd, "pecule", "dist", "server.mjs"))).toBe(true);
    expect(readdirSync(cwd)).toEqual(["pecule"]);
  });

  it("refuse une archive dont l'empreinte n'est pas celle de la version, et ne laisse rien", async () => {
    const cwd = work("b");
    const r = await launch(["--depuis", tampered, "--json"], cwd);
    expect(r.code).toBe(1);
    expect(r.json).toMatchObject({ ok: false });
    expect(String(r.json?.error)).toMatch(/empreinte/);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("dit qu'une version n'est pas publiée, et ne laisse rien", async () => {
    const cwd = work("c");
    const r = await launch(["--depuis", `${good}-absente`, "--json"], cwd);
    expect(r.code).toBe(1);
    expect(String(r.json?.error)).toMatch(/n'a pas pu être téléchargée/);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("prend une archive déjà téléchargée, sans réseau, et règle l'installation si la base est donnée", async () => {
    const cwd = work("d");
    const r = await launch(["ici", "--archive", path.join(root, "versions", "juste", "pecule.tar.gz"), "--base", "mysql://alex:secret@127.0.0.1:3306/pecule", "--port", "3100", "--json"], cwd);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json).toMatchObject({ ok: true, checked: true, setup: { ok: true, recu: ["--base", "mysql://alex:secret@127.0.0.1:3306/pecule", "--port", "3100", "--json"] } });
    expect(r.json?.next).toEqual(["node dist/server.mjs", "node scripts/lien.mjs"]);
    expect(readdirSync(cwd)).toEqual(["ici"]);
  });

  it("ne touche ni à une installation déjà là, ni à un dossier qui n'est pas vide", async () => {
    const cwd = work("e");
    expect((await launch(["--depuis", good, "--json"], cwd)).code).toBe(0);
    // Le mot « installer », que demandait la première forme de la commande, reste admis en tête.
    const again = await launch(["installer", "--depuis", good, "--json"], cwd);
    expect(again.code).toBe(1);
    expect(String(again.json?.error)).toMatch(/déjà installé.*node scripts\/maj\.mjs/);
    mkdirSync(path.join(cwd, "autre"));
    writeFileSync(path.join(cwd, "autre", "notes.txt"), "à moi");
    const busy = await launch(["autre", "--depuis", good, "--json"], cwd);
    expect(busy.code).toBe(1);
    expect(String(busy.json?.error)).toMatch(/n'est pas vide/);
    expect(readdirSync(path.join(cwd, "autre"))).toEqual(["notes.txt"]);
  });

  it("refuse une version qui demande un Node plus récent que celui de la machine", async () => {
    const cwd = work("f");
    const r = await launch(["--depuis", good.replace("/juste", "/vieux-node"), "--json"], cwd);
    expect(r.code).toBe(1);
    expect(String(r.json?.error)).toMatch(/demande Node 99/);
    expect(readdirSync(cwd)).toEqual([]);
  });

  it("dit non à ce qu'il ne connaît pas, et son aide nomme la commande", async () => {
    const cwd = work("g");
    expect(String((await launch(["--force", "--json"], cwd)).json?.error)).toMatch(/Option inconnue/);
    const help = await launch(["--help"], cwd);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("npm create pecule");
    expect(help.stdout).toContain("npx create-pecule");
    expect((await launch(["--version"], cwd)).stdout.trim()).toBe(pkg.version);
    // Suivi d'un numéro, « --version » choisit la version à installer : il ne rend pas celle de l'installateur.
    expect(String((await launch(["--version", "pas-un-numero", "--json"], cwd)).json?.error)).toMatch(/Version illisible/);
    expect(readdirSync(cwd)).toEqual([]);
  });
});

describe("paquet npm", () => {
  const launcher = readFileSync("scripts/pecule.mjs", "utf8");
  it("l'installateur et la bibliothèque qu'il emporte tournent avec Node seul", () => {
    for (const file of ["scripts/pecule.mjs", "scripts/lib/archive.mjs"]) {
      const imports = [...readFileSync(file, "utf8").matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
      for (const name of imports) expect(name.startsWith("node:") || name === "./lib/archive.mjs", `${file} importe ${name}`).toBe(true);
    }
  });
  it("connaît le dépôt des versions et le Node que demande Pécule", () => {
    expect(/const DEFAULT_REPO = "([^"]+)"/.exec(launcher)?.[1]).toBe(DEFAULT_REPO);
    expect(Number(/const NODE_MIN = (\d+)/.exec(launcher)?.[1])).toBe(Number(/(\d+)/.exec(pkg.engines.node)?.[1]));
  });
  it("le script des archives n'y met que l'installateur", () => {
    const paquet = readFileSync("scripts/paquet.mjs", "utf8");
    // « npm create pecule » lance le paquet « create-pecule », par la commande du même nom.
    expect(paquet).toContain('const NPM_NAME = "create-pecule"');
    expect(paquet).toContain('bin: { [NPM_NAME]: "scripts/pecule.mjs" }');
    expect(paquet).toContain('files: ["scripts"]');
    expect(existsSync("npm/README.md")).toBe(true);
  });
});
