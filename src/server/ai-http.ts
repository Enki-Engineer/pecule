import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isLocalAddress, isPrivateAddress } from "../lib/net.ts";

/*
 * Demandes http aux fournisseurs d'IA que Pécule traduit lui-même (OpenAI, OpenRouter, Ollama, services compatibles) :
 * une demande JSON, une réponse lue au fil de l'eau — événements « data: », lignes JSON ou réponse d'un bloc.
 * Sans dépendance (`node:http`), pour deux raisons : les délais se règlent (un modèle local met parfois plusieurs
 * minutes à écrire son premier mot, ce que `fetch` coupe d'office), et la connexion part vers l'adresse qui vient
 * d'être contrôlée, pas vers celle qu'une seconde résolution du nom donnerait.
 *
 * Où une demande a le droit de partir (`Destination`) :
 * - « publique » : https, vers un nom qui ne mène qu'à des adresses publiques — un fournisseur en ligne. Une adresse
 *   saisie dans les réglages ne doit pas permettre de sonder le réseau de l'hébergement ;
 * - « locale » : un serveur de modèles que l'administrateur a désigné, qui peut être sur la machine ou le réseau local
 *   (Ollama, LM Studio). Même principe que la copie des sauvegardes vers un NAS (`remote.ts`) : en clair (http),
 *   seulement vers la machine ou un réseau local — sur Internet, la clé et les données du foyer circuleraient
 *   lisibles. « Local » s'entend au sens strict (`isLocalAddress`) : pas l'adresse où un hébergeur sert ses
 *   métadonnées, ni les plages réservées.
 * Aucune redirection n'est suivie : elle emporterait la clé et les données ailleurs que là où l'administrateur l'a dit.
 */

export type Destination = "publique" | "locale";

/** Réponse d'erreur du fournisseur (code http hors 2xx) : son corps, tel quel. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly headers: http.IncomingHttpHeaders,
  ) {
    super(`réponse ${status}`);
  }
}
/** Le fournisseur n'a pas répondu, ou s'est tu, dans le délai. */
export class HttpTimeout extends Error {}
/** Pourquoi une adresse n'a pas le droit de recevoir la demande ; l'écran en fait une phrase dans la langue du membre (`src/server/ai.ts`). */
export type RefusedReason = "identifiants" | "https" | "introuvable" | "publique" | "clair";
/** L'adresse n'a pas le droit de recevoir la demande. */
export class HttpRefused extends Error {
  constructor(
    readonly reason: RefusedReason,
    readonly host = "",
  ) {
    super(`adresse du fournisseur d'IA refusée (${reason})`);
  }
}

type Target = { address: string; family: number };

/** L'adresse vers laquelle la demande partira, contrôlée ; lève `HttpRefused` si elle n'y a pas droit. */
export async function destination(url: URL, rule: Destination): Promise<Target> {
  if (url.username || url.password) throw new HttpRefused("identifiants");
  if (url.protocol !== "https:" && !(rule === "locale" && url.protocol === "http:")) throw new HttpRefused("https");
  let found: Target[];
  try {
    found = await lookup(url.hostname.replace(/^\[|\]$/g, ""), { all: true });
  } catch {
    found = [];
  }
  if (!found.length) throw new HttpRefused("introuvable", url.hostname);
  if (rule === "publique" && found.some((a) => isPrivateAddress(a.address))) throw new HttpRefused("publique");
  // En clair, chaque adresse du nom doit être celle de la machine ou d'un réseau local, au sens strict.
  if (url.protocol === "http:" && !found.every((a) => isLocalAddress(a.address))) throw new HttpRefused("clair");
  return found.find((a) => a.family === 4) ?? found[0];
}

export type StreamOptions = {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  /** Corps de la demande, envoyé en JSON. */
  body?: unknown;
  signal?: AbortSignal;
  rule: Destination;
  /** Délai avant le début de la réponse (un modèle local se charge, lit la demande). */
  firstByteMs: number;
  /** Silence le plus long accepté au milieu d'une réponse. */
  idleMs: number;
};

const MAX_ERROR = 64 * 1024;
const MAX_BODY = 64 * 1024 * 1024;

