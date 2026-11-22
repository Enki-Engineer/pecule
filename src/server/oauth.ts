import { createHash, randomBytes } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { exec, one, q } from "./db.ts";
import { origin } from "./env.ts";
import { ActionError } from "./actions.ts";
import { logAudit } from "./journal.ts";
import { loadUser } from "./auth.ts";
import { publicDocument } from "./net.ts";
import { memberLang } from "./lang.ts";
import { DEFAULT_LANG, t, tk, translate } from "../lib/i18n.ts";
import { MCP_CLIENTS, hostedRedirect } from "../lib/mcp-clients.ts";
import {
  SCOPES,
  actionsRequested,
  canWrite,
  cleanClientName,
  clientDocumentUrl,
  clientIdentity,
  grantedScope,
  isLoopback,
  pkceMatches,
  redirectAllowed,
  redirectMatches,
  resourceMatches,
  validChallenge,
  validateClientDocument,
} from "./oauth-rules.ts";

/*
 * Serveur d'autorisation OAuth 2.1 minimal, pour brancher un assistant sur le serveur MCP de Pécule au nom d'un
 * membre (spécification MCP 2025-11-25) : l'appli Claude et les autres assistants reconnus, et tout programme de
 * l'ordinateur du membre (Claude Code, un terminal, un éditeur de code).
 *
 *  - Découverte : /.well-known/oauth-protected-resource (ressource = /api/mcp) et
 *    /.well-known/oauth-authorization-server.
 *  - Client : document d'identité hébergé par son éditeur (client_id = URL, lu sur un hôte public quel qu'il soit)
 *    ou enregistrement dynamique (POST /oauth/register). Clients publics, PKCE S256 obligatoire.
 *    Adresses de retour admises : celles des assistants reconnus (`src/lib/mcp-clients.ts`) et les boucles locales.
 *    Le nom montré au membre vient de l'adresse de retour, pas de ce que le client dit de lui-même.
 *  - Consentement : /oauth/authorize range la demande et renvoie vers l'écran /autoriser, où un membre
 *    connecté par clé d'accès choisit « lecture seule » ou « lecture et actions ».
 *  - Jetons : accès d'une heure (pmca_…), renouvellement tournant de 90 jours (pmcr_…) ; seules les
 *    empreintes sont en base. Un jeton d'accès n'ouvre que POST /api/mcp, dans la vue du membre.
 *  - Révocation : Réglages → Compte et sécurité → Applications connectées.
 */

export const MCP_URL = `${origin}/api/mcp`;
export const RESOURCE_METADATA_URL = `${origin}/.well-known/oauth-protected-resource`;
export const ACCESS_PREFIX = "pmca_";
const REFRESH_PREFIX = "pmcr_";
const ACCESS_TTL_S = 3600;
const REFRESH_TTL_DAYS = 90;
const REQUEST_TTL_MIN = 10;
const CODE_TTL_S = 60;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
/** Où mène une adresse de retour, pour un humain : son hôte, ou son schéma quand elle ouvre une appli de bureau. */
const redirectTarget = (uri: string) => {
  try {
    const u = new URL(uri);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host : `${u.protocol}//${u.host}`;
  } catch {
    return "adresse illisible";
  }
};
const secret = (prefix = "") => prefix + randomBytes(32).toString("base64url");

/* ---------- Découverte ---------- */

const protectedResource = {
  resource: MCP_URL,
  authorization_servers: [origin],
  scopes_supported: SCOPES,
  bearer_methods_supported: ["header"],
  resource_name: "Pécule",
};

const authorizationServer = {
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  client_id_metadata_document_supported: true,
  authorization_response_iss_parameter_supported: true,
  scopes_supported: [...SCOPES, "offline_access"],
};

/* ---------- Clients ---------- */

type Client = { clientId: string; name: string; redirectUris: string[] };

async function storedClient(clientId: string): Promise<(Client & { source: string; fetchedAt: string | null }) | null> {
  const row = await one<{ client_id: string; name: string; redirect_uris: string; source: string; fetched_at: string | null }>(
    "SELECT client_id, name, redirect_uris, source, fetched_at FROM oauth_clients WHERE client_id = ?",
    [clientId],
  );
  // À la lettre : la clé de la table ignore la casse et les accents, deux identifiants voisins ne sont pas le même client.
  return row && row.client_id === clientId ? { clientId: row.client_id, name: row.name, redirectUris: JSON.parse(row.redirect_uris) as string[], source: row.source, fetchedAt: row.fetched_at } : null;
}

