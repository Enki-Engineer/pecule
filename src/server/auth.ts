import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { householdSettings } from "./household.ts";
import { region } from "./region.ts";
import { DEFAULT_REGION } from "../lib/countries.ts";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { ACCESS_PREFIX, verifyAccessToken } from "./oauth.ts";
import { z } from "zod";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { env, isProd, origin, rpID, secureOrigin } from "./env.ts";
import { demoEnabled, exec, one, q } from "./db.ts";
import { adminMember, listMembers } from "./members.ts";
import { ensureDemoReady } from "./demo.ts";
import { setMemberLang, storedLang } from "./lang.ts";
import { runDemo, runReal } from "./demo-context.ts";
import { dateBasis } from "./stat-dates.ts";
import { LANG_IDS, t as tr } from "../lib/i18n.ts";

const SESSION_COOKIE = "pecule_session";
const CHALLENGE_COOKIE = "pecule_challenge";
const SESSION_DAYS = 90;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const token = (bytes = 32) => randomBytes(bytes).toString("base64url");

/** via « oauth » : jeton d'accès accordé à l'appli Claude par un membre (serveur MCP seulement) ; canWrite = actions autorisées. */
/** admin : l'administrateur de Pécule (le titulaire du jeton d'administration, ou sa session hors démo) — sauvegarde complète. */
export type AuthedUser = { id: number; name: string; via: "session" | "api" | "depot" | "oauth"; demo?: boolean; canWrite?: boolean; admin?: boolean };