function open(url: URL, target: Target, o: StreamOptions): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const payload = o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body));
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: o.method ?? (payload ? "POST" : "GET"),
        agent: false,
        signal: o.signal,
        headers: { Accept: "application/json, text/event-stream", ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}), ...o.headers },
        // L'adresse contrôlée, et elle seule (Node demande parfois toutes les adresses : `all`).
        lookup: (_host, options, callback) => {
          const cb = callback as (err: Error | null, address: string | Target[], family?: number) => void;
          if (typeof options === "object" && options.all) cb(null, [target]);
          else cb(null, target.address, target.family);
        },
      },
      (res) => {
        // La réponse a commencé : c'est maintenant le silence entre deux morceaux qui est borné.
        clearTimeout(timer);
        res.setTimeout(o.idleMs, () => res.destroy(new HttpTimeout("silence trop long")));
        resolve(res);
      },
    );
    // Un minuteur à nous, et non celui du socket, qui ne compte qu'une fois la connexion établie : une adresse
    // muette doit être abandonnée dans le délai annoncé, pas dans celui du système.
    const timer = setTimeout(() => req.destroy(new HttpTimeout("délai dépassé")), o.firstByteMs);
    req.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end(payload);
  });
}

async function readAll(res: http.IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of res as AsyncIterable<Buffer>) {
    size += c.length;
    if (size > max) break;
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const parse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/**
 * Envoie une demande et rend sa réponse, un objet JSON à la fois : chaque événement d'un flux « text/event-stream »
 * (sans le « [DONE] » final, ni les lignes de commentaire), chaque ligne d'un flux de lignes JSON, ou la réponse
 * entière quand elle arrive d'un bloc. Lève `HttpError` sur un code d'erreur, `HttpTimeout` sur un silence trop long.
 */
export async function* jsonStream(address: string, o: StreamOptions): AsyncGenerator<unknown> {
  const url = new URL(address);
  const target = await destination(url, o.rule);
  const res = await open(url, target, o);
  try {
    const status = res.statusCode ?? 0;
    if (status < 200 || status >= 300) throw new HttpError(status, await readAll(res, MAX_ERROR), res.headers);
    const type = String(res.headers["content-type"] ?? "").toLowerCase();
    if (type.includes("application/json") && !type.includes("ndjson") && !type.includes("jsonl")) {
      const whole = parse(await readAll(res, MAX_BODY));
      if (whole !== undefined) yield whole;
      return;
    }
    const sse = type.includes("event-stream");
    const decoder = new TextDecoder();
    let rest = "";
    let data: string[] = [];
    let size = 0;
    const lines = function* (text: string, last = false): Generator<unknown> {
      rest += text;
      const parts = rest.split(/\r?\n/);
      rest = last ? "" : (parts.pop() ?? "");
      for (const line of parts) {
        if (!sse) {
          // Lignes JSON ; un service qui envoie un flux « data: » sans l'annoncer est lu quand même.
          const text = line.trim().replace(/^data:\s*/, "");
          const v = text && text !== "[DONE]" ? parse(text) : undefined;
          if (v !== undefined) yield v;
          continue;
        }
        // Un événement tient en une ou plusieurs lignes « data: », et se termine par une ligne vide.
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (!line.trim() && data.length) {
          const payload = data.join("\n");
          data = [];
          const v = payload === "[DONE]" ? undefined : parse(payload);
          if (v !== undefined) yield v;
        }
      }
    };
    for await (const c of res as AsyncIterable<Buffer>) {
      size += c.length;
      if (size > MAX_BODY) throw new HttpError(502, "réponse trop longue", res.headers);
      yield* lines(decoder.decode(c, { stream: true }));
    }
    // Un flux coupé sans sa ligne vide finale : ce qui était en attente est rendu quand même.
    yield* lines(`${decoder.decode()}\n\n`, true);
  } finally {
    res.destroy();
  }
}

/** Une réponse JSON d'un bloc (liste des modèles d'un service) ; `undefined` si elle n'en est pas une. */
export async function jsonOnce(address: string, o: StreamOptions): Promise<unknown> {
  for await (const v of jsonStream(address, o)) return v;
  return undefined;
}