/** Taille maximale d'un document d'identité de client, et temps laissé à son hôte pour le donner. */
const DOCUMENT_MAX = 16_384;
const DOCUMENT_TIMEOUT_MS = 5000;
/**
 * Documents qui n'ont pas été admis : pas redemandés tout de suite (n'importe qui peut donner une adresse). Un
 * document lu mais refusé attend dix minutes ; un hôte qui n'a pas répondu, quinze secondes seulement — un incident
 * passager ne doit pas fermer la porte à un client honnête.
 */
const refusedDocuments = new Map<string, number>();
const REFUSED_TTL_MS = 600_000;
const UNREACHABLE_TTL_MS = 15_000;
/** Lectures de documents en cours : au-delà, la demande suivante attend son tour au lieu d'en lancer une de plus. */
let reading = 0;
const MAX_READING = 3;

/**
 * Client connu : enregistré dynamiquement, ou décrit par un document d'identité hébergé chez son éditeur
 * (client_id = URL, relu au plus une fois par jour). L'adresse est donnée par n'importe qui : le document se lit sur
 * un hôte public seulement, à l'adresse contrôlée, sans suivre de redirection, dans une taille et un délai bornés
 * (`publicDocument`).
 */
async function findClient(clientId: string): Promise<Client | null> {
  const known = await storedClient(clientId);
  if (!clientDocumentUrl(clientId)) return known;
  if (known?.fetchedAt && Date.parse(`${known.fetchedAt}Z`) > Date.now() - 86400_000) return known;
  if ((refusedDocuments.get(clientId) ?? 0) > Date.now() || reading >= MAX_READING) return known;
  const refuse = (ttl: number) => {
    if (refusedDocuments.size > 500) refusedDocuments.clear();
    refusedDocuments.set(clientId, Date.now() + ttl);
    return known;
  };
  reading++;
  try {
    const text = await publicDocument(clientId, { maxBytes: DOCUMENT_MAX, timeoutMs: DOCUMENT_TIMEOUT_MS });
    if (text === null) return refuse(UNREACHABLE_TTL_MS);
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      // Pas du JSON : refusé comme un document illisible.
    }
    const doc = validateClientDocument(clientId, json);
    if (typeof doc === "string") return refuse(REFUSED_TTL_MS);
    await exec(
      `INSERT INTO oauth_clients (client_id, name, redirect_uris, source, fetched_at) VALUES (?, ?, ?, 'cimd', UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE name = VALUES(name), redirect_uris = VALUES(redirect_uris), fetched_at = VALUES(fetched_at)`,
      [clientId, doc.name, JSON.stringify(doc.redirectUris)],
    );
    return { clientId, name: doc.name, redirectUris: doc.redirectUris };
  } catch {
    // La base n'a pas pu garder le document : on reste sur la dernière version connue.
    return known;
  } finally {
    reading--;
  }
}

/* ---------- Routes publiques (hors /api) ---------- */

export const oauthRouter = Router();

const noStore = (res: Response) => res.set("Cache-Control", "no-store").set("Pragma", "no-cache");
// Un compteur par route : des enregistrements en rafale n'empêchent pas les renouvellements de jetons des clients honnêtes.
const limited = (limit: number) => rateLimit({ windowMs: 15 * 60_000, limit, standardHeaders: "draft-8", legacyHeaders: false });
const registerLimiter = limited(20);
const authorizeLimiter = limited(60);
const tokenLimiter = limited(120);
/** Clients enregistrés d'eux-mêmes et sans accès en cours, gardés au plus : au-delà, les plus anciens partent. */
const MAX_IDLE_CLIENTS = 300;
const HAS_ACCESS = "client_id IN (SELECT client_id FROM oauth_grants WHERE revoked_at IS NULL AND refresh_expires_at > UTC_TIMESTAMP())";

/** Ménage des clients enregistrés d'eux-mêmes : ceux de plus de 30 jours sans accès en cours, puis les plus anciens au-delà du plafond. */
async function pruneClients() {
  await exec(`DELETE FROM oauth_clients WHERE source = 'dcr' AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND NOT ${HAS_ACCESS}`);
  const edge = await one<{ created_at: string }>(`SELECT created_at FROM oauth_clients WHERE source = 'dcr' AND NOT ${HAS_ACCESS} ORDER BY created_at DESC, client_id LIMIT 1 OFFSET ${MAX_IDLE_CLIENTS}`);
  if (edge) await exec(`DELETE FROM oauth_clients WHERE source = 'dcr' AND created_at <= ? AND NOT ${HAS_ACCESS}`, [edge.created_at]);
}

