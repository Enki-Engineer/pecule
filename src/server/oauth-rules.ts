import { createHash } from "node:crypto";
import { hostedRedirect, knownClient } from "../lib/mcp-clients.ts";

/*
 * Règles du serveur d'autorisation OAuth de Pécule (connexion d'un assistant au serveur MCP).
 * Fonctions pures, testées : PKCE, adresses de retour admises, ressource visée, portées.
 * Politique : un client revient soit à l'adresse d'un assistant reconnu (`src/lib/mcp-clients.ts`), soit par une
 * boucle locale — un programme de l'ordinateur du membre. Toute autre adresse de retour est refusée.
 */

/** Adresse de retour des applis Claude hébergées (web, Desktop, mobile). */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

export const SCOPE_READ = "pecule:lecture";
export const SCOPE_WRITE = "pecule:actions";
export const SCOPES = [SCOPE_READ, SCOPE_WRITE];

const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]", "localhost"];

/**
 * Boucle locale d'un client natif (RFC 8252, § 7.3) : `http://127.0.0.1`, `http://[::1]` ou `http://localhost`, port
 * et chemin au choix du client (Claude Code revient à « /callback », d'autres à « /oauth/callback » ou à la racine).
 * Ce qui y revient ne quitte pas l'ordinateur du membre : seul un programme qu'il a lancé peut le recevoir.
 */
export function isLoopback(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" && LOOPBACK_HOSTS.includes(u.hostname) && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Adresse de retour admise par Pécule : celle d'un assistant reconnu, ou une boucle locale. */
export const redirectAllowed = (uri: string) => knownClient(uri) !== null || isLoopback(uri);

/**
 * L'adresse demandée fait-elle partie de celles du client ? Égalité stricte, sauf le port d'une boucle locale, choisi
 * au lancement (RFC 8252) : l'hôte et le chemin restent ceux que le client a enregistrés.
 */
export function redirectMatches(registered: string[], requested: string): boolean {
  if (!redirectAllowed(requested)) return false;
  if (registered.includes(requested)) return true;
  if (!isLoopback(requested)) return false;
  const u = new URL(requested);
  return registered.some((r) => {
    if (!isLoopback(r)) return false;
    const known = new URL(r);
    return known.hostname === u.hostname && known.pathname === u.pathname;
  });
}

/**
 * Nom d'un client tel qu'il se donne : sans caractère invisible (contrôle, sens d'écriture inversé, largeur nulle),
 * ni chevron, ni guillemet — il s'affiche entre guillemets, comme une citation —, 60 caractères au plus.
 */
export const cleanClientName = (name: unknown): string | null => {
  const s = typeof name === "string" ? name.replace(/[\p{C}<>«»"“”]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
  return s || null;
};

/**
 * Qui le membre est en train de connecter, d'après l'adresse où il retournera — pas d'après ce que le client dit de
 * lui-même, que n'importe qui peut écrire. `known` : le retour se fait chez l'éditeur d'un assistant reconnu, dont le
 * nom vient de la liste ; sinon c'est un programme de l'ordinateur (boucle locale, ou appli ouverte par son schéma),
 * avec le nom de la liste si l'adresse y figure, à défaut celui qu'il se donne (`null` s'il n'en donne pas).
 */
export function clientIdentity(redirectUri: string, declared: unknown): { known: boolean; name: string | null } {
  const client = knownClient(redirectUri);
  return { known: hostedRedirect(redirectUri), name: client?.name ?? cleanClientName(declared) };
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

/**
 * Un `client_id` qui est l'adresse d'un document d'identité (spécification MCP 2025-11-25) : https, avec un chemin,
 * sans identifiants ni fragment, et écrite sous sa forme canonique — hôte en minuscules et en ASCII, port par défaut
 * omis (deux écritures d'une même adresse, ou deux hôtes qui ne diffèrent que par un accent, ne font pas deux
 * clients). Son hôte n'a pas à être connu : ce qui protège le membre, ce sont les adresses de retour, que le document
 * ne peut choisir que parmi celles admises pour tous.
 */
export function clientDocumentUrl(clientId: string): URL | null {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname !== "/" && !u.username && !u.password && !u.hash && u.href === clientId ? u : null;
  } catch {
    return null;
  }
}

/** Document d'identité d'un client (client_id = URL) : contrôles de forme, et seulement ses adresses de retour admises. */
export function validateClientDocument(url: string, doc: unknown): { name: string; redirectUris: string[] } | string {
  const u = clientDocumentUrl(url);
  if (!u) return "client_id invalide";
  if (!doc || typeof doc !== "object") return "document du client illisible";
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url) return "le document ne correspond pas au client_id";
  const uris = Array.isArray(d.redirect_uris) ? d.redirect_uris.filter((x): x is string => typeof x === "string").slice(0, 20) : [];
  const allowed = uris.filter(redirectAllowed);
  if (!allowed.length) return "aucune adresse de retour admise";
  return { name: cleanClientName(d.client_name) ?? u.hostname.slice(0, 60), redirectUris: allowed };
}
