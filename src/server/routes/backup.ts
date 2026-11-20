import { householdTimeZone } from "../region.ts";
import { rpID } from "../env.ts";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { PoolConnection } from "mysql2/promise";
import { one, pool } from "../db.ts";
import { requireAdmin } from "../auth.ts";
import { isDemo, runReal } from "../demo-context.ts";
import { logAudit, recordAlert } from "../journal.ts";
import { BackupAborted, writeBackup } from "../backup.ts";
import { backupFileName } from "../backup-format.ts";
import { archivePath, backupDir, backupDirChoice, listArchives } from "../archives.ts";
import { autoBackupRunning, backupSettings, backupState, DOWNLOAD_AUDIT, forgetOffsiteFailure, lastBackupAt, runAutoBackup, saveBackupSettings } from "../auto-backup.ts";
import { rmSync } from "node:fs";
import { z } from "zod";
import { finished } from "node:stream/promises";
import { encryptStream, isRecipient } from "../age.ts";
import { destination, encryptionKey, listOffsite, remoteProblemText, removeDestination, saveDestination, SecretNeeded, setEncryptionKey, testDestination } from "../offsite.ts";
import { RemoteError } from "../remote.ts";
import type { BackupFailure } from "../auto-backup.ts";
import { ENCRYPTED_SUFFIX, KEEP_MAX, KEEP_MIN } from "../../lib/backup-plan.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Sauvegarde complète (Réglages → Compte et sécurité, `pnpm sauvegarde`) : réservée à
 * l'administrateur, car l'archive contient les données privées de tous les membres. Toujours la
 * vraie base, jamais en démo. Chaque téléchargement abouti est noté dans le journal.
 * Ici aussi : le réglage des sauvegardes automatiques (`src/server/auto-backup.ts`) et les archives que le serveur
 * garde dans son dossier — les lister, en télécharger une, en retirer une.
 */

export const backupApi = Router();

/** Action du journal : sert aussi à retrouver la dernière sauvegarde. */
const AUDIT_ACTION = DOWNLOAD_AUDIT;

const limiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 6,
  keyGenerator: (req) => `sauvegarde${req.user?.id ?? 0}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // Fonction : la langue n'est connue qu'au moment de la requête.
  message: () => ({ error: t("Trop de sauvegardes cette heure-ci : réessaie plus tard.") }),
});

/** Réglages de la copie hors du serveur (clé, stockage, essais) : chacun fait partir quelques requêtes vers l'extérieur. */
const settingsLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 60,
  keyGenerator: (req) => `sauvegarde-reglages${req.user?.id ?? 0}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: () => ({ error: t("Trop d'essais : réessaie dans un quart d'heure.") }),
});

