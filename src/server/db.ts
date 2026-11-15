import { readdirSync, readFileSync, existsSync } from "node:fs";
import { alreadyDone } from "./migrate-rules.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type Pool, type PoolOptions } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "./db/schema/index.ts";
import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { env } from "./env.ts";
import { isDemo } from "./demo-context.ts";
import { schemaStatements } from "./backup-format.ts";

const options: PoolOptions = {
  connectionLimit: 5,
  // Les DECIMAL reviennent en chaînes : on les convertit à la lecture.
  decimalNumbers: true,
  dateStrings: true,
  timezone: "Z",
  charset: "utf8mb4",
  enableKeepAlive: true,
};
const realPool = mysql.createPool({ ...options, uri: env.DATABASE_URL });
const demoPool = env.DEMO_DATABASE_URL ? mysql.createPool({ ...options, uri: env.DEMO_DATABASE_URL, connectionLimit: 3 }) : null;

/** Mode démo disponible (base de données fictives configurée). */
export const demoEnabled = demoPool !== null;

/** Base de la requête en cours : celle de démo dans une session démo, sinon la vraie. Jamais de repli. */
function currentPool(): Pool {
  if (!isDemo()) return realPool;
  if (!demoPool) throw new Error("Mode démo sans base de démo (DEMO_DATABASE_URL absente)");
  return demoPool;
}

/**
 * Pool « aiguilleur » : chaque appel (query, getConnection…) part vers la base du contexte courant
 * (voir demo-context.ts). Tout le code existant (q/one/exec, Drizzle, verrous) en profite.
 */
export const pool: Pool = new Proxy(realPool, {
  get(_target, prop) {
    const p = currentPool();
    const v = Reflect.get(p, prop, p) as unknown;
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(p) : v;
  },
});

/** Ferme les connexions (arrêt du serveur). */
export const endPools = () => Promise.all([realPool.end(), demoPool?.end()]);

export async function q<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function one<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(sql, params))[0];
}

export async function exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await pool.query<ResultSetHeader>(sql, params);
  return res;
}

/** Exécute fn sous un verrou MySQL nommé ; renvoie null si le verrou est déjà pris. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS ok", [name]);
    if (!rows[0]?.ok) return null;
    // Le wait_timeout de MariaDB est court chez certains hébergeurs : on garde la connexion vivante.
    const keepAlive = setInterval(() => conn.query("SELECT 1").catch(() => {}), 5000);
    try {
      return await fn();
    } finally {
      clearInterval(keepAlive);
      await conn.query("SELECT RELEASE_LOCK(?)", [name]).catch(() => {});
    }
  } finally {
    conn.release();
  }
}

/** Client Drizzle (schéma typé) sur le même pool ; q/one/exec restent pour le SQL écrit à la main. */
export const db = drizzle(pool, { schema, mode: "default" });

const here = path.dirname(fileURLToPath(import.meta.url));

/** Premier dossier existant : en prod à côté de dist/server.mjs, en dev à la racine du dépôt ou sous src/server. */
function findDir(candidates: string[]): string | null {
  return candidates.map((c) => path.join(here, c)).find((d) => existsSync(d)) ?? null;
}

/**
 * Migrations dans l'ordre : d'abord les fichiers SQL historiques (001 à 007, écrits à la main),
 * puis celles générées par Drizzle (drizzle/NNNN_nom.sql, instructions séparées par
 * « --> statement-breakpoint »). La 0000 (baseline) décrit la base créée par 001 à 007 : elle est
 * notée comme appliquée sans être exécutée.
 */
export function migrationFiles(): { name: string; statements: string[]; skip: boolean }[] {
  // Fichiers historiques : absents d'un dépôt dont l'histoire est repliée dans le schéma de départ (voir `foldedMigrations`).
  const legacy = findDir(["migrations", "src/server/migrations"]);
  const out = !legacy
    ? []
    : readdirSync(legacy)
        .filter((f) => f.endsWith(".sql"))
        .sort()
        .map((f) => ({
          name: f,
          skip: false,
          statements: readFileSync(path.join(legacy, f), "utf8")
            .split(/;\s*$/m)
            .map((s) => s.trim())
            .filter((s) => s && !s.split("\n").every((l) => l.trim().startsWith("--") || !l.trim())),
        }));
  const generated = findDir(["drizzle", "../../drizzle"]);
  if (!legacy && !generated) throw new Error("Dossier des migrations introuvable");
  if (generated)
    for (const f of readdirSync(generated).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort())
      out.push({
        name: `drizzle/${f}`,
        skip: f.startsWith("0000_"),
        statements: readFileSync(path.join(generated, f), "utf8")
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean),
      });
  return out;
}

