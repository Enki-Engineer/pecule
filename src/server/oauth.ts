import { createHash, randomBytes } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { exec, one, q } from "./db.ts";
import { origin } from "./env.ts";
import { ActionError } from "./actions.ts";
import { logAudit } from "./journal.ts";
import { loadUser } from "./auth.ts";
import { memberLang } from "./lang.ts";
import { DEFAULT_LANG, t, tk, translate } from "../lib/i18n.ts";
import {
  CLAUDE_CALLBACK,
  SCOPES,
  SCOPE_WRITE,
  TRUSTED_CLIENT_HOSTS,
  canWrite,
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
 * Serveur d'autorisation OAuth 2.1 minimal, pour brancher l'appli Claude (web, Desktop, iPhone) et
 * Claude Code sur le serveur MCP de Pécule au nom d'un membre (spécification MCP 2025-11-25).
 *
 *  - Découverte : /.well-known/oauth-protected-resource (ressource = /api/mcp) et
 *    /.well-known/oauth-authorization-server.
 *  - Client : document d'identité hébergé par Claude (client_id = URL, hôtes de confiance) ou
 *    enregistrement dynamique (POST /oauth/register). Clients publics, PKCE S256 obligatoire.
 *    Seules l'adresse de retour de Claude et les boucles locales « /callback » sont admises.
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
  return row ? { clientId: row.client_id, name: row.name, redirectUris: JSON.parse(row.redirect_uris) as string[], source: row.source, fetchedAt: row.fetched_at } : null;
}

/** Client connu : enregistré dynamiquement, ou décrit par un document hébergé chez Claude (relu au plus une fois par jour). */
async function findClient(clientId: string): Promise<Client | null> {
  const known = await storedClient(clientId);
  if (!/^https:\/\//.test(clientId)) return known;
  if (known?.fetchedAt && Date.parse(`${known.fetchedAt}Z`) > Date.now() - 86400_000) return known;
  let host: string;
  try {
    host = new URL(clientId).hostname;
  } catch {
    return null;
  }
  // Aucun appel sortant vers un hôte qui n'est pas de confiance (pas de requête forgée côté serveur).
  if (!TRUSTED_CLIENT_HOSTS.includes(host)) return null;
  try {
    const res = await fetch(clientId, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
    const text = res.ok ? await res.text() : "";
    const doc = validateClientDocument(clientId, text.length && text.length < 65_536 ? JSON.parse(text) : null);
    if (typeof doc === "string") return known;
    await exec(
      `INSERT INTO oauth_clients (client_id, name, redirect_uris, source, fetched_at) VALUES (?, ?, ?, 'cimd', UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE name = VALUES(name), redirect_uris = VALUES(redirect_uris), fetched_at = VALUES(fetched_at)`,
      [clientId, doc.name, JSON.stringify(doc.redirectUris)],
    );
    return { clientId, name: doc.name, redirectUris: doc.redirectUris };
  } catch {
    // Document injoignable : on garde la dernière version connue.
    return known;
  }
}

/* ---------- Routes publiques (hors /api) ---------- */

export const oauthRouter = Router();

const noStore = (res: Response) => res.set("Cache-Control", "no-store").set("Pragma", "no-cache");
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false });

oauthRouter.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/api/mcp"], (_req, res) => {
  res.set("Cache-Control", "public, max-age=300").json(protectedResource);
});
oauthRouter.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300").json(authorizationServer);
});

