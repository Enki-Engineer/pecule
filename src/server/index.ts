import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { ZodError } from "zod";
import { env, isProd, secureOrigin } from "./env.ts";
import { endPools, migrate } from "./db.ts";
import { authRouter, loadUser } from "./auth.ts";
import { demoContext, migrateDemo } from "./demo.ts";
import { admin, api } from "./routes/api.ts";
import { mcpRouter } from "./mcp.ts";
import { oauthApi, oauthRouter } from "./oauth.ts";
import { voiceApi } from "./voice.ts";
import { backupApi } from "./routes/backup.ts";
import { brandsApi } from "./routes/brands.ts";
import { langContext } from "./lang.ts";
import { dataI18nApi, dataNames } from "./data-i18n.ts";
import { DEFAULT_LANG, isLang, t, tk, translate } from "../lib/i18n.ts";
import { loadAiConfig } from "./ai-config.ts";
import { readEnableBankingNow, syncBanks } from "./bank-sync.ts";
import { seedStarter } from "./starter.ts";
import { kick as kickImports, resumeImports } from "./imports/batches.ts";
import { loadServiceKeys } from "./service-keys.ts";
import { loadRegion } from "./region.ts";
import { fillPurchaseDates } from "./stat-dates.ts";
import { fillDocumentTopics } from "./documents.ts";
import { FxError, refreshFx } from "./fx.ts";
import { refreshWealth } from "./wealth.ts";
import { maybeSyncCrypto } from "./crypto.ts";
import { ActionError } from "./actions.ts";
import { UnknownMemberError } from "./members.ts";
import { EbError, ebFinishAuth } from "./enable-banking.ts";
import { auditWrites, recordAlert, requestContext } from "./journal.ts";
import { icalRouter } from "./ical.ts";
import { runNotifications } from "./notify.ts";
import { runWeeklySummaries } from "./weekly.ts";
import { backupBeforeMigration } from "./pre-migration.ts";
import { scheduleUpdateCheck } from "./updates.ts";
import { scheduleAutoBackup } from "./auto-backup.ts";
import { updatesApi } from "./routes/updates.ts";
import { cleanInterruptedRestore, cleanRestoreLeftovers, restoreApi, type RestoreHooks } from "./restore.ts";
import { cleanOffsiteLeftovers } from "./offsite.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

/*
 * Démarrage en deux temps : le port s'ouvre tout de suite, les migrations tournent
 * ensuite. Pendant ce temps, une requête attend la fin du démarrage (15 s au plus : LiteSpeed lance
 * les processus à la demande) puis reçoit une page de maintenance ; un échec est retenté.
 */
const boot = { ready: false, phase: "demarrage" as "demarrage" | "pret" | "echec", current: Promise.resolve() as Promise<void>, /** Une restauration tient le service fermé. */ held: false };

