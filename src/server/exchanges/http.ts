/*
 * Requêtes vers l'API d'un exchange : en https, vers une adresse écrite dans le code, bornées en durée et en taille.
 * Jamais de nouvel essai automatique (une requête signée porte un numéro d'ordre) et jamais de secret dans une
 * erreur : seuls le code de la réponse et le message de l'exchange en sortent.
 */

import { readCapped } from "../net.ts";

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 8_000_000;

/** Lecture d'un exchange qui échoue. `refused` : la clé elle-même est en cause (fausse, expirée, sans le droit). */
export class ExchangeError extends Error {
  constructor(
    message: string,
    readonly refused = false,
  ) {
    super(message);
  }
}

export type Http = (url: string, init?: { method?: "GET" | "POST"; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; body: unknown }>;

/** Réponse d'un exchange, lue comme du JSON quand c'en est (un refus arrive aussi en JSON, avec son code d'erreur). */
export const request: Http = async (url, init = {}) => {
  let res: Response;
  try {
    res = await fetch(url, { method: init.method ?? "GET", headers: { Accept: "application/json", "User-Agent": "Pecule", ...init.headers }, body: init.body, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new ExchangeError(`${new URL(url).host} ne répond pas (${e instanceof Error ? e.name : "erreur"})`);
  }
  const raw = await readCapped(res, MAX_BYTES);
  if (!raw) throw new ExchangeError(`${new URL(url).host} : réponse trop grande`);
  let body: unknown = null;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

/** Ce qu'un exchange rend pour un compte : soldes par symbole, et son propre cours en euros quand il le donne. */
export type ExchangeReading = {
  balances: { symbol: string; quantity: number; wallet?: string }[];
  pricesEur: Map<string, number>;
  /** Parties du compte qui n'ont pas pu être lues cette fois (leurs lignes d'avant sont gardées). */
  unread: string[];
  note: string;
};
export type Credentials = { key: string; secret?: string };

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const obj = record;
export const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(record) : []);
export const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
