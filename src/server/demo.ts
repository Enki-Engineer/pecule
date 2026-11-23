import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2/promise";
import { demoEnabled, migrate, one, pool, q, withLock } from "./db.ts";
import { env } from "./env.ts";
import { runDemo, runReal } from "./demo-context.ts";
import { fillPurchaseDates } from "./stat-dates.ts";
import { recordAlert } from "./journal.ts";
import { seedDemo } from "./demo/seed.ts";
import { householdSettings } from "./household.ts";
import { setDemoNames } from "./ai.ts";
import { t as tr } from "../lib/i18n.ts";

/*
 * Mode démo : montrer Pécule sans rien dévoiler. Une session passée en démo (Réglages → Mode démo)
 * lit et écrit uniquement la base de données fictives (DEMO_DATABASE_URL) ; la sortie demande une
 * nouvelle connexion par clé d'accès (Face ID / Touch ID). Les données fictives sont recréées
 * chaque jour (dates relatives au jour même), ce qu'on y modifie est donc effacé le lendemain.
 */

/** Prénoms affichés en démo, dans l'ordre des membres (le 1er membre devient Alex…). */
const PERSONAS = ["Alex", "Camille", "Sam", "Charlie"];
/** Prénoms donnés en démo aux personnes sans connexion (un enfant). */
const OTHER_PERSONAS = ["Léo", "Zoé", "Noa"];