const MAINTENANCE_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="20"><title>Pécule</title></head>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;font-family:-apple-system,system-ui,sans-serif;background:#eef2fa;color:#0f1e3d">
<main style="text-align:center;padding:24px"><div style="font-size:22px;font-weight:700">Pécule démarre…</div>
<p style="color:#6b7a99">La page se recharge toute seule dans quelques secondes.</p></main></body></html>`;

function waitFor(p: Promise<unknown>, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.finally(() => {
      clearTimeout(timer);
      setImmediate(resolve);
    });
  });
}

function maintenanceGate(req: Request, res: Response, next: NextFunction) {
  if (boot.ready) return next();
  void waitFor(boot.current, 15_000).then(() => {
    if (boot.ready) return next();
    res.status(503).set("Retry-After", "20").set("Cache-Control", "no-store");
    if (req.path.startsWith("/api")) {
      // Avant langContext, et sans base pour lire la langue du membre : l'écran dit la sienne dans l'en-tête X-Langue.
      const lang = req.get("x-langue");
      return res.json({ error: translate(isLang(lang) ? lang : DEFAULT_LANG, tk("Pécule démarre ou est en maintenance : réessaie dans un instant.")) });
    }
    // Page ouverte par le navigateur lui-même : ni en-tête ni membre connu à ce stade, elle reste en français.
    res.type("html").send(MAINTENANCE_HTML);
  });
}

/**
 * Une écriture faite avec le témoin de session doit venir de l'appli elle-même : une page d'un autre site (ou d'un
 * sous-domaine voisin) qui enverrait une requête avec le témoin du visiteur est refusée. Les appels par jeton
 * (ligne de commande, serveur MCP) ne portent pas de témoin et ne sont pas concernés.
 */
function sameOriginWrites(req: Request, res: Response, next: NextFunction) {
  if (req.user?.via !== "session" || !["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const site = req.get("sec-fetch-site");
  const from = req.get("origin");
  if ((site && site !== "same-origin" && site !== "none") || (from && from !== new URL(env.APP_URL).origin)) return res.status(403).json({ error: "Requête refusée : elle ne vient pas de Pécule." });
  next();
}

export async function createApp() {
  const app = express();
  app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // En développement seulement, Vite injecte un script en ligne (rechargement à chaud) et ouvre un WebSocket.
          scriptSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: isProd ? ["'self'"] : ["'self'", "ws:"],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: isProd && secureOrigin ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // Sur un essai en http://localhost, pas d'engagement https (le navigateur l'ignorerait de toute façon).
      strictTransportSecurity: isProd && secureOrigin,
    }),
  );
  // Discrétion : aucun moteur ni robot ne doit indexer ou archiver le site.
  app.use((_req, res, next) => {
    res.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
    next();
  });
  app.get("/robots.txt", (_req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /\n"));
  app.use(compression());
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => res.status(boot.ready ? 200 : 503).json({ ok: boot.ready, phase: boot.phase }));
  // Restauration d'une sauvegarde à l'installation : avant la porte de maintenance, son état se lit pendant le chargement.
  app.use("/api/restore", langContext, restoreApi(restoreHooks));
  app.use(maintenanceGate);
  // Abonnement iCal de l'échéancier (lien privé, hors /api : les agendas ne savent pas s'authentifier).
  app.use(icalRouter);
  // Connexion OAuth de l'appli Claude au serveur MCP : découverte, enregistrement, autorisation, jetons (hors /api).
  app.use(oauthRouter);
  // langContext avant demoContext : un refus du mode démo est écrit dans la langue du membre.
  app.use("/api", loadUser, sameOriginWrites, langContext, demoContext, requestContext, auditWrites);
  app.use("/api/admin", admin);
  // Mode vocal : avant le lecteur JSON, l'enregistrement arrive en corps brut.
  app.use("/api", voiceApi);
  // Noms de catégories et de postes dans la langue de la requête (et import d'administration, corps JSON lu par la route).
  app.use("/api", dataI18nApi);
  app.use("/api", express.json({ limit: "200kb" }));
  app.use("/api/mcp", mcpRouter);
  app.use("/api/auth", authRouter);
  app.use("/api", oauthApi);
  // Sauvegarde complète (administrateur) : archive zip écrite au fil de l'eau.
  app.use("/api", backupApi);
  // Version en service et mises à jour (administrateur).
  app.use("/api", updatesApi);
  // Enseignes du foyer et logos des banques reliées.
  app.use("/api", brandsApi);
  app.use("/api", api);
  app.use("/api", (_req, res) => res.status(404).json({ error: t("Route inconnue") }));

  // Retour d'une banque après un accord donné chez Enable Banking : le code porté par l'adresse est échangé ici,
  // côté serveur (l'écran des réglages réécrit son adresse et le perdrait). Le résultat est laissé à l'écran dans
  // un témoin de deux minutes, puis l'écran s'ouvre sur une adresse propre.
  app.get("/reglages/comptes", loadUser, async (req, res, next) => {
    const { code, state, error } = req.query;
    if (typeof state !== "string" || (typeof code !== "string" && typeof error !== "string")) return next();
    let outcome = "erreur";
    try {
      // Le membre est celui de la demande (retrouvée par son `state`) : le navigateur qui revient de la banque
      // n'a pas forcément de session Pécule. Jamais depuis une session de démo.
      if (typeof code === "string" && !req.user?.demo) {
        await ebFinishAuth(code, state);
        outcome = "reliee";
        // Première lecture tout de suite, sans faire attendre l'écran.
        void readEnableBankingNow("accord").catch((e) => console.error("[Enable Banking] première lecture", e));
      }
    } catch (e) {
      console.error("[Enable Banking] retour de la banque", e);
    }
    res.cookie("pecule_banque", outcome, { maxAge: 120_000, sameSite: "lax", secure: isProd && secureOrigin, path: "/" });
    // Retour sur le bloc « banque » des connexions (l'adresse de retour déclarée chez Enable Banking, elle, ne change pas).
    res.redirect(303, "/reglages/connexions?c=banque");
  });

  if (isProd) {
    const client = path.join(here, "client");
    app.use(
      "/assets",
      express.static(path.join(client, "assets"), { immutable: true, maxAge: "1y", index: false }),
    );
    // Fichier de code d'une version précédente (une fenêtre restée ouverte pendant un déploiement le demande encore) :
    // « introuvable », et surtout pas la page d'accueil — le navigateur la prendrait pour du code et la garderait en cache.
    app.use("/assets", (_req, res) => {
      res.status(404).set("Cache-Control", "no-store").type("text/plain").send("Introuvable");
    });
    app.use(express.static(client, { index: false, maxAge: 0 }));
    app.get("/{*path}", (_req, res) => {
      res.set("Cache-Control", "no-cache");
      // `root` : le chemin de l'installation peut passer par un dossier caché (« .apps/… ») sans que l'envoi soit refusé.
      res.sendFile("index.html", { root: client });
    });
  } else {
    const { createServer } = await import("vite");
    // Le rechargement à chaud prend un port lié à celui de l'appli : deux projets en développement ne se gênent pas.
    const vite = await createServer({ server: { middlewareMode: true, hmr: { port: env.PORT + 10_000 } }, appType: "spa" });
    app.use(vite.middlewares);
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: t("Données invalides"), details: err.issues });
    // Corps de requête illisible (JSON mal formé) ou trop gros : une erreur de l'appelant, pas une panne.
    const kind = (err as { type?: string } | null)?.type;
    if (kind === "entity.parse.failed") return res.status(400).json({ error: t("Données invalides") });
    if (kind === "entity.too.large") return res.status(413).json({ error: t("Fichier vide ou de plus de 20 Mo") });
    if (err instanceof ActionError || err instanceof UnknownMemberError) return res.status(err.status).json({ error: err.message });
    // Refus d'Enable Banking (clé, banque, accord) : le message est rendu tel quel, ce n'est pas une panne de Pécule.
    if (err instanceof FxError) return res.status(err.unsupported ? 400 : 502).json({ error: err.unsupported ? t("Devise non prise en charge : {devise}", { devise: err.currency }) : t("Cours de change indisponible pour {devise} : réessaie dans un moment.", { devise: err.currency }) });
    if (err instanceof EbError) return res.status(err.status === 400 ? 400 : 502).json({ error: err.status === 400 ? err.message : t("Enable Banking a refusé la demande : {message}", { message: err.message }) });
    console.error(err);
    void recordAlert("serveur", `Erreur interne : ${err instanceof Error ? err.message : String(err)}`, err);
    res.status(500).json({ error: t("Erreur interne") });
  });
  return app;
}

let syncScheduled = false;

function scheduleSync() {
  // Une seule fois : le démarrage peut être rejoué (restauration d'une sauvegarde).
  if (!env.SYNC_INTERVAL_MINUTES || syncScheduled) return;
  syncScheduled = true;
  const run = () =>
    syncBanks("auto")
      .then((r) => r && console.log(`[sync] ${r.seen} vues, ${r.inserted} nouvelles, ${r.auto} catégorisées`))
      .catch((e) => console.error("[sync] échec", e));
  // Cours et instantané de patrimoine juste après chaque synchro (les soldes viennent d'être mis à jour).
  // Puis crypto (CoinStats, une fois par jour au plus), cours et instantané de patrimoine.
  const runAll = () => {
    // En maintenance (restauration en cours) : rien ne lit ni n'écrit la base.
    if (!boot.ready) return;
    return run()
      // Cours de change du jour, et soldes des comptes en devise ramenés à la devise du foyer.
      .finally(() => refreshFx().catch((e) => console.error("[cours de change] échec", e)))
      .finally(() => maybeSyncCrypto())
      .finally(() => refreshWealth().catch((e) => console.error("[patrimoine] échec", e)))
      // Après chaque synchro : nouveaux prélèvements, soldes, enveloppes… (une alerte n'est jamais envoyée deux fois).
      .finally(() => runNotifications().catch((e) => console.error("[notifications] échec", e)))
      .finally(() => runWeeklySummaries().catch((e) => console.error("[résumé] échec", e)))
      // Imports mis en pause par le plafond du mois de l'IA : ils repartent d'eux-mêmes quand il n'est plus atteint (mois suivant).
      .finally(() => kickImports());
  };
  setTimeout(runAll, 60_000);
  setInterval(runAll, env.SYNC_INTERVAL_MINUTES * 60_000);
}

/** Rejets et exceptions non gérés : journalisés et signalés ; une exception arrête le processus (l'hébergeur ou Docker le relance). */
function installProcessHandlers() {
  process.on("unhandledRejection", (reason) => {
    console.error("[rejet non géré]", reason);
    void recordAlert("processus", `Rejet non géré : ${reason instanceof Error ? reason.message : String(reason)}`, reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[exception non gérée]", err);
    setTimeout(() => process.exit(1), 3000).unref();
    void recordAlert("processus", `Exception non gérée : ${err.message}`, err).finally(() => process.exit(1));
  });
}

/**
 * Ouvre le service : migrations, réglages en mémoire, tâches de fond. `restored` : sur une base qui vient d'être
 * restaurée (l'archive en est la sauvegarde : pas besoin d'en écrire une autre avant ses migrations).
 */
async function bootstrap(opts: { restored?: boolean } = {}): Promise<{ applied: string[] } | { error: string }> {
  try {
    // Restauration coupée par l'arrêt du serveur : la base à moitié chargée repart de neuf.
    if (await cleanInterruptedRestore()) console.warn("[restauration] une restauration interrompue a été annulée : la base repart de neuf");
    // Fichiers de travail laissés par un arrêt du serveur (archive en cours d'envoi, copie en cours de chiffrement).
    cleanRestoreLeftovers();
    cleanOffsiteLeftovers();
    // Une base déjà en service est sauvegardée sur le serveur avant de recevoir une migration.
    const applied = await migrate(undefined, { beforeApply: opts.restored ? undefined : backupBeforeMigration });
    if (applied.length) console.log(`[db] migrations appliquées : ${applied.join(", ")}`);
    // Installation neuve : référentiel de catégories de départ (une base qui a déjà le sien n'est pas touchée).
    await seedStarter()
      .then((r) => r && console.log(`[départ] ${r.categories} catégories et ${r.rules} règles de départ chargées`))
      .catch((e) => console.error("[départ] référentiel de départ", e));
    // Fournisseur d'IA réglé dans l'appli : lu avant d'ouvrir (à défaut, les valeurs de l'hébergement).
    await loadAiConfig().catch((e) => console.error("[IA] configuration illisible", e));
    await loadServiceKeys().catch((e) => console.error("[services] clés illisibles", e));
    // Pays et devise du foyer : sans eux, une synchro convertirait vers la mauvaise devise — le démarrage attend.
    await loadRegion();
    boot.ready = true;
    boot.phase = "pret";
    // Noms de catégories traduits : en mémoire dès l'ouverture (les textes écrits par le serveur s'en servent).
    void dataNames("fr").catch(() => {});
    // Jour d'achat des opérations de carte déjà là (première ouverture après la migration 0028, puis sans effet).
    void fillPurchaseDates()
      .then((n) => n && console.log(`[jour d'achat] ${n} opération(s) complétée(s)`))
      .catch((e) => console.error("[jour d'achat]", e));
    // Nature des contrats déjà au coffre (première ouverture après la migration 0030, puis sans effet).
    void fillDocumentTopics()
      .then((n) => n && console.log(`[coffre] ${n} document(s) étiqueté(s) par nature de contrat`))
      .catch((e) => console.error("[coffre] nature des contrats", e));
    // Import massif : une lecture interrompue par l'arrêt du serveur reprend.
    void resumeImports().catch((e) => console.error("[import] reprise", e));
    // Base de démo : migrée à part ; un échec ne bloque pas l'appli (alerte, nouvel essai à la demande).
    migrateDemo().catch(() => {});
    if (isProd || process.env.ENABLE_SYNC === "1") scheduleSync();
    // Une fois par jour : une version plus récente est-elle publiée ? (UPDATE_CHECK=0 pour ne jamais le demander.)
    if (isProd) scheduleUpdateCheck(() => boot.ready);
    // Sauvegardes automatiques, si l'administrateur les a demandées (Réglages → Compte et sécurité).
    scheduleAutoBackup(() => boot.ready);
    return { applied };
  } catch (e) {
    boot.phase = "echec";
    const locked = e instanceof Error && e.message.includes("déjà en cours");
    console.error("[démarrage] échec, nouvelle tentative", locked ? "dans 5 s" : "dans 60 s", e);
    if (!locked) void recordAlert("demarrage", `Démarrage impossible : ${e instanceof Error ? e.message : String(e)}`, e);
    setTimeout(() => {
      // Entre-temps, une restauration a pu reprendre la main : c'est elle qui relancera le démarrage.
      if (boot.held) return;
      boot.phase = "demarrage";
      boot.current = bootstrap().then(() => {});
    }, locked ? 5_000 : 60_000).unref();
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Ce que la restauration d'une sauvegarde demande au démarrage : la maintenance pendant le chargement, puis rouvrir. */
const restoreHooks: RestoreHooks = {
  ready: () => boot.ready,
  pause() {
    boot.ready = false;
    boot.held = true;
    boot.phase = "demarrage";
  },
  resume(opts) {
    boot.held = false;
    boot.phase = "demarrage";
    const run = bootstrap(opts);
    boot.current = run.then(() => {});
    return run;
  },
};

export async function start() {
  installProcessHandlers();
  const app = await createApp();
  const server = app.listen(env.PORT, () => console.log(`Pécule à l'écoute sur le port ${env.PORT}`));
  boot.current = bootstrap().then(() => {});
  const stop = () => {
    server.close(() => endPools().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  return server;
}
