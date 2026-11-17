import { createReadStream, createWriteStream, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { statfs } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { encryptStream, generateIdentity, isRecipient } from "./age.ts";
import { backupDir } from "./archives.ts";
import { exec, one } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { sealingSecret } from "./env.ts";
import { davRemote, RemoteError, s3Remote, testRemote, type Remote, type RemoteFile, type RemoteProblem } from "./remote.ts";
import { createSealer } from "./secret.ts";
import { parseRemoteName, remoteName, remoteToPrune, type DestinationInput, type PublicDestination, type Retention } from "../lib/backup-plan.ts";
import { t } from "../lib/i18n.ts";

/*
 * Copie des sauvegardes hors du serveur. Une sauvegarde gardée sur le même serveur que la base ne protège pas de sa
 * perte : quand l'administrateur a réglé un stockage extérieur (compatible S3 ou WebDAV, `remote.ts`), chaque
 * sauvegarde automatique y est aussi déposée — toujours chiffrée (`age.ts`), parce qu'elle quitte le serveur.
 *
 * - La clé : le serveur ne garde que la clé publique (`app_kv`, « sauvegarde:cle »). La clé de récupération est
 *   montrée une fois à l'administrateur ; Pécule ne peut pas déchiffrer ce qu'il envoie.
 * - Le stockage : son adresse et son identifiant en clair, son secret chiffré avec le secret du serveur
 *   (« sauvegarde:destination ») ; il est essayé (dépôt, liste, suppression d'un petit fichier) avant d'être enregistré.
 * - La conservation : les dernières copies, puis la première de chaque semaine et de chaque mois (`remoteToPrune`).
 */

const KEY = "sauvegarde:cle";
const DESTINATION = "sauvegarde:destination";
/** Marge de disque libre exigée en plus de la taille de la copie chiffrée, écrite sur le serveur le temps de l'envoi. */
const MARGIN = 64 * 1_048_576;
const sealer = createSealer(sealingSecret);

type Stored = { type: "s3"; endpoint: string; region: string; bucket: string; prefix: string; accessKey: string; secret: string } | { type: "webdav"; url: string; user: string; secret: string };

const read = async <T>(key: string): Promise<T | null> => {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key]));
  try {
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
};
const save = (key: string, value: unknown) => runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, JSON.stringify(value)]));

/* ---------- Clé de chiffrement ---------- */

export type EncryptionKey = { recipient: string; creeLe: string };

export async function encryptionKey(): Promise<EncryptionKey | null> {
  const k = await read<EncryptionKey>(KEY);
  return k && typeof k.recipient === "string" && isRecipient(k.recipient) ? k : null;
}

/**
 * Règle la clé de chiffrement. Avec une clé publique (« age1… ») : l'administrateur garde sa clé de récupération, le
 * serveur ne la voit jamais. Sans : une paire neuve, dont la clé de récupération est rendue ici, une seule fois, et
 * n'est gardée nulle part.
 */
export async function setEncryptionKey(recipient?: string): Promise<{ recipient: string; identity: string | null }> {
  const pair = recipient ? null : generateIdentity();
  const next = { recipient: pair ? pair.recipient : recipient!.trim(), creeLe: new Date().toISOString() };
  await save(KEY, next);
  return { recipient: next.recipient, identity: pair?.identity ?? null };
}

/* ---------- Stockage extérieur ---------- */

const publicOf = (d: Stored): PublicDestination => {
  const unreadable = sealer.open(d.secret) === null;
  return d.type === "s3" ? { type: "s3", endpoint: d.endpoint, region: d.region, bucket: d.bucket, prefix: d.prefix, accessKey: d.accessKey, unreadable } : { type: "webdav", url: d.url, user: d.user, unreadable };
};

const stored = async (): Promise<Stored | null> => {
  const d = await read<Stored>(DESTINATION);
  return d && (d.type === "s3" || d.type === "webdav") && typeof d.secret === "string" ? d : null;
};

export async function destination(): Promise<PublicDestination | null> {
  const d = await stored();
  return d ? publicOf(d) : null;
}

const remoteOf = (d: Stored, secret: string): Remote =>
  d.type === "s3" ? s3Remote({ endpoint: d.endpoint, region: d.region, bucket: d.bucket, prefix: d.prefix, accessKey: d.accessKey, secretKey: secret }) : davRemote({ url: d.url, user: d.user, password: secret });

/** Le stockage réglé, prêt à servir ; `null` s'il n'y en a pas, ou si son secret ne s'ouvre plus. */
async function openRemote(): Promise<Remote | null> {
  const d = await stored();
  const secret = d ? sealer.open(d.secret) : null;
  return d && secret !== null ? remoteOf(d, secret) : null;
}

const workDir = () => path.join(backupDir(), "envoi");

/** Écrit un petit fichier d'essai dans le dossier de travail et rend son chemin. */
async function writeProbe(content: Buffer): Promise<string> {
  mkdirSync(workDir(), { recursive: true });
  const file = path.join(workDir(), `essai-${randomBytes(4).toString("hex")}.txt`);
  writeFileSync(file, content, { mode: 0o600 });
  return file;
}

const withProbe = async (remote: Remote) => {
  const files: string[] = [];
  try {
    await testRemote(remote, async (content) => {
      const f = await writeProbe(content);
      files.push(f);
      return f;
    });
  } finally {
    for (const f of files) rmSync(f, { force: true });
  }
};

