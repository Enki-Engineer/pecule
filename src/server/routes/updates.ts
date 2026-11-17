import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { requireAdmin } from "../auth.ts";
import { checkUpdates, updateStatus } from "../updates.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Version en service et mises à jour (Réglages → Suivi technique, `node scripts/doctor.mjs`, `node scripts/maj.mjs`) :
 * réservé à l'administrateur — la version d'une installation n'a pas à être lue par n'importe qui — et interdit en
 * démo (BLOCKED, `src/server/demo.ts`). Rien n'est installé depuis l'appli.
 */

export const updatesApi = Router();

/** GitHub n'accepte que soixante demandes anonymes par heure et par adresse : « Vérifier maintenant » reste rare. */
const limiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  keyGenerator: (req) => `maj${req.user?.id ?? 0}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // Fonction : la langue n'est connue qu'au moment de la requête.
  message: () => ({ error: t("Trop de vérifications cette heure-ci : réessaie plus tard.") }),
});

/** Où en est l'installation, d'après la dernière réponse gardée. */
updatesApi.get("/updates", requireAdmin, async (_req, res) => {
  res.json(await updateStatus());
});

/** Pose la question à GitHub tout de suite. */
updatesApi.post("/updates/check", requireAdmin, limiter, async (_req, res) => {
  await checkUpdates({ force: true });
  res.json(await updateStatus());
});
