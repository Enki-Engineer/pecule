import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "./db.ts";
import { isDemo, runReal } from "./demo-context.ts";
import { alerts, auditLog } from "./db/schema/index.ts";

/*
 * Journal : contexte de la requête (qui agit, par quel canal), audit des écritures et alertes
 * techniques. Rien ici ne doit faire échouer la requête qui l'appelle.
 */

export type Via = "ecran" | "api" | "assistant" | "mcp" | "raccourci" | "systeme";
type Actor = { userId: number | null; via: Via };

const context = new AsyncLocalStorage<Actor>();

/** Auteur courant : le membre connecté (écran ou jeton), sinon le système (planificateur). */
export const currentActor = (): Actor => context.getStore() ?? { userId: null, via: "systeme" };

/** Exécute fn au nom d'un autre canal (ex. une action confirmée dans l'assistant). */
export const runAs = <T>(patch: Partial<Actor>, fn: () => Promise<T>) => context.run({ ...currentActor(), ...patch }, fn);

/** Middleware : pose le contexte de la requête après l'identification (loadUser). */
export function requestContext(req: Request, _res: Response, next: NextFunction) {
  const via: Via = req.user?.via === "api" ? "api" : req.user?.via === "oauth" ? "mcp" : req.user?.via === "depot" ? "raccourci" : req.user ? "ecran" : "systeme";
  context.run({ userId: req.user?.id ?? null, via }, next);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function logAudit(action: string, target?: string | number | null, details?: unknown) {
  const actor = currentActor();
  try {
    await db.insert(auditLog).values({
      userId: actor.userId,
      via: actor.via,
      action: clip(action, 96),
      target: target == null ? null : clip(String(target), 191),
      details: details === undefined ? null : clip(typeof details === "string" ? details : JSON.stringify(details), 4000),
    });
  } catch (e) {
    console.error("[audit]", e);
  }
}

/**
 * Requêtes qui n'écrivent rien de métier (connexion, conversation) ou déjà tracées ailleurs (réglages de l'IA : sans la
 * clé saisie ; portefeuille crypto ajouté : sans l'adresse collée, qui peut être la clé étendue d'un compte, ni la clé
 * d'un exchange).
 */
const NOT_AUDITED = [/^\/api\/crypto\/(sources|exchanges)(\?|$)/, /^\/api\/auth\/setup/, /^\/api\/connections\/keys/, /^\/api\/bank\/enable-banking\/key/, /^\/api\/auth\/(login|register|token-login|logout)/, /^\/api\/assistant\/(message|confirm)/, /^\/api\/sync$/, /^\/api\/mcp/, /^\/api\/voice\//, /^\/api\/ai\//];

/** Champs d'un corps de requête qui ne s'écrivent jamais au journal, à aucun niveau (codes, clés, jetons, mots de passe). */
const SECRET_FIELD = /^(code|key|keys|cle|privatekey|private_key|accesskey|access_key|secretkey|secret_key|token|jeton|secret|password|motdepasse|p256dh|auth)$/i;
function masked(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return depth > 4 ? "…" : value.map((v) => masked(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  if (depth > 4) return "…";
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET_FIELD.test(k) ? "•••" : masked(v, depth + 1)]));
}

/** Audit automatique de toute écriture réussie de l'API (corps résumé, jamais de fichier ni de secret). */
export function auditWrites(req: Request, res: Response, next: NextFunction) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method) || NOT_AUDITED.some((r) => r.test(req.originalUrl))) return next();
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    const route = `${req.baseUrl}${req.route?.path ?? req.path}`;
    const target = Object.values(req.params ?? {}).join("/") || null;
    const details = Buffer.isBuffer(req.body) ? { fichier: req.query.name ?? null, octets: req.body.length } : req.body && Object.keys(req.body).length ? masked(req.body) : undefined;
    void logAudit(`${req.method} ${route}`, target, details);
  });
  next();
}

/**
 * Enregistre une alerte technique ; une alerte identique encore ouverte de moins de 24 h est
 * regroupée (compteur + dernière occurrence).
 */
export async function recordAlert(source: string, message: string, details?: unknown, level: "erreur" | "alerte" = "erreur"): Promise<void> {
  // Une erreur pendant une démo doit se voir dans le vrai Suivi technique.
  if (isDemo()) return runReal(() => recordAlert(source, `[démo] ${message}`, details, level));
  const msg = clip(message, 512);
  const det = details === undefined ? null : clip(details instanceof Error ? (details.stack ?? details.message) : typeof details === "string" ? details : JSON.stringify(details), 4000);
  try {
    const res = await db
      .update(alerts)
      .set({ occurrences: sql`${alerts.occurrences} + 1`, lastAt: sql`CURRENT_TIMESTAMP`, details: det })
      .where(and(eq(alerts.source, source), eq(alerts.message, msg), isNull(alerts.resolvedAt), gt(alerts.lastAt, sql`NOW() - INTERVAL 1 DAY`)));
    if (res[0].affectedRows === 0) await db.insert(alerts).values({ source, message: msg, details: det, level });
  } catch (e) {
    console.error("[alerte non enregistrée]", source, message, e);
  }
}
