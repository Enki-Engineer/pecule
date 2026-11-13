import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { ActionError } from "../actions.ts";
import { activeConnector, loadAiConfig, previewConnector, saveConnector, setActiveProvider, type ConnectorPatch } from "../ai-config.ts";
import { foundryAccess, missingFor, testConnector } from "../ai.ts";
import { requireAdmin } from "../auth.ts";
import { resolvesPublic } from "../net.ts";
import { isDemo } from "../demo-context.ts";
import { logAudit } from "../journal.ts";
import { AI_PROVIDERS, AI_PROVIDER_INFO, aiStatusOf, normalizeAiUrl, type AiProvider } from "../../lib/ai-providers.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Réglages → Assistant → Fournisseur d'IA : choisir qui sert Claude, avec son adresse, son modèle et sa clé.
 * Sous /api, pour un membre connecté dans son navigateur ou le jeton d'administration ; interdit en démo
 * (BLOCKED, demo.ts). Une clé n'est jamais renvoyée, ni journalisée : ces routes sont hors de l'audit
 * automatique (qui garde le corps des demandes) et tracent elles-mêmes ce qui a changé.
 */
export const aiSettingsApi = Router();

function member(req: Request, res: Response, next: NextFunction) {
  // Jamais depuis une session de démo : ces réglages vivent dans la vraie base.
  if (isDemo() || req.user?.demo) return res.status(403).json({ error: t("Indisponible en mode démo") });
  if (req.user?.via !== "session" && req.user?.via !== "api") return res.status(403).json({ error: t("Réservé à un membre connecté") });
  next();
}

const limiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 40,
  keyGenerator: (req) => `ia${req.user?.id ?? 0}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // Fonction : la langue n'est connue qu'au moment de la requête.
  message: () => ({ error: t("Trop de modifications ou d'essais cette heure-ci.") }),
});

const fields = {
  provider: z.enum(AI_PROVIDERS),
  /** Absente = inchangée ; vide = retirer celle des réglages. */
  key: z.string().max(500).optional(),
  url: z.string().trim().max(300).optional(),
  model: z.string().trim().max(120).optional(),
};

/** Une adresse saisie doit être utilisable (https, nom de domaine public) ; vide = la retirer. */
async function checkUrl(provider: (typeof AI_PROVIDERS)[number], url: string | undefined) {
  if (!url || !AI_PROVIDER_INFO[provider].url) return;
  const normalized = normalizeAiUrl(provider, url);
  // Le nom doit être public, et se résoudre vers une adresse publique (pas vers le réseau du serveur).
  let host: string | null = null;
  try {
    host = normalized ? new URL(/^https:\/\//i.test(normalized) ? normalized : `https://${normalized}`).hostname : null;
  } catch {
    host = null;
  }
  if (!normalized || (host && host.includes(".") && !(await resolvesPublic(host)))) throw new ActionError(400, t("Adresse inutilisable : il faut une adresse https vers un nom de domaine public."));
}

const status = async () => ({ ...aiStatusOf(await loadAiConfig()), voice: Boolean(foundryAccess()) });

aiSettingsApi.get("/ai/config", member, async (_req, res) => {
  res.json(await status());
});

/** Essaie un fournisseur avec les valeurs saisies (pas encore enregistrées), sinon tel qu'il est configuré. */
/** Une clé déjà enregistrée ne part jamais vers une adresse nouvelle : changer l'adresse demande de ressaisir la clé. */
async function sameAddressOrNewKey(provider: AiProvider, patch: ConnectorPatch) {
  if (patch.url === undefined || !patch.url.trim() || patch.key?.trim()) return;
  const [now, next] = await Promise.all([previewConnector(provider, {}), previewConnector(provider, { url: patch.url })]);
  if (now.url !== next.url && (now.key || now.keyUnreadable)) throw new ActionError(400, t("Changer l'adresse du fournisseur demande de ressaisir sa clé."));
}

aiSettingsApi.post("/ai/test", member, requireAdmin, limiter, async (req, res) => {
  const { provider, ...patch } = z.object(fields).parse(req.body);
  await checkUrl(provider, patch.url);
  await sameAddressOrNewKey(provider, patch);
  res.json(await testConnector(await previewConnector(provider, patch)));
});

/**
 * Enregistre un fournisseur et, avec `activate`, le choisit. Le fournisseur qui répond (ou qui va répondre)
 * est essayé d'abord : rien n'est enregistré si l'essai échoue, pour ne jamais couper l'assistant par une
 * faute de frappe. Un fournisseur en réserve s'enregistre tel quel.
 */
aiSettingsApi.put("/ai/config", member, requireAdmin, limiter, async (req, res) => {
  const { provider, activate, ...patch } = z.object({ ...fields, activate: z.boolean().optional() }).parse(req.body);
  await checkUrl(provider, patch.url);
  await sameAddressOrNewKey(provider, patch);
  await loadAiConfig();
  const live = activate || activeConnector().provider === provider;
  if (live) {
    const next = await previewConnector(provider, patch);
    const missing = missingFor(next);
    if (missing) throw new ActionError(400, missing);
    const test = await testConnector(next);
    if (!test.ok) throw new ActionError(400, t("Rien n'a été changé, l'essai a échoué. {erreur}", { erreur: String(test.error) }));
  }
  const changed = (Object.keys(patch) as (keyof ConnectorPatch)[]).filter((k) => patch[k] !== undefined);
  if (changed.length) await saveConnector(provider, patch);
  if (activate) await setActiveProvider(provider);
  void logAudit("PUT /api/ai/config", provider, {
    ...(patch.url !== undefined ? { adresse: patch.url || "retirée" } : {}),
    ...(patch.model !== undefined ? { modele: patch.model || "par défaut" } : {}),
    ...(patch.key !== undefined ? { cle: patch.key.trim() ? "remplacée" : "retirée" } : {}),
    ...(activate ? { choisi: true } : {}),
  });
  res.json(await status());
});
