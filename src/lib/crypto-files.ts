/*
 * Historique d'une appli crypto sans clé d'API, lu dans le fichier qu'elle exporte : l'export « Crypto Wallet » de
 * l'appli Crypto.com (CSV), le relevé de compte de SwissBorg (classeur Excel, dont les lignes sont données ici en
 * texte). Le solde de chaque crypto est la somme de ses mouvements ; sans base ni réseau (testé dans
 * crypto-files.test.ts).
 */

import { splitCsv } from "./bank-files.ts";
import { isCurrency } from "./currencies.ts";
import { tk } from "./i18n.ts";

/**
 * Applis suivies par leurs exports : nom, format du fichier, marche à suivre, ce qui est lu. Une source de ce genre
 * porte le type « f-<appli> » ; son lecteur est dans `FILE_READERS` (src/server/crypto.ts).
 */
export const FILE_APP_IDS = ["cryptocom", "swissborg"] as const;
export type FileAppId = (typeof FILE_APP_IDS)[number];
export const FILE_APPS: Record<FileAppId, { name: string; accept: string; why: string; steps: string[]; covers: string }> = {
  cryptocom: {
    name: "Crypto.com",
    accept: ".csv,text/csv",
    why: tk("L'appli Crypto.com ne donne pas de clé d'API. Pécule lit le fichier de son historique : le solde de chaque crypto est la somme de ses mouvements. Un mouvement déjà connu n'est jamais compté deux fois."),
    steps: [
      tk("Dans l'appli Crypto.com : Comptes → historique des transactions → exporter."),
      tk("Choisis « Crypto Wallet », puis une période. L'appli limite la durée d'un export : fais-en plusieurs pour couvrir tout l'historique, depuis le premier jour."),
      tk("Dépose ici tous les fichiers CSV obtenus. La fois suivante, un export de la période écoulée suffit."),
    ],
    covers: tk("Ce qui est immobilisé dans l'appli (staking, carte, « Earn ») reste compté. L'export du portefeuille en monnaie n'est pas lu."),
  },
  swissborg: {
    name: "SwissBorg",
    accept: ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    why: tk("SwissBorg ne donne pas de clé d'API. Pécule lit son relevé de compte : le solde de chaque crypto est la somme de ses mouvements. Un mouvement déjà connu n'est jamais compté deux fois."),
    steps: [
      tk("Dans l'appli SwissBorg : Profil → « Account Statement »."),
      tk("Choisis une période qui part de l'ouverture du compte, et le format Excel."),
      tk("Dépose ici le classeur reçu. La fois suivante, un relevé de la période écoulée suffit."),
    ],
    covers: tk("Dépôts, retraits, achats, ventes et versements de rendement. La monnaie (euros, francs) n'est pas suivie."),
  },
};

/** Un mouvement qui change le solde d'une crypto. `key` : ce qui le distingue, pour ne pas le compter deux fois. */
export type FileMove = { at: string; kind: string; symbol: string; amount: number; key: string };
/** `fiat` : c'est l'export du portefeuille en monnaie de l'appli (euros déposés et dépensés), qui n'a rien à suivre ici. */
/** `unknown` : genres de ligne que Pécule ne connaît pas, laissés de côté (on ne sait pas s'ils ajoutent ou retirent). */
export type FileParse = { moves: FileMove[]; internal: number; rows: number; from: string | null; to: string | null; fiat: boolean; unknown?: string[] };

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

const SWISSBORG_COLUMNS = ["Local time", "Time in UTC", "Type", "Currency", "Gross amount", "", "Fee", "", "Net amount", "", "Note"];
/** Ce qui entre dans le compte (pour son montant net de frais) et ce qui en sort (pour son montant brut). */
const SWISSBORG_IN = new Set(["deposit", "payouts", "buy"]);
const SWISSBORG_OUT = new Set(["withdrawal", "sell"]);

/** Rang de la ligne d'en-têtes d'un relevé SwissBorg dans une feuille, ou -1 (ses premières lignes décrivent le compte). */
const swissborgHeader = (rows: string[][]) => rows.slice(0, 40).findIndex((r) => SWISSBORG_COLUMNS.every((c, i) => !c || (r[i] ?? "").trim() === c));

/** Vrai si ces lignes sont celles d'un relevé de compte SwissBorg (ses colonnes, dans l'ordre). */
export const isSwissborgStatement = (rows: string[][]) => swissborgHeader(rows) >= 0;

/**
 * Mouvements d'un relevé de compte SwissBorg, d'après les lignes de sa feuille. Les montants y sont tous positifs :
 * c'est le genre de la ligne qui dit le sens. Un échange donne deux lignes (une vente, un achat). La monnaie n'est
 * pas suivie. Rend `null` si ce n'est pas un tel relevé.
 */
export function parseSwissborgRows(rows: string[][]): FileParse | null {
  const head = swissborgHeader(rows);
  if (head < 0) return null;
  const lines = rows.slice(head + 1).filter((r) => (r[1] ?? "").trim() && (r[2] ?? "").trim());
  const moves: FileMove[] = [];
  const seen = new Map<string, number>();
  const unknown = new Set<string>();
  for (const r of lines) {
    const [, at, type, currency, gross, , , , net, , note] = Array.from({ length: 11 }, (_, i) => (r[i] ?? "").trim());
    const kind = type.toLowerCase();
    const symbol = symbolOf(currency);
    const base = [at, kind, symbol, gross, net, note].join("|");
    const rank = seen.get(base) ?? 0;
    seen.set(base, rank + 1);
    if (!symbol || isCurrency(symbol)) continue;
    const amount = SWISSBORG_IN.has(kind) ? number(net) : SWISSBORG_OUT.has(kind) ? -number(gross) : null;
    if (amount === null) {
      unknown.add(type);
      continue;
    }
    if (amount !== 0) moves.push({ at, kind: kind.slice(0, 96), symbol: symbol.slice(0, 24), amount, key: `swissborg|${base}|${rank}` });
  }
  const dates = lines.map((r) => r[1].trim()).sort();
  return { moves, internal: 0, rows: lines.length, from: dates[0] ?? null, to: dates.at(-1) ?? null, fiat: lines.length > 0 && lines.every((r) => isCurrency(symbolOf(r[3]))), unknown: [...unknown] };
}

/**
 * Genre d'un « solde constaté » : ce que l'appli affiche pour une crypto, relevé par le membre à cette date. Un export
 * peut avoir un trou (des récompenses que l'appli n'y écrit pas) ; le solde constaté le comble sans rien inventer.
 */
export const OBSERVED = "solde_constate";

/**
 * Solde de chaque crypto : la somme de ses mouvements. Une crypto qui a un solde constaté part de lui : seuls les
 * mouvements venus après s'y ajoutent — un export déposé plus tard, qui recouvre la période d'avant, ne compte rien
 * deux fois.
 */
export function balancesOf(moves: { symbol: string; amount: number; at?: string; kind?: string }[]): Map<string, number> {
  const base = new Map<string, { at: string; amount: number }>();
  for (const m of moves) if (m.kind === OBSERVED && (m.at ?? "") >= (base.get(m.symbol)?.at ?? "")) base.set(m.symbol, { at: m.at ?? "", amount: m.amount });
  const out = new Map<string, number>([...base].map(([symbol, b]) => [symbol, b.amount]));
  for (const m of moves) {
    if (m.kind === OBSERVED) continue;
    const from = base.get(m.symbol);
    if (from && (m.at ?? "") <= from.at) continue;
    out.set(m.symbol, (out.get(m.symbol) ?? 0) + m.amount);
  }
  return out;
}