oauthRouter.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"], (_req, res) => {
  res.set("Cache-Control", "public, max-age=300").json(protectedResource);
});
oauthRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300").json(authorizationServer);
});

/**
 * Enregistrement dynamique (RFC 7591) : client public. Seules ses adresses de retour admises sont gardées — celles
 * d'un assistant reconnu et les boucles locales ; s'il n'en a aucune, la demande est refusée.
 */
oauthRouter.post("/oauth/register", registerLimiter, express.json({ limit: "20kb" }), async (req, res) => {
  const b = z.object({ redirect_uris: z.array(z.string().max(512)).min(1).max(10), client_name: z.string().max(120).optional() }).safeParse(req.body);
  const redirectUris = b.success ? b.data.redirect_uris.filter(redirectAllowed) : [];
  const refused = b.success ? b.data.redirect_uris.filter((uri) => !redirectAllowed(uri)).map(redirectTarget) : [];
  // Trace pour celui qui héberge : un assistant qui n'est pas dans la liste a tenté de s'enregistrer.
  if (refused.length) console.warn(`[oauth] enregistrement : adresse de retour non admise (${refused.join(", ")})`);
  if (!b.success || !redirectUris.length)
    return res.status(400).json({
      error: "invalid_redirect_uri",
      error_description: `Adresses de retour admises : celle d'un assistant reconnu (${MCP_CLIENTS.map((c) => c.name).join(", ")}) ou une boucle locale (http://127.0.0.1:<port>/…, http://localhost:<port>/…). Refusé : ${refused.join(", ") || "demande illisible"}`,
    });
  // Ménage : un enregistrement ouvert à tous ne doit pas pouvoir remplir la base.
  await pruneClients();
  const clientId = secret("pcl_");
  // Le nom gardé est celui que le client se donne, rien de plus : à l'affichage, un assistant reconnu porte le sien
  // d'après l'adresse où le membre retourne (`clientIdentity`), jamais d'après la première adresse enregistrée.
  const name = cleanClientName(b.data.client_name) ?? "";
  await exec("INSERT INTO oauth_clients (client_id, name, redirect_uris, source) VALUES (?, ?, ?, 'dcr')", [clientId, name, JSON.stringify(redirectUris)]);
  noStore(res)
    .status(201)
    .json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
});

/**
 * Page d'erreur montrée dans le navigateur du membre. La route est hors /api, donc sans langContext : la page
 * est écrite dans la langue du membre si sa session est reconnue, sinon en français. `message` : texte marqué `tk`.
 */
async function page(req: Request, res: Response, status: number, message: string) {
  await new Promise<void>((done) => void loadUser(req, res, () => done()));
  const lang = req.user ? await memberLang(req.user.id).catch(() => DEFAULT_LANG) : DEFAULT_LANG;
  const say = (text: string) => translate(lang, text).replace(/[<>&]/g, "");
  res
    .status(status)
    .type("html")
    .send(`<!doctype html><html lang="${lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pécule</title><body style="font:16px system-ui;margin:3rem auto;max-width:32rem;padding:0 1rem"><h1 style="font-size:1.25rem">${say(tk("Connexion à Pécule impossible"))}</h1><p>${say(message)}</p></body></html>`);
}