declare global {
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

/** Comparaison à durée constante (codes et jetons). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function bearer(req: Request): string | null {
  const h = req.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

const cookieOpts = (maxAgeMs: number) => ({
  httpOnly: true,
  // En http (essai sur localhost), un témoin « Secure » serait refusé par certains navigateurs.
  secure: isProd && secureOrigin,
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeMs,
});

async function createSession(res: Response, userId: number, userAgent?: string) {
  const t = token();
  await exec(
    "INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY), ?)",
    [sha256(t), userId, SESSION_DAYS, userAgent?.slice(0, 255) ?? null],
  );
  res.cookie(SESSION_COOKIE, t, cookieOpts(SESSION_DAYS * 86400_000));
}

/** Renseigne req.user depuis le cookie de session ou le jeton d'API (Bearer). */
export async function loadUser(req: Request, res: Response, next: NextFunction) {
  try {
    const b = bearer(req);
    if (b && safeEqual(b, env.API_TOKEN)) {
      // Le jeton d'administration agit au nom du membre administrateur.
      const admin = await adminMember();
      if (admin) req.user = { id: admin.id, name: admin.name, via: "api", admin: true };
      // Jeton juste, mais installation neuve : il agira au nom du premier membre, qui n'existe pas encore.
      else res.locals.noMemberYet = true;
      return next();
    }
    // Jeton d'administration créé dans l'appli (Réglages → Comptes et connexions) : mêmes droits que celui de l'hébergement,
    // mais nommé, révocable, et gardé en empreinte seulement.
    if (b && b.startsWith("pecadm_")) {
      const tok = await one<{ id: number; user_id: number; name: string }>(
        "SELECT t.id, t.user_id, u.name FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.scope = 'admin' AND t.revoked_at IS NULL AND u.role = 'admin'",
        [sha256(b)],
      );
      if (tok) {
        req.user = { id: tok.user_id, name: tok.name, via: "api", admin: true };
        await exec("UPDATE api_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [tok.id]);
      }
      return next();
    }
    // Jeton personnel limité (Raccourci iPhone) : il ne sert qu'au dépôt de fichiers.
    if (b && b.startsWith("pec_")) {
      if (req.method === "POST" && req.originalUrl.split("?")[0] === "/api/inbox") {
        const tok = await one<{ id: number; user_id: number; name: string }>(
          "SELECT t.id, t.user_id, u.name FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.scope = 'depot' AND t.revoked_at IS NULL",
          [sha256(b)],
        );
        if (tok) {
          req.user = { id: tok.user_id, name: tok.name, via: "depot" };
          await exec("UPDATE api_tokens SET last_used_at = UTC_TIMESTAMP() WHERE id = ?", [tok.id]);
        }
      }
      return next();
    }
    // Jeton d'accès OAuth (appli Claude) : il n'ouvre que le serveur MCP, dans la vue du membre qui l'a accordé.
    if (b && b.startsWith(ACCESS_PREFIX)) {
      if (req.method === "POST" && req.originalUrl.split("?")[0] === "/api/mcp") {
        const who = await verifyAccessToken(b);
        if (who) req.user = { id: who.id, name: who.name, via: "oauth", canWrite: who.canWrite };
      }
      return next();
    }
    const t = req.cookies?.[SESSION_COOKIE];
    if (typeof t === "string" && t.length > 20) {
      const row = await one<{ id: number; name: string; role: string; last_seen_at: string; demo: number }>(
        `SELECT u.id, u.name, u.role, s.last_seen_at, s.demo FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP()`,
        [sha256(t)],
      );
      if (row) {
        req.user = { id: row.id, name: row.name, via: "session", demo: row.demo === 1, admin: row.role === "admin" && row.demo !== 1 };
        // Session glissante : prolongée au plus une fois par jour.
        if (Date.parse(row.last_seen_at + "Z") < Date.now() - 86400_000) {
          await exec(
            "UPDATE sessions SET last_seen_at = UTC_TIMESTAMP(), expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY) WHERE token_hash = ?",
            [SESSION_DAYS, sha256(t)],
          );
        }
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user && res.locals.noMemberYet) return res.status(409).json({ error: tr("Cette installation n'a pas encore de membre : crée d'abord le premier dans l'appli (écran « Bienvenue dans Pécule »).") });
  if (!req.user) return res.status(401).json({ error: tr("Connexion requise") });
  next();
}

/** Administrateur de Pécule : jeton d'administration, ou session du membre administrateur (jamais en démo). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: tr("Connexion requise") });
  if (!req.user.admin || req.user.demo) return res.status(403).json({ error: tr("Réservé à l'administrateur de Pécule") });
  next();
}

export function requireApiToken(req: Request, res: Response, next: NextFunction) {
  if (req.user?.via !== "api") return res.status(403).json({ error: "Jeton d'administration requis" });
  next();
}

/** Jeton de synchro (tâche planifiée) OU utilisateur connecté. */
export function requireSyncAccess(req: Request, res: Response, next: NextFunction) {
  const b = bearer(req);
  if (req.user || (b && safeEqual(b, env.SYNC_TOKEN))) return next();
  res.status(401).json({ error: tr("Connexion requise") });
}

/** Crée un lien d'inscription (passkey) valable 7 jours pour un utilisateur. */
export async function createEnrollmentLink(userId: number): Promise<string> {
  const t = token();
  await exec(
    "INSERT INTO enrollment_tokens (token_hash, user_id, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))",
    [sha256(t), userId],
  );
  return `${origin}/inscription?jeton=${t}`;
}

async function saveChallenge(res: Response, challenge: string, purpose: string, userId: number | null) {
  const id = token();
  await exec("DELETE FROM auth_challenges WHERE expires_at < UTC_TIMESTAMP()");
  await exec(
    "INSERT INTO auth_challenges (id, challenge, purpose, user_id, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))",
    [sha256(id), challenge, purpose, userId],
  );
  res.cookie(CHALLENGE_COOKIE, id, cookieOpts(5 * 60_000));
}

async function takeChallenge(req: Request, res: Response, purpose: string) {
  const id = req.cookies?.[CHALLENGE_COOKIE];
  res.clearCookie(CHALLENGE_COOKIE, { path: "/" });
  if (typeof id !== "string") return null;
  const row = await one<{ challenge: string; user_id: number | null }>(
    "SELECT challenge, user_id FROM auth_challenges WHERE id = ? AND purpose = ? AND expires_at > UTC_TIMESTAMP()",
    [sha256(id), purpose],
  );
  await exec("DELETE FROM auth_challenges WHERE id = ?", [sha256(id)]);
  return row ?? null;
}

/** Ce qui règle les écrans d'un membre et dépend de sa base : le jour retenu pour les statistiques, et l'intérêt du choix Foyer / Moi. */
async function memberView(userId: number) {
  const [basis, counts] = await Promise.all([
    dateBasis(),
    // « Moi » = les comptes à son nom. Le choix n'a de sens que s'il en a, et s'il n'a pas que ceux-là.
    one<{ total: number; mine: number }>("SELECT COUNT(*) AS total, COALESCE(SUM(a.owner = (SELECT LOWER(u.name) FROM users u WHERE u.id = ?)), 0) AS mine FROM accounts a", [userId]),
  ]);
  const mine = Number(counts?.mine ?? 0);
  return { dateBasis: basis, scopeChoice: mine > 0 && mine < Number(counts?.total ?? 0) };
}

const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false });

export const authRouter = Router();
authRouter.use(limiter);

authRouter.get("/me", async (req, res) => {
  // language : la langue choisie par le membre (null tant qu'il n'a rien choisi : l'appareil garde la sienne).
  const language = req.user ? await storedLang(req.user.id).catch(() => null) : null;
  // setup : installation neuve, aucun membre encore — l'écran propose de créer le premier (l'administrateur).
  const setup = !req.user && !(await one("SELECT id FROM users LIMIT 1"));
  // region : pays, devise et fuseau du foyer (l'écran met en forme les montants dans cette devise).
  // modulesOff : écrans facultatifs retirés par le foyer (la démo les montre tous).
  const modulesOff = req.user && !req.user.demo ? (await householdSettings().catch(() => null))?.modulesOff ?? [] : [];
  // dateBasis : jour retenu pour les statistiques (jour d'achat ou d'écriture) ; scopeChoice : « Moi » montre-t-il autre
  // chose que « Foyer » pour ce membre (sinon l'écran ne propose pas le choix). Lus dans la base du membre (démo comprise).
  const view = req.user ? await (req.user.demo ? runDemo : runReal)(() => memberView(req.user!.id)).catch(() => null) : null;
  res.json({ user: req.user ? { id: req.user.id, name: req.user.name, demo: req.user.demo === true, admin: req.user.admin === true, language, modulesOff, dateBasis: view?.dateBasis ?? "debit", scopeChoice: view?.scopeChoice ?? true, region: req.user.demo ? DEFAULT_REGION : region() } : null, demoAvailable: demoEnabled, ...(setup ? { setup: true } : {}) });
});

/**
 * Premier démarrage : crée le premier membre du foyer, qui en est l'administrateur, et renvoie son lien d'inscription
 * (création de sa clé d'accès). Possible seulement tant qu'aucun membre n'existe, et avec le code d'installation —
 * le jeton d'administration du serveur (API_TOKEN) : celui qui installe Pécule l'a sous les yeux, pas un visiteur.
 */
authRouter.post("/setup", async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(80), code: z.string().min(1).max(400) }).parse(req.body);
  if (!safeEqual(body.code.trim(), env.SETUP_CODE ?? env.API_TOKEN)) return res.status(403).json({ error: tr("Code d'installation incorrect.") });
  // Une seule instruction : deux demandes simultanées ne créent pas deux administrateurs.
  const created = await exec("INSERT INTO users (name, role) SELECT ?, 'admin' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users)", [body.name]);
  if (!created.affectedRows) return res.status(409).json({ error: tr("Cette installation a déjà ses membres.") });
  console.log("[installation] premier membre créé (administrateur)");
  res.json({ link: await createEnrollmentLink(created.insertId) });
});