/** Ce qui ne doit jamais partir d'une session de démo (vraies données ou vrais accès). */
const BLOCKED: [method: string, path: RegExp][] = [
  ["*", /^\/sync$/],
  // Lire une adresse, relier un exchange ou relancer une synchro interroge des services extérieurs.
  ["POST", /^\/crypto\/(sync|sources|exchanges)/],
  ["*", /^\/push\//],
  ["POST", /^\/tokens/],
  ["DELETE", /^\/tokens/],
  ["*", /^\/calendar-link/],
  ["POST", /^\/bank-labels\//],
  // Le classement en lot envoie les libellés au fournisseur d'IA du foyer.
  ["POST", /^\/transactions\/ai-classify/],
  ["*", /^\/auth\/register\//],
  ["*", /^\/auth\/users\/\d+\/(enrollment|revoke-access)/],
  ["*", /^\/auth\/passkeys\//],
  ["*", /^\/admin\//],
  ["*", /^\/mcp/],
  ["*", /^\/oauth\//],
  ["POST", /^\/voice\//],
  ["*", /^\/ai\//],
  ["*", /^\/backup/],
  ["*", /^\/updates/],
  ["*", /^\/bank\//],
  ["*", /^\/imports/],
  ["*", /^\/connections\//],
  // La démo est un foyer français en euros : changer sa devise appellerait un service de cours.
  ["*", /^\/household\/currency/],
];

/** Routes d'identification : toujours sur la vraie base (sessions, défis, clés d'accès). */
// Ancrées : « logout-others » fermerait les vraies sessions du membre depuis une session de démo.
const REAL_AUTH = /^\/auth\/(me|login\/.*|logout|token-login|demo)$/;

let migrated: Promise<void> | null = null;

const dbName = (url?: string) => (url ? decodeURIComponent(new URL(url).pathname.slice(1)) : null);

/**
 * Base de démo jetable : vide entièrement (tables et vues). Refuse si la connexion ne vise pas
 * exactement la base de démo configurée (nom contenant « demo », différent de la vraie base).
 */
async function wipeDemoDatabase() {
  const expected = dbName(env.DEMO_DATABASE_URL);
  await runDemo(async () => {
    const conn = await pool.getConnection();
    try {
      const [[row]] = await conn.query<RowDataPacket[]>("SELECT DATABASE() AS db");
      const current = row?.db as string | null;
      if (!current || current !== expected || !/demo/i.test(current) || current === dbName(env.DATABASE_URL))
        throw new Error(`Remise à zéro refusée : ${current ?? "aucune base"} n'est pas la base de démo`);
      await conn.query("SET FOREIGN_KEY_CHECKS = 0");
      try {
        const [views] = await conn.query<RowDataPacket[]>("SELECT TABLE_NAME AS t FROM information_schema.VIEWS WHERE TABLE_SCHEMA = DATABASE()");
        for (const v of views) await conn.query(`DROP VIEW IF EXISTS \`${String(v.t)}\``);
        const [tables] = await conn.query<RowDataPacket[]>("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'");
        for (const t of tables) await conn.query(`DROP TABLE IF EXISTS \`${String(t.t)}\``);
      } finally {
        await conn.query("SET FOREIGN_KEY_CHECKS = 1");
      }
    } finally {
      conn.release();
    }
  });
}

/** Migrations de la base de démo (au démarrage, puis à la demande si elles avaient échoué). */
export function migrateDemo(): Promise<void> {
  if (!demoEnabled) return Promise.resolve();
  const run = () => runDemo(() => migrate("pecule:migrate-demo"));
  migrated ??= run()
    // Migration interrompue (ex. redémarrage pendant un déploiement) : la base de démo ne contient
    // rien à garder, on la vide et on recommence une fois.
    .catch(async (e) => {
      if (e instanceof Error && e.message.includes("déjà en cours")) throw e;
      console.error("[démo] migrations en échec, base de démo remise à zéro", e);
      await wipeDemoDatabase();
      return run();
    })
    .then((applied) => {
      if (applied.length) console.log(`[démo] migrations appliquées : ${applied.join(", ")}`);
    })
    .catch((e) => {
      migrated = null;
      void recordAlert("demo", `Base de démo : migrations impossibles : ${e instanceof Error ? e.message : String(e)}`, e);
      throw e;
    });
  return migrated;
}

const today = () => new Date().toISOString().slice(0, 10);
let readyOn: string | null = null;
let preparing: Promise<void> | null = null;
const personas = new Map<number, string>();

/** Base de démo prête et remplie du jour (données recréées une fois par jour). */
export async function ensureDemoReady(): Promise<void> {
  if (!demoEnabled) throw new Error("Mode démo non configuré");
  if (readyOn === today()) return;
  preparing ??= (async () => {
    await migrateDemo();
    const day = today();
    const seeded = await runDemo(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = 'demo:seeded'"));
    const members = await runReal(() => q<{ id: number; name: string }>("SELECT id, name FROM users ORDER BY id"));
    const users = members.map((u, i) => ({ id: u.id, name: PERSONAS[i] ?? `Membre ${i + 1}` }));
    // La famille de la démo compte deux adultes : un foyer d'un seul membre y reçoit un second membre fictif,
    // qui n'existe que dans la base de démo (personne ne se connecte en son nom).
    if (users.length === 1) users.push({ id: users[0].id + 1, name: PERSONAS[1] });
    // Filet de sécurité de l'IA en démo : vrais prénoms (membres et autres personnes du foyer) → prénoms fictifs.
    const others = await runReal(() => householdSettings()).catch(() => ({ people: [] as string[] }));
    setDemoNames([...members.map((u, i): [string, string] => [u.name, users[i].name]), ...others.people.map((p, i): [string, string] => [p, OTHER_PERSONAS[i % OTHER_PERSONAS.length]])]);
    if (seeded?.value?.slice(0, 10) !== day) {
      const t0 = Date.now();
      const r = await runDemo(() => withLock("pecule:demo-seed", () => seedDemo({ users })));
      // Jour d'achat des achats par carte de la démo : la frise et le réglage « au jour de l'achat » s'y essaient.
      await runDemo(() => fillPurchaseDates()).catch((e) => console.error("[démo] jour d'achat", e));
      if (r) console.log(`[démo] données fictives recréées en ${Date.now() - t0} ms`, r.counts);
    }
    personas.clear();
    readyOn = day;
  })().finally(() => {
    preparing = null;
  });
  await preparing;
}

/** Prénom fictif d'un membre en démo. */
async function personaName(userId: number): Promise<string> {
  const known = personas.get(userId);
  if (known) return known;
  const row = await runDemo(() => one<{ name: string }>("SELECT name FROM users WHERE id = ?", [userId]));
  const name = row?.name ?? "Démo";
  personas.set(userId, name);
  return name;
}

/**
 * Middleware (après loadUser et langContext, pour que ses refus soient écrits dans la langue du membre) :
 * une session de démo voit son prénom fictif, et le reste de la requête s'exécute sur la base de démo —
 * sauf l'identification, qui reste sur la vraie base.
 */
export async function demoContext(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.demo) return next();
  if (!demoEnabled) return res.status(503).json({ error: tr("Mode démo indisponible") });
  try {
    await ensureDemoReady();
    req.user = { ...req.user, name: await personaName(req.user.id) };
  } catch (e) {
    return next(e);
  }
  // Le routeur ignore la casse et la barre finale : le filtre aussi, sinon « /AI/test » passerait à côté de « /ai/ ».
  const route = req.path.toLowerCase().replace(/\/+$/, "") || "/";
  if (REAL_AUTH.test(route)) return next();
  if (BLOCKED.some(([m, r]) => (m === "*" || m === req.method) && r.test(route)))
    return res.status(403).json({ error: tr("Indisponible en mode démo") });
  runDemo(() => next());
}
