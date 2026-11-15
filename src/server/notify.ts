import { householdTimeZone, money } from "./region.ts";
import { isDemo } from "./demo-context.ts";
import { createHash } from "node:crypto";
import * as webpush from "web-push";
import { env, origin, sealingSecret } from "./env.ts";
import { createSealer } from "./secret.ts";
import { exec, one, q } from "./db.ts";
import { userAccountsSql } from "./actions.ts";
import { agenda } from "./agenda.ts";
import { balanceForecast } from "./balance.ts";
import { listEnvelopes } from "./planning.ts";
import { STAT_SCOPE } from "./stats.ts";
import { labelShape, natureOf } from "../lib/nature.ts";
import { recordAlert } from "./journal.ts";
import { memberLang, runInLang } from "./lang.ts";
import { labels, locale, t, td, tk, tn } from "../lib/i18n.ts";
import { resolvesPublic } from "./net.ts";

/*
 * Notifications push (Web Push, appli installée sur l'iPhone ou navigateur de l'ordinateur) :
 * une vérification par heure, chaque alerte envoyée une seule fois (table notifications_sent).
 * Clés VAPID générées au premier besoin et gardées en base (app_kv). Chaque appareil choisit ses
 * alertes (prefs). Le contenu reste sobre : montants et libellés, jamais de numéro de compte.
 * Langue : la vérification tourne en tâche de fond, sans requête — les textes de chaque membre sont écrits
 * dans sa langue (`runInLang(await memberLang(id), …)` autour de ses vérifications).
 */

/** Libellés des types d'alerte (écran des réglages) : marqués ici, traduits à la lecture — pendant la requête, donc dans sa langue. */
export const NOTIF_TYPES = labels({
  aclasser: tk("Opérations à classer (le soir, à 19 h)"),
  prelevement: tk("Prélèvement nouveau ou inhabituel"),
  solde: tk("Solde bas, aujourd'hui ou à venir"),
  loyer: tk("Loyer pas encore reçu (après le 8 du mois)"),
  echeance: tk("Échéances à 7 jours et tâches du jour"),
  garantie: tk("Garantie qui expire dans 30 jours"),
  enveloppe: tk("Enveloppe à 80 % ou dépassée"),
  resume: tk("Résumé de la semaine (lundi, 8 h)"),
});
export type NotifType = keyof typeof NOTIF_TYPES;
/** `lowBalance` : ancien seuil par appareil, repris une fois par la règle du membre (src/server/balance.ts). */
export type NotifPrefs = Partial<Record<NotifType, boolean>> & { lowBalance?: number };
export const DEFAULT_PREFS: NotifPrefs = { aclasser: true, prelevement: true, solde: true, loyer: true, echeance: true, garantie: true, enveloppe: true, resume: true };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const parisNow = () => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", { timeZone: householdTimeZone(), year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23" })
      .formatToParts(new Date())
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday as string, day: Number(p.day) };
};
/** Jour d'une notification, dans la langue du membre : « 22 novembre ». */
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "long", timeZone: "UTC" });
/** Montant d'une notification, au format de la langue du membre. */
const eur = (n: number) => money(n, Math.abs(n) >= 100);

/* ---------- Clés et abonnements ---------- */

let vapid: { publicKey: string; privateKey: string } | null = null;
const vapidSealer = createSealer(sealingSecret);

