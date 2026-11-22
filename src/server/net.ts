import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { isPrivateAddress } from "../lib/net.ts";

/* Requêtes sortantes vers une adresse choisie ailleurs que dans le code : jamais vers le réseau privé du serveur. */

/** Vrai si le nom d'hôte se résout, et seulement vers des adresses publiques. */
export async function resolvesPublic(hostname: string): Promise<boolean> {
  try {
    const found = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true });
    return found.length > 0 && found.every((a) => !isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/** Vrai si le nom d'hôte se résout, et seulement vers des adresses privées : un appareil du réseau du serveur (un NAS). */
export async function resolvesPrivate(hostname: string): Promise<boolean> {
  try {
    const found = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true });
    return found.length > 0 && found.every((a) => isPrivateAddress(a.address));
  } catch {
    return false;
  }
}

/**
 * `fetch` en https qui vérifie la destination à chaque saut : la première adresse comme chaque redirection doivent
 * mener à un hôte public (un site tiers ne peut pas renvoyer le serveur vers son propre réseau).
 */
export async function publicFetch(url: string, init: RequestInit = {}, hops = 4): Promise<Response> {
  let current = url;
  for (let i = 0; i <= hops; i++) {
    const u = new URL(current);
    if (u.protocol !== "https:" || !(await resolvesPublic(u.hostname))) throw new Error("Adresse refusée");
    const res = await fetch(u, { ...init, redirect: "manual" });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) return res;
    await res.body?.cancel().catch(() => undefined);
    current = new URL(next, u).toString();
  }
  throw new Error("Trop de redirections");
}

/**
 * Corps d'une réponse, lu au fil de l'eau et abandonné dès qu'il dépasse `maxBytes` : un site qui annonce une image et
 * envoie un flux sans fin n'est pas gardé en mémoire le temps du délai. `null` s'il est trop gros (ou s'il l'annonce).
 */
export async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  const announced = Number(res.headers.get("content-length"));
  if (announced > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!res.body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** Adresses d'un nom d'hôte, s'il se résout dans le délai et seulement vers des adresses publiques ; sinon aucune. */
async function publicAddresses(hostname: string, timeoutMs: number): Promise<{ address: string; family: number }[]> {
  const host = hostname.replace(/^\[|\]$/g, "");
  // Un document public se demande à un nom, jamais à une adresse écrite en chiffres.
  if (isIP(host)) return [];
  let timer: NodeJS.Timeout | undefined;
  try {
    const found = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("résolution trop lente")), timeoutMs);
      }),
    ]);
    return found.length > 0 && found.every((a) => !isPrivateAddress(a.address)) ? found : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lit un petit document public en https, à une adresse donnée par n'importe qui (le document d'identité d'un client
 * OAuth). L'hôte est résolu une seule fois, ne doit avoir que des adresses publiques, et la connexion se fait vers
 * l'adresse qui vient d'être contrôlée : un nom qui changerait d'adresse entre le contrôle et la connexion n'y gagne
 * rien. Aucune redirection n'est suivie, seule une réponse 200 compte, la taille et la durée totales sont bornées.
 * Rend le texte du document, ou `null` dans tous les autres cas.
 */
export async function publicDocument(url: string, limits: { maxBytes: number; timeoutMs: number }): Promise<string | null> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const started = Date.now();
  const addresses = await publicAddresses(u.hostname, Math.min(2000, limits.timeoutMs));
  const target = addresses.find((a) => a.family === 4) ?? addresses[0];
  const left = limits.timeoutMs - (Date.now() - started);
  if (!target || left <= 0) return null;
  return new Promise((resolve) => {
    let settled = false;
    const done = (text: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.destroy();
      resolve(text);
    };
    const req = httpsRequest(
      u,
      {
        method: "GET",
        agent: false,
        headers: { Accept: "application/json", "User-Agent": "Pecule" },
        // L'adresse contrôlée, et elle seule (Node demande parfois toutes les adresses : `all`).
        lookup: (_host, options, callback) => {
          const cb = callback as (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
          if (typeof options === "object" && options.all) cb(null, [{ address: target.address, family: target.family }]);
          else cb(null, target.address, target.family);
        },
      },
      (res) => {
        if (res.statusCode !== 200) return done(null);
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > limits.maxBytes) return done(null);
          chunks.push(chunk);
        });
        res.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
        res.on("error", () => done(null));
      },
    );
    const timer = setTimeout(() => done(null), left);
    req.on("error", () => done(null));
    req.end();
  });
}
