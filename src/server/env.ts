import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { mergeSettings, parseSettings, SETTINGS_FILE } from "../lib/settings-file.ts";
import { DEFAULT_REPO } from "../lib/version.ts";

/*
 * Réglages gardés par l'installation elle-même (`src/lib/settings-file.ts`). SETTINGS_DIR n'est donné que par l'image
 * Docker : `compose.yaml` y monte le volume « pecule-reglages », où son service « reglages » range les secrets
 * qu'il a tirés. Ils complètent l'environnement sans jamais le remplacer. Sans SETTINGS_DIR, rien ne change.
 */
const settingsDir = process.env.SETTINGS_DIR?.trim();
if (settingsDir) {
  const file = path.join(settingsDir, SETTINGS_FILE);
  if (existsSync(file)) mergeSettings(process.env, parseSettings(readFileSync(file, "utf8")));
}

/** Réglage « oui par défaut » : 0, false, non, no ou off le coupent. */
const onOff = z
  .string()
  .default("1")
  .transform((v) => !["0", "false", "non", "no", "off"].includes(v.trim().toLowerCase()));

const schema = z.object({
  /**
   * « production » sans rien dire : une installation dont les réglages ont été écrits à la main, sans cette ligne, ne
   * démarre pas en mode développement (témoins sans « Secure », scripts en ligne admis, serveur de développement de
   * l'écran exposé). Le développement le demande (`pnpm dev`, `pnpm local dev`), les tests aussi.
   */
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  PORT: z.coerce.number().default(3000),
  /**
   * Interface où le serveur écoute. Absent : toutes (un hébergeur, un conteneur, un proxy le joignent d'où ils sont).
   * `127.0.0.1` : la machine seule — c'est ce que règle l'appli de bureau, où rien ne doit sortir de l'ordinateur.
   */
  LISTEN_HOST: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  DATABASE_URL: z.string().min(1),
  /** Mode démo : base séparée remplie de données fictives (désactivé si absent). */
  DEMO_DATABASE_URL: z.string().optional(),
  APP_URL: z.url(),
  /** Jeton d'administration (Claude, scripts d'import) : accès complet à l'API en Bearer. */
  API_TOKEN: z.string().min(32),
  /**
   * Code demandé au premier démarrage pour créer le premier membre (il ne sert plus ensuite). Absent : c'est le jeton
   * d'administration qui en tient lieu.
   */
  SETUP_CODE: z.string().min(16).optional(),
  /**
   * Secret qui chiffre les clés gardées en base (banque, IA, notifications). Distinct du jeton d'administration :
   * on peut alors changer le jeton sans rien ressaisir. Absent : c'est le jeton d'administration qui en tient lieu.
   */
  SECRET_KEY: z.string().min(32).optional(),
  /** Jeton limité au déclenchement de la synchro (tâche planifiée de l'hébergeur : `POST /api/sync`). */
  SYNC_TOKEN: z.string().min(32),
  /** Finta (agrégateur bancaire) : facultatif. Sans clé, cette source n'est simplement pas lue. */
  FINTA_API_KEY: z.string().startsWith("finta_").optional(),
  /** Assistant IA (Claude sur Microsoft Foundry) : désactivé si la ressource ou la clé manquent. */
  AI_FOUNDRY_RESOURCE: z.string().optional(),
  AI_FOUNDRY_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  /** Effort de l'assistant (réflexion adaptative) ; AI_EFFORT reste celui des lectures de documents. */
  /** Contact indiqué aux services de notification (VAPID) ; facultatif. */
  VAPID_CONTACT: z.string().optional(),
  AI_ASSISTANT_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
  /** Mode vocal de l'assistant, sur la même ressource Foundry : déploiement de transcription (chaîne vide = mode vocal désactivé) et voix par défaut (identifiant de VOICES, `src/lib/voice.ts`). */
  AI_STT_DEPLOYMENT: z.string().default("gpt-transcribe"),
  AI_TTS_VOICE: z.string().default("vivienne"),
  /** Crypto : quantités synchronisées depuis CoinStats (clé sans portée : lecture seule imposée par le code). */
  COINSTATS_API_KEY: z.string().optional(),
  /** Prénom du membre propriétaire du compte CoinStats (les positions synchronisées lui appartiennent) ; à défaut, l'administrateur. */
  COINSTATS_OWNER: z.string().optional(),
  /** Cours CoinGecko : clé Demo gratuite (sans clé, limite par IP partagée sur l'hébergement mutualisé). */
  COINGECKO_DEMO_KEY: z.string().optional(),
  /** Synchro automatique toutes les N minutes (0 = désactivée). */
  SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).default(60),
  /** Nombre de proxys entre Internet et Pécule (1 : un seul, cas d'un hébergeur ou de Caddy ; 0 : aucun). Sert à lire la vraie adresse du visiteur. */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(1),
  /** Une fois par jour, demander à GitHub si une version plus récente de Pécule est publiée (0 : ne jamais le demander). */
  UPDATE_CHECK: onOff,
  /** Dépôt GitHub dont les versions publiées sont suivies (« propriétaire/dépôt ») : à changer pour une copie du projet. */
  UPDATE_REPO: z
    .string()
    .optional()
    // Une valeur vide ou mal écrite n'empêche pas le serveur de démarrer : le dépôt d'origine est repris.
    .transform((v) => (v && /^[\w.-]+\/[\w.-]+$/.test(v.trim()) ? v.trim() : DEFAULT_REPO)),
  /** Avant d'appliquer une migration à une base déjà remplie, écrire une sauvegarde complète sur le serveur (0 : ne pas le faire). */
  BACKUP_BEFORE_MIGRATION: onOff,
  /**
   * Dossier des sauvegardes écrites par le serveur. Facultatif : sans lui, le serveur en choisit un qui survit à une
   * mise à jour (`src/server/backup-dir.ts` : un dossier du compte du serveur, hors de l'installation ; le volume avec Docker).
   */
  BACKUP_DIR: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Un réglage manque ou n'a pas la bonne forme : le dire en clair, sans sa valeur, plutôt que par une pile d'appels.
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "réglages"} : ${/received undefined/.test(i.message) ? "absent" : i.message}`);
  console.error(`Pécule ne peut pas démarrer : réglages absents ou invalides.\n${lines.join("\n")}\nLes écrire : node scripts/setup.mjs --help — les contrôler : node scripts/doctor.mjs (guide : docs/guide/installation.md).`);
  process.exit(1);
}
export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
/** Secret de chiffrement des clés gardées en base (voir SECRET_KEY). */
export const sealingSecret = env.SECRET_KEY ?? env.API_TOKEN;

const appUrl = new URL(env.APP_URL);
/** Identifiant WebAuthn : les passkeys sont liées à ce nom d'hôte. */
export const rpID = appUrl.hostname;
export const origin = appUrl.origin;
/** L'appli est servie en https (sinon : essai en local, sur http://localhost). */
export const secureOrigin = appUrl.protocol === "https:";