export async function vapidKeys() {
  if (vapid) return vapid;
  // La clé privée est gardée chiffrée (une copie de la base ne permet pas d'envoyer des notifications au nom de l'instance).
  const read = async () => {
    const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = 'vapid'");
    if (!row) return null;
    const v = JSON.parse(row.value) as { publicKey: string; privateKey?: string; sealed?: string };
    if (v.sealed) {
      const privateKey = vapidSealer.open(v.sealed);
      // Secret du serveur changé : la clé est illisible, les appareils devront se réabonner à de nouvelles clés.
      return privateKey ? { publicKey: v.publicKey, privateKey } : undefined;
    }
    if (!v.privateKey) return undefined;
    // Ancienne écriture en clair : chiffrée au passage.
    await exec("UPDATE app_kv SET value = ? WHERE `key` = 'vapid'", [JSON.stringify({ publicKey: v.publicKey, sealed: vapidSealer.seal(v.privateKey) })]);
    return { publicKey: v.publicKey, privateKey: v.privateKey };
  };
  let keys = await read();
  if (!keys) {
    const k = webpush.generateVAPIDKeys();
    const value = JSON.stringify({ publicKey: k.publicKey, sealed: vapidSealer.seal(k.privateKey) });
    if (keys === undefined) {
      await exec("UPDATE app_kv SET value = ? WHERE `key` = 'vapid'", [value]);
      await exec("DELETE FROM push_subscriptions");
    } else await exec("INSERT IGNORE INTO app_kv (`key`, value) VALUES ('vapid', ?)", [value]);
    keys = (await read()) ?? k;
  }
  vapid = keys;
  // Contact annoncé aux services de notification : l'adresse donnée, sinon l'adresse de l'appli (https exigé ; en local, un contact de forme valide).
  const contact = env.VAPID_CONTACT ? `mailto:${env.VAPID_CONTACT}` : origin.startsWith("https:") ? origin : "mailto:pecule@localhost";
  webpush.setVapidDetails(contact, vapid!.publicKey, vapid!.privateKey);
  return vapid!;
}

export async function subscribe(userId: number, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, device: string | null, prefs?: NotifPrefs) {
  // Adresse du service de notification du navigateur : https, et un hôte public (jamais le réseau du serveur).
  let host = "";
  try {
    const u = new URL(sub.endpoint);
    host = u.protocol === "https:" ? u.hostname : "";
  } catch {
    host = "";
  }
  if (!host || !(await resolvesPublic(host))) throw new Error("Abonnement invalide");
  await exec(
    `INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth, device, prefs) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), p256dh = VALUES(p256dh), auth = VALUES(auth), device = VALUES(device)`,
    [userId, sub.endpoint, sha(sub.endpoint), sub.keys.p256dh, sub.keys.auth, device, JSON.stringify(prefs ?? DEFAULT_PREFS)],
  );
}

export async function getSubscription(userId: number, endpoint: string) {
  const row = await one<{ id: number; prefs: string | null; device: string | null; created_at: string }>(
    "SELECT id, prefs, device, created_at FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?",
    [sha(endpoint), userId],
  );
  return row ? { id: row.id, device: row.device, createdAt: row.created_at, prefs: { ...DEFAULT_PREFS, ...(row.prefs ? JSON.parse(row.prefs) : {}) } as NotifPrefs } : null;
}

export async function updatePrefs(userId: number, endpoint: string, prefs: NotifPrefs) {
  await exec("UPDATE push_subscriptions SET prefs = ? WHERE endpoint_hash = ? AND user_id = ?", [JSON.stringify({ ...DEFAULT_PREFS, ...prefs }), sha(endpoint), userId]);
}

export async function unsubscribe(userId: number, endpoint: string) {
  await exec("DELETE FROM push_subscriptions WHERE endpoint_hash = ? AND user_id = ?", [sha(endpoint), userId]);
}

/* ---------- Envoi ---------- */

type Message = { title: string; body: string; url?: string; tag?: string };

