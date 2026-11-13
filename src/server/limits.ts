import { rateLimit } from "express-rate-limit";
import { t } from "../lib/i18n.ts";

/**
 * Limite de débit par membre et par heure pour une route coûteuse (appel à l'IA, à une banque, à un service payant,
 * envoi de fichier). Chaque appel crée son propre compteur : à poser une fois, à la déclaration de la route.
 */
export const hourly = (limit: number) =>
  rateLimit({
    windowMs: 3600_000,
    limit,
    keyGenerator: (req) => `u${req.user?.id ?? 0}`,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Fonction : la langue n'est connue qu'au moment de la requête.
    message: () => ({ error: t("Trop de demandes cette heure-ci : réessaie plus tard.") }),
  });