/** Langue de Pécule pour ce membre, sur tous ses appareils (écrans, assistant, voix). */
authRouter.put("/language", requireAuth, async (req, res) => {
  // onlyIfUnset : l'inscription propose la langue de l'appareil sans jamais remplacer un choix déjà fait.
  const { language, onlyIfUnset } = z.object({ language: z.enum(LANG_IDS), onlyIfUnset: z.boolean().optional() }).parse(req.body);
  const kept = onlyIfUnset ? await storedLang(req.user!.id) : null;
  if (kept) return res.json({ ok: true, language: kept });
  await setMemberLang(req.user!.id, language);
  res.json({ ok: true, language });
});

/**
 * Passer cette session en mode démo (données fictives). Pas de route de sortie : on en sort en se
 * reconnectant avec sa clé d'accès (Face ID / Touch ID), qui ouvre une nouvelle session normale.
 */
authRouter.post("/demo", requireAuth, async (req, res) => {
  const t = req.cookies?.[SESSION_COOKIE];
  if (req.user?.via !== "session" || typeof t !== "string") return res.status(400).json({ error: tr("Réservé à une session ouverte dans le navigateur") });
  if (!demoEnabled) return res.status(503).json({ error: tr("Mode démo non configuré") });
  await ensureDemoReady();
  await exec("UPDATE sessions SET demo = 1 WHERE token_hash = ?", [sha256(t)]);
  res.json({ ok: true });
});

