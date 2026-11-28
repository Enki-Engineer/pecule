import { bankReturnOrigin } from "../lib/desktop.ts";
import { createHash, createSign, randomUUID } from "node:crypto";
import { isDemo, runReal } from "./demo-context.ts";
import { exec, one, pool, q, withLock } from "./db.ts";
import { env, origin, sealingSecret } from "./env.ts";
import { guessCategory } from "./guess.ts";
import { accountHousehold } from "./household.ts";
import { fxConverter } from "./fx.ts";
import { householdCurrency } from "./region.ts";
import { recordAlert } from "./journal.ts";
import { createSealer } from "./secret.ts";
import {
  ebAccountKind,
  ebAccountTail,
  ebBalance,
  ebCardOutstanding,
  ebDeferredCard,
  ebHolding,
  ebTransaction,
  isoCurrency,
  type CardOutstanding,
  type EbAccount,
  type EbBalance,
  type EbTransaction,
} from "../lib/enable-banking.ts";
import { historyLabel } from "../lib/bank-history.ts";
import { purchaseDay, reconcile, summarize, type RecTx } from "../lib/bank-reconcile.ts";
import { t } from "../lib/i18n.ts";
import { bankHeadline, classifyAccount, labelKey, type AccountKind } from "../lib/labels.ts";

/*
 * Enable Banking : lecture des comptes bancaires par l'interface officielle des banques (lecture seule).
 * Chaque foyer crée sa propre application chez Enable Banking et donne à Pécule son identifiant et sa clé
 * privée (docs/connecteurs/enable-banking.md). Tout vit dans app_kv (« bank:enablebanking »), toujours dans
 * la vraie base : la clé chiffrée, les accords en cours (un par banque et par membre), l'encours des cartes.
 *
 * Période d'observation : les comptes lus sont créés à part (« eb:… »), masqués et hors statistiques, pour
 * comparer avec la source en place sans rien compter deux fois. Le rattachement aux comptes existants
 * viendra avec la bascule.
 */

const API = "https://api.enablebanking.com";
const KV = "bank:enablebanking";
/** Lectures en arrière-plan : les banques en acceptent peu par jour (souvent 4) ; on reste en dessous. */
const MIN_HOURS_BETWEEN_SYNCS = 6;
const MIN_MINUTES_BETWEEN_FORCED = 10;
/** Fenêtre courante. Au-delà de quelques mois, la banque oublie des achats en attente : l'encours ne se lit que sur une période courte. */
const WINDOW_DAYS = 45;
const FIRST_WINDOW_DAYS = 120;
const sealer = createSealer(sealingSecret);

export class EbError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type EbClient = { get<T>(path: string): Promise<T>; post<T>(path: string, body: unknown): Promise<T>; del(path: string): Promise<void> };

const b64 = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** Client de l'API : chaque demande porte un jeton signé avec la clé privée de l'application (valable une heure). */
export function ebClient(appId: string, privateKey: string): EbClient {
  let token: { value: string; exp: number } | null = null;
  const jwt = () => {
    const now = Math.floor(Date.now() / 1000);
    if (token && token.exp - now > 120) return token.value;
    const head = b64(JSON.stringify({ typ: "JWT", alg: "RS256", kid: appId }));
    const body = b64(JSON.stringify({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: now, exp: now + 3600 }));
    const value = `${head}.${body}.${b64(createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey))}`;
    token = { value, exp: now + 3600 };
    return value;
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${jwt()}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let message = text.slice(0, 300);
      try {
        message = (JSON.parse(text) as { message?: string; detail?: string }).message ?? message;
      } catch {
        /* réponse qui n'est pas du JSON : on garde le texte */
      }
      throw new EbError(res.status, message);
    }
    return text ? JSON.parse(text) : null;
  };
  return { get: (path) => call("GET", path), post: (path, body) => call("POST", path, body), del: async (path) => void (await call("DELETE", path)) };
}

/* ---------- Ce que Pécule garde ---------- */

type StoredAccount = { key: string; uid: string; hashes: string[]; name: string; kind: AccountKind; deferred: boolean; tail: string | null; holding: ReturnType<typeof ebHolding> };
/** `app` : membre dont la clé personnelle a servi à cet accord (absent : la clé du foyer). */
type StoredSession = { id: string; aspsp: string; country: string; userId: number; validUntil: string; createdAt: string; accounts: StoredAccount[]; app?: number };
type Stored = {
  appId?: string;
  /** Clé privée chiffrée (secret.ts). */
  key?: string;
  /**
   * Clé personnelle d'un membre (identifiant du membre → application et clé chiffrée) : l'usage gratuit
   * d'Enable Banking ne couvre que les comptes de la personne inscrite, donc un autre adulte qui a ses
   * propres comptes crée sa propre application.
   */
  members?: Record<string, { appId: string; key: string }>;
  sessions?: StoredSession[];
  /** Demandes d'accord en cours (state → qui, quelle banque, quelle clé), valables 20 minutes. `from` : l'écran d'où elle est partie, quand ce n'est pas celui des réglages. */
  pending?: Record<string, { userId: number; aspsp: string; country: string; at: number; app?: number; from?: EbAuthOrigin }>;
  lastSyncAt?: string;
  /** Comptes lus → comptes de Pécule qu'ils alimentent (après la bascule). */
  adopted?: Record<string, string>;
  /** Observation : les comptes lus sont créés à part, masqués et hors statistiques. */
  observation?: boolean;
  cards?: Record<string, CardOutstanding & { at: string }>;
};

async function load(): Promise<Stored> {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [KV]));
  try {
    return JSON.parse(row?.value ?? "{}") as Stored;
  } catch {
    return {};
  }
}
const save = (s: Stored) => runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KV, JSON.stringify(s)]));

/**
 * Modifie l'état enregistré : il est relu juste avant, et une seule modification passe à la fois. Deux écritures
 * rapprochées (l'accord d'un membre pendant qu'une lecture s'achève, une clé enregistrée pendant un accord) ne
 * s'effacent plus l'une l'autre.
 */
let writing: Promise<unknown> = Promise.resolve();
function mutate(change: (fresh: Stored) => Stored): Promise<void> {
  const run = async () => {
    await save(change(await load()));
  };
  const next = writing.then(run, run);
  writing = next.catch(() => undefined);
  return next;
}

