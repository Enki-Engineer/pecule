/*
 * Règles de la synchro CoinStats sans base de données (testées dans crypto-sync.test.ts).
 */

import { t } from "./i18n.ts";

export type SyncedLine = { symbol: string; identifier: string; count: number; valueEur: number };
export type ManualLine = { id: number; symbol: string; quantity: number; manualValue: number | null };

/** Doublon exact : même nom et mêmes avoirs qu'un portefeuille déjà vu sous le même parent. */
export function portfolioSignature(parentId: string | null, name: string, lines: { identifier: string; count: number }[]) {
  const holdings = lines
    .filter((l) => l.count > 0)
    .map((l) => `${l.identifier}=${l.count.toPrecision(10)}`)
    .sort()
    .join("|");
  return `${parentId ?? ""}::${name.trim().toLowerCase()}::${holdings}`;
}

/**
 * Garde-fou : un portefeuille qui valait plus de 100 € et revient vide ou divisé par deux d'un jour
 * à l'autre signale plus probablement une connexion cassée qu'une vente : on garde l'existant.
 */
export function suspiciousDrop(previousEur: number | null, totalEur: number, lineCount: number) {
  if (previousEur == null || previousEur <= 100) return false;
  return lineCount === 0 || totalEur < previousEur * 0.5;
}

export type ManualDecision = { id: number; action: "archiver" | "garder" | "conflit"; reason: string };

/**
 * Sort des lignes saisies à la main une fois CoinStats synchronisé : archivée si CoinStats couvre au
 * moins 90 % de la quantité (ou a la ligne, pour une valeur saisie en euros), gardée si CoinStats ne
 * la voit pas, signalée en conflit entre les deux (possible double compte). « AUTRES » (longue traîne
 * saisie en bloc) est toujours archivée : elle est désormais synchronisée ligne par ligne.
 */
export function decideManualLines(manual: ManualLine[], synced: SyncedLine[]): ManualDecision[] {
  const qty = new Map<string, number>();
  const val = new Map<string, number>();
  for (const s of synced) {
    const k = s.symbol.toUpperCase();
    qty.set(k, (qty.get(k) ?? 0) + s.count);
    val.set(k, (val.get(k) ?? 0) + s.valueEur);
  }
  return manual.map((m) => {
    const k = m.symbol.toUpperCase();
    const q = qty.get(k) ?? 0;
    if (k === "AUTRES") return { id: m.id, action: "archiver", reason: t("Longue traîne désormais synchronisée ligne par ligne depuis CoinStats") };
    if (m.manualValue != null && !(m.quantity > 0))
      return (val.get(k) ?? 0) > 0
        ? { id: m.id, action: "archiver", reason: t("Valeur reprise par CoinStats") }
        : { id: m.id, action: "garder", reason: t("Absente de CoinStats") };
    if (q <= 0) return { id: m.id, action: "garder", reason: t("Absente de CoinStats") };
    if (q >= m.quantity * 0.9) return { id: m.id, action: "archiver", reason: t("Couverte par CoinStats ({quantite} {symbole})", { quantite: +q.toFixed(6), symbole: m.symbol }) };
    return { id: m.id, action: "conflit", reason: t("{saisi} saisis à la main, {synchro} dans CoinStats", { saisi: +m.quantity.toFixed(6), synchro: +q.toFixed(6) }) };
  });
}

/** Identifiants CoinStats dont l'id CoinGecko diffère (le reste est identique : bitcoin, ethereum, staked-ether…). */
export const COINGECKO_OVERRIDES: Record<string, string | null> = {
  "binance-coin": "binancecoin",
  FiatCoinEUR: null,
  FiatCoinUSD: null,
};

/** Id CoinGecko candidat : celui d'une ligne manuelle du même symbole, sinon la table, sinon l'identifiant CoinStats. */
export function coingeckoCandidate(identifier: string, symbol: string, knownBySymbol: Map<string, string>): string | null {
  const known = knownBySymbol.get(symbol.toUpperCase());
  if (known) return known;
  if (identifier in COINGECKO_OVERRIDES) return COINGECKO_OVERRIDES[identifier];
  return /^[a-z0-9-]+$/.test(identifier) ? identifier : null;
}

/**
 * Lignes CoinStats remplacées par une lecture sur la blockchain : chaque source lue désigne le
 * portefeuille CoinStats et l'actif qu'elle remplace (clé « portefeuille:SYMBOLE »), pour ne pas
 * compter deux fois sans toucher au même actif ailleurs (ex. un peu d'ETH chez Crypto.com).
 */
export function withoutChainCovered<T extends { coin: { symbol: string } }>(lines: T[], portfolioId: string, skipKeys: Set<string>) {
  const kept: T[] = [];
  const skipped: T[] = [];
  for (const l of lines) (skipKeys.has(`${portfolioId}:${l.coin.symbol.toUpperCase()}`) ? skipped : kept).push(l);
  return { kept, skipped };
}

/** Sources qu'une source remplace (colonne `replaces_id` : identifiants séparés par une virgule). */
export const replacedIds = (value: string | null | undefined): string[] => (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);

export type SourceLines = { id: string; name: string; lines: { symbol: string; quantity: number }[] };
export type Duplicate = { directId: string; directName: string; otherId: string; otherName: string; symbols: string[] };

const sameQuantity = (a: number, b: number) => Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-4;

/**
 * Sources qui décrivent sans doute les mêmes avoirs : une source lue sans intermédiaire (adresse, exchange, fichier)
 * et une source d'agrégateur, quel qu'il soit, où la même crypto figure pour la même quantité. Deux cryptos égales,
 * ou la seule crypto d'une source, suffisent à le proposer : c'est le membre qui confirme. Une paire déjà réglée
 * (`replaced`) n'est pas reproposée.
 */
export function findDuplicates(direct: (SourceLines & { replaces: string[] })[], others: SourceLines[]): Duplicate[] {
  const out: Duplicate[] = [];
  for (const d of direct) {
    const totals = new Map<string, number>();
    for (const l of d.lines) totals.set(l.symbol.toUpperCase(), (totals.get(l.symbol.toUpperCase()) ?? 0) + l.quantity);
    for (const o of others) {
      if (d.replaces.includes(o.id) || !o.lines.length) continue;
      const symbols = o.lines
        .filter((l) => l.quantity > 0)
        .filter((l) => {
          const symbol = l.symbol.toUpperCase();
          // La même quantité que tout ce que la source directe a de cette crypto, ou que l'une de ses lignes.
          return (totals.has(symbol) && sameQuantity(totals.get(symbol)!, l.quantity)) || d.lines.some((x) => x.symbol.toUpperCase() === symbol && sameQuantity(x.quantity, l.quantity));
        })
        .map((l) => l.symbol.toUpperCase());
      if (symbols.length >= 2 || (symbols.length === 1 && o.lines.length === 1)) out.push({ directId: d.id, directName: d.name, otherId: o.id, otherName: o.name, symbols: [...new Set(symbols)] });
    }
  }
  return out;
}