/** Options d'inscription : avec un jeton d'inscription, ou connecté (ajout d'un appareil). */
authRouter.post("/register/options", async (req, res) => {
  const body = z.object({ jeton: z.string().optional() }).parse(req.body ?? {});
  let userId = req.user?.id ?? null;
  if (!userId && body.jeton) {
    const row = await one<{ user_id: number }>(
      "SELECT user_id FROM enrollment_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()",
      [sha256(body.jeton)],
    );
    userId = row?.user_id ?? null;
  }
  if (!userId) return res.status(403).json({ error: tr("Lien d'inscription invalide ou expiré") });
  const user = await one<{ id: number; name: string }>("SELECT id, name FROM users WHERE id = ?", [userId]);
  if (!user) return res.status(404).json({ error: tr("Utilisateur introuvable") });
  const existing = await q<{ id: string; transports: string | null }>("SELECT id, transports FROM passkeys WHERE user_id = ?", [userId]);
  const options = await generateRegistrationOptions({
    rpName: "Pécule",
    rpID,
    userName: user.name,
    userDisplayName: user.name,
    userID: new TextEncoder().encode(`pecule-${user.id}`),
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({ id: p.id, transports: p.transports?.split(",") })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  await saveChallenge(res, options.challenge, "register", userId);
  res.json({ options, userName: user.name });
});

authRouter.post("/register/verify", async (req, res) => {
  const body = z
    .object({ response: z.custom<RegistrationResponseJSON>(), jeton: z.string().optional(), deviceName: z.string().max(120).optional() })
    .parse(req.body);
  const ch = await takeChallenge(req, res, "register");
  if (!ch?.user_id) return res.status(400).json({ error: tr("Défi expiré, recommencez") });
  const verification = await verifyRegistrationResponse({
    response: body.response,
    expectedChallenge: ch.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!verification.verified) return res.status(400).json({ error: tr("Clé d'accès refusée") });
  const cred = verification.registrationInfo.credential;
  await exec(
    "INSERT INTO passkeys (id, id_hash, user_id, public_key, counter, transports, device_name) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [cred.id, sha256(cred.id), ch.user_id, Buffer.from(cred.publicKey), cred.counter, cred.transports?.join(",") ?? null, body.deviceName ?? null],
  );
  // Inscription par un lien : tous les liens en cours de ce membre sont consommés (le serveur ne s'en remet pas à l'écran).
  if (body.jeton || !req.user) await exec("UPDATE enrollment_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL", [ch.user_id]);
  if (!req.user) await createSession(res, ch.user_id, req.get("user-agent"));
  res.json({ ok: true });
});

authRouter.post("/login/options", async (_req, res) => {
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  await saveChallenge(res, options.challenge, "login", null);
  res.json({ options });
});

authRouter.post("/login/verify", async (req, res) => {
  const body = z.object({ response: z.custom<AuthenticationResponseJSON>() }).parse(req.body);
  const ch = await takeChallenge(req, res, "login");
  if (!ch) return res.status(400).json({ error: tr("Défi expiré, recommencez") });
  const pk = await one<{ id: string; user_id: number; public_key: Buffer; counter: number; transports: string | null }>(
    "SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE id_hash = ?",
    [sha256(body.response.id)],
  );
  if (!pk) return res.status(400).json({ error: tr("Clé d'accès inconnue") });
  const verification = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: ch.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: pk.id,
      publicKey: new Uint8Array(pk.public_key),
      counter: Number(pk.counter),
      transports: pk.transports?.split(",") as never,
    },
  });
  if (!verification.verified) return res.status(401).json({ error: tr("Connexion refusée") });
  await exec("UPDATE passkeys SET counter = ?, last_used_at = UTC_TIMESTAMP() WHERE id_hash = ?", [
    verification.authenticationInfo.newCounter,
    sha256(pk.id),
  ]);
  // L'ancienne session de cet appareil (ex. une session de démo dont on sort) est fermée.
  const previous = req.cookies?.[SESSION_COOKIE];
  if (typeof previous === "string") await exec("DELETE FROM sessions WHERE token_hash = ?", [sha256(previous)]);
  await createSession(res, pk.user_id, req.get("user-agent"));
  res.json({ ok: true });
});

/** Ouvre une session navigateur à partir du jeton d'administration (tests, Claude). */
authRouter.post("/token-login", async (req, res) => {
  if (req.user?.via !== "api") return res.status(403).json({ error: "Jeton d'administration requis" });
  await createSession(res, req.user.id, req.get("user-agent"));
  res.json({ ok: true });
});