/** Sauvegardes écrites sur le serveur à la demande : chacune lit toute la base. */
const runLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 12,
  keyGenerator: (req) => `sauvegarde-serveur${req.user?.id ?? 0}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: () => ({ error: t("Trop de sauvegardes cette heure-ci : réessaie plus tard.") }),
});

/** Une seule sauvegarde à la fois : elle lit toute la base. */
let running = false;

/** Un échec tel que l'écran le montre : un refus du stockage extérieur devient une phrase dans la langue de la requête. */
const shown = (f: BackupFailure | null) => (f ? { at: f.at, raison: f.code ? remoteProblemText(f.code, f.raison) : f.raison } : null);

/** Un refus du stockage extérieur n'est pas une panne de Pécule : sa raison est rendue telle quelle. */
const remoteRefusal = (e: unknown) =>
  e instanceof RemoteError ? remoteProblemText(e.code, e.detail) : e instanceof SecretNeeded ? t("Adresse ou identifiant modifié : saisis de nouveau le secret du stockage.") : null;

/** Ce que contiendra l'archive (ordre de grandeur) et la dernière sauvegarde téléchargée. */
backupApi.get("/backup/info", requireAdmin, async (_req, res) => {
  const size = await one<{ tables: number; octets: number }>(
    "SELECT COUNT(*) AS tables, COALESCE(SUM(DATA_LENGTH), 0) AS octets FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'",
  );
  const counts = await one<{ operations: number; factures: number; documents: number }>(
    "SELECT (SELECT COUNT(*) FROM transactions) AS operations, (SELECT COUNT(*) FROM invoice_files) AS factures, (SELECT COUNT(*) FROM document_files) AS documents",
  );
  // Instant exact (secondes Unix) : l'écran l'affiche à l'heure de l'appareil, quel que soit le fuseau de la base.
  const last = await one<{ at: number; name: string | null; details: string | null }>(
    "SELECT UNIX_TIMESTAMP(a.at) AS at, u.name, a.details FROM audit_log a LEFT JOIN users u ON u.id = a.user_id WHERE a.action = ? ORDER BY a.id DESC LIMIT 1",
    [AUDIT_ACTION],
  );
  let lastBytes: number | null = null;
  try {
    lastBytes = Number((JSON.parse(last?.details ?? "{}") as { octets?: number }).octets) || null;
  } catch {
    // Détails illisibles : la date suffit.
  }
  res.json({
    tables: Number(size?.tables ?? 0),
    octets: Number(size?.octets ?? 0),
    operations: Number(counts?.operations ?? 0),
    factures: Number(counts?.factures ?? 0),
    documents: Number(counts?.documents ?? 0),
    running,
    last: last ? { at: Number(last.at) * 1000, by: last.name, octets: lastBytes } : null,
    // Sauvegardes automatiques : réglage, dernier résultat, et ce que le serveur garde dans son dossier.
    auto: await backupSettings(),
    state: await backupState().then((st) => ({ ok: st.ok, echec: shown(st.echec), dehors: { ok: st.dehors.ok, echec: shown(st.dehors.echec), attente: st.dehors.attente } })),
    // Copie hors du serveur : la clé publique de chiffrement et le stockage réglés (jamais un secret).
    key: await encryptionKey(),
    destination: await destination(),
    autoRunning: autoBackupRunning(),
    dir: backupDir(),
    // Pourquoi ce dossier (réglé, volume, déjà utilisé, compte du serveur, repli dans l'installation) : `doctor` le dit.
    dirReason: backupDirChoice().reason,
    archives: listArchives().slice(0, 100),
    // Dernière sauvegarde de toute sorte (téléchargée, automatique, d'avant migration).
    latest: await lastBackupAt(),
  });
});

/** Réglage des sauvegardes automatiques. */
backupApi.put("/backup/settings", requireAdmin, async (req, res) => {
  const patch = z
    .object({
      auto: z.boolean().optional(),
      frequence: z.enum(["jour", "semaine"]).optional(),
      garder: z.number().int().min(KEEP_MIN).max(KEEP_MAX).optional(),
      dehors: z.object({ jours: z.number().int().min(1).max(120), semaines: z.number().int().min(0).max(120), mois: z.number().int().min(0).max(120) }).optional(),
    })
    .parse(req.body);
  res.json(await saveBackupSettings(patch));
});

/** Écrit une sauvegarde sur le serveur tout de suite (comme celle de la nuit) ; la fin se lit dans `/backup/info`. */
backupApi.post("/backup/run", requireAdmin, runLimiter, (_req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  if (autoBackupRunning()) return res.status(409).json({ error: t("Une sauvegarde est déjà en cours : attends qu'elle se termine.") });
  void runReal(() => runAutoBackup()).catch((e) => console.error("[sauvegarde] écriture à la demande en échec", e));
  res.status(202).json({ ok: true });
});

/**
 * Clé de chiffrement des copies qui quittent le serveur. Sans `recipient` : Pécule crée une paire et rend la clé de
 * récupération, cette seule fois (elle n'est gardée nulle part). Avec : la clé publique « age1… » de l'administrateur.
 */
backupApi.post("/backup/key", requireAdmin, settingsLimiter, async (req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  const { recipient } = z.object({ recipient: z.string().trim().max(200).optional() }).parse(req.body ?? {});
  if (recipient && !isRecipient(recipient)) return res.status(400).json({ error: t("Clé publique invalide : elle commence par « age1 » et se recopie en entier.") });
  res.set("Cache-Control", "no-store").json(await setEncryptionKey(recipient || undefined));
});

const destinationShape = z.discriminatedUnion("type", [
  z.object({ type: z.literal("s3"), endpoint: z.string().trim().min(1).max(300), region: z.string().trim().max(60), bucket: z.string().trim().min(1).max(100), prefix: z.string().trim().max(200), accessKey: z.string().trim().min(1).max(200), secret: z.string().max(400) }),
  z.object({ type: z.literal("webdav"), url: z.string().trim().min(1).max(400), user: z.string().trim().min(1).max(200), secret: z.string().max(400) }),
]);

/** Règle le stockage extérieur : il est essayé pour de bon (dépôt, liste, suppression d'un petit fichier) avant d'être enregistré. */
backupApi.put("/backup/destination", requireAdmin, settingsLimiter, async (req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  if (!(await encryptionKey())) return res.status(409).json({ error: t("Crée d'abord la clé de chiffrement : rien ne quitte le serveur sans être chiffré.") });
  try {
    res.json(await saveDestination(destinationShape.parse(req.body)));
  } catch (e) {
    const why = remoteRefusal(e);
    if (!why) throw e;
    res.status(400).json({ error: why });
  }
});

/** Retire le stockage extérieur (les copies déjà déposées y restent). */
backupApi.delete("/backup/destination", requireAdmin, async (_req, res) => {
  await removeDestination();
  await forgetOffsiteFailure();
  res.json({ ok: true });
});

/** Essaie le stockage enregistré, et rend les copies qu'il porte. */
backupApi.post("/backup/destination/test", requireAdmin, settingsLimiter, async (_req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  try {
    await testDestination();
    res.json({ ok: true, copies: await listOffsite() });
  } catch (e) {
    const why = remoteRefusal(e);
    if (!why) throw e;
    res.status(400).json({ error: why });
  }
});

/** Les copies présentes sur le stockage extérieur, la plus récente d'abord. */
backupApi.get("/backup/remote", requireAdmin, async (_req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  try {
    res.json({ copies: await listOffsite() });
  } catch (e) {
    const why = remoteRefusal(e);
    if (!why) throw e;
    res.status(502).json({ error: why });
  }
});

/** Une archive du dossier des sauvegardes du serveur, à télécharger. */
backupApi.get("/backup/archives/:name", requireAdmin, async (req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  // Depuis l'appli seulement (ou par jeton) : un lien posé sur un autre site ne doit pas faire télécharger l'archive.
  const site = req.get("sec-fetch-site");
  if (req.user?.via === "session" && site && site !== "same-origin" && site !== "none") return res.status(403).json({ error: "Requête refusée : elle ne vient pas de Pécule." });
  const name = String(req.params.name);
  const file = archivePath(name);
  if (!file) return res.status(404).json({ error: t("Archive introuvable sur le serveur.") });
  await logAudit("archive de sauvegarde téléchargée", name);
  res.set({ "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" });
  // `dotfiles` : le chemin de l'installation peut passer par un dossier caché sans que l'envoi soit refusé.
  res.download(file, name, { dotfiles: "allow" });
});

/** Retire une archive du dossier des sauvegardes du serveur. */
backupApi.delete("/backup/archives/:name", requireAdmin, (req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  const file = archivePath(String(req.params.name));
  if (!file) return res.status(404).json({ error: t("Archive introuvable sur le serveur.") });
  rmSync(file, { force: true });
  res.json({ ok: true });
});

/**
 * L'archive, écrite au fil de l'eau dans la réponse (rien n'est gardé sur le serveur). `?chiffre=1` : chiffrée avec la
 * clé de l'installation avant de partir (« .zip.age »), pour la ranger dans un endroit moins sûr qu'un disque à soi.
 */
backupApi.get("/backup", requireAdmin, limiter, async (_req, res, next) => {
  // Garde-fou : la route est déjà interdite en démo (BLOCKED), la sauvegarde ne lit que la vraie base.
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  // Depuis l'appli seulement (ou par jeton) : un lien posé sur un autre site ne doit pas faire télécharger l'archive.
  const site = _req.get("sec-fetch-site");
  if (_req.user?.via === "session" && site && site !== "same-origin" && site !== "none") return res.status(403).json({ error: "Requête refusée : elle ne vient pas de Pécule." });
  if (running) return res.status(409).json({ error: t("Une sauvegarde est déjà en cours : attends qu'elle se termine.") });
  running = true;
  let conn: PoolConnection | null = null;
  let keepAlive: NodeJS.Timeout | null = null;
  const started = Date.now();
  try {
    const c = (conn = await runReal(() => pool.getConnection()));
    // Le wait_timeout de l'hébergeur est court : la connexion reste vivante si le téléchargement est lent.
    keepAlive = setInterval(() => c.query("SELECT 1").catch(() => {}), 5000);
    const now = new Date();
    const key = _req.query.chiffre === "1" ? await encryptionKey() : null;
    if (_req.query.chiffre === "1" && !key) {
      clearInterval(keepAlive);
      c.release();
      conn = null;
      return res.status(409).json({ error: t("Crée d'abord la clé de chiffrement : rien ne quitte le serveur sans être chiffré.") });
    }
    res.status(200).set({
      "Content-Type": key ? "application/octet-stream" : "application/zip",
      "Content-Disposition": `attachment; filename="${backupFileName(now, householdTimeZone())}${key ? ENCRYPTED_SUFFIX : ""}"`,
      // no-transform : ni compression ni mise en tampon par un intermédiaire.
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    // Chiffrée : l'archive traverse le chiffrement avant la réponse ; un téléchargement coupé arrête tout.
    const sealer = key ? encryptStream(key.recipient) : null;
    if (sealer) {
      sealer.pipe(res);
      res.once("close", () => sealer.destroy());
    }
    const { manifest, octets } = await writeBackup(c, sealer ?? res, { now, origine: rpID });
    if (sealer) {
      sealer.end();
      await finished(res);
    } else res.end();
    clearInterval(keepAlive);
    c.release();
    conn = null;
    await logAudit(AUDIT_ACTION, null, { ...manifest.totaux, octets, secondes: Math.round((Date.now() - started) / 1000) });
  } catch (e) {
    // Connexion peut-être au milieu d'une lecture : elle n'est pas rendue au pool.
    conn?.destroy();
    conn = null;
    if (res.headersSent) {
      // Archive déjà entamée : couper net, pour que le téléchargement échoue au lieu de laisser un zip tronqué.
      if (!(e instanceof BackupAborted)) void recordAlert("sauvegarde", `Sauvegarde interrompue : ${e instanceof Error ? e.message : String(e)}`, e);
      res.destroy();
    } else if (e instanceof BackupAborted) {
      res.end();
    } else {
      res.removeHeader("Content-Disposition");
      res.removeHeader("Content-Type");
      next(e);
    }
  } finally {
    if (keepAlive) clearInterval(keepAlive);
    running = false;
  }
});
