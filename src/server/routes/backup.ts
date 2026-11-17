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
import { archivePath, backupDir, listArchives } from "../archives.ts";
import { autoBackupRunning, backupSettings, backupState, DOWNLOAD_AUDIT, lastBackupAt, runAutoBackup, saveBackupSettings } from "../auto-backup.ts";
import { rmSync } from "node:fs";
import { z } from "zod";
import { KEEP_MAX, KEEP_MIN } from "../../lib/backup-plan.ts";
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

/** Une seule sauvegarde à la fois : elle lit toute la base. */
let running = false;

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
    state: await backupState(),
    autoRunning: autoBackupRunning(),
    dir: backupDir(),
    archives: listArchives().slice(0, 100),
    // Dernière sauvegarde de toute sorte (téléchargée, automatique, d'avant migration).
    latest: await lastBackupAt(),
  });
});

/** Réglage des sauvegardes automatiques. */
backupApi.put("/backup/settings", requireAdmin, async (req, res) => {
  const patch = z.object({ auto: z.boolean().optional(), frequence: z.enum(["jour", "semaine"]).optional(), garder: z.number().int().min(KEEP_MIN).max(KEEP_MAX).optional() }).parse(req.body);
  res.json(await saveBackupSettings(patch));
});

/** Écrit une sauvegarde sur le serveur tout de suite (comme celle de la nuit) ; la fin se lit dans `/backup/info`. */
backupApi.post("/backup/run", requireAdmin, limiter, (_req, res) => {
  if (isDemo()) return res.status(403).json({ error: t("Indisponible en mode démo") });
  if (autoBackupRunning()) return res.status(409).json({ error: t("Une sauvegarde est déjà en cours : attends qu'elle se termine.") });
  void runReal(() => runAutoBackup());
  res.status(202).json({ ok: true });
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

/** L'archive, écrite au fil de l'eau dans la réponse (rien n'est gardé sur le serveur). */
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
    res.status(200).set({
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${backupFileName(now, householdTimeZone())}"`,
      // no-transform : ni compression ni mise en tampon par un intermédiaire.
      "Cache-Control": "private, no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    const { manifest, octets } = await writeBackup(c, res, { now, origine: rpID });
    res.end();
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