/** Demande d'autorisation : contrôlée, rangée, puis confiée à l'écran de consentement. */
oauthRouter.get("/oauth/authorize", authorizeLimiter, async (req, res) => {
  const p = z
    .object({
      response_type: z.string().optional(),
      client_id: z.string().max(255),
      redirect_uri: z.string().max(512),
      code_challenge: z.string().optional(),
      code_challenge_method: z.string().optional(),
      state: z.string().max(2000).optional(),
      scope: z.string().max(255).optional(),
      resource: z.string().max(512).optional(),
    })
    .safeParse(req.query);
  if (!p.success) return page(req, res, 400, tk("La demande est incomplète (client ou adresse de retour manquants)."));
  const a = p.data;
  // Client et adresse de retour d'abord : sans eux, on ne renvoie jamais le navigateur ailleurs.
  const client = await findClient(a.client_id);
  if (!client) return page(req, res, 400, tk("Ce client n'est pas reconnu par Pécule."));
  if (!redirectMatches(client.redirectUris, a.redirect_uri)) return page(req, res, 400, tk("L'adresse de retour ne correspond pas à ce client."));
  const back = (error: string, description: string) => {
    const u = new URL(a.redirect_uri);
    u.searchParams.set("error", error);
    u.searchParams.set("error_description", description);
    if (a.state) u.searchParams.set("state", a.state);
    u.searchParams.set("iss", origin);
    res.redirect(302, u.toString());
  };
  if (a.response_type !== "code") return back("unsupported_response_type", "response_type=code attendu");
  if (a.code_challenge_method !== "S256" || !a.code_challenge || !validChallenge(a.code_challenge)) return back("invalid_request", "PKCE S256 obligatoire");
  if (!resourceMatches(a.resource, MCP_URL)) return back("invalid_target", `resource doit être ${MCP_URL}`);
  await exec("DELETE FROM oauth_requests WHERE expires_at < UTC_TIMESTAMP()");
  const id = secret();
  await exec("INSERT INTO oauth_requests (id_hash, client_id, redirect_uri, state, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))", [
    sha256(id),
    client.clientId,
    a.redirect_uri,
    a.state ?? null,
    a.code_challenge,
    a.scope ?? null,
    REQUEST_TTL_MIN,
  ]);
  res.redirect(302, `/autoriser?demande=${id}`);
});

const tokenError = (res: Response, error: string, description: string, status = 400) => noStore(res).status(status).json({ error, error_description: description });

/** Nouveaux jetons d'un accès ; au renouvellement, l'ancien jeton de renouvellement est gardé pour reconnaître un rejeu. */
/**
 * `renewedFrom` : l'empreinte du jeton de renouvellement présenté. L'échange ne se fait que s'il est encore celui de
 * l'accès : de deux renouvellements simultanés du même jeton, un seul aboutit (`null` pour l'autre).
 */