/** Enregistrement dynamique (RFC 7591) : client public, adresses de retour de Claude ou boucle locale seulement. */
oauthRouter.post("/oauth/register", limiter, express.json({ limit: "20kb" }), async (req, res) => {
  const b = z.object({ redirect_uris: z.array(z.string().max(512)).min(1).max(10), client_name: z.string().max(120).optional() }).safeParse(req.body);
  if (!b.success || !b.data.redirect_uris.every(redirectAllowed))
    return res.status(400).json({ error: "invalid_redirect_uri", error_description: `Adresses de retour admises : ${CLAUDE_CALLBACK} ou une boucle locale http://localhost/callback` });
  // Ménage : clients enregistrés depuis plus de 30 jours et jamais autorisés.
  await exec(
    "DELETE FROM oauth_clients WHERE source = 'dcr' AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) AND client_id NOT IN (SELECT client_id FROM oauth_grants WHERE revoked_at IS NULL)",
  );
  const clientId = secret("pcl_");
  const name = b.data.client_name?.trim() || "Claude";
  await exec("INSERT INTO oauth_clients (client_id, name, redirect_uris, source) VALUES (?, ?, ?, 'dcr')", [clientId, name, JSON.stringify(b.data.redirect_uris)]);
  noStore(res)
    .status(201)
    .json({
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: b.data.redirect_uris,
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
oauthRouter.get("/oauth/authorize", limiter, async (req, res) => {
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
async function issue(grantId: number, scope: string, renewal: boolean) {
  const access = secret(ACCESS_PREFIX);
  const refresh = secret(REFRESH_PREFIX);
  await exec(
    `UPDATE oauth_grants SET prev_refresh_hash = ${renewal ? "refresh_hash" : "NULL"}, access_hash = ?, access_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
       refresh_hash = ?, refresh_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE id = ?`,
    [sha256(access), ACCESS_TTL_S, sha256(refresh), REFRESH_TTL_DAYS, grantId],
  );
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}

/** Échange d'un code contre un accès, ou renouvellement (jeton de renouvellement tournant). */
oauthRouter.post("/oauth/token", limiter, express.urlencoded({ extended: false, limit: "20kb" }), async (req, res) => {
  const b = (req.body ?? {}) as Record<string, string | undefined>;
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
      [code.user_id, code.client_id, client?.name ?? "Claude", code.scope, sha256(secret()), sha256(secret())],
    );
    await exec("UPDATE oauth_codes SET grant_id = ? WHERE code_hash = ?", [grant.insertId, hash]);
    return noStore(res).json(await issue(grant.insertId, code.scope, false));
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
    return noStore(res).json(await issue(grant.id, grant.scope, true));
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
  if (!r) throw new ActionError(404, t("Demande expirée : relance la connexion depuis Claude"));
  return r;
}

oauthApi.get("/oauth/requests/:id", async (req, res) => {
  const user = member(req);
  const r = await pendingRequest(z.string().max(128).parse(req.params.id));
  const client = await storedClient(r.client_id);
  res.json({
    client: client?.name ?? "Claude",
    redirectHost: new URL(r.redirect_uri).host,
    loopback: isLoopback(r.redirect_uri),
    member: user.name,
    actionsRequested: !r.scope || r.scope.split(" ").includes(SCOPE_WRITE),
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
  const scope = grantedScope(b.actions === true);
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
  await logAudit("Accès au serveur MCP accordé", client?.name ?? r.client_id, { portee: scope, retour: u.host });
  u.searchParams.set("code", code);
  res.json({ redirect: u.toString() });
});

/** Accès accordés par le membre connecté (applications connectées). */
oauthApi.get("/oauth/grants", async (req, res) => {
  const user = member(req);
  const rows = await q<{ id: number; client_name: string; scope: string; created_at: string; last_used_at: string | null }>(
    "SELECT id, client_name, scope, created_at, last_used_at FROM oauth_grants WHERE user_id = ? AND revoked_at IS NULL AND refresh_expires_at > UTC_TIMESTAMP() ORDER BY created_at DESC",
    [user.id],
  );
  res.json({ grants: rows.map((g) => ({ id: g.id, client: g.client_name, actions: canWrite(g.scope), createdAt: g.created_at, lastUsedAt: g.last_used_at })) });
});

oauthApi.delete("/oauth/grants/:id", async (req, res) => {
  const user = member(req);
  const r = await exec("UPDATE oauth_grants SET revoked_at = UTC_TIMESTAMP() WHERE id = ? AND user_id = ? AND revoked_at IS NULL", [z.coerce.number().int().parse(req.params.id), user.id]);
  if (!r.affectedRows) throw new ActionError(404, t("Accès introuvable"));
  res.json({ ok: true });
});
