/*
 * Requêtes vers les services publics des blockchains : sans clé, en lecture, avec un service de secours.
 * Les adresses sont écrites dans le code (jamais données par un membre), les réponses sont bornées dans le temps.
 */

import { readCapped } from "../net.ts";

const TIMEOUT_MS = 15_000;
/** Une réponse plus grosse n'est pas lue : un portefeuille de particulier tient très en dessous. */
const MAX_BYTES = 8_000_000;
export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Une tentative par service, dans l'ordre ; un service qui demande de ralentir (429) est réessayé une fois. */
async function firstAnswer<T>(urls: string[], init: RequestInit | undefined, label: string, read: (body: unknown) => T): Promise<T> {
  let last = "";
  for (const url of urls) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { ...init, headers: { Accept: "application/json", "User-Agent": "Pecule", ...init?.headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.status === 429 && attempt === 0) {
          await res.body?.cancel().catch(() => undefined);
          await wait(Math.min(5, Number(res.headers.get("retry-after")) || 2) * 1000);
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          throw new Error(`HTTP ${res.status}`);
        }
        const body = await readCapped(res, MAX_BYTES);
        if (!body) throw new Error("réponse trop grande");
        return read(JSON.parse(body.toString("utf8")));
      } catch (e) {
        last = `${new URL(url).host} : ${e instanceof Error ? e.message : String(e)}`;
        break;
      }
    }
  }
  throw new Error(`${label} illisible (${last})`);
}

/** Document JSON lu au premier service qui répond. */
export const getJson = <T>(urls: string[], label: string): Promise<T> => firstAnswer(urls, undefined, label, (body) => body as T);

/** Document JSON demandé par un corps JSON (lecture seule : une question trop longue pour une adresse), au premier service qui répond. */
export const postJson = <T>(urls: string[], body: unknown, label: string): Promise<T> =>
  firstAnswer(urls, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, label, (answer) => answer as T);

type RpcCall = { method: string; params: unknown[] };
type RpcReply = { id: number; result?: unknown; error?: { message?: string } };

/**
 * Appels JSON-RPC envoyés en un lot au premier nœud qui répond à tous. Un nœud qui refuse une partie du lot est
 * tenu pour défaillant : le suivant est essayé, plutôt que de rendre un solde incomplet.
 */
export function rpcBatch(urls: string[], calls: RpcCall[], label: string): Promise<unknown[]> {
  if (!calls.length) return Promise.resolve([]);
  const body = JSON.stringify(calls.map((c, id) => ({ jsonrpc: "2.0", id, method: c.method, params: c.params })));
  return firstAnswer(urls, { method: "POST", headers: { "Content-Type": "application/json" }, body }, label, (answer) => {
    const replies = answer as RpcReply[] | RpcReply;
    if (!Array.isArray(replies)) throw new Error(replies.error?.message ?? "lot refusé");
    const byId = new Map(replies.map((r) => [r.id, r]));
    return calls.map((_, id) => {
      const r = byId.get(id);
      if (!r || r.error || r.result === undefined) throw new Error(r?.error?.message ?? "réponse incomplète");
      return r.result;
    });
  });
}

/** `fn` appliquée à chaque élément, `limit` à la fois, résultats dans l'ordre. */
export async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