authRouter.post("/logout", async (req, res) => {
  const t = req.cookies?.[SESSION_COOKIE];
  if (typeof t === "string") await exec("DELETE FROM sessions WHERE token_hash = ?", [sha256(t)]);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

/** Utilisateurs, leurs clés d'accès, et lien d'invitation pour un membre. */
authRouter.get("/users", requireAuth, async (_req, res) => {
  const users = await listMembers();
  const keys = await q<{ user_id: number; device_name: string | null; created_at: string; last_used_at: string | null; id_hash: string }>(
    "SELECT user_id, device_name, created_at, last_used_at, id_hash FROM passkeys ORDER BY created_at",
  );
  res.json({
    users: users.map((u) => ({
      ...u,
      passkeys: keys.filter((k) => k.user_id === u.id).map(({ user_id: _u, ...k }) => k),
    })),
  });
});

/** Ajoute un membre au foyer (administrateur) ; il crée ensuite sa clé d'accès avec son lien d'inscription. */
authRouter.post("/users", requireAdmin, async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
  if (await one("SELECT id FROM users WHERE name = ?", [name])) return res.status(409).json({ error: tr("Ce prénom est déjà pris.") });
  const created = await exec("INSERT INTO users (name, role) VALUES (?, 'membre')", [name]);
  res.json({ id: created.insertId, link: await createEnrollmentLink(created.insertId) });
});

/** Lien d'inscription : pour soi (ajouter un appareil autrement), ou pour un autre membre — par l'administrateur seulement. */
authRouter.post("/users/:id/enrollment", requireAuth, async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  // Un lien d'inscription permet de créer une clé d'accès sur le compte visé : jamais sur celui d'un autre sans être l'administrateur.
  if (id !== req.user!.id && (!req.user!.admin || req.user!.demo)) return res.status(403).json({ error: tr("Réservé à l'administrateur de Pécule") });
  if (!(await one("SELECT id FROM users WHERE id = ?", [id]))) return res.status(404).json({ error: tr("Utilisateur introuvable") });
  res.json({ link: await createEnrollmentLink(id) });
});

authRouter.delete("/passkeys/:idHash", requireAuth, async (req, res) => {
  const key = await one<{ user_id: number }>("SELECT user_id FROM passkeys WHERE id_hash = ?", [req.params.idHash]);
  if (!key) return res.status(404).json({ error: tr("Clé introuvable") });
  // Ses propres clés, ou celles d'un autre membre pour l'administrateur.
  if (key.user_id !== req.user!.id && (!req.user!.admin || req.user!.demo)) return res.status(403).json({ error: tr("Réservé à l'administrateur de Pécule") });
  const count = await one<{ n: number }>("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?", [key.user_id]);
  // On ne peut pas s'enfermer dehors soi-même ; le jeton d'administration le peut (nettoyage).
  if ((count?.n ?? 0) <= 1 && req.user?.via !== "api")
    return res.status(400).json({ error: tr("Impossible de supprimer la dernière clé d'accès de cet utilisateur") });
  await exec("DELETE FROM passkeys WHERE id_hash = ?", [req.params.idHash]);
  // Une clé retirée (appareil perdu, accès à couper) ferme les sessions de ce membre, sauf celle qui fait la demande.
  const current = typeof req.cookies?.[SESSION_COOKIE] === "string" ? sha256(req.cookies[SESSION_COOKIE]) : "";
  await exec("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", [key.user_id, current]);
  res.json({ ok: true });
});

/** « Déconnecter mes autres appareils » : ferme toutes les sessions du membre, sauf celle qui fait la demande. */
authRouter.post("/logout-others", requireAuth, async (req, res) => {
  // Depuis une session seulement : par jeton il n'y a pas de session « courante », toutes seraient fermées.
  if (req.user!.via !== "session") return res.status(400).json({ error: tr("Réservé à une session ouverte dans le navigateur") });
  const current = typeof req.cookies?.[SESSION_COOKIE] === "string" ? sha256(req.cookies[SESSION_COOKIE]) : "";
  const done = await exec("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", [req.user!.id, current]);
  res.json({ closed: done.affectedRows });
});

/** Nouveau jeton d'administration : renvoyé une seule fois, seule son empreinte est gardée. */
export async function createAdminToken(userId: number, name: string): Promise<string> {
  const token = `pecadm_${randomBytes(32).toString("base64url")}`;
  await exec("INSERT INTO api_tokens (user_id, name, token_hash, scope) VALUES (?, ?, ?, 'admin')", [userId, name.slice(0, 80), sha256(token)]);
  return token;
}

/** Nouveau jeton personnel de dépôt : renvoyé une seule fois, seule son empreinte est gardée. */
export async function createDepotToken(userId: number, name: string): Promise<string> {
  const token = `pec_${randomBytes(30).toString("base64url")}`;
  await exec("INSERT INTO api_tokens (user_id, name, token_hash, scope) VALUES (?, ?, ?, 'depot')", [userId, name.slice(0, 80), sha256(token)]);
  return token;
}
