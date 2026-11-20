// L'archive d'une version (`pecule.tar.gz`, jointe à chaque version publiée) : la télécharger, contrôler son
// empreinte, la déplier. Partagé par la mise à jour (`scripts/maj.mjs`) et par l'installateur du paquet npm
// (`npm/pecule.mjs`, qui en reçoit une copie). Node seul, aucune dépendance, aucun fichier TypeScript.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Noms des pièces jointes d'une version : les mêmes à chaque version (`scripts/paquet.mjs`). */
export const ARCHIVE = "pecule.tar.gz";
export const SUMS = "SHA256SUMS";

const AGENT = { "User-Agent": "Pecule" };

/** Adresse des pièces jointes d'une version publiée sur GitHub. */
export const releaseBase = (repo, tag) => `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}`;

/** Erreur d'un appel au réseau : l'adresse, la réponse, et `status` (le code HTTP ; 0 sans réponse). */
const netError = (url, res) => Object.assign(new Error(`${url} → ${res ? `HTTP ${res.status}` : "pas de réponse"}`), { status: res?.status ?? 0 });
const apiHeaders = (token) => ({ ...AGENT, Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" });

/**
 * Étiquette de la dernière version publiée (« v1.34.1 »). Sans jeton : la page « latest » du dépôt, qui renvoie vers
 * elle (aucune limite de demandes) ; avec un jeton (dépôt privé) : l'API.
 */
export async function latestTag(repo, token = null) {
  if (token) {
    const url = `https://api.github.com/repos/${repo}/releases/latest`;
    const res = await fetch(url, { headers: apiHeaders(token) }).catch(() => null);
    const tag = res?.ok ? (await res.json().catch(() => null))?.tag_name : null;
    if (typeof tag !== "string") throw netError(url, res?.ok ? { status: 404 } : res);
    return tag;
  }
  const url = `https://github.com/${repo}/releases/latest`;
  const res = await fetch(url, { headers: AGENT, redirect: "manual" }).catch(() => null);
  const tag = /\/releases\/tag\/([^/?#]+)$/.exec(res?.headers.get("location") ?? "")?.[1];
  if (!tag) throw netError(url, res && res.status >= 300 && res.status < 400 ? { status: 404 } : res);
  return decodeURIComponent(tag);
}

/** Empreinte SHA-256 d'un fichier, lu par morceaux. */
export const sha256 = (file) =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

/** L'empreinte d'un fichier dans un `SHA256SUMS` (« empreinte  nom » par ligne) ; `null` s'il n'y figure pas. */
export const expectedSum = (sums, name) =>
  sums
    .split(/\r?\n/)
    .map((l) => /^([0-9a-f]{64})\s+\*?(.+)$/.exec(l.trim()))
    .find((m) => m && m[2] === name)?.[1] ?? null;

/** Télécharge une adresse dans un fichier. L'erreur dit l'adresse et la réponse (`status` : le code HTTP, 0 sans réponse). */
export async function download(url, dest, headers = {}) {
  const res = await fetch(url, { headers: { ...AGENT, ...headers }, redirect: "follow" }).catch(() => null);
  if (!res?.ok || !res.body) throw netError(url, res);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

/**
 * Télécharge une pièce jointe d'une version. Sans jeton, par son adresse publique ; avec un jeton GitHub (dépôt
 * privé, copie privée du projet), par l'API, qui seule l'accepte. `base` : une autre adresse où les mêmes fichiers
 * sont posés (miroir, serveur de l'entreprise).
 */
export async function downloadAsset({ repo, tag, name, dest, token = null, base = null }) {
  if (base) return download(`${base.replace(/\/+$/, "")}/${name}`, dest);
  if (!token) return download(`${releaseBase(repo, tag)}/${name}`, dest);
  const url = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const res = await fetch(url, { headers: apiHeaders(token) }).catch(() => null);
  if (!res?.ok) throw netError(url, res);
  const asset = ((await res.json().catch(() => null))?.assets ?? []).find((a) => a.name === name);
  if (!asset) throw Object.assign(new Error(`${name} n'est pas joint à la version ${tag}`), { status: 404 });
  // L'API renvoie vers l'adresse du fichier : le jeton n'y est pas présenté (fetch le retire en changeant d'hôte).
  return download(asset.url, dest, { ...apiHeaders(token), Accept: "application/octet-stream" });
}

/**
 * Déplie une archive `.tar.gz` dans un dossier. Lancée par l'administrateur de la machine, l'extraction ne reprend
 * pas le compte de celui qui a fabriqué l'archive. Rend `false` si `tar` manque ou échoue.
 */
export function untar(archive, dir) {
  const r = spawnSync("tar", ["-xzf", archive, "--no-same-owner", "-C", dir], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  return !r.error && r.status === 0;
}
