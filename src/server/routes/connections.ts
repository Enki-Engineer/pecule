import { Router } from "express";
import { z } from "zod";
import { ActionError } from "../actions.ts";
import { createAdminToken, requireAdmin } from "../auth.ts";
import { aiConfig } from "../ai-config.ts";
import { exec, one, q } from "../db.ts";
import { isDemo } from "../demo-context.ts";
import { ebConsents } from "../enable-banking.ts";
import { fintaEnabled } from "../finta.ts";
import { logAudit } from "../journal.ts";
import { saveServiceKey, serviceKeyStatus, SERVICES } from "../service-keys.ts";
import { aiStatusOf } from "../../lib/ai-providers.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Vue d'ensemble de ce à quoi Pécule est relié (Réglages → Comptes et connexions) : banques, fichiers, IA, crypto, assistants
 * extérieurs, appareils. Une lecture seule, sans appel réseau ; chaque connexion se règle sur son propre écran.
 * Les clés des services crypto se règlent ici, par l'administrateur.
 */
export const connectionsApi = Router();

const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(sql, params))?.n ?? 0);

connectionsApi.get("/connections", async (req, res) => {
  const userId = req.user!.id;
  const demo = isDemo() || req.user!.demo === true;
  const consents = demo ? [] : await ebConsents();
  const ai = aiStatusOf(aiConfig());
  const active = ai.connectors.find((c) => c.active);
  res.json({
    banks: {
      enableBanking: { consents: consents.length, mine: consents.filter((c) => c.userId === userId).length, nextExpiry: consents.map((c) => c.validUntil).sort()[0] ?? null },
      finta: { enabled: !demo && fintaEnabled() },
      files: { lastImport: (await one<{ at: string | null }>("SELECT DATE_FORMAT(MAX(date), '%Y-%m-%d') AS at FROM transactions WHERE origin = 'fichier'"))?.at ?? null },
      manualAccounts: await count("SELECT COUNT(*) AS n FROM accounts WHERE source = 'manuel'"),
      lastSync: (await one<{ at: string | null; status: string | null }>("SELECT DATE_FORMAT(COALESCE(finished_at, started_at), '%Y-%m-%d %H:%i') AS at, status FROM sync_runs ORDER BY id DESC LIMIT 1")) ?? null,
    },
    ai: { enabled: !demo && ai.enabled, provider: active?.id ?? null, model: active?.model ?? null },
    services: Object.fromEntries(SERVICES.map((s) => [s, demo ? { keySet: false, source: null, unreadable: false } : serviceKeyStatus(s)])),
    crypto: { lastRun: (await one<{ at: string | null; status: string | null }>("SELECT DATE_FORMAT(COALESCE(finished_at, started_at), '%Y-%m-%d %H:%i') AS at, status FROM crypto_sync_runs ORDER BY id DESC LIMIT 1").catch(() => undefined)) ?? null },
    apps: demo ? 0 : await count("SELECT COUNT(*) AS n FROM oauth_grants WHERE user_id = ? AND revoked_at IS NULL AND refresh_expires_at > UTC_TIMESTAMP()", [userId]),
    shortcuts: demo ? 0 : await count("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND scope = 'depot' AND revoked_at IS NULL", [userId]),
    calendar: demo ? false : (await count("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND scope = 'ical' AND revoked_at IS NULL", [userId])) > 0,
    devices: demo ? 0 : await count("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?", [userId]),
  });
});

/** Clé d'un service crypto (vide : retirée des réglages, la valeur de l'hébergement reprend la main). Hors audit automatique. */
connectionsApi.put("/connections/keys/:service", requireAdmin, async (req, res) => {
  if (isDemo() || req.user!.demo) return res.status(403).json({ error: t("Indisponible en mode démo") });
  const service = z.enum(SERVICES).parse(req.params.service);
  const { key } = z.object({ key: z.string().max(400) }).parse(req.body);
  await saveServiceKey(service, key);
  void logAudit("PUT /api/connections/keys", service, { cle: key.trim() ? "remplacée" : "retirée" });
  res.json(serviceKeyStatus(service));
});

/*
 * Jetons d'administration créés dans l'appli : pour la ligne de commande, les scripts et le serveur MCP. Chacun a un
 * nom, se révoque seul, et n'est montré qu'une fois. Le jeton de l'hébergement (API_TOKEN) reste valable : il sert
 * de secours, et n'a plus besoin de circuler.
 */
connectionsApi.get("/connections/admin-tokens", requireAdmin, async (req, res) => {
  res.json({ tokens: await q("SELECT id, name, created_at, last_used_at FROM api_tokens WHERE user_id = ? AND scope = 'admin' AND revoked_at IS NULL ORDER BY id", [req.user!.id]) });
});

connectionsApi.post("/connections/admin-tokens", requireAdmin, async (req, res) => {
  // Depuis l'appli seulement : un jeton ne fabrique pas d'autres jetons.
  if (req.user!.via !== "session") throw new ActionError(403, t("Jeton à créer depuis l'appli"));
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  const n = await one<{ n: number }>("SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND scope = 'admin' AND revoked_at IS NULL", [req.user!.id]);
  if (Number(n?.n ?? 0) >= 10) throw new ActionError(400, t("10 jetons au plus : révoques-en un d'abord."));
  res.json({ token: await createAdminToken(req.user!.id, name) });
});

connectionsApi.delete("/connections/admin-tokens/:id", requireAdmin, async (req, res) => {
  await exec("UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND scope = 'admin'", [z.coerce.number().int().parse(req.params.id), req.user!.id]);
  res.json({ ok: true });
});