async function issue(grantId: number, scope: string, renewedFrom?: string) {
  const access = secret(ACCESS_PREFIX);
  const refresh = secret(REFRESH_PREFIX);
  const done = await exec(
    `UPDATE oauth_grants SET prev_refresh_hash = ${renewedFrom ? "refresh_hash" : "NULL"}, access_hash = ?, access_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
       refresh_hash = ?, refresh_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE id = ?${renewedFrom ? " AND refresh_hash = ?" : ""}`,
    [sha256(access), ACCESS_TTL_S, sha256(refresh), REFRESH_TTL_DAYS, grantId, ...(renewedFrom ? [renewedFrom] : [])],
  );
  if (!done.affectedRows) return null;
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

/** Échange d'un code contre un accès, ou renouvellement (jeton de renouvellement tournant). */
oauthRouter.post("/oauth/token", tokenLimiter, express.urlencoded({ extended: false, limit: "20kb" }), async (req, res) => {
  // Un paramètre répété arrive en tableau : il est ignoré, la demande est alors incomplète (jamais une erreur du serveur).
  const b: Record<string, string | undefined> = Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string"));
  if (b.grant_type === "authorization_code") {
    if (!b.code || !b.code_verifier || !b.client_id || !b.redirect_uri) return tokenError(res, "invalid_request", "code, code_verifier, client_id et redirect_uri attendus");
    const hash = sha256(b.code);
    const code = await one<{ client_id: string; user_id: number; redirect_uri: string; code_challenge: string; scope: string; used_at: string | null; grant_id: number | null; expired: number }>(
      "SELECT client_id, user_id, redirect_uri, code_challenge, scope, used_at, grant_id, expires_at < UTC_TIMESTAMP() AS expired FROM oauth_codes WHERE code_hash = ?",
      [hash],
    );
    if (!code) return tokenError(res, "invalid_grant", "Code inconnu");
    if (code.used_at) {
      // Code présenté deux fois : l'accès qu'il avait ouvert est révoqué.
      if (code.grant_id) await exec("UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE id = ?", [code.grant_id]);
      return tokenError(res, "invalid_grant", "Code déjà utilisé");
    }
    if (code.expired) return tokenError(res, "invalid_grant", "Code expiré");
    if (code.client_id !== b.client_id || code.redirect_uri !== b.redirect_uri) return tokenError(res, "invalid_grant", "Client ou adresse de retour différents de la demande");
    if (!pkceMatches(b.code_verifier, code.code_challenge)) return tokenError(res, "invalid_grant", "Vérifieur PKCE incorrect");
    if (!resourceMatches(b.resource, MCP_URL)) return tokenError(res, "invalid_target", `resource doit être ${MCP_URL}`);
    // Usage unique : un seul échange peut marquer le code.
    const used = await exec("UPDATE oauth_codes SET used_at = UTC_TIMESTAMP() WHERE code_hash = ? AND used_at IS NULL", [hash]);
    if (used.affectedRows !== 1) return tokenError(res, "invalid_grant", "Code déjà utilisé");
    const client = await storedClient(code.client_id);
    const grant = await exec(
      // Empreintes provisoires (jetons jamais émis), remplacées aussitôt par issue().
      "INSERT INTO oauth_grants (user_id, client_id, client_name, scope, access_hash, access_expires_at, refresh_hash, refresh_expires_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, UTC_TIMESTAMP())",
      // Nom vide : un programme de l'ordinateur qui ne s'est pas nommé (dit à l'affichage, dans la langue du membre).
      [code.user_id, code.client_id, clientIdentity(code.redirect_uri, client?.name).name ?? "", code.scope, sha256(secret()), sha256(secret())],
    );
    await exec("UPDATE oauth_codes SET grant_id = ? WHERE code_hash = ?", [grant.insertId, hash]);
    return noStore(res).json(await issue(grant.insertId, code.scope));
  }
  if (b.grant_type === "refresh_token") {
    if (!b.refresh_token) return tokenError(res, "invalid_request", "refresh_token attendu");
    const hash = sha256(b.refresh_token);
    const grant = await one<{ id: number; client_id: string; scope: string; revoked_at: string | null; expired: number }>(
      "SELECT id, client_id, scope, revoked_at, refresh_expires_at < UTC_TIMESTAMP() AS expired FROM oauth_grants WHERE refresh_hash = ?",
      [hash],
    );
    if (!grant) {
      // Ancien jeton de renouvellement rejoué : signe d'un vol, l'accès est révoqué.
      await exec("UPDATE oauth_grants SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE prev_refresh_hash = ?", [hash]);
      return tokenError(res, "invalid_grant", "Jeton de renouvellement invalide");
    }
    if (grant.revoked_at || grant.expired) return tokenError(res, "invalid_grant", "Accès révoqué ou expiré");
    if (b.client_id && b.client_id !== grant.client_id) return tokenError(res, "invalid_grant", "Client différent");
    const renewed = await issue(grant.id, grant.scope, hash);
    // Le même jeton vient d'être échangé par une autre demande : celle-ci n'en reçoit pas un second jeu.
    if (!renewed) return tokenError(res, "invalid_grant", "Jeton de renouvellement déjà utilisé");
    return noStore(res).json(renewed);
  }
  return tokenError(res, "unsupported_grant_type", "authorization_code ou refresh_token attendu");
});

/* ---------- Vérification d'un jeton d'accès (serveur MCP) ---------- */

export type OAuthIdentity = { id: number; name: string; grantId: number; canWrite: boolean };

export async function verifyAccessToken(token: string): Promise<OAuthIdentity | null> {
  const row = await one<{ id: number; user_id: number; name: string; scope: string; last_used_at: string | null }>(
    `SELECT g.id, g.user_id, u.name, g.scope, g.last_used_at FROM oauth_grants g JOIN users u ON u.id = g.user_id
     WHERE g.access_hash = ? AND g.revoked_at IS NULL AND g.access_expires_at > UTC_TIMESTAMP()`,
    [sha256(token)],
  );
  if (!row) return null;
  // Dernier usage : mis à jour au plus toutes les cinq minutes.
  if (!row.last_used_at || Date.parse(`${row.last_used_at}Z`) < Date.now() - 300_000) await exec("UPDATE oauth_grants SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [row.id]);
  return { id: row.user_id, name: row.name, grantId: row.id, canWrite: canWrite(row.scope) };
}

/* ---------- Écran de consentement et accès accordés (sous /api, session d'un membre) ---------- */

/**
 * Une des adresses de retour du client ne mène pas chez un éditeur reconnu : il a pu revenir par un programme de
 * l'ordinateur, et son nom n'est alors que celui qu'il se donne. (Un client qui enregistrerait l'adresse d'un
 * assistant reconnu à côté d'une boucle locale ne s'affiche pas sous le nom de cet assistant.)
 */
function maybeLocal(redirectUris: string | null): boolean {
  if (!redirectUris) return false; // Client d'avant ce contrôle, ou retiré : on garde son nom tel quel.
  try {
    return !(JSON.parse(redirectUris) as string[]).every(hostedRedirect);
  } catch {
    return false;
  }
}

export const oauthApi = Router();

function member(req: Request) {
  if (req.user?.via !== "session") throw new ActionError(401, t("Connexion par clé d'accès requise"));
  return req.user;
}

async function pendingRequest(id: string) {
  const r = await one<{ client_id: string; redirect_uri: string; state: string | null; code_challenge: string; scope: string | null }>(
    "SELECT client_id, redirect_uri, state, code_challenge, scope FROM oauth_requests WHERE id_hash = ? AND expires_at > UTC_TIMESTAMP()",
    [sha256(id)],
  );
  if (!r) throw new ActionError(404, t("Demande expirée : relance la connexion depuis ton assistant"));
  return r;
}

oauthApi.get("/oauth/requests/:id", async (req, res) => {
  const user = member(req);
  const r = await pendingRequest(z.string().max(128).parse(req.params.id));
  const client = await storedClient(r.client_id);
  const identity = clientIdentity(r.redirect_uri, client?.name);
  res.json({
    // Assistant reconnu : son nom, tiré de la liste. Sinon le nom que se donne un programme de l'ordinateur (ou rien).
    client: identity.name,
    known: identity.known,
    redirectHost: redirectTarget(r.redirect_uri),
    loopback: isLoopback(r.redirect_uri),
    member: user.name,
    actionsRequested: actionsRequested(r.scope),
  });
});

oauthApi.post("/oauth/requests/:id/decision", async (req, res) => {
  const user = member(req);
  const id = z.string().max(128).parse(req.params.id);
  const b = z.object({ approve: z.boolean(), actions: z.boolean().optional() }).parse(req.body);
  const r = await pendingRequest(id);
  await exec("DELETE FROM oauth_requests WHERE id_hash = ?", [sha256(id)]);
  const u = new URL(r.redirect_uri);
  if (r.state) u.searchParams.set("state", r.state);
  u.searchParams.set("iss", origin);
  if (!b.approve) {
    u.searchParams.set("error", "access_denied");
    return res.json({ redirect: u.toString() });
  }
  // Jamais plus que ce que le client a demandé : les actions ne s'accordent que s'il les demandait.
  const scope = grantedScope(b.actions === true && actionsRequested(r.scope));
  const code = secret();
  await exec("DELETE FROM oauth_codes WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)");
  await exec("INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, expires_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))", [
    sha256(code),
    r.client_id,
    user.id,
    r.redirect_uri,
    r.code_challenge,
    scope,
    CODE_TTL_S,
  ]);
  const client = await storedClient(r.client_id);
  await logAudit("Accès au serveur MCP accordé", clientIdentity(r.redirect_uri, client?.name).name ?? "programme de cet ordinateur", { portee: scope, retour: redirectTarget(r.redirect_uri) });
  u.searchParams.set("code", code);
  res.json({ redirect: u.toString() });
});

/** Accès accordés par le membre connecté (applications connectées). */
oauthApi.get("/oauth/grants", async (req, res) => {
  const user = member(req);
  const rows = await q<{ id: number; client_name: string; scope: string; created_at: string; last_used_at: string | null; redirect_uris: string | null }>(
    `SELECT g.id, g.client_name, g.scope, g.created_at, g.last_used_at, c.redirect_uris FROM oauth_grants g LEFT JOIN oauth_clients c ON c.client_id = g.client_id
     WHERE g.user_id = ? AND g.revoked_at IS NULL AND g.refresh_expires_at > UTC_TIMESTAMP() ORDER BY g.created_at DESC`,
    [user.id],
  );
  res.json({
    grants: rows.map((g) => ({
      id: g.id,
      // `local` : peut-être un programme de l'ordinateur, dont le nom n'est que celui qu'il s'est donné (une de ses adresses ne mène pas chez un éditeur reconnu).
      client: g.client_name || null,
      local: maybeLocal(g.redirect_uris),
      actions: canWrite(g.scope),
      createdAt: g.created_at,
      lastUsedAt: g.last_used_at,
    })),
  });
});

oauthApi.delete("/oauth/grants/:id", async (req, res) => {
  const user = member(req);
  const r = await exec("UPDATE oauth_grants SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND revoked_at IS NULL", [z.coerce.number().int().parse(req.params.id), user.id]);
  if (!r.affectedRows) throw new ActionError(404, t("Accès introuvable"));
  res.json({ ok: true });
});
