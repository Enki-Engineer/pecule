import { existsSync } from "node:fs";
import { z } from "zod";
import { env } from "./env.ts";
import { exec, one } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { backupDir, listServerBackups, type ServerBackup } from "./pre-migration.ts";
import { VERSION } from "./version.ts";
import { cleanVersion, DOCKER_IMAGE, updateState, type UpdateState } from "../lib/version.ts";

/*
 * Mises à jour : une fois par jour, le serveur demande à GitHub quelle est la dernière version publiée de Pécule et
 * la garde (`app_kv`, clé « maj:etat »). Réglages → Suivi technique l'annonce à l'administrateur, qui reçoit aussi une
 * notification s'il les a activées. Rien n'est installé d'ici : la mise à jour se lance sur le serveur
 * (`node scripts/maj.mjs`, docs/guide/mise-a-jour.md).
 *
 * Seule la question part vers GitHub (qui voit, comme tout site, l'adresse IP du serveur) : aucune donnée du foyer,
 * ni l'adresse de l'installation, ni sa version.
 * UPDATE_CHECK=0 ne pose jamais la question ; UPDATE_REPO suit les versions d'une copie du projet.
 */

const KEY = "maj:etat";
/** Une réponse de moins de vingt heures n'est pas redemandée (le serveur peut redémarrer souvent). */
const FRESH = 20 * 3_600_000;
const NOTES_MAX = 20_000;

export type Release = {
  version: string;
  /** Étiquette git de la version (« v1.22.0 »). */
  tag: string;
  url: string;
  /** Notes de version, en Markdown (la section du journal des versions). */
  notes: string;
  publishedAt: string | null;
  /** Plus ancienne version depuis laquelle celle-ci se met à jour directement, si elle le dit. */
  depuis: string | null;
};

/** Pourquoi le dernier essai a manqué : GitHub n'a pas répondu, a refusé (trop de demandes), ou a répondu autre chose qu'une version. */
export type CheckError = "injoignable" | "refus" | "illisible";

type Stored = { repo: string; checkedAt: string | null; etag: string | null; latest: Release | null; error: CheckError | null };

const empty = (): Stored => ({ repo: env.UPDATE_REPO, checkedAt: null, etag: null, latest: null, error: null });

async function read(): Promise<Stored> {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [KEY]));
  try {
    const s = JSON.parse(row?.value ?? "null") as Stored | null;
    // Dépôt suivi changé depuis : ce qui est gardé ne vaut plus.
    return s && s.repo === env.UPDATE_REPO ? { ...empty(), ...s } : empty();
  } catch {
    return empty();
  }
}

const save = (s: Stored) => runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KEY, JSON.stringify(s)]));

const releaseShape = z.object({
  tag_name: z.string(),
  html_url: z.string().optional(),
  body: z.string().nullish(),
  published_at: z.string().nullish(),
});

const headers = { "User-Agent": "Pecule", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };

