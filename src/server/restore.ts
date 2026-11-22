import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, rmSync, statSync } from "node:fs";
import { appendFile, open, statfs } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { AgeError, decryptStream, looksEncrypted } from "./age.ts";
import path from "node:path";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { env, rpID, sealingSecret } from "./env.ts";
import { foldedMigrations, migrationFiles, one, pool, q } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { createEnrollmentLink, safeEqual } from "./auth.ts";
import { checkPacketSize, PacketTooSmall, restoreBackup, verifyBackup, type VerifiedBackup } from "./backup.ts";
import type { BackupManifest } from "./backup-format.ts";
import { logAudit } from "./journal.ts";
import { setRestoring } from "./maintenance.ts";
import { forgetVapidKeys } from "./notify.ts";
import { archivePath, backupDir, ensurePrivateDir, listArchives } from "./archives.ts";
import { createSealer } from "./secret.ts";
import { DEPUIS } from "./version.ts";
import { fileSource, ZipError, type ZipSource } from "./zip.ts";
import { archiveCompatibility, chunkPlacement, RESTORE_CHUNK, type RestoreReport, type RestoreStage, type RestoreStatus, type SealedKind, type ServerArchive } from "../lib/restore.ts";
import { t, tk } from "../lib/i18n.ts";

/*
 * Restaurer une sauvegarde à l'installation. Tant qu'une installation n'a aucun membre ni aucune donnée, l'écran
 * « Bienvenue dans Pécule » propose, à côté de « Créer le foyer », de reprendre une sauvegarde complète : celui qui
 * installe donne le code d'installation (le même que pour créer le premier membre), envoie son archive par morceaux —
 * ou en choisit une déjà présente dans le dossier des sauvegardes du serveur — et Pécule la recharge.
 *
 * Garde-fous :
 * - seulement dans une installation neuve (aucun membre, compte, opération, facture ni document) : rien ne peut être
 *   écrasé. Revenir à une sauvegarde sur une installation en service reste une affaire de ligne de commande
 *   (`pnpm restaurer`, dans une base vide) ;
 * - l'archive est relue en entier (tailles, empreintes) et sa version contrôlée avant que la base soit touchée ;
 * - un témoin (la table `_restauration_en_cours`) est posé le temps du chargement : si le serveur s'arrête au milieu,
 *   le démarrage suivant le trouve et remet la base à neuf (`cleanInterruptedRestore`) au lieu de démarrer sur une
 *   base à moitié chargée ;
 * - pendant le chargement, Pécule est en maintenance (comme pendant une migration) ; les migrations plus récentes que
 *   l'archive s'appliquent ensuite, au redémarrage du service.
 *
 * Un seul processus, une seule restauration à la fois : l'état vit en mémoire. Toujours la vraie base, jamais la démo.
 */

/** Table témoin d'une restauration en cours. */
const MARKER = "_restauration_en_cours";
const LOCK = "pecule:restauration";
const SESSION_MS = 6 * 3_600_000;
/** Une fois la restauration finie, sa session (et son rapport) ne vaut plus que ce temps-là. */
const REPORT_MS = 30 * 60_000;
/** Marge de disque libre exigée en plus de la taille de l'archive envoyée. */
const MARGIN = 64 * 1_048_576;
const MAX_ARCHIVE = 20 * 1024 * 1_048_576;

/** Ce que le démarrage du serveur (`src/server/index.ts`) prête à la restauration. */
export type RestoreHooks = {
  /** Le serveur a fini de démarrer. */
  ready(): boolean;
  /** Met Pécule en maintenance (les requêtes attendent, puis reçoivent « Pécule démarre… »). */
  pause(): void;
  /** Relance le démarrage (migrations, réglages en mémoire) ; `restored` : sur une base qui vient d'être restaurée. */
  resume(opts: { restored: boolean }): Promise<{ applied: string[] } | { error: string }>;
};

type FailureCode = "cle-requise" | "cle-refusee" | "place" | "pas-une-sauvegarde" | "abimee" | "trop-recente" | "trop-ancienne" | "pas-neuve" | "paquet" | "occupee" | "demarrage" | "interne";
type Failure = { code: FailureCode; detail?: string };