/** Client de la clé personnelle d'un membre (`app`), sinon de la clé du foyer. */
function clientOf(s: Stored, app?: number): EbClient | null {
  const own = app !== undefined ? s.members?.[String(app)] : undefined;
  const appId = own ? own.appId : s.appId;
  const sealed = own ? own.key : s.key;
  const key = appId && sealed ? sealer.open(sealed) : null;
  return key ? ebClient(appId!, key) : null;
}
/** Le membre a-t-il sa propre clé ? Elle prime alors sur celle du foyer pour ses accords. */
const ownApp = (s: Stored, userId: number): number | undefined => (s.members?.[String(userId)] ? userId : undefined);

/** Identifiant stable d'un compte, d'une session à l'autre (l'empreinte que donne l'API est trop longue pour servir de clé). */
const accountKey = (a: EbAccount) => createHash("sha256").update(a.identification_hash ?? a.account_id?.iban ?? a.account_id?.other?.identification ?? a.uid).digest("hex").slice(0, 40);
const accountIdOf = (key: string) => `eb:${key}`;
/**
 * Ce qui désigne un même compte d'un accord à l'autre : sa nature, la fin de son numéro, son intitulé — et, quand
 * la banque ne donne pas de numéro, la banque elle-même (deux comptes sans numéro au même intitulé, dans deux
 * banques, restent deux comptes).
 */
const identityOf = (a: Pick<StoredAccount, "kind" | "tail" | "name">, aspsp: string) => `${a.kind}|${a.tail ?? `@${aspsp}`}|${a.name}`;
/** Carte à débit immédiat : ses achats figurent aussi sur le compte courant qu'elle débite. */
const immediateCard = (a: Pick<StoredAccount, "kind" | "deferred">) => a.kind === "carte" && !a.deferred;
/** Comptes lus, chacun une seule fois (le premier accord qui le porte). */
const uniqueAccounts = (s: Stored): StoredAccount[] => [...new Map((s.sessions ?? []).flatMap((x) => x.accounts).map((a) => [a.key, a] as const).reverse()).values()].reverse();
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const daysLeft = (until: string) => Math.floor((Date.parse(until) - Date.now()) / 86400_000);

/* ---------- Réglages ---------- */

export type EbStatus = {
  configured: boolean;
  /** La clé enregistrée n'est plus lisible (le secret du serveur a changé) : à ressaisir. */
  keyUnreadable: boolean;
  appId: string | null;
  /** Adresse de retour à déclarer chez Enable Banking. */
  redirectUrl: string;
  application: { name: string; active: boolean; environment: string; redirectOk: boolean } | null;
  error: string | null;
  /** `own` : l'accord a été donné avec la clé personnelle du membre (sinon, avec celle du foyer). */
  sessions: { id: string; aspsp: string; country: string; userId: number; own: boolean; validUntil: string; daysLeft: number; accounts: { id: string; name: string; kind: AccountKind; deferred: boolean; tail: string | null }[] }[];
  lastSyncAt: string | null;
  /** Clé personnelle du membre qui regarde (null s'il n'en a pas) : elle sert alors à ses propres accords. */
  own: { appId: string; keyUnreadable: boolean; application: EbStatus["application"]; error: string | null } | null;
  /** Des comptes lus sont encore gardés à part (masqués, hors statistiques), en attendant la bascule. */
  observation: boolean;
};

export const ebRedirectUrl = () => `${bankReturnOrigin(process.env, origin)}/reglages/comptes`;