/**
 * Schéma de départ d'une installation neuve (`drizzle/initial/schema.sql`, écrit par `pnpm db:initial`) : la
 * structure complète en un fichier, et le nom de la dernière migration qu'il contient déjà.
 */
export function initialSchema(): { upTo: string; statements: string[] } | null {
  const dir = findDir(["drizzle/initial", "../../drizzle/initial"]);
  const file = dir && path.join(dir, "schema.sql");
  if (!file || !existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const upTo = /^-- inclut-jusqu-a: (.+)$/m.exec(text)?.[1]?.trim();
  return upTo ? { upTo, statements: schemaStatements(text) } : null;
}

/**
 * Migrations repliées dans le schéma de départ et dont les fichiers ne sont plus dans le dépôt
 * (`drizzle/initial/incluses.txt`, un nom par ligne, dans l'ordre). Une base neuve les note comme faites ; une base
 * existante doit les avoir toutes appliquées — sinon elle est trop ancienne pour cette version du code.
 */
export function foldedMigrations(): string[] {
  const dir = findDir(["drizzle/initial", "../../drizzle/initial"]);
  const file = dir && path.join(dir, "incluses.txt");
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

/**
 * Applique les migrations dans l'ordre, une seule fois chacune, sous verrou MySQL. Une base vide reçoit d'abord
 * le schéma de départ (toute la structure d'un coup), et les migrations qu'il contient déjà sont notées faites.
 */
export async function migrate(lockName = "pecule:migrate"): Promise<string[]> {
  const applied: string[] = [];
  const result = await withLock(lockName, async () => {
    await exec(`CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(190) PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    const done = new Set((await q<{ name: string }>("SELECT name FROM _migrations")).map((r) => r.name));
    const files = migrationFiles();
    const folded = foldedMigrations();
    const initial = process.env.PECULE_SANS_SCHEMA_DE_DEPART ? null : initialSchema();
    if (done.size) {
      const missing = folded.filter((name) => !done.has(name));
      if (missing.length) throw new Error(`Cette base est antérieure à cette version de Pécule (${missing.length} migrations repliées n'y ont pas été appliquées, dont ${missing[0]}) : la mettre d'abord à jour avec la version précédente.`);
    }
    if (!done.size && initial && (files.some((m) => m.name === initial.upTo) || folded.includes(initial.upTo))) {
      const [empty] = await q<{ n: number }>("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name <> '_migrations'");
      if (Number(empty.n) === 0) {
        // Une seule connexion : les réglages du fichier (clés étrangères suspendues) valent pour toutes ses instructions.
        const conn = await pool.getConnection();
        try {
          for (const sql of initial.statements) await conn.query(sql);
        } finally {
          // Cette connexion porte les réglages du fichier (clés suspendues, mode SQL) : elle ne retourne pas dans la réserve.
          conn.destroy();
        }
        // Tout ce que le schéma de départ contient est noté fait : les migrations repliées, puis les fichiers jusqu'à la sienne.
        const included = [...folded];
        if (!folded.includes(initial.upTo))
          for (const m of files) {
            if (!included.includes(m.name)) included.push(m.name);
            if (m.name === initial.upTo) break;
          }
        for (const name of included) {
          await exec("INSERT IGNORE INTO _migrations (name) VALUES (?)", [name]);
          done.add(name);
        }
        applied.push(`schéma de départ (jusqu'à ${initial.upTo})`);
      }
    }
    for (const m of files) {
      if (done.has(m.name)) continue;
      if (!m.skip)
        for (const sql of m.statements) {
          try {
            await exec(sql);
          } catch (e) {
            // Migration interrompue à un démarrage précédent : cette instruction avait déjà produit son effet.
            if (!alreadyDone(e)) throw e;
            console.warn(`[db] ${m.name} : instruction déjà appliquée, reprise (${e instanceof Error ? e.message : String(e)})`);
          }
        }
      await exec("INSERT INTO _migrations (name) VALUES (?)", [m.name]);
      applied.push(m.skip ? `${m.name} (référence, non exécutée)` : m.name);
    }
    return applied;
  });
  if (result === null) throw new Error("Migrations déjà en cours dans un autre processus");
  return applied;
}
