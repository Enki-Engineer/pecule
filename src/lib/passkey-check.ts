import { addressInfo } from "./address.ts";

/*
 * Pourquoi une clé d'accès ne peut pas servir ici, dit avant le geste et après un refus. Un navigateur ne crée une
 * clé d'accès que dans un contexte qu'il juge sûr, sur un nom (jamais une adresse IP), avec un certificat qu'il
 * reconnaît, et elle ne vaut qu'à l'adresse de l'installation. Quand il refuse, il ne dit presque rien : « opération
 * non autorisée », que l'on ait annulé ou qu'il ait refusé de lui-même. Ces règles font la différence.
 */

/** Ce que l'écran sait de la page avant tout geste. */
export type PageFacts = {
  /** L'adresse ouverte (`location.origin`). */
  origin: string;
  /** Le navigateur juge-t-il ce contexte sûr (`isSecureContext`) ? */
  secure: boolean;
  /** Le navigateur connaît-il les clés d'accès (`PublicKeyCredential`) ? */
  webauthn: boolean;
  /** L'adresse où l'installation est servie, dite par le serveur. */
  expected?: string | null;
  /** L'appli de bureau : on y entre par mot de passe, quoi que sache faire sa fenêtre. */
  desktop?: boolean;
};

/**
 * Ce qui empêche une clé d'accès de servir sur cette page :
 * - `adresse` : la page n'est pas ouverte à l'adresse de l'installation (rien n'y marchera, mot de passe compris) ;
 * - `bureau` : l'appli de bureau, servie sur la machine elle-même (`src/lib/desktop.ts`) ;
 * - `ip` : l'adresse est une adresse IP ;
 * - `http` : le contexte n'est pas sûr (http hors de localhost) ;
 * - `navigateur` : ce navigateur ne connaît pas les clés d'accès.
 */
export type PasskeyBlock = "adresse" | "bureau" | "ip" | "http" | "navigateur";

export function passkeyBlock(page: PageFacts): PasskeyBlock | null {
  if (page.expected && page.expected !== page.origin) return "adresse";
  if (page.desktop) return "bureau";
  if (addressInfo(page.origin)?.ip) return "ip";
  if (!page.secure) return "http";
  if (!page.webauthn) return "navigateur";
  return null;
}

/**
 * Pourquoi le geste a échoué :
 * - `annule` : la personne a fermé la fenêtre du navigateur, ou laissé passer le délai ;
 * - `refus` : le navigateur a refusé aussitôt, sans rien demander ;
 * - `certificat` : il ne fait pas confiance au certificat de l'adresse ;
 * - `adresse` : l'adresse n'est pas un nom valable, ou n'est pas celle de l'installation ;
 * - `existe` : cet appareil a déjà une clé d'accès pour ce membre ;
 * - `appareil` : l'appareil ne sait pas garder de clé d'accès ;
 * - `autre` : autre chose (une réponse du serveur, par exemple) — son message se montre tel quel.
 */
export type PasskeyFailure = "annule" | "refus" | "certificat" | "adresse" | "existe" | "appareil" | "autre";

/** En deçà, personne n'a eu le temps de lire une fenêtre et de la fermer : le navigateur a refusé de lui-même. */
const TOO_FAST_MS = 800;

export function passkeyFailure(error: unknown, elapsedMs: number): PasskeyFailure {
  if (!error || typeof error !== "object") return "autre";
  const { name, message, code } = error as { name?: unknown; message?: unknown; code?: unknown };
  const text = typeof message === "string" ? message : "";
  if (code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID" || name === "SecurityError") return "adresse";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || name === "InvalidStateError") return "existe";
  if (name === "NotSupportedError" || name === "ConstraintError") return "appareil";
  if (name === "NotAllowedError") {
    if (/certificate/i.test(text)) return "certificat";
    return elapsedMs < TOO_FAST_MS ? "refus" : "annule";
  }
  if (name === "AbortError") return "annule";
  return "autre";
}