class Refused extends Error {
  constructor(readonly failure: Failure) {
    super(failure.detail ?? failure.code);
  }
}

type Job = { stage: RestoreStage; fait: number; total: number; failure: Failure | null; report: RestoreReport | null };
type Upload = { file: string; size: number; total: number; busy: boolean };
type Session = { hash: string; expires: number; upload: Upload | null; job: Job | null };

let session: Session | null = null;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const uploadDir = () => path.join(backupDir(), "restauration");
const running = () => !!session?.job && session.job.stage !== "termine" && session.job.stage !== "echec";

/** Une installation neuve : personne, et rien de ce qu'un foyer y aurait mis. */
async function freshInstall(conn?: PoolConnection): Promise<boolean> {
  const sql =
    "SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM accounts) + (SELECT COUNT(*) FROM transactions) + (SELECT COUNT(*) FROM invoices) + (SELECT COUNT(*) FROM documents) AS n";
  const row = conn ? (await conn.query<RowDataPacket[]>(sql))[0][0] : await runReal(() => one<{ n: number }>(sql));
  return Number(row?.n ?? 1) === 0;
}

/** Vide la base de la connexion (tables et vues), sauf `keep`. Refuse toute autre base que celle de Pécule. */
async function dropAll(conn: PoolConnection, keep: string[]) {
  const expected = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
  const demo = env.DEMO_DATABASE_URL ? decodeURIComponent(new URL(env.DEMO_DATABASE_URL).pathname.slice(1)) : null;
  const [[row]] = await conn.query<RowDataPacket[]>("SELECT DATABASE() AS db");
  const current = row?.db as string | null;
  if (!current || current !== expected || current === demo) throw new Error(`Remise à neuf refusée : ${current ?? "aucune base"} n'est pas la base de Pécule`);
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  const [views] = await conn.query<RowDataPacket[]>("SELECT TABLE_NAME AS t FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()");
  for (const v of views) await conn.query(`DROP VIEW IF EXISTS \`${String(v.t)}\``);
  const [tables] = await conn.query<RowDataPacket[]>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
  for (const tbl of tables) if (!keep.includes(String(tbl.t))) await conn.query(`DROP TABLE IF EXISTS \`${String(tbl.t)}\``);
}

