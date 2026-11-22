import { createHash, createHmac, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import http from "node:http";
import https from "node:https";
import { pipeline } from "node:stream/promises";
import { resolvesPrivate } from "./net.ts";

/*
 * Stockages extérieurs où Pécule dépose une copie chiffrée de ses sauvegardes : un stockage compatible S3 (Amazon S3,
 * Backblaze B2, Scaleway, OVH, Cloudflare R2, Wasabi, MinIO…) ou un dossier WebDAV (Nextcloud, kDrive, un NAS…).
 * Sans dépendance : les deux protocoles tiennent en quelques requêtes — déposer un fichier, lister, retirer.
 *
 * L'adresse est donnée par l'administrateur, et peut être celle d'un appareil du réseau local (un NAS) : ces
 * requêtes ne passent donc pas par `publicFetch`. Rien de ce qu'elles renvoient n'est rendu à l'écran, hors le
 * code de la réponse et le message d'erreur du service.
 */

export type RemoteFile = { name: string; octets: number; at: number | null };

export type Remote = {
  /** Dépose un fichier local sous ce nom. */
  put(name: string, file: string, octets: number): Promise<void>;
  /** Les fichiers du dossier (ou du préfixe) de Pécule. */
  list(): Promise<RemoteFile[]>;
  remove(name: string): Promise<void>;
};

export type S3Config = { endpoint: string; region: string; bucket: string; prefix: string; accessKey: string; secretKey: string };
export type DavConfig = { url: string; user: string; password: string };

/** Ce qui peut manquer avec un stockage extérieur ; l'écran en fait une phrase dans la langue du membre (`src/server/offsite.ts`). */
export type RemoteProblem = "adresse" | "clair" | "injoignable" | "muet" | "envoi" | "lecture" | "suppression" | "dossier" | "identifiants" | "redirection" | "trop-gros" | "invisible";

/** Refus ou panne du stockage extérieur. `detail` : ce que le service a répondu (code, message), tel quel. */
export class RemoteError extends Error {
  constructor(
    readonly code: RemoteProblem,
    readonly detail = "",
  ) {
    super(`stockage extérieur : ${code}${detail ? ` (${detail})` : ""}`);
  }
}

type Body = Buffer | { file: string; octets: number } | undefined;
type Reply = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

/**
 * Où une requête a le droit de partir. En clair (http), seulement vers un appareil du réseau du serveur — un NAS : sur
 * Internet, le mot de passe WebDAV et le contenu des listes circuleraient lisibles. Jamais d'identifiants dans
 * l'adresse : ils seraient gardés en clair avec elle, et montrés à l'écran.
 */
async function checkTarget(url: URL): Promise<void> {
  if (url.username || url.password) throw new RemoteError("adresse");
  if (url.protocol === "http:" && !(await resolvesPrivate(url.hostname))) throw new RemoteError("clair");
}

/** Une requête http(s), corps en mémoire ou lu dans un fichier ; s'arrête si rien ne circule pendant deux minutes. */
async function send(method: string, url: URL, headers: Record<string, string>, body?: Body): Promise<Reply> {
  await checkTarget(url);
  return new Promise((resolve, reject) => {
    if (url.protocol !== "https:" && url.protocol !== "http:") return reject(new RemoteError("adresse"));
    const length = body === undefined ? 0 : Buffer.isBuffer(body) ? body.length : body.octets;
    const req = (url.protocol === "https:" ? https : http).request(url, { method, headers: { ...headers, ...(body !== undefined || method === "PUT" ? { "Content-Length": String(length) } : {}) } }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        // Une liste ou un message d'erreur : jamais plus de quelques Mo.
        if ((size += c.length) <= 8 * 1_048_576) chunks.push(c);
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(120_000, () => req.destroy(new RemoteError("muet")));
    req.on("error", (e) => reject(e instanceof RemoteError ? e : new RemoteError("injoignable", e.message)));
    if (body === undefined) req.end();
    else if (Buffer.isBuffer(body)) req.end(body);
    else pipeline(createReadStream(body.file), req).catch((e) => req.destroy(e instanceof Error ? e : new Error(String(e))));
  });
}

const xmlText = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
/** Contenu de la première balise de ce nom (avec ou sans préfixe d'espace de noms). */
const tag = (xml: string, name: string): string | null => {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i").exec(xml);
  return m ? xmlText(m[1].trim()) : null;
};
const blocks = (xml: string, name: string): string[] => [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "gi"))].map((m) => m[1]);

/* ---------- Compatible S3 (signature AWS version 4) ---------- */

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
/** Encodage d'une adresse comme le veut la signature : tout sauf lettres, chiffres, « - . _ ~ ». */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * En-tête `Authorization` d'une requête signée (AWS Signature Version 4). `headers` : ceux qui partent, `host` et
 * `x-amz-date` compris ; `payloadHash` : l'empreinte SHA-256 du corps.
 */