/** Ce que la version publiée dit d'elle-même dans son `package.json` : depuis quelle version elle se met à jour directement. */
async function readDepuis(repo: string, tag: string): Promise<string | null> {
  try {
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/${encodeURIComponent(tag)}/package.json`, { headers: { "User-Agent": headers["User-Agent"] }, signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return null;
    return cleanVersion(((await r.json()) as { pecule?: { depuis?: unknown } }).pecule?.depuis as string | undefined);
  } catch {
    return null;
  }
}

/** Interroge GitHub et rend ce qu'il faut garder. Une panne ou un refus garde la dernière réponse connue, avec sa raison. */
async function ask(prev: Stored): Promise<Stored> {
  const repo = env.UPDATE_REPO;
  const now = new Date().toISOString();
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { ...headers, ...(prev.etag && prev.latest ? { "If-None-Match": prev.etag } : {}) },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn(`[mise à jour] GitHub injoignable : ${e instanceof Error ? e.message : String(e)}`);
    return { ...prev, checkedAt: now, error: "injoignable" };
  }
  // Rien n'a changé depuis la dernière réponse.
  if (res.status === 304) return { ...prev, checkedAt: now, error: null };
  // Aucune version publiée, ou dépôt qui n'est pas public.
  if (res.status === 404) return { ...prev, checkedAt: now, etag: null, latest: null, error: null };
  if (!res.ok) {
    console.warn(`[mise à jour] GitHub a répondu ${res.status}`);
    return { ...prev, checkedAt: now, error: "refus" };
  }
  const parsed = releaseShape.safeParse(await res.json().catch(() => null));
  const version = parsed.success ? cleanVersion(parsed.data.tag_name) : null;
  if (!parsed.success || !version) return { ...prev, checkedAt: now, error: "illisible" };
  const tag = parsed.data.tag_name;
  // L'adresse affichée est toujours celle de la version sur GitHub, quoi que dise la réponse.
  const url = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
  const known = prev.latest?.tag === tag ? prev.latest.depuis : null;
  const depuis = known ?? (updateState(VERSION, version).kind === "a-jour" ? null : await readDepuis(repo, tag));
  return {
    repo,
    checkedAt: now,
    etag: res.headers.get("etag"),
    latest: { version, tag, url, notes: (parsed.data.body ?? "").slice(0, NOTES_MAX), publishedAt: parsed.data.published_at ?? null, depuis },
    error: null,
  };
}

let running: Promise<Stored> | null = null;

/**
 * Demande à GitHub la dernière version publiée, au plus une fois toutes les vingt heures (`force` : tout de suite).
 * Sans effet quand la vérification est coupée (UPDATE_CHECK=0).
 */
export function checkUpdates({ force = false } = {}): Promise<Stored> {
  running ??= (async () => {
    const prev = await read();
    if (!env.UPDATE_CHECK) return prev;
    if (!force && prev.checkedAt && Date.now() - Date.parse(prev.checkedAt) < FRESH) return prev;
    const next = await ask(prev);
    await save(next);
    const before = updateState(VERSION, prev.latest?.version);
    const after = updateState(VERSION, next.latest?.version);
    if (after.kind !== "a-jour" && (before.kind === "a-jour" || before.version !== after.version)) console.log(`[mise à jour] Pécule ${after.version} est publiée (en service : ${VERSION})`);
    return next;
  })().finally(() => {
    running = null;
  });
  return running;
}

export type UpdateStatus = {
  /** Version en service. */
  version: string;
  /** La question est posée à GitHub chaque jour (UPDATE_CHECK). */
  enabled: boolean;
  repo: string;
  checkedAt: string | null;
  /** Raison du dernier essai manqué ; `null` s'il a abouti. */
  error: CheckError | null;
  state: UpdateState;
  /** La version plus récente, quand il y en a une. */
  latest: Release | null;
  /** Installation par Docker : la mise à jour passe par l'image publiée. */
  docker: boolean;
  image: string;
  /** Sauvegardes écrites par le serveur avant une migration, la plus récente d'abord, et leur dossier. */
  backups: ServerBackup[];
  backupDir: string;
  backupBeforeMigration: boolean;
};

const stateOf = (s: Stored): UpdateState => (env.UPDATE_CHECK ? updateState(VERSION, s.latest?.version, s.latest?.depuis) : { kind: "a-jour" });

/** Une version plus récente est-elle publiée ? Lecture de ce qui est gardé, rien d'autre (menu, notification). */
export const updateAvailable = async (): Promise<UpdateState> => stateOf(await read());

/** Où en est cette installation, d'après la dernière réponse gardée (aucun appel à l'extérieur). */
export async function updateStatus(): Promise<UpdateStatus> {
  const s = await read();
  const state = stateOf(s);
  return {
    version: VERSION,
    enabled: env.UPDATE_CHECK,
    repo: env.UPDATE_REPO,
    checkedAt: env.UPDATE_CHECK ? s.checkedAt : null,
    error: env.UPDATE_CHECK ? s.error : null,
    state,
    latest: state.kind === "a-jour" ? null : s.latest,
    docker: existsSync("/.dockerenv"),
    image: DOCKER_IMAGE,
    backups: listServerBackups(),
    backupDir: backupDir(),
    backupBeforeMigration: env.BACKUP_BEFORE_MIGRATION,
  };
}

let scheduled = false;

/** Une vérification peu après le démarrage, puis toutes les six heures (elle ne part vraiment qu'une fois par jour). */
export function scheduleUpdateCheck() {
  if (scheduled || !env.UPDATE_CHECK) return;
  scheduled = true;
  const run = () => void checkUpdates().catch((e) => console.error("[mise à jour] vérification en échec", e));
  setTimeout(run, 90_000).unref();
  setInterval(run, 6 * 3_600_000).unref();
}