/**
 * Enregistre le stockage extérieur, après l'avoir essayé pour de bon (dépôt, liste et suppression d'un petit fichier) :
 * rien n'est gardé s'il refuse. Un secret laissé vide reprend celui déjà enregistré pour le même genre de stockage.
 */
export async function saveDestination(input: DestinationInput): Promise<PublicDestination> {
  const before = await stored();
  const kept = before && before.type === input.type ? sealer.open(before.secret) : null;
  const secret = input.secret.trim() || kept;
  if (!secret) throw new RemoteError("identifiants");
  const clean: Stored =
    input.type === "s3"
      ? { type: "s3", endpoint: input.endpoint.trim().replace(/\/+$/, ""), region: input.region.trim() || "us-east-1", bucket: input.bucket.trim(), prefix: input.prefix.trim(), accessKey: input.accessKey.trim(), secret: "" }
      : { type: "webdav", url: input.url.trim().replace(/\/+$/, ""), user: input.user.trim(), secret: "" };
  await withProbe(remoteOf(clean, secret));
  const next = { ...clean, secret: sealer.seal(secret) };
  await save(DESTINATION, next);
  return publicOf(next);
}

export const removeDestination = () => runReal(() => exec("DELETE FROM app_kv WHERE `key` = ?", [DESTINATION]));

/** Essaie le stockage enregistré. */
export async function testDestination(): Promise<void> {
  const remote = await openRemote();
  if (!remote) throw new RemoteError("identifiants");
  await withProbe(remote);
}

/** Une copie hors du serveur est possible : une clé de chiffrement et un stockage dont le secret s'ouvre. */
export const offsiteReady = async (): Promise<boolean> => !!(await encryptionKey()) && !!(await openRemote());

/** Les copies de Pécule présentes sur le stockage extérieur, la plus récente d'abord. */
export async function listOffsite(): Promise<RemoteFile[]> {
  const remote = await openRemote();
  if (!remote) return [];
  return (await remote.list())
    .filter((f) => parseRemoteName(f.name) !== null)
    .map((f) => ({ ...f, at: parseRemoteName(f.name) }))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

/**
 * Dépose une archive du serveur sur le stockage extérieur : chiffrée d'abord dans un fichier de travail (le stockage
 * veut connaître la taille avant de recevoir), envoyée, puis les copies les plus anciennes sont retirées selon la
 * conservation choisie. Rend le nom et la taille de la copie.
 */
export async function copyOffsite(file: string, name: string, keep: Retention): Promise<{ name: string; octets: number }> {
  const key = await encryptionKey();
  const remote = await openRemote();
  if (!key || !remote) throw new RemoteError("identifiants");
  const dir = workDir();
  mkdirSync(dir, { recursive: true });
  const disk = await statfs(dir);
  const needed = statSync(file).size + MARGIN;
  if (Number(disk.bavail) * Number(disk.bsize) < needed) throw new Error(`pas assez de place dans ${dir} pour chiffrer l'archive avant de l'envoyer`);
  const target = remoteName(name);
  const sealed = path.join(dir, `${target}.partiel`);
  try {
    const sealer = encryptStream(key.recipient);
    await pipeline(createReadStream(file), sealer, createWriteStream(sealed, { mode: 0o600 }));
    const octets = statSync(sealed).size;
    await remote.put(target, sealed, octets);
    // La rotation ne fait pas échouer une copie qui vient d'aboutir : elle sera refaite à la prochaine.
    try {
      for (const old of remoteToPrune((await remote.list()).map((f) => f.name), keep)) if (old !== target) await remote.remove(old);
    } catch (e) {
      console.warn(`[sauvegarde] rotation des copies hors du serveur en échec : ${e instanceof Error ? e.message : String(e)}`);
    }
    return { name: target, octets };
  } finally {
    rmSync(sealed, { force: true });
  }
}

/** Ce qui n'a pas marché avec le stockage extérieur, en une phrase, dans la langue de la requête. */
export function remoteProblemText(code: RemoteProblem, detail: string): string {
  switch (code) {
    case "adresse":
      return t("Adresse du stockage invalide : elle commence par https://.");
    case "injoignable":
      return t("Stockage injoignable ({detail}) : vérifie son adresse.", { detail });
    case "muet":
      return t("Le stockage ne répond pas.");
    case "identifiants":
      return t("Le stockage refuse cet identifiant ou ce secret.");
    case "redirection":
      return t("Le stockage renvoie vers une autre adresse ({detail}) : donne l'adresse finale du dossier.", { detail });
    case "trop-gros":
      return t("Archive de plus de 5 Go : trop grosse pour un envoi simple vers ce stockage.");
    case "invisible":
      return t("Le fichier d'essai a été accepté, mais il n'apparaît pas dans le dossier : vérifie le dossier ou le préfixe.");
    case "dossier":
      return t("Le stockage refuse de créer le dossier (réponse {detail}).", { detail });
    case "lecture":
      return t("Le stockage refuse de montrer le contenu du dossier (réponse {detail}).", { detail });
    case "suppression":
      return t("Le stockage refuse de retirer un fichier (réponse {detail}) : Pécule a besoin de ce droit pour ne garder que les copies récentes.", { detail });
    default:
      return t("Le stockage refuse l'envoi (réponse {detail}).", { detail });
  }
}
