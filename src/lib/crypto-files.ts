/*
 * Historique d'une appli crypto sans clé d'API, lu dans le fichier qu'elle exporte : pour l'instant l'export
 * « Crypto Wallet » de l'appli Crypto.com. Le solde de chaque crypto est la somme de ses mouvements ; sans base ni
 * réseau (testé dans crypto-files.test.ts).
 */

import { splitCsv } from "./bank-files.ts";
import { isCurrency } from "./currencies.ts";

/** Un mouvement qui change le solde d'une crypto. `key` : ce qui le distingue, pour ne pas le compter deux fois. */
export type FileMove = { at: string; kind: string; symbol: string; amount: number; key: string };
/** `fiat` : c'est l'export du portefeuille en monnaie de l'appli (euros déposés et dépensés), qui n'a rien à suivre ici. */
export type FileParse = { moves: FileMove[]; internal: number; rows: number; from: string | null; to: string | null; fiat: boolean };

const COLUMNS = ["Timestamp (UTC)", "Transaction Description", "Currency", "Amount", "To Currency", "To Amount", "Native Currency", "Native Amount", "Native Amount (in USD)", "Transaction Kind"];
/**
 * Mouvements internes à l'appli : la crypto est immobilisée (staking, carte, « Earn », « Supercharger », ordre en
 * attente) puis rendue, sans jamais quitter le compte. Les compter ferait disparaître ce qui est immobilisé.
 */
const INTERNAL = /(^|[._])(lockup_lock|lockup_unlock|lockup_upgrade|dpos_lock|dpos_unlock|staking|unstaking|fund_lock|purchase_lock|purchase_unlock|sell_lock)($|[._])|^supercharger_(deposit|withdrawal)$|^crypto_earn_program_(created|withdrawn)$|^airdrop_locked$/;
/** Symboles propres à l'appli, ramenés à celui que tout le monde emploie. */
const ALIASES: Record<string, string> = { LUNA2: "LUNA" };

const number = (v: string | undefined) => {
  const n = Number((v ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};
const symbolOf = (v: string | undefined) => {
  const s = (v ?? "").trim().toUpperCase();
  return ALIASES[s] ?? s;
};

/** Vrai si le texte est un export de l'appli Crypto.com (ses colonnes, dans l'ordre). */
export function isCryptocomExport(text: string): boolean {
  const header = splitCsv(text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "", ",")[0] ?? [];
  return COLUMNS.every((c, i) => (header[i] ?? "").trim() === c);
}

/**
 * Mouvements d'un export « Crypto Wallet » de l'appli Crypto.com. Une ligne donne un mouvement, deux pour un
 * échange (ce qui part, ce qui arrive). La monnaie (euro, dollar) n'est pas suivie : elle vit dans un autre
 * portefeuille de l'appli, que cet export ne décrit pas. Rend `null` si ce n'est pas un tel export.
 */
export function parseCryptocomExport(text: string): FileParse | null {
  if (!isCryptocomExport(text)) return null;
  const lines = splitCsv(text.replace(/^﻿/, ""), ",").slice(1).filter((r) => r.length >= COLUMNS.length && r[0].trim());
  // L'export du portefeuille en monnaie a les mêmes colonnes : tout y est en monnaie, et les achats y sont comptés
  // en positif. Ses achats de crypto figurent déjà dans l'export « Crypto Wallet » : le lire les compterait deux fois.
  const fiat = lines.length > 0 && lines.every((r) => isCurrency(symbolOf(r[2]))) && lines.some((r) => number(r[3]) > 0);
  if (fiat) return { moves: [], internal: 0, rows: lines.length, from: null, to: null, fiat };
  const moves: FileMove[] = [];
  const seen = new Map<string, number>();
  let internal = 0;
  for (const r of lines) {
    const [at, , currency, amount, toCurrency, toAmount, , , , kind, hash] = r.map((c) => c.trim());
    // Deux lignes identiques à la seconde près existent (deux récompenses égales) : leur rang les distingue.
    const base = [at, kind, currency, amount, toCurrency, toAmount, hash ?? ""].join("|");
    const rank = seen.get(base) ?? 0;
    seen.set(base, rank + 1);
    if (INTERNAL.test(kind)) {
      internal++;
      continue;
    }
    const legs: [string, number, string][] = [[symbolOf(currency), number(amount), "a"]];
    if (toCurrency) legs.push([symbolOf(toCurrency), Math.abs(number(toAmount)), "b"]);
    for (const [symbol, value, leg] of legs) if (symbol && value !== 0 && !isCurrency(symbol)) moves.push({ at, kind: kind.slice(0, 96), symbol: symbol.slice(0, 24), amount: value, key: `${base}|${rank}|${leg}` });
  }
  const dates = lines.map((r) => r[0].trim()).sort();
  return { moves, internal, rows: lines.length, from: dates[0] ?? null, to: dates.at(-1) ?? null, fiat };
}

/** Solde de chaque crypto : la somme de ses mouvements. */
export function balancesOf(moves: { symbol: string; amount: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of moves) out.set(m.symbol, (out.get(m.symbol) ?? 0) + m.amount);
  return out;
}
