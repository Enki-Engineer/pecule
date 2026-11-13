import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3000),
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
  /** Jeton limité au déclenchement de la synchro (tâche planifiée hPanel). */
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
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
/** Secret de chiffrement des clés gardées en base (voir SECRET_KEY). */
export const sealingSecret = env.SECRET_KEY ?? env.API_TOKEN;

const appUrl = new URL(env.APP_URL);
/** Identifiant WebAuthn : les passkeys sont liées à ce nom d'hôte. */
export const rpID = appUrl.hostname;
export const origin = appUrl.origin;
/** L'appli est servie en https (sinon : essai en local, sur http://localhost). */
export const secureOrigin = appUrl.protocol === "https:";