/** Envoie à tous les appareils du membre qui ont activé ce type ; une seule fois par clé (sauf essai). */
export async function notify(userId: number, type: NotifType | "test", key: string | null, msg: Message): Promise<number> {
  if (isDemo()) return 0;
  if (key) {
    const r = await exec("INSERT IGNORE INTO notifications_sent (user_id, `key`, title, body, url) VALUES (?, ?, ?, ?, ?)", [userId, key, msg.title.slice(0, 200), msg.body.slice(0, 400), msg.url ?? null]);
    if (!r.affectedRows) return 0;
  }
  await vapidKeys();
  const subs = await q<{ id: number; endpoint: string; p256dh: string; auth: string; prefs: string | null }>("SELECT id, endpoint, p256dh, auth, prefs FROM push_subscriptions WHERE user_id = ?", [userId]);
  let sent = 0;
  for (const s of subs) {
    const prefs = { ...DEFAULT_PREFS, ...(s.prefs ? JSON.parse(s.prefs) : {}) } as NotifPrefs;
    if (type !== "test" && prefs[type] === false) continue;
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...msg, url: msg.url ?? "/" }), { TTL: 6 * 3600, urgency: "normal" });
      await exec("UPDATE push_subscriptions SET last_sent_at = UTC_TIMESTAMP() WHERE id = ?", [s.id]);
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      // Abonnement expiré ou révoqué (appli supprimée, autorisation retirée) : on l'oublie.
      if (status === 404 || status === 410) await exec("DELETE FROM push_subscriptions WHERE id = ?", [s.id]);
      else console.error("[push] envoi impossible", status, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/* ---------- Règles ---------- */

/** Vérifications d'un membre ; à appeler dans sa langue (voir runNotifications) : titres et textes sont écrits ici. */
async function checksFor(userId: number) {
  const now = parisNow();
  const A = userAccountsSql(userId);
  const month = now.date.slice(0, 7);

  // 1. Opérations à classer : le soir.
  if (now.hour >= 19 && now.hour < 22) {
    // Trois derniers mois seulement : l'historique repris de la banque (années passées) ne relance pas chaque soir.
    const n = await one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tx_lines t JOIN ${A} a ON a.id = t.account_id WHERE ${STAT_SCOPE} AND t.category_id IS NULL AND t.date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`,
    );
    if ((n?.n ?? 0) > 0)
      await notify(userId, "aclasser", `aclasser:${now.date}`, { title: tn("{n} opération à classer", "{n} opérations à classer", n!.n), body: t("Deux minutes en mode tri, avec les suggestions."), url: "/tri", tag: "aclasser" });
  }

  // 2. Prélèvements nouveaux ou inhabituels (3 derniers jours).
  const debits = await q<{ id: string; date: string; amount: number; label: string; merchant: string | null }>(
    `SELECT t.id, t.date, t.amount, t.label, t.merchant FROM transactions t JOIN ${A} a ON a.id = t.account_id
     WHERE t.status IN ('posted', 'pending') AND a.excluded = 0 AND t.amount < 0 AND t.date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)`,
  );
  for (const d of debits.filter((x) => natureOf(x.label, Number(x.amount)) === "prelevement")) {
    const shape = labelShape(d.label);
    const past = await q<{ amount: number; label: string }>(
      `SELECT t.amount, t.label FROM transactions t JOIN ${A} a ON a.id = t.account_id WHERE t.amount < 0 AND t.id <> ? AND t.date < ? AND t.date >= DATE_SUB(?, INTERVAL 13 MONTH)`,
      [d.id, d.date, d.date],
    );
    const same = past.filter((p) => labelShape(p.label) === shape).map((p) => -Number(p.amount));
    const amount = -Number(d.amount);
    const name = d.merchant ?? d.label.slice(0, 40);
    if (!same.length && amount >= 30)
      await notify(userId, "prelevement", `prlv:${d.id}`, { title: t("Nouveau prélèvement : {montant}", { montant: eur(amount) }), body: t("{nom} — jamais vu jusqu'ici. Nomme-le depuis sa fiche.", { nom: name }), url: "/operations" });
    else if (same.length) {
      const avg = same.reduce((s, a) => s + a, 0) / same.length;
      if (avg > 0 && Math.abs(amount - avg) / avg > 0.3 && Math.abs(amount - avg) >= 10)
        await notify(userId, "prelevement", `prlv:${d.id}`, { title: t("Prélèvement inhabituel : {montant}", { montant: eur(amount) }), body: t("{nom} — d'habitude {montant}.", { nom: name, montant: eur(avg) }), url: "/operations" });
    }
  }

  // 3. Solde bas, d'après la règle du membre (src/server/balance.ts) : un compte déjà sous son seuil, ou qui y
  //    passerait dans le délai de prévenance d'après ce qui est attendu. Une alerte par compte et par jour franchi.
  for (const a of (await balanceForecast(userId)).accounts) {
    if (!a.watched) continue;
    const url = `/operations?compte=${encodeURIComponent(a.id)}`;
    if (a.balance < a.threshold) await notify(userId, "solde", `solde:${a.id}:${now.date}`, { title: t("Solde bas : {montant}", { montant: eur(a.balance) }), body: a.name, url });
    else if (a.low)
      await notify(userId, "solde", `solde-prevu:${a.id}:${a.low.date}`, {
        title: t("Solde bas à venir : {montant} le {date}", { montant: eur(a.low.balance), date: shortDate(a.low.date) }),
        body: a.low.cause ? t("{compte} — après {cause} ({montant}).", { compte: a.name, cause: a.low.cause.name, montant: eur(a.low.cause.amount) }) : a.name,
        url: "/mois?onglet=calendrier",
      });
  }

  // 4. Loyer pas encore reçu après le 8 du mois.
  if (now.day >= 8) {
    const rents = await q<{ id: number; label: string; monthly: number }>(
      "SELECT id, label, monthly FROM income_sources WHERE kind = 'loyer' AND monthly > 0 AND (valid_to IS NULL OR valid_to >= CURDATE()) AND (owner_user_id IS NULL OR owner_user_id = ?)",
      [userId],
    );
    for (const r of rents) {
      const got = await one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM transactions t JOIN ${A} a ON a.id = t.account_id WHERE t.amount BETWEEN ? AND ? AND t.date >= ? AND t.status IN ('posted', 'pending')`,
        [Number(r.monthly) * 0.95, Number(r.monthly) * 1.05, `${month}-01`],
      );
      if (!got?.n) await notify(userId, "loyer", `loyer:${r.id}:${month}`, { title: t("Loyer pas encore reçu"), body: t("{nom} : {montant} attendus ce mois-ci.", { nom: r.label, montant: eur(Number(r.monthly)) }), url: "/budget" });
    }
  }

  // 5. Échéances à 7 jours, tâches du jour, garanties à 30 jours (le matin).
  if (now.hour >= 8) {
    const in7 = new Date(Date.parse(`${now.date}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    const in30 = new Date(Date.parse(`${now.date}T12:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10);
    // Les titres des échéances calculées (mensualité, fin de garantie…) sortent de agenda() dans la langue du membre.
    const items = await agenda(userId, now.date, in30);
    for (const e of items) {
      if (!e.date || e.status === "fait") continue;
      if (e.source === "garantie" && e.date === in30)
        await notify(userId, "garantie", `garantie:${e.key}`, { title: t("Garantie : plus que 30 jours"), body: e.title, url: e.link ?? "/echeancier" });
      else if (e.source !== "garantie" && e.date === in7 && e.kind !== "jalon")
        await notify(userId, "echeance", `ech7:${e.key}:${e.date}`, { title: e.amount != null ? t("Dans 7 jours · {montant}", { montant: eur(Math.abs(e.amount)) }) : t("Dans 7 jours"), body: e.title, url: e.link ?? "/echeancier" });
      else if (e.kind === "tache" && e.date === now.date)
        await notify(userId, "echeance", `tache:${e.key}:${e.date}`, { title: t("À faire aujourd'hui"), body: e.title, url: "/echeancier" });
    }
  }

  // 6. Enveloppes à 80 % ou dépassées.
  for (const e of await listEnvelopes(userId, A)) {
    if (e.state === "ok") continue;
    await notify(userId, "enveloppe", `env:${e.id}:${month}:${e.state}`, {
      // Le nom de l'enveloppe est celui d'un poste ou d'une catégorie : traduit comme à l'écran.
      title: e.state === "depasse" ? t("Enveloppe dépassée : {nom}", { nom: td(e.label) }) : t("Enveloppe à {pct} % : {nom}", { pct: Math.round(e.pct), nom: td(e.label) }),
      body:
        e.left >= 0
          ? t("{depense} dépensés sur {plafond}, reste {reste}.", { depense: eur(e.spent), plafond: eur(e.monthly), reste: eur(e.left) })
          : t("{depense} dépensés sur {plafond}.", { depense: eur(e.spent), plafond: eur(e.monthly) }),
      url: "/budget#enveloppes",
    });
  }
}

let running = false;

/** Vérification horaire pour chaque membre ayant au moins un appareil abonné. */
export async function runNotifications() {
  if (running) return;
  running = true;
  try {
    const users = await q<{ user_id: number }>("SELECT DISTINCT user_id FROM push_subscriptions");
    for (const { user_id: userId } of users) {
      try {
        // Tâche de fond, sans requête : chaque membre reçoit ses notifications dans la langue qu'il a choisie.
        await runInLang(await memberLang(userId), () => checksFor(userId));
      } catch (e) {
        void recordAlert("notifications", `Vérification des notifications en échec : ${e instanceof Error ? e.message : String(e)}`, e);
      }
    }
  } finally {
    running = false;
  }
}

/** Dernières notifications envoyées au membre (Réglages). */
export const recentNotifications = (userId: number) => q("SELECT title, body, url, sent_at FROM notifications_sent WHERE user_id = ? ORDER BY id DESC LIMIT 15", [userId]);
