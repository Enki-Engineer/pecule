import { createHash } from "node:crypto";

/*
 * Règles du serveur d'autorisation OAuth de Pécule (connexion de l'appli Claude au serveur MCP).
 * Fonctions pures, testées : PKCE, adresses de retour admises, ressource visée, portées.
 * Politique : seuls Claude (claude.ai, appli mobile, Desktop) et Claude Code peuvent être clients —
 * l'adresse de retour doit être celle de Claude ou une boucle locale « /callback ».
 */

/** Adresse de retour des applis Claude hébergées (web, Desktop, mobile). */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
/** Hôtes dont on accepte le document d'identité de client (client_id = URL). */
export const TRUSTED_CLIENT_HOSTS = ["claude.ai", "claude.com"];

export const SCOPE_READ = "pecule:lecture";
export const SCOPE_WRITE = "pecule:actions";
export const SCOPES = [SCOPE_READ, SCOPE_WRITE];

/** Boucle locale d'un client natif (Claude Code) : http://localhost[:port]/callback ou http://127.0.0.1[:port]/callback. */
export function isLoopback(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/callback" && !u.search && !u.hash && !u.username;
  } catch {
    return false;
  }
}

/** Adresse de retour admise par Pécule, quel que soit le client. */
export const redirectAllowed = (uri: string) => uri === CLAUDE_CALLBACK || isLoopback(uri);

/** L'adresse demandée fait-elle partie de celles du client ? Égalité stricte, sauf le port d'une boucle locale (RFC 8252). */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (!redirectAllowed(requested)) return false;
  if (registered.includes(requested)) return true;
  if (!isLoopback(requested)) return false;
  const host = new URL(requested).hostname;
  return registered.some((r) => isLoopback(r) && new URL(r).hostname === host);
}

/** PKCE S256 : le vérifieur (43 à 128 caractères non réservés) doit redonner le défi. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

export const validChallenge = (c: string) => /^[A-Za-z0-9\-_]{43}$/.test(c);

/** La ressource demandée (RFC 8707) doit être le serveur MCP de Pécule ; absente, on l'admet. */
export function resourceMatches(resource: string | undefined, mcpUrl: string): boolean {
  if (!resource) return true;
  return resource.replace(/\/$/, "").toLowerCase() === mcpUrl.toLowerCase();
}

/**
 * Portées accordées : la lecture toujours ; les actions seulement si le membre les accepte à l'écran de
 * consentement. Les portées inconnues (offline_access…) sont ignorées.
 */
export const grantedScope = (allowActions: boolean) => (allowActions ? `${SCOPE_READ} ${SCOPE_WRITE}` : SCOPE_READ);
export const canWrite = (scope: string) => scope.split(" ").includes(SCOPE_WRITE);

/** Document d'identité d'un client (client_id = URL) : contrôles de forme, hôte de confiance, adresses de retour admises. */
export function validateClientDocument(url: string, doc: unknown): { name: string; redirectUris: string[] } | string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "client_id invalide";
  }
  if (u.protocol !== "https:" || !TRUSTED_CLIENT_HOSTS.includes(u.hostname) || u.pathname === "/") return "client non reconnu";
  if (!doc || typeof doc !== "object") return "document du client illisible";
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url) return "le document ne correspond pas au client_id";
  const uris = Array.isArray(d.redirect_uris) ? d.redirect_uris.filter((x): x is string => typeof x === "string") : [];
  const allowed = uris.filter(redirectAllowed);
  if (!allowed.length) return "aucune adresse de retour admise";
  return { name: typeof d.client_name === "string" && d.client_name.trim() ? d.client_name.trim().slice(0, 120) : u.hostname, redirectUris: allowed };
}