async function applicationOf(client: EbClient | null): Promise<{ application: EbStatus["application"]; error: string | null }> {
  if (!client) return { application: null, error: null };
  try {
    const a = await client.get<{ name: string; active: boolean; environment: string; redirect_urls?: string[] }>("/application");
    return { application: { name: a.name, active: a.active, environment: a.environment, redirectOk: (a.redirect_urls ?? []).includes(ebRedirectUrl()) }, error: null };
  } catch (e) {
    return { application: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** État des connexions, vu par un membre (sa clé personnelle, s'il en a une, est décrite à part). */
export async function ebStatus(userId?: number): Promise<EbStatus> {
  const s = await load();
  const client = clientOf(s);
  const { application, error } = await applicationOf(client);
  const mine = userId !== undefined ? s.members?.[String(userId)] : undefined;
  const mineClient = mine ? clientOf(s, userId) : null;
  return {
    configured: !!client,
    keyUnreadable: !!s.key && !client,
    appId: s.appId ?? null,
    redirectUrl: ebRedirectUrl(),
    application,
    error,
    sessions: (s.sessions ?? []).map((x) => ({
      id: x.id,
      aspsp: x.aspsp,
      country: x.country,
      userId: x.userId,
      own: x.app !== undefined,
      validUntil: x.validUntil,
      daysLeft: daysLeft(x.validUntil),
      accounts: x.accounts.map((a) => ({ id: s.adopted?.[a.key] ?? accountIdOf(a.key), name: a.name, kind: a.kind, deferred: a.deferred, tail: a.tail })),
    })),
    lastSyncAt: s.lastSyncAt ?? null,
    own: mine ? { appId: mine.appId, keyUnreadable: !mineClient, ...(await applicationOf(mineClient)) } : null,
    observation: uniqueAccounts(s).some((a) => !s.adopted?.[a.key]),
  };
}

/**
 * Enregistre l'identifiant et la clé privée d'une application, après les avoir essayés pour de bon :
 * celle du foyer, ou la clé personnelle d'un membre (`userId`).
 */
export async function ebSaveKey(appId: string, privateKey: string, userId?: number): Promise<void> {
  const pem = privateKey.trim();
  if (!/^[0-9a-f-]{36}$/i.test(appId.trim())) throw new EbError(400, t("Identifiant d'application invalide"));
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) throw new EbError(400, t("Clé privée invalide"));
  // Une mauvaise clé ou un mauvais identifiant : la demande est refusée, rien n'est enregistré.
  try {
    await ebClient(appId.trim(), pem).get("/application");
  } catch (e) {
    // Refus d'Enable Banking : son message. Clé que le serveur ne sait pas lire (fichier abîmé, mauvais format) : le dire simplement.
    if (e instanceof EbError) throw e;
    throw new EbError(400, t("Clé privée invalide"));
  }
  if (userId === undefined) await mutate((f) => ({ ...f, appId: appId.trim(), key: sealer.seal(pem) }));
  else await mutate((f) => ({ ...f, members: { ...(f.members ?? {}), [String(userId)]: { appId: appId.trim(), key: sealer.seal(pem) } } }));
}

/**
 * Oublie une clé et les accords qu'elle porte : celle du foyer, ou la clé personnelle d'un membre (`userId`).
 * Les comptes et opérations déjà lus restent dans Pécule, comme les rattachements faits à la bascule.
 */
export async function ebForget(userId?: number): Promise<void> {
  const s = await load();
  const client = clientOf(s, userId);
  const gone = (s.sessions ?? []).filter((x) => x.app === userId);
  for (const x of gone) await client?.del(`/sessions/${x.id}`).catch(() => {});
  const goneIds = new Set(gone.map((x) => x.id));
  await mutate((f) => {
    const sessions = (f.sessions ?? []).filter((x) => !goneIds.has(x.id));
    if (userId === undefined) {
      const { appId: _a, key: _k, ...rest } = f;
      return { ...rest, sessions };
    }
    const { [String(userId)]: _m, ...members } = f.members ?? {};
    return { ...f, members, sessions };
  });
}

const banks = new Map<string, { at: number; list: { name: string; country: string; personal: boolean; consentDays: number; logo: string | null }[] }>();

/** Banques d'un pays (gardées une heure en mémoire), avec l'adresse de leur logo chez Enable Banking. */
export async function ebBanks(country: string) {
  const c = country.toUpperCase();
  const cached = banks.get(c);
  if (cached && Date.now() - cached.at < 3600_000) return cached.list;
  const s = await load();
  const client = clientOf(s) ?? Object.keys(s.members ?? {}).map((id) => clientOf(s, Number(id))).find(Boolean) ?? null;
  if (!client) throw new EbError(400, t("Enable Banking n'est pas configuré"));
  const { aspsps } = await client.get<{ aspsps: { name: string; country: string; psu_types?: string[]; maximum_consent_validity?: number; logo?: string | null }[] }>(`/aspsps?country=${encodeURIComponent(c)}`);
  const list = aspsps
    .map((a) => ({ name: a.name, country: a.country, personal: (a.psu_types ?? []).includes("personal"), consentDays: Math.floor((a.maximum_consent_validity ?? 0) / 86400), logo: a.logo ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  banks.set(c, { at: Date.now(), list });
  return list;
}

/** Écran, autre que les réglages, d'où part une demande d'accord : le retour de la banque y ramène (la présentation de bienvenue). */
export type EbAuthOrigin = "bienvenue";

/** Demande d'accord : l'adresse où envoyer le titulaire (page d'accord, puis sa banque). */
export async function ebStartAuth(userId: number, aspsp: string, country: string, from?: EbAuthOrigin): Promise<string> {
  const s = await load();
  const app = ownApp(s, userId);
  const client = clientOf(s, app);
  if (!client) throw new EbError(400, t("Enable Banking n'est pas configuré"));
  const bank = (await ebBanks(country)).find((b) => b.name === aspsp);
  if (!bank) throw new EbError(400, t("Banque inconnue"));
  const state = randomUUID();
  const days = Math.min(180, bank.consentDays || 180);
  const r = await client.post<{ url: string }>("/auth", {
    access: { valid_until: new Date(Date.now() + days * 86400_000 - 60_000).toISOString() },
    aspsp: { name: bank.name, country: bank.country },
    state,
    redirect_url: ebRedirectUrl(),
    psu_type: "personal",
  });
  await mutate((f) => {
    const pending = Object.fromEntries(Object.entries(f.pending ?? {}).filter(([, p]) => Date.now() - p.at < 20 * 60_000));
    return { ...f, pending: { ...pending, [state]: { userId, aspsp: bank.name, country: bank.country, at: Date.now(), ...(app !== undefined ? { app } : {}), ...(from ? { from } : {}) } } };
  });
  return r.url;
}

/** Écran d'où est partie une demande d'accord (à lire avant `ebFinishAuth`, qui l'oublie) ; null : les réglages. */
export async function ebAuthOrigin(state: string): Promise<EbAuthOrigin | null> {
  return (await load()).pending?.[state]?.from ?? null;
}

/**
 * Retour de la banque : le code est échangé contre l'accord (une session), qui remplace l'ancien pour cette banque
 * et ce membre. Le membre est celui de la demande, retrouvée par son `state` — une valeur tirée au hasard, connue
 * du seul navigateur parti chez la banque : pas besoin d'une session Pécule dans ce navigateur.
 */
export async function ebFinishAuth(code: string, state: string): Promise<{ aspsp: string; accounts: number }> {
  const s = await load();
  const asked = s.pending?.[state];
  const client = asked ? clientOf(s, asked.app) : null;
  if (!client || !asked || Date.now() - asked.at > 20 * 60_000) throw new EbError(400, t("Demande d'accord inconnue ou expirée"));
  const userId = asked.userId;
  const r = await client.post<EbSessionResponse>("/sessions", { code });
  await mutate((f) => {
    const { [state]: _done, ...pending } = f.pending ?? {};
    return { ...f, pending };
  });
  const previous = (s.sessions ?? []).filter((x) => x.aspsp === asked.aspsp && x.userId === userId);
  for (const x of previous) await client.del(`/sessions/${x.id}`).catch(() => {});
  return ebStoreSession(userId, asked.aspsp, asked.country, r, asked.app);
}

export type EbSessionResponse = { session_id: string; access: { valid_until: string }; accounts: EbAccount[] };

/** Enregistre un accord (la réponse de `POST /sessions`) : il remplace l'ancien pour cette banque et ce membre. */
export async function ebStoreSession(userId: number, aspsp: string, country: string, r: EbSessionResponse, app?: number): Promise<{ aspsp: string; accounts: number }> {
  const s = await load();
  // Un compte déjà connu par un autre accord (compte joint lu par les deux titulaires, chacun avec sa propre
  // application) garde sa clé : il n'existe qu'une fois dans Pécule, quel que soit l'accord qui le lit.
  const knownKeys = new Map((s.sessions ?? []).flatMap((x) => x.accounts.map((a) => [identityOf(a, x.aspsp), a.key] as const)));
  const accounts = r.accounts.map((a): StoredAccount => ({
    key: knownKeys.get(identityOf({ kind: ebAccountKind(a), tail: ebAccountTail(a), name: (a.name ?? a.product ?? "Compte").slice(0, 255) }, aspsp)) ?? accountKey(a),
    uid: a.uid,
    hashes: a.identification_hashes ?? (a.identification_hash ? [a.identification_hash] : []),
    name: (a.name ?? a.product ?? "Compte").slice(0, 255),
    kind: ebAccountKind(a),
    deferred: ebDeferredCard(a),
    tail: ebAccountTail(a),
    holding: ebHolding(a),
  }));
  await mutate((f) => ({
    ...f,
    sessions: [...(f.sessions ?? []).filter((x) => !(x.aspsp === aspsp && x.userId === userId)), { id: r.session_id, aspsp, country, userId, validUntil: r.access.valid_until, createdAt: new Date().toISOString(), accounts, ...(app !== undefined ? { app } : {}) }],
  }));
  return { aspsp, accounts: accounts.length };
}

/** Retire un accord (et le signale à Enable Banking). */
export async function ebRemoveSession(id: string): Promise<void> {
  const s = await load();
  await clientOf(s, s.sessions?.find((x) => x.id === id)?.app)
    ?.del(`/sessions/${id}`)
    .catch(() => {});
  await mutate((f) => ({ ...f, sessions: (f.sessions ?? []).filter((x) => x.id !== id) }));
}

/* ---------- Synchronisation ---------- */

export type EbSyncResult = { accounts: number; seen: number; inserted: number; attached: number; pending: number; cards: number; errors: string[] };

async function allTransactions(client: EbClient, uid: string, from: string): Promise<EbTransaction[]> {
  const out: EbTransaction[] = [];
  let next: string | undefined;
  do {
    const page = await client.get<{ transactions?: EbTransaction[]; continuation_key?: string | null }>(
      `/accounts/${uid}/transactions?date_from=${from}${next ? `&continuation_key=${encodeURIComponent(next)}` : ""}`,
    );
    out.push(...(page.transactions ?? []));
    next = page.continuation_key ?? undefined;
  } while (next && out.length < 20_000);
  return out;
}

type Row = RecTx & { bank_ref: string | null; origin: string };
// `amount` : le montant tel que la banque l'a écrit (celui d'origine pour un compte qui n'est pas dans la devise du
// foyer) — c'est lui qu'on compare à ce que la banque annonce, jamais sa conversion, qui dépend du cours du jour.
/**
 * Montant d'une opération déjà connue : celui de la banque pour un compte dans la devise du foyer ; pour un compte en
 * devise, la conversion déjà gardée tant que le montant d'origine n'a pas changé (elle ne suit pas le cours du jour :
 * ventilations et statistiques restent stables). S'écrit avant `original_amount` dans la même instruction.
 */
const KEEP_CONVERTED = "IF(? IS NOT NULL AND original_amount <=> ? AND original_currency <=> ?, amount, ?)";
const kept = (t: { amount: number; originalAmount: number | null; originalCurrency: string | null }) => [t.originalCurrency, t.originalAmount, t.originalCurrency, t.amount];

const ROW = "id, DATE_FORMAT(date, '%Y-%m-%d') AS date, COALESCE(original_amount, amount) AS amount, label, status, bank_ref, origin";

/**
 * Libellé de la banque d'une opération venue d'une autre source : celui d'Enable Banking (ligne par ligne) le
 * remplace s'il manque, s'il n'est que son intitulé (export de la banque), ou s'il est son ancienne écriture sur une
 * seule ligne. Tout autre libellé déjà là est gardé. Paramètres : `richer(t)`.
 */
const RICHER_BANK_LABEL = "IF(bank_label IS NULL OR bank_label = ? OR bank_label = ?, ?, bank_label)";
const richer = (t: { label: string; bankLabel: string | null }) => [bankHeadline(t.bankLabel ?? ""), t.label.slice(0, 255), t.bankLabel];
/** Préfixe des références d'un compte : « eb:<début de l'empreinte du compte>: ». */
const refPrefix = (key: string) => `eb:${key.slice(0, 12)}:`;

/**
 * Lit comptes, soldes et opérations de chaque accord en cours. `force` : à la demande d'un membre (sinon, pas plus
 * d'une lecture toutes les 6 heures). `client` : pour les essais, un client qui rejoue des réponses enregistrées.
 *
 * Un compte **adopté** alimente le compte de Pécule désigné ; sinon il est créé à part (« eb:… »), masqué et hors
 * statistiques tant que dure l'observation. Une opération lue retrouve sa ligne par sa référence (`bank_ref`) ;
 * une opération nouvelle est d'abord rapprochée d'une ligne qui l'attend — un achat en attente que la banque vient
 * d'écrire sous une autre référence, ou une ligne venue d'une autre source — avant d'être créée.
 */
export async function syncEnableBanking(opts: { force?: boolean; client?: EbClient } = {}): Promise<EbSyncResult | null> {
  if (isDemo()) throw new Error("Synchronisation indisponible en mode démo");
  const first = await load();
  if (!first.sessions?.length) return null;
  const clients = new Map<number | undefined, EbClient | null>();
  const clientFor = (app?: number) => opts.client ?? (clients.has(app) ? clients.get(app)! : (clients.set(app, clientOf(first, app)), clients.get(app)!));
  if (!first.sessions.some((x) => clientFor(x.app))) {
    // Des accords, mais plus aucune clé qui s'ouvre (sauvegarde reprise dans une autre installation, secret de
    // chiffrement changé) : rien ne sera lu. Sans cette alerte, la synchronisation semblerait aboutir, à vide.
    if (first.key || Object.keys(first.members ?? {}).length)
      await recordAlert("banque", "Banque non lue : la clé Enable Banking enregistrée n'est plus lisible (sauvegarde reprise dans une autre installation, ou secret de chiffrement changé). Ressaisis-la dans Réglages → Comptes et connexions.", undefined, "alerte");
    return null;
  }
  if (!opts.force && first.lastSyncAt && Date.now() - Date.parse(first.lastSyncAt) < MIN_HOURS_BETWEEN_SYNCS * 3600_000) return null;
  // Même à la demande, pas deux lectures coup sur coup : les banques comptent chaque lecture.
  if (opts.force && !opts.client && first.lastSyncAt && Date.now() - Date.parse(first.lastSyncAt) < MIN_MINUTES_BETWEEN_FORCED * 60_000) return null;
  return withLock("pecule:sync-enablebanking", async () => {
    const result: EbSyncResult = { accounts: 0, seen: 0, inserted: 0, attached: 0, pending: 0, cards: 0, errors: [] };
    const cards: NonNullable<Stored["cards"]> = {};
    const household = await accountHousehold();
    const today = isoDay(new Date());
    // Observation : tant qu'une autre source en direct (Finta) alimente des comptes qui n'ont pas été rattachés,
    // un compte nouveau est créé à part, masqué et hors statistiques (rien n'est compté deux fois). Sinon — installation
    // neuve, comptes saisis à la main ou importés d'un fichier — il est créé visible.
    const targets = Object.values(first.adopted ?? {});
    const observing = !!env.FINTA_API_KEY && !!(await one(`SELECT id FROM accounts WHERE source = 'finta'${targets.length ? ` AND id NOT IN (${targets.map(() => "?").join(", ")})` : ""} LIMIT 1`, targets));
    // Un compte porté par deux accords (compte joint) n'est lu qu'une fois : par le premier accord qui y parvient.
    const read = new Set<string>();
    for (const session of first.sessions!) {
      if (daysLeft(session.validUntil) < 0) {
        result.errors.push(`${session.aspsp} : accord expiré`);
        continue;
      }
      const client = clientFor(session.app);
      if (!client) {
        result.errors.push(`${session.aspsp} : clé illisible`);
        continue;
      }
      for (const a of session.accounts) {
        if (read.has(a.key)) continue;
        const adopted = first.adopted?.[a.key];
        const id = adopted ?? accountIdOf(a.key);
        const prefix = refPrefix(a.key);
        try {
          const known = await one<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND bank_ref LIKE ?", [id, `${prefix}%`]);
          const from = isoDay(new Date(Date.now() - (known?.n ? WINDOW_DAYS : FIRST_WINDOW_DAYS) * 86400_000));
          const { balances } = await client.get<{ balances: EbBalance[] }>(`/accounts/${a.uid}/balances`);
          const txs = immediateCard(a) ? [] : await allTransactions(client, a.uid, from);
          const balance = ebBalance(a.kind, balances ?? []);
          // Devise du compte : celle que la banque écrit sur ses soldes et ses opérations. Les montants sont ramenés à la
          // devise du foyer au cours de leur jour (l'original est gardé) ; un compte dans la devise du foyer n'est pas touché.
          // (Une devise que Pécule ne sait pas convertir arrête la lecture de ce compte, avec un message, plutôt que d'être prise pour une autre.)
          const currency = balance?.currency ?? isoCurrency(balances?.[0]?.balance_amount.currency) ?? isoCurrency(txs[0]?.transaction_amount.currency) ?? householdCurrency();
          const convert = await fxConverter([currency], from);
          const held = balance ? convert(balance.balance, currency, today) : null;
          if (adopted) {
            await exec("UPDATE accounts SET currency = ?, balance = COALESCE(?, balance), balance_original = IF(? IS NULL, balance_original, ?), balance_at = UTC_TIMESTAMP() WHERE id = ?", [currency, held?.amount ?? null, held?.amount ?? null, held?.originalAmount ?? null, id]);
          } else {
            // Le titulaire se lit dans l'intitulé ; à défaut, dans le lien du membre avec le compte.
            const guessed = classifyAccount(a.name, session.aspsp, household).owner;
            const owner = guessed !== "autre" ? guessed : a.holding === "joint" ? "joint" : "autre";
            await exec(
              `INSERT INTO accounts (id, name, institution, owner, kind, currency, balance, balance_original, balance_at, hidden, excluded, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), ?, ?, 'enablebanking')
               ON DUPLICATE KEY UPDATE name = VALUES(name), institution = VALUES(institution), currency = VALUES(currency), balance_original = IF(VALUES(balance) IS NULL, balance_original, VALUES(balance_original)),
                 balance = COALESCE(VALUES(balance), balance), balance_at = VALUES(balance_at)`,
              [id, a.name, session.aspsp, owner, a.kind === "autre" ? "courant" : a.kind, currency, held?.amount ?? null, held?.originalAmount ?? null, observing ? 1 : 0, observing ? 1 : 0],
            );
          }
          if (held) await exec("INSERT INTO balances (account_id, date, balance) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)", [id, today, held.amount]);
          result.accounts++;
          // Carte à débit immédiat : chacun de ses achats est déjà écrit sur le compte courant. Les lire ici les
          // compterait deux fois : la carte ne garde que son solde, et ce qui aurait été lu auparavant est retiré.
          if (immediateCard(a)) {
            await exec("DELETE FROM transactions WHERE account_id = ? AND origin = 'enablebanking' AND bank_ref LIKE ?", [id, `${prefix}%`]);
            read.add(a.key);
            continue;
          }

          const incoming = txs
            .map(ebTransaction)
            .filter((t): t is NonNullable<typeof t> => !!t)
            .map((t) => ({ ...t, ref: `${prefix}${t.reference ?? `h${createHash("sha1").update(`${t.date}|${t.amount}|${t.label}`).digest("hex").slice(0, 16)}`}`.slice(0, 160) }))
            // La référence se calcule sur le montant de la banque ; tout le reste (rapprochement, écriture) se fait dans la devise du foyer.
            .map((t) => {
              // Une opération se lit dans la devise de son compte (c'est ainsi que la banque l'écrit sur le compte).
              const c = convert(t.amount, currency, t.date);
              return { ...t, amount: c.amount, written: t.amount, originalAmount: c.originalAmount, originalCurrency: c.originalCurrency };
            });
          result.seen += incoming.length;
          result.pending += incoming.filter((t) => t.status === "pending").length;
          const announced = new Set(incoming.map((t) => t.ref));
          const linked = await q<Row>(`SELECT ${ROW} FROM transactions WHERE account_id = ? AND bank_ref LIKE ?`, [id, `${prefix}%`]);
          const byRef = new Map(linked.map((r) => [r.bank_ref!, r]));

          // 1. Opérations déjà connues : la banque fait foi pour la date, le montant et l'état.
          for (const t of incoming) {
            const row = byRef.get(t.ref);
            if (!row) continue;
            if (row.origin === "enablebanking")
              await exec(`UPDATE transactions SET date = ?, amount = ${KEEP_CONVERTED}, original_amount = ?, original_currency = ?, status = ?, label = ?, bank_label = ?, purchase_date = COALESCE(?, purchase_date), label_key = IF(merchant IS NOT NULL, label_key, ?) WHERE id = ?`, [t.date, ...kept(t), t.originalAmount, t.originalCurrency, t.status, historyLabel(t.headline), t.bankLabel, t.purchaseDate, labelKey(historyLabel(t.headline)), row.id]);
            else await exec(`UPDATE transactions SET date = ?, amount = ${KEEP_CONVERTED}, original_amount = ?, original_currency = ?, status = ?, purchase_date = COALESCE(purchase_date, ?), bank_label = ${RICHER_BANK_LABEL} WHERE id = ?`, [t.date, ...kept(t), t.originalAmount, t.originalCurrency, t.status, t.purchaseDate, ...richer(t), row.id]);
          }

          // 2. Opérations nouvelles : d'abord les rapprocher d'une ligne qui les attend.
          const fresh = incoming.filter((t) => !byRef.has(t.ref));
          if (fresh.length) {
            // Attentes que la banque n'annonce plus (l'achat vient d'être écrit, peut-être sous une autre référence)…
            const orphans = linked.filter((r) => r.status === "pending" && !announced.has(r.bank_ref!));
            // … et, pour un compte adopté, lignes de ce compte venues d'ailleurs et pas encore rattachées.
            const unlinked = adopted ? await q<Row>(`SELECT ${ROW} FROM transactions WHERE account_id = ? AND bank_ref IS NULL AND status <> 'deleted' AND date >= DATE_SUB(?, INTERVAL 40 DAY)`, [id, from]) : [];
            const r = reconcile(
              fresh.map((t) => ({ id: t.ref, date: t.date, amount: t.written, label: t.label, status: t.status })),
              [...orphans, ...unlinked],
            );
            const freshByRef = new Map(fresh.map((t) => [t.ref, t]));
            for (const p of r.pairs) {
              const t = freshByRef.get(p.incoming.id)!;
              await exec(`UPDATE transactions SET bank_ref = ?, date = ?, amount = ${KEEP_CONVERTED}, original_amount = ?, original_currency = ?, status = ?, purchase_date = COALESCE(purchase_date, ?), bank_label = IF(origin = 'enablebanking', bank_label, ${RICHER_BANK_LABEL}) WHERE id = ?`, [t.ref, t.date, ...kept(t), t.originalAmount, t.originalCurrency, t.status, t.purchaseDate, ...richer(t), p.existing.id]);
              announced.add(t.ref);
              result.attached++;
            }
            for (const lone of r.onlyIncoming) {
              const t = freshByRef.get(lone.id)!;
              // Le libellé est l'intitulé de la banque, écrit comme les autres (« Carte 05 11 26 Enseigne », « Prlv Sepa Créancier ») :
              // le même d'un mois à l'autre, donc la même catégorie. Le libellé entier de la banque (texte du créancier,
              // références) est gardé ligne par ligne à côté, et le jour d'achat quand la banque le donne.
              const label = historyLabel(t.headline);
              const key = labelKey(label);
              await exec("INSERT INTO transactions (id, account_id, date, purchase_date, amount, original_amount, original_currency, label, bank_label, label_key, status, origin, bank_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enablebanking', ?)", [t.ref, id, t.date, t.purchaseDate, t.amount, t.originalAmount, t.originalCurrency, label, t.bankLabel, key, t.status, t.ref]);
              result.inserted++;
              const guess = await guessCategory(key);
              if (guess) await exec("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ? AND category_id IS NULL", [guess.categoryId, guess.source, t.ref]);
            }
          }

          // 3. Un achat en attente que la banque n'annonce plus, et qu'aucune écriture n'a repris : l'attente s'efface
          //    (une ligne créée par cette lecture est retirée ; une ligne venue d'ailleurs garde sa place, sans référence).
          const stale = await q<Row>(`SELECT ${ROW} FROM transactions WHERE account_id = ? AND bank_ref LIKE ? AND status = 'pending'`, [id, `${prefix}%`]);
          for (const row of stale) {
            if (announced.has(row.bank_ref!)) continue;
            if (row.origin === "enablebanking") await exec("DELETE FROM transactions WHERE id = ? AND status = 'pending'", [row.id]);
            else await exec("UPDATE transactions SET bank_ref = NULL, status = 'posted' WHERE id = ?", [row.id]);
          }

          if (a.deferred) {
            const outstanding = ebCardOutstanding(balances ?? [], txs);
            if (outstanding) {
              // Encours d'une carte en devise : ramené à la devise du foyer au cours du jour, comme son solde.
              const home = (n: number) => convert(n, currency, today).amount;
              cards[id] = { ...outstanding, amount: home(outstanding.amount), realtime: outstanding.realtime == null ? null : home(outstanding.realtime), sum: home(outstanding.sum), at: new Date().toISOString() };
              result.cards++;
            }
          }
          read.add(a.key);
        } catch (e) {
          result.errors.push(`${session.aspsp} · ${a.kind}${a.tail ? ` •••• ${a.tail}` : ""} : ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    // L'encours est rangé sous le compte du moment : après une adoption, celui du compte en service.
    await mutate((f) => ({ ...f, lastSyncAt: new Date().toISOString(), cards }));
    if (result.errors.length) await recordAlert("banque", `Enable Banking : ${result.errors.length} lecture(s) en échec`, result.errors);
    return result;
  });
}

/* ---------- Bascule : les comptes lus alimentent les comptes en service ---------- */

export type EbAdoption = {
  accountId: string;
  name: string;
  target: { id: string; name: string } | null;
  /** Lignes du compte en service reconnues dans la lecture ; parmi elles, celles dont la date ou l'état change. */
  attached: number;
  redated: number;
  restored: number;
  /** Opérations que seule la banque connaît (dont les achats en attente de prélèvement) : elles rejoignent le compte. */
  added: number;
  /** Lignes du compte en service que la lecture ne connaît pas : elles restent telles quelles. */
  kept: number;
};

/**
 * Bascule des comptes en observation vers les comptes en service qui portent les mêmes opérations. À blanc par
 * défaut. Pour chaque compte : les lignes existantes reconnues reçoivent la référence de la banque (et sa date,
 * son état), les opérations que seule la banque connaît rejoignent le compte, puis le compte d'observation
 * disparaît. Tout est fait dans une transaction ; le détail de ce qui a changé est gardé (« bank:enablebanking:bascule »).
 */
export async function ebAdopt(opts: { apply?: boolean; map?: Record<string, string> } = {}): Promise<{ applied: boolean; accounts: EbAdoption[] }> {
  if (isDemo()) throw new Error("Indisponible en mode démo");
  const s = await load();
  const comparisons = await ebCompare();
  const plan: EbAdoption[] = [];
  const log: { account: string; target: string; changes: { id: string; date: [string, string]; status: [string, string] }[]; added: string[] }[] = [];
  const conn = await runReal(() => pool.getConnection());
  try {
    await conn.beginTransaction();
    const adopted = { ...(s.adopted ?? {}) };
    for (const a of uniqueAccounts(s)) {
      const obs = accountIdOf(a.key);
      if (adopted[a.key]) continue;
      // Cible : celle que l'administrateur impose (`map` : compte lu → compte de Pécule), sinon celle du comparatif.
      const forced = opts.map?.[obs];
      const [named] = forced ? ((await conn.query("SELECT id, COALESCE(display_name, name) AS name FROM accounts WHERE id = ? AND source <> 'enablebanking'", [forced])) as unknown as [{ id: string; name: string }[]]) : [[]];
      if (forced && !named.length) throw new EbError(400, `Compte inconnu : ${forced}`);
      const target = named[0] ?? comparisons.find((c) => c.accountId === obs)?.counterpart ?? null;
      const entry: EbAdoption = { accountId: obs, name: a.name, target, attached: 0, redated: 0, restored: 0, added: 0, kept: 0 };
      plan.push(entry);
      if (!target) continue;
      const [incoming] = immediateCard(a) ? [[] as Row[]] : ((await conn.query(`SELECT ${ROW} FROM transactions WHERE account_id = ? AND origin = 'enablebanking' AND status IN ('posted', 'pending')`, [obs])) as unknown as [Row[]]);
      if (!incoming.length) {
        // Rien à rapprocher (carte à débit immédiat, compte sans opération) : seul le compte est rattaché, si la cible est imposée.
        if (!forced) continue;
        await conn.query("DELETE FROM transactions WHERE account_id = ?", [obs]);
        await conn.query("DELETE FROM balances WHERE account_id = ?", [obs]);
        await conn.query("DELETE FROM accounts WHERE id = ? AND source = 'enablebanking'", [obs]);
        adopted[a.key] = target.id;
        log.push({ account: obs, target: target.id, changes: [], added: [] });
        continue;
      }
      const ref = (t: RecTx) => purchaseDay(t.label) ?? t.date;
      const from = incoming.map(ref).sort()[0];
      const [rows] = (await conn.query(`SELECT ${ROW} FROM transactions WHERE account_id = ? AND bank_ref IS NULL AND status <> 'deleted' AND date >= DATE_SUB(?, INTERVAL 5 DAY)`, [target.id, from])) as unknown as [Row[]];
      const existing = rows.filter((t) => ref(t) >= from);
      const r = reconcile(incoming, existing);
      const changes: (typeof log)[number]["changes"] = [];
      for (const p of r.pairs) {
        entry.attached++;
        if (p.existing.date !== p.incoming.date) entry.redated++;
        if (p.existing.status === "duplicate") entry.restored++;
        if (p.existing.date !== p.incoming.date || p.existing.status !== p.incoming.status) changes.push({ id: p.existing.id, date: [p.existing.date, p.incoming.date], status: [p.existing.status, p.incoming.status] });
        // La ligne d'observation s'efface au profit de la ligne en service, qui garde son identifiant, sa catégorie et ses notes.
        await conn.query("DELETE FROM transactions WHERE id = ?", [p.incoming.id]);
        await conn.query("UPDATE transactions SET bank_ref = ?, date = ?, status = ?, bank_label = COALESCE(bank_label, ?) WHERE id = ?", [p.incoming.id, p.incoming.date, p.incoming.status, p.incoming.label.slice(0, 255), p.existing.id]);
      }
      for (const t of r.onlyIncoming) {
        entry.added++;
        await conn.query("UPDATE transactions SET account_id = ?, bank_ref = id WHERE id = ?", [target.id, t.id]);
      }
      entry.kept = r.onlyExisting.filter((t) => t.status !== "duplicate").length;
      await conn.query("DELETE FROM transactions WHERE account_id = ?", [obs]);
      await conn.query("DELETE FROM balances WHERE account_id = ?", [obs]);
      await conn.query("DELETE FROM accounts WHERE id = ? AND source = 'enablebanking'", [obs]);
      adopted[a.key] = target.id;
      log.push({ account: obs, target: target.id, changes, added: r.onlyIncoming.map((t) => t.id) });
    }
    if (!opts.apply) {
      await conn.rollback();
      return { applied: false, accounts: plan };
    }
    const cards = Object.fromEntries(Object.entries(s.cards ?? {}).map(([id, v]) => [Object.entries(adopted).find(([key]) => accountIdOf(key) === id)?.[1] ?? id, v]));
    await conn.query("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KV, JSON.stringify({ ...s, adopted, cards })]);
    await conn.query("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [`${KV}:bascule`, JSON.stringify({ at: new Date().toISOString(), log })]);
    await conn.commit();
    return { applied: true, accounts: plan };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/** Comptes de Pécule alimentés par Enable Banking : une autre source ne doit plus y écrire. */
export async function ebAdoptedAccounts(): Promise<Set<string>> {
  return new Set(Object.values((await load()).adopted ?? {}));
}

/** Encours des cartes à débit différé, tel que lu à la dernière synchronisation. */
export async function ebCards(): Promise<{ accountId: string; name: string; tail: string | null; outstanding: CardOutstanding & { at: string } }[]> {
  const s = await load();
  const accounts = uniqueAccounts(s);
  return Object.entries(s.cards ?? {})
    .map(([accountId, outstanding]) => {
      const a = accounts.find((x) => (s.adopted?.[x.key] ?? accountIdOf(x.key)) === accountId);
      return a ? { accountId, name: a.name, tail: a.tail, outstanding } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
}

/* ---------- Comparatif avec les comptes en service (période d'observation) ---------- */

export type EbComparison = {
  accountId: string;
  name: string;
  kind: AccountKind;
  tail: string | null;
  /** Compte de Pécule qui porte les mêmes opérations, s'il y en a un. */
  counterpart: { id: string; name: string } | null;
  /** Début de la période comparée (premier jour d'achat ou d'écriture lu par Enable Banking). */
  from: string | null;
  read: number;
  same: number;
  shifted: number;
  /** Lues à la banque et absentes de Pécule ; connues de Pécule et absentes de la banque (20 au plus de chaque). */
  onlyBank: { date: string; amount: number; label: string; pending: boolean }[];
  onlyPecule: { date: string; amount: number; label: string }[];
  onlyBankCount: number;
  onlyPeculeCount: number;
};

type CmpRow = RecTx & { account_id: string };

/** Pour chaque compte lu par Enable Banking : le compte en service qui lui correspond, et ce qui diffère, opération par opération. */
export async function ebCompare(): Promise<EbComparison[]> {
  const s = await load();
  const out: EbComparison[] = [];
  for (const a of uniqueAccounts(s)) {
    if (s.adopted?.[a.key]) continue; // déjà rattaché au compte en service
    const id = accountIdOf(a.key);
    const incoming = await q<CmpRow>(
      "SELECT id, account_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, amount, label, status FROM transactions WHERE account_id = ? AND origin = 'enablebanking' AND status IN ('posted', 'pending')",
      [id],
    );
    const base: EbComparison = { accountId: id, name: a.name, kind: a.kind, tail: a.tail, counterpart: null, from: null, read: incoming.length, same: 0, shifted: 0, onlyBank: [], onlyPecule: [], onlyBankCount: 0, onlyPeculeCount: 0 };
    if (!incoming.length) {
      out.push(base);
      continue;
    }
    // Le compte en service qui partage le plus d'opérations (même date, même montant) avec ce compte.
    const best = await one<{ id: string; name: string; n: number }>(
      `SELECT f.account_id AS id, COALESCE(fa.display_name, fa.name) AS name, COUNT(DISTINCT e.id) AS n
       FROM transactions e JOIN transactions f ON f.date = e.date AND f.amount = e.amount AND f.origin <> 'enablebanking' AND f.status <> 'deleted'
       JOIN accounts fa ON fa.id = f.account_id AND fa.source <> 'enablebanking'
       WHERE e.account_id = ? AND e.status = 'posted' GROUP BY f.account_id, fa.display_name, fa.name ORDER BY n DESC LIMIT 1`,
      [id],
    );
    const posted = incoming.filter((t) => t.status === "posted").length;
    if (!best || best.n < Math.max(3, posted / 2)) {
      out.push(base);
      continue;
    }
    const ref = (t: RecTx) => purchaseDay(t.label) ?? t.date;
    const from = incoming.map(ref).sort()[0];
    const existing = (
      await q<CmpRow>(
        "SELECT id, account_id, DATE_FORMAT(date, '%Y-%m-%d') AS date, amount, label, status FROM transactions WHERE account_id = ? AND status <> 'deleted' AND date >= DATE_SUB(?, INTERVAL 5 DAY)",
        [best.id, from],
      )
    ).filter((t) => ref(t) >= from);
    const r = reconcile(incoming, existing);
    const sum = summarize(r);
    const missing = r.onlyExisting.filter((t) => t.status !== "duplicate");
    out.push({
      ...base,
      counterpart: { id: best.id, name: best.name },
      from,
      same: sum.same,
      shifted: sum.shifted,
      onlyBankCount: r.onlyIncoming.length,
      onlyPeculeCount: missing.length,
      onlyBank: r.onlyIncoming.slice(0, 20).map((t) => ({ date: t.date, amount: Number(t.amount), label: t.label, pending: t.status === "pending" })),
      onlyPecule: missing.slice(0, 20).map((t) => ({ date: t.date, amount: Number(t.amount), label: t.label })),
    });
  }
  return out;
}

/** Accords en cours et leur échéance (échéancier, rappels). Rien en démo. */
export async function ebConsents(): Promise<{ id: string; aspsp: string; userId: number; validUntil: string }[]> {
  if (isDemo()) return [];
  return ((await load()).sessions ?? []).map((x) => ({ id: x.id, aspsp: x.aspsp, userId: x.userId, validUntil: x.validUntil }));
}

/** Banques reliées (une fois chacune), avec les comptes de Pécule qu'elles alimentent : pour leur logo (bank-logos.ts). Rien en démo. */
export async function ebLinkedBanks(): Promise<{ aspsp: string; country: string; accountIds: string[] }[]> {
  if (isDemo()) return [];
  const s = await load();
  const out = new Map<string, { aspsp: string; country: string; accountIds: string[] }>();
  for (const x of s.sessions ?? []) {
    const key = `${x.country.toUpperCase()}:${x.aspsp}`;
    const bank = out.get(key) ?? { aspsp: x.aspsp, country: x.country.toUpperCase(), accountIds: [] };
    for (const a of x.accounts) bank.accountIds.push(s.adopted?.[a.key] ?? accountIdOf(a.key));
    out.set(key, bank);
  }
  return [...out.values()].map((b) => ({ ...b, accountIds: [...new Set(b.accountIds)] }));
}