export function signV4(o: { method: string; path: string; query: Record<string, string>; headers: Record<string, string>; payloadHash: string; region: string; service: string; accessKey: string; secretKey: string }): string {
  const names = Object.keys(o.headers)
    .map((h) => h.toLowerCase())
    .sort();
  const lower = Object.fromEntries(Object.entries(o.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")]));
  const query = Object.keys(o.query)
    .sort()
    .map((k) => `${enc(k)}=${enc(o.query[k])}`)
    .join("&");
  const canonical = [o.method, o.path, query, ...names.map((h) => `${h}:${lower[h]}`), "", names.join(";"), o.payloadHash].join("\n");
  const stamp = lower["x-amz-date"];
  const scope = `${stamp.slice(0, 8)}/${o.region}/${o.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256(canonical)].join("\n");
  const key = [stamp.slice(0, 8), o.region, o.service, "aws4_request"].reduce<Buffer | string>((k, part) => hmac(k, part), `AWS4${o.secretKey}`);
  return `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${createHmac("sha256", key).update(toSign).digest("hex")}`;
}

/** Fichiers d'une réponse « ListObjectsV2 », et la suite s'il y en a une. */
export function parseS3List(xml: string, prefix: string): { files: RemoteFile[]; next: string | null } {
  const files = blocks(xml, "Contents").flatMap((c) => {
    const key = tag(c, "Key");
    if (!key || !key.startsWith(prefix)) return [];
    const name = key.slice(prefix.length);
    const at = Date.parse(tag(c, "LastModified") ?? "");
    // Seulement le dossier de Pécule, pas ses sous-dossiers.
    return name && !name.includes("/") ? [{ name, octets: Number(tag(c, "Size") ?? 0), at: Number.isNaN(at) ? null : at }] : [];
  });
  return { files, next: tag(xml, "IsTruncated") === "true" ? tag(xml, "NextContinuationToken") : null };
}

const s3Problem = (what: RemoteProblem, r: Reply) => {
  const text = r.body.toString("utf8");
  const code = tag(text, "Code");
  if (code === "InvalidAccessKeyId" || code === "SignatureDoesNotMatch") return new RemoteError("identifiants", `${r.status} ${code}`);
  return new RemoteError(what, `${r.status}${code ? ` ${code}${tag(text, "Message") ? ` — ${tag(text, "Message")!.slice(0, 160)}` : ""}` : ""}`);
};

/** Préfixe rangé : sans barre au début, avec une barre à la fin (vide : la racine du compartiment). */
export const cleanPrefix = (prefix: string) => {
  const p = prefix.trim().replace(/^\/+|\/+$/g, "");
  return p ? `${p}/` : "";
};

export function s3Remote(cfg: S3Config): Remote {
  let base: URL;
  try {
    base = new URL(cfg.endpoint.trim().replace(/\/+$/, ""));
  } catch {
    throw new RemoteError("adresse");
  }
  // Amazon range le compartiment dans le nom d'hôte ; les autres services l'acceptent dans le chemin.
  const hosted = /(^|\.)amazonaws\.com$/i.test(base.hostname) && !base.hostname.startsWith(`${cfg.bucket}.`);
  const origin = hosted ? `${base.protocol}//${cfg.bucket}.${base.host}` : base.origin;
  const root = `${base.pathname.replace(/\/+$/, "")}${hosted ? "" : `/${enc(cfg.bucket)}`}`;
  const prefix = cleanPrefix(cfg.prefix);

  const call = (method: string, key: string, query: Record<string, string>, body?: Body, payloadHash = sha256("")) => {
    const path = `${root}/${key.split("/").map(enc).join("/")}`.replace(/\/$/, key ? "/" : "") || "/";
    const url = new URL(`${origin}${path}${Object.keys(query).length ? `?${Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&")}` : ""}`);
    const headers: Record<string, string> = { host: url.host, "x-amz-content-sha256": payloadHash, "x-amz-date": new Date().toISOString().replace(/[-:]|\.\d{3}/g, "") };
    const authorization = signV4({ method, path, query, headers, payloadHash, region: cfg.region.trim() || "us-east-1", service: "s3", accessKey: cfg.accessKey.trim(), secretKey: cfg.secretKey.trim() });
    return send(method, url, { ...headers, authorization }, body);
  };

  return {
    async put(name, file, octets) {
      // Un envoi simple accepte 5 Go au plus.
      if (octets > 5 * 1024 * 1_048_576) throw new RemoteError("trop-gros");
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
      const r = await call("PUT", `${prefix}${name}`, {}, { file, octets }, hash.digest("hex"));
      if (r.status < 200 || r.status >= 300) throw s3Problem("envoi", r);
    },
    async list() {
      const out: RemoteFile[] = [];
      let token: string | null = null;
      for (let page = 0; page < 20; page++) {
        const r: Reply = await call("GET", "", { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) });
        if (r.status !== 200) throw s3Problem("lecture", r);
        const { files, next } = parseS3List(r.body.toString("utf8"), prefix);
        out.push(...files);
        if (!next) break;
        token = next;
      }
      return out;
    },
    async remove(name) {
      const r = await call("DELETE", `${prefix}${name}`, {});
      if (r.status !== 204 && r.status !== 200 && r.status !== 404) throw s3Problem("suppression", r);
    },
  };
}

/* ---------- WebDAV ---------- */

/** Fichiers d'une réponse « PROPFIND » de profondeur 1 (le dossier lui-même et ses sous-dossiers sont écartés). */
export function parseDavList(xml: string): RemoteFile[] {
  return blocks(xml, "response").flatMap((r) => {
    const href = tag(r, "href");
    if (!href || href.endsWith("/") || /<(?:[\w-]+:)?collection\b/i.test(r)) return [];
    let name: string;
    try {
      name = decodeURIComponent(href.split("/").pop() ?? "");
    } catch {
      return [];
    }
    const at = Date.parse(tag(r, "getlastmodified") ?? "");
    return name ? [{ name, octets: Number(tag(r, "getcontentlength") ?? 0), at: Number.isNaN(at) ? null : at }] : [];
  });
}

export function davRemote(cfg: DavConfig): Remote {
  let folder: URL;
  try {
    folder = new URL(`${cfg.url.trim().replace(/\/+$/, "")}/`);
  } catch {
    throw new RemoteError("adresse");
  }
  const headers = { Authorization: `Basic ${Buffer.from(`${cfg.user}:${cfg.password}`).toString("base64")}` };
  const at = (name: string) => new URL(encodeURIComponent(name), folder);
  const problem = (what: RemoteProblem, r: Reply) =>
    r.status === 401 || r.status === 403 ? new RemoteError("identifiants", String(r.status)) : r.status >= 300 && r.status < 400 ? new RemoteError("redirection", String(r.headers.location ?? "")) : new RemoteError(what, String(r.status));
  /** Crée le dossier s'il n'existe pas encore (405 : il est déjà là), et ceux qui le contiennent s'ils manquent (409). */
  const ensureFolder = async (target: URL = folder, depth = 0): Promise<void> => {
    let r = await send("MKCOL", target, headers);
    if (r.status === 409 && depth < 6 && target.pathname.replace(/\/+$/, "").includes("/")) {
      await ensureFolder(new URL("../", target), depth + 1);
      r = await send("MKCOL", target, headers);
    }
    if (![200, 201, 204, 301, 405].includes(r.status)) throw problem("dossier", r);
  };

  return {
    async put(name, file, octets) {
      let r = await send("PUT", at(name), { ...headers, "Content-Type": "application/octet-stream" }, { file, octets });
      if (r.status === 404 || r.status === 409) {
        await ensureFolder();
        r = await send("PUT", at(name), { ...headers, "Content-Type": "application/octet-stream" }, { file, octets });
      }
      if (r.status < 200 || r.status >= 300) throw problem("envoi", r);
    },
    async list() {
      const body = Buffer.from('<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getcontentlength/><d:getlastmodified/><d:resourcetype/></d:prop></d:propfind>');
      const r = await send("PROPFIND", folder, { ...headers, Depth: "1", "Content-Type": "application/xml; charset=utf-8" }, body);
      // Dossier pas encore créé : il n'y a simplement rien dedans.
      if (r.status === 404) return [];
      if (r.status !== 207 && r.status !== 200) throw problem("lecture", r);
      return parseDavList(r.body.toString("utf8"));
    },
    async remove(name) {
      const r = await send("DELETE", at(name), headers);
      if ((r.status < 200 || r.status >= 300) && r.status !== 404) throw problem("suppression", r);
    },
  };
}

/**
 * Essai d'un stockage : dépose un petit fichier, le retrouve dans la liste, le retire. `write` : écrit ce fichier
 * d'essai sur le disque et rend son chemin (le stockage reçoit des fichiers, pas des octets en mémoire).
 */
export async function testRemote(remote: Remote, write: (content: Buffer) => Promise<string>): Promise<void> {
  const name = `pecule-essai-${randomBytes(4).toString("hex")}.txt`;
  const content = Buffer.from("Essai de Pécule : ce fichier peut être supprimé.\n");
  await remote.put(name, await write(content), content.length);
  try {
    if (!(await remote.list()).some((f) => f.name === name)) throw new RemoteError("invisible");
  } finally {
    await remote.remove(name).catch(() => {});
  }
}
