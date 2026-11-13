import { lookup } from "node:dns/promises";
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