const takeLock = async (conn: PoolConnection) => Boolean((await conn.query<RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS ok", [LOCK]))[0][0]?.ok);

/**
 * Au démarrage, avant les migrations : une restauration coupée par l'arrêt du serveur a laissé son témoin et une base
 * à moitié chargée. Elle ne peut venir que d'une installation neuve : la base est remise à neuf, et le démarrage la
 * recrée. Renvoie vrai si c'était le cas.
 */
export async function cleanInterruptedRestore(): Promise<boolean> {
  const marker = await runReal(() => one("SELECT 1 AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [MARKER]));
  if (!marker) return false;
  const conn = await runReal(() => pool.getConnection());
  try {
    // Le verrou est tenu par le processus qui restaure : s'il est pris, ce n'est pas une restauration coupée.
    if (!(await takeLock(conn))) throw new Error("Restauration d'une sauvegarde déjà en cours dans un autre processus");
    // Relu sous le verrou : un autre processus a pu faire ce ménage entre-temps, et recrée peut-être déjà la base.
    const [[still]] = await conn.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [MARKER]);
    if (!Number(still?.n)) return false;
    await dropAll(conn, []);
  } finally {
    // La connexion porte le verrou et des réglages de session : elle ne retourne pas dans la réserve.
    conn.destroy();
  }
  return true;
}

/** Au démarrage : restes d'un envoi abandonné ou d'un déchiffrement coupé par l'arrêt du serveur (aucune session n'y survit). */
export function cleanRestoreLeftovers() {
  rmSync(uploadDir(), { recursive: true, force: true });
}

/** Archives du dossier des sauvegardes du serveur proposées à la restauration, la plus récente d'abord. */
const offered = (): ServerArchive[] => listArchives().slice(0, 30).map((a) => ({ nom: a.name, octets: a.octets, at: a.at }));

const SEALED = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*$/;
const SEALED_KEYS: Record<string, SealedKind> = { "ai:config": "ia", "bank:enablebanking": "banque", "services:keys": "services", vapid: "notifications", "sauvegarde:destination": "stockage" };

/** Vrai si la valeur porte une clé chiffrée que le secret de ce serveur n'ouvre pas. */
function hasUnreadable(value: unknown, open: (sealed: string) => string | null, depth = 0): boolean {
  if (typeof value === "string") return SEALED.test(value) && open(value) === null;
  if (!value || typeof value !== "object" || depth > 6) return false;
  return Object.values(value as Record<string, unknown>).some((v) => hasUnreadable(v, open, depth + 1));
}

/** Clés gardées en base que ce serveur ne sait pas lire (son secret n'est pas celui du serveur d'origine). */
async function unreadableKeys(): Promise<SealedKind[]> {
  const { open } = createSealer(sealingSecret);
  const rows = await runReal(() => q<{ key: string; value: string }>("SELECT `key`, value FROM app_kv WHERE `key` IN (?)", [Object.keys(SEALED_KEYS)]));
  const out: SealedKind[] = [];
  for (const r of rows) {
    try {
      if (hasUnreadable(JSON.parse(r.value), open)) out.push(SEALED_KEYS[r.key]);
    } catch {
      // Valeur illisible : rien à en dire ici.
    }
  }
  return out;
}

async function buildReport(manifest: BackupManifest, migrations: number): Promise<RestoreReport> {
  const lines = (table: string) => manifest.tables.find((x) => x.nom === table)?.lignes ?? 0;
  const members = await runReal(() => q<{ id: number; name: string; role: string }>("SELECT id, name, role FROM users ORDER BY id"));
  const membres: RestoreReport["membres"] = [];
  // Un administrateur reçoit un lien d'inscription : si sa clé d'accès ne vaut pas ici (autre adresse, appareil perdu), il en
  // crée une. Sans administrateur dans la sauvegarde, le premier membre le reçoit : personne ne doit rester à la porte.
  const linked = members.some((m) => m.role === "admin") ? members.filter((m) => m.role === "admin") : members.slice(0, 1);
  for (const m of members) membres.push({ nom: m.name, admin: m.role === "admin", lien: linked.includes(m) ? await runReal(() => createEnrollmentLink(m.id)) : null });
  return {
    sauvegardeDu: manifest.creeLe,
    operations: lines("transactions"),
    factures: lines("invoices"),
    documents: lines("documents"),
    lignes: manifest.totaux.lignes,
    migrations,
    adresseChangee: manifest.origine ? manifest.origine !== rpID : null,
    sauvegardesEnPause: false,
    clesIllisibles: await unreadableKeys(),
    membres,
  };
}

const message = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e)).slice(0, 300);

/**
 * Coupe les sauvegardes automatiques de la base qui vient d'être restaurée, et oublie leur état (il décrit le serveur
 * d'origine). Rend vrai si elles étaient actives.
 */
async function pauseAutoBackups(conn: PoolConnection): Promise<boolean> {
  const [rows] = await conn.query<RowDataPacket[]>("SELECT value FROM app_kv WHERE `key` = 'sauvegarde:reglages'");
  await conn.query("DELETE FROM app_kv WHERE `key` = 'sauvegarde:etat'");
  let settings: Record<string, unknown> | null = null;
  try {
    settings = rows[0] ? (JSON.parse(String(rows[0].value)) as Record<string, unknown>) : null;
  } catch {
    settings = null;
  }
  if (!settings || settings.auto !== true) return false;
  await conn.query("UPDATE app_kv SET value = ? WHERE `key` = 'sauvegarde:reglages'", [JSON.stringify({ ...settings, auto: false })]);
  return true;
}

/** Les premiers octets d'un fichier. */
async function head(file: string, length: number): Promise<Buffer> {
  const fd = await open(file, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fd.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

/**
 * Une archive chiffrée (« .zip.age », copie hors du serveur ou téléchargement chiffré) est d'abord déchiffrée à côté
 * d'elle, avec la clé de récupération donnée à l'écran — qui ne sert qu'à cela et n'est gardée nulle part. Rend le
 * chemin de l'archive en clair, ou `null` si le fichier n'était pas chiffré.
 */
async function decrypted(file: string, cle: string | undefined): Promise<string | null> {
  if (!looksEncrypted(await head(file, 64))) return null;
  if (!cle?.trim()) throw new Refused({ code: "cle-requise" });
  const dir = uploadDir();
  ensurePrivateDir(dir);
  const disk = await statfs(dir);
  if (Number(disk.bavail) * Number(disk.bsize) < statSync(file).size + MARGIN) throw new Refused({ code: "place" });
  const clear = path.join(dir, `clair-${randomBytes(6).toString("hex")}.zip`);
  try {
    // Le déchiffrement d'abord : une clé mal recopiée est refusée avant qu'un fichier soit ouvert.
    const opener = decryptStream(cle);
    await pipeline(createReadStream(file), opener, createWriteStream(clear, { mode: 0o600 }));
  } catch (e) {
    rmSync(clear, { force: true });
    if (e instanceof AgeError) throw new Refused({ code: /n'ouvre pas|invalide/.test(e.message) ? "cle-refusee" : "abimee", detail: e.message });
    throw e;
  }
  return clear;
}

/** La clé de récupération manque ou n'ouvre pas l'archive : l'archive envoyée est gardée, il suffit de redonner la clé. */
const keyProblem = (f: Failure | null) => f?.code === "cle-requise" || f?.code === "cle-refusee";

async function run(job: Job, file: string, uploaded: boolean, hooks: RestoreHooks, cle?: string) {
  let src: ZipSource | null = null;
  let clear: string | null = null;
  let conn: PoolConnection | null = null;
  let keepAlive: NodeJS.Timeout | null = null;
  let paused = false;
  let restored = false;
  let autoPaused = false;
  let manifest: BackupManifest | null = null;
  const started = Date.now();
  try {
    // 0. Chiffrée : déchiffrée d'abord, avec la clé de récupération.
    job.stage = "dechiffrement";
    clear = await decrypted(file, cle);
    // 1. L'archive, relue en entier avant de toucher à quoi que ce soit.
    job.stage = "verification";
    src = await fileSource(clear ?? file);
    let verified: VerifiedBackup;
    try {
      verified = await verifyBackup(src);
    } catch (e) {
      throw new Refused({ code: e instanceof ZipError ? "abimee" : /format plus récent/.test(message(e)) ? "trop-recente" : "pas-une-sauvegarde", detail: message(e) });
    }
    if (verified.problems.length) throw new Refused({ code: "abimee", detail: verified.problems[0] });
    manifest = verified.manifest;
    const folded = foldedMigrations();
    const compat = archiveCompatibility(manifest.derniereMigration, [...folded, ...migrationFiles().map((m) => m.name).filter((n) => !folded.includes(n))], folded);
    if (compat !== "ok") throw new Refused({ code: compat });

    // 2. La base : toujours neuve, et capable de recevoir les fichiers.
    job.stage = "preparation";
    const c = (conn = await runReal(() => pool.getConnection()));
    // Le wait_timeout de certains hébergeurs est court : la connexion reste vivante pendant les relectures.
    keepAlive = setInterval(() => c.query("SELECT 1").catch(() => {}), 5000);
    if (!(await takeLock(c))) throw new Refused({ code: "occupee" });
    try {
      await checkPacketSize(manifest, c);
    } catch (e) {
      if (e instanceof PacketTooSmall) throw new Refused({ code: "paquet" });
      throw e;
    }
    // La maintenance d'abord : plus aucune requête n'entre. Puis seulement le contrôle — une création de foyer
    // arrivée juste avant est ainsi vue, et rien n'est vidé.
    hooks.pause();
    paused = true;
    if (!(await freshInstall(c))) throw new Refused({ code: "pas-neuve" });
    await c.query(`CREATE TABLE IF NOT EXISTS \`${MARKER}\` (debut DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    // Dernier regard avant de vider : le témoin est retiré si la base n'est plus neuve, pour que rien ne la remette à zéro.
    if (!(await freshInstall(c))) {
      await c.query(`DROP TABLE IF EXISTS \`${MARKER}\``);
      throw new Refused({ code: "pas-neuve" });
    }
    await dropAll(c, [MARKER]);

    // 3. Structure, lignes, fichiers, puis contrôle contre le manifeste.
    const { problems } = await restoreBackup(src, c, (line) => console.log(`[restauration] ${line}`), {
      ignore: [MARKER],
      verified,
      progress: (p) => {
        job.stage = p.etape === "structure" ? "preparation" : p.etape;
        job.fait = p.fait;
        job.total = p.total;
      },
    });
    if (problems.length) throw new Error(problems[0]);
    // Ce qui ouvrait une session ou une inscription sur le serveur d'origine ne vaut pas ici.
    for (const table of ["sessions", "auth_challenges", "enrollment_tokens", "oauth_codes", "oauth_requests"]) await c.query(`DELETE FROM \`${table}\``);
    // Cette installation est peut-être une copie d'essai : elle n'écrit pas de sauvegarde — et ne trie pas les copies du
    // stockage extérieur — à la place de celle d'origine tant que l'administrateur ne l'a pas redemandé.
    autoPaused = await pauseAutoBackups(c);
    await c.query(`DROP TABLE \`${MARKER}\``);
    restored = true;
  } catch (e) {
    job.failure = e instanceof Refused ? e.failure : { code: "interne", detail: message(e) };
    console.error("[restauration] échec", e);
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    // Elle porte le verrou et les réglages du chargement (clés étrangères suspendues) : elle ne retourne pas dans la réserve.
    conn?.destroy();
    await src?.close?.().catch(() => {});
    if (clear) rmSync(clear, { force: true });
    if (uploaded && !keyProblem(job.failure)) rmSync(file, { force: true });
  }

  if (!paused) {
    job.stage = "echec";
    return;
  }
  // Redémarrage du service : sur la base restaurée (les migrations plus récentes s'appliquent), ou, après un échec,
  // sur une base remise à neuf (le témoin encore là, le démarrage la vide et la recrée).
  job.stage = "demarrage";
  job.fait = job.total = 0;
  forgetVapidKeys();
  const boot = await hooks.resume({ restored });
  if (!restored) {
    job.stage = "echec";
    return;
  }
  if ("error" in boot) {
    job.failure = { code: "demarrage", detail: boot.error };
    job.stage = "echec";
    return;
  }
  try {
    job.report = { ...(await buildReport(manifest!, boot.applied.length)), sauvegardesEnPause: autoPaused };
    await runReal(() => logAudit("restauration d'une sauvegarde", null, { sauvegardeDu: manifest!.creeLe, ...manifest!.totaux, secondes: Math.round((Date.now() - started) / 1000) }));
    console.log(`[restauration] sauvegarde du ${manifest!.creeLe} restaurée en ${Math.round((Date.now() - started) / 1000)} s`);
    job.stage = "termine";
  } catch (e) {
    job.failure = { code: "demarrage", detail: message(e) };
    job.stage = "echec";
  }
}

/** Raison d'un échec, dans la langue de la requête. */
function failureText(f: Failure): string {
  switch (f.code) {
    case "cle-requise":
      return t("Cette archive est chiffrée : donne ta clé de récupération pour la restaurer.");
    case "cle-refusee":
      return t("Cette clé de récupération n'ouvre pas cette archive.");
    case "place":
      return t("Pas assez de place sur le serveur pour recevoir cette archive.");
    case "pas-une-sauvegarde":
      return t("Ce fichier n'est pas une sauvegarde de Pécule.");
    case "abimee":
      return t("Archive abîmée ou incomplète : rien n'a été modifié. Télécharge-la de nouveau, ou prends-en une autre.");
    case "trop-recente":
      return t("Cette sauvegarde vient d'une version plus récente de Pécule : mets d'abord ce serveur à jour, puis recommence.");
    case "trop-ancienne":
      return t("Cette sauvegarde est trop ancienne pour cette version de Pécule : installe d'abord la version {palier}, restaure-la, puis mets à jour.", { palier: DEPUIS });
    case "pas-neuve":
      return t("Cette installation a déjà des données : une sauvegarde ne se restaure que dans une installation neuve.");
    case "paquet":
      return t("Le serveur de base de données refuse des envois de la taille des fichiers de cette sauvegarde : augmente son réglage max_allowed_packet (256M par exemple), puis recommence.");
    case "occupee":
      return t("Une restauration est déjà en cours.");
    case "demarrage":
      return t("La sauvegarde est restaurée, mais Pécule n'arrive pas à démarrer dessus : {detail}", { detail: f.detail ?? "" });
    default:
      return t("La restauration n'a pas abouti ({detail}). L'installation est revenue à son état neuf : tu peux recommencer.", { detail: f.detail ?? "" });
  }
}

const statusOf = (s: Session): RestoreStatus => {
  const j = s.job;
  if (!j) return { etape: "envoi", fait: s.upload?.size ?? 0, total: s.upload?.total ?? 0, erreur: null, rapport: null, cleRefusee: false };
  return { etape: j.stage, fait: j.fait, total: j.total, erreur: j.stage === "echec" && j.failure ? failureText(j.failure) : null, rapport: j.report, cleRefusee: j.stage === "echec" && keyProblem(j.failure) };
};

const EXPIRED = tk("Session de restauration expirée : recommence depuis le code d'installation.");
const STARTING = tk("Pécule démarre ou est en maintenance : réessaie dans un instant.");

/** Routes de la restauration à l'installation, montées avant la porte de maintenance (l'état se lit pendant le chargement). */
export function restoreApi(hooks: RestoreHooks) {
  const api = Router();
  const json = express.json({ limit: "20kb" });

  // Le code d'installation ne se devine pas à force d'essais.
  const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: () => ({ error: t("Trop d'essais : réessaie dans un quart d'heure.") }) });

  /** La session de restauration de la requête (jeton dans l'en-tête `X-Restauration`), si elle vaut encore. */
  const current = (req: Request): Session | null => {
    const jeton = req.get("x-restauration");
    if (!session || !jeton || session.expires < Date.now() || !safeEqual(sha256(jeton), session.hash)) return null;
    return session;
  };

  /** Ouvre une restauration : le code d'installation, dans une installation neuve. */
  api.post("/open", limiter, json, async (req, res) => {
    const { code } = z.object({ code: z.string().min(1).max(400) }).parse(req.body);
    if (!hooks.ready()) return res.status(503).json({ error: t(STARTING) });
    if (running()) return res.status(409).json({ error: t("Une restauration est déjà en cours.") });
    // Avant le code : une installation en service répond la même chose quel que soit le code, qui ne s'y essaie donc pas.
    if (!(await freshInstall())) return res.status(409).json({ error: t(NOT_FRESH) });
    if (!safeEqual(code.trim(), env.SETUP_CODE ?? env.API_TOKEN)) return res.status(403).json({ error: t("Code d'installation incorrect.") });
    // Restes d'un envoi précédent, abandonné.
    rmSync(uploadDir(), { recursive: true, force: true });
    const jeton = randomBytes(32).toString("base64url");
    session = { hash: sha256(jeton), expires: Date.now() + SESSION_MS, upload: null, job: null };
    res.json({ jeton, archives: offered(), morceau: RESTORE_CHUNK });
  });

  /**
   * Une session de restauration ne vaut que tant que l'installation est neuve : un foyer créé entre-temps la ferme.
   * Sans cela, celui qui l'avait ouverte pouvait encore, six heures durant, remplir le disque d'une archive et faire
   * passer le service en maintenance le temps qu'elle soit relue — sans rien écraser, mais sans y avoir plus droit.
   */
  const NOT_FRESH = tk("Cette installation a déjà des données : une sauvegarde ne se restaure que dans une installation neuve.");
  const stillFresh = async (): Promise<boolean> => {
    // Démarrage en cours : rien à lire encore — le lancement est refusé plus bas, et un morceau ne fait qu'attendre.
    if (!hooks.ready() || (await freshInstall())) return true;
    session = null;
    rmSync(uploadDir(), { recursive: true, force: true });
    return false;
  };

  /** Sans session de restauration, le corps d'un morceau n'est même pas lu. */
  const known = (req: Request, res: Response, next: NextFunction) => (current(req) ? next() : res.status(401).json({ error: t(EXPIRED) }));

  /** Un morceau de l'archive (corps brut), à la suite de ce qui est déjà reçu. */

  api.put("/upload", known, express.raw({ type: () => true, limit: RESTORE_CHUNK + 65_536 }), async (req, res) => {
    const s = current(req);
    if (!s) return res.status(401).json({ error: t(EXPIRED) });
    if (running()) return res.status(409).json({ error: t("Une restauration est déjà en cours.") });
    if (!(await stillFresh())) return res.status(409).json({ error: t(NOT_FRESH) });
    const { offset, total } = z.object({ offset: z.coerce.number().int().min(0), total: z.coerce.number().int().min(1).max(MAX_ARCHIVE) }).parse(req.query);
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: t("Données invalides") });
    if (offset === 0 && (!s.upload || s.upload.size > 0 || s.upload.total !== total)) {
      // Nouvel envoi : il remplace le précédent.
      const dir = uploadDir();
      rmSync(dir, { recursive: true, force: true });
      ensurePrivateDir(dir);
      const disk = await statfs(dir);
      if (Number(disk.bavail) * Number(disk.bsize) < total + MARGIN) return res.status(507).json({ error: t("Pas assez de place sur le serveur pour recevoir cette archive.") });
      s.upload = { file: path.join(dir, `envoi-${randomBytes(6).toString("hex")}.zip.partiel`), size: 0, total, busy: false };
    }
    const up = s.upload;
    if (!up || up.total !== total || up.busy) return res.status(409).json({ error: t("Envoi interrompu : recommence l'envoi de l'archive."), recu: up?.size ?? 0 });
    const place = chunkPlacement(up.size, offset, req.body.length);
    if (place === "decale" || offset + req.body.length > up.total) return res.status(409).json({ error: t("Envoi interrompu : recommence l'envoi de l'archive."), recu: up.size });
    if (place === "ecrire") {
      up.busy = true;
      try {
        // Lisible par le seul compte du serveur : l'archive porte toutes les données du foyer.
        await appendFile(up.file, req.body, { mode: 0o600 });
        up.size += req.body.length;
      } finally {
        up.busy = false;
      }
    }
    res.json({ recu: up.size });
  });

  /** Lance la restauration : de l'archive envoyée, ou d'une archive du dossier des sauvegardes du serveur. */
  api.post("/start", json, async (req, res) => {
    const s = current(req);
    if (!s) return res.status(401).json({ error: t(EXPIRED) });
    const { archive, cle } = z.object({ archive: z.string().max(200).optional(), cle: z.string().max(200).optional() }).parse(req.body ?? {});
    if (!hooks.ready()) return res.status(503).json({ error: t(STARTING) });
    if (running()) return res.status(409).json({ error: t("Une restauration est déjà en cours.") });
    // Avant de relire quoi que ce soit : une installation qui a désormais son foyer ne passe pas en maintenance pour une archive.
    if (!(await stillFresh())) return res.status(409).json({ error: t(NOT_FRESH) });
    let file: string;
    if (archive !== undefined) {
      const found = archivePath(archive);
      if (!found) return res.status(404).json({ error: t("Archive introuvable sur le serveur.") });
      file = found;
    } else {
      if (!s.upload || s.upload.size !== s.upload.total) return res.status(400).json({ error: t("Envoi interrompu : recommence l'envoi de l'archive.") });
      file = s.upload.file;
    }
    const job: Job = { stage: "dechiffrement", fait: 0, total: 0, failure: null, report: null };
    const sent = archive === undefined ? s.upload : null;
    s.job = job;
    // L'archive envoyée est consommée par cette restauration (elle est retirée du serveur à la fin)…
    s.upload = null;
    setRestoring(true);
    void run(job, file, archive === undefined, hooks, cle)
      .catch((e) => {
        job.failure = { code: "interne", detail: message(e) };
        job.stage = "echec";
      })
      .finally(() => {
        setRestoring(false);
        // … sauf si seule la clé de récupération manquait : elle reste là, prête pour un nouvel essai.
        if (keyProblem(job.failure) && session === s) s.upload = sent;
        // Le rapport porte des liens d'inscription : il ne reste lisible qu'une demi-heure.
        if (session === s) s.expires = Math.min(s.expires, Date.now() + REPORT_MS);
      });
    res.status(202).json(statusOf(s));
  });

  /** Où en est la restauration (répond aussi pendant le chargement, quand le reste de Pécule est en maintenance). */
  api.get("/status", (req, res) => {
    const s = current(req);
    if (!s) return res.status(401).json({ error: t(EXPIRED) });
    res.set("Cache-Control", "no-store").json(statusOf(s));
  });

  return api;
}
