/*
 * Ce que Pécule propose de noter au journal crypto, d'après ce qu'il lit déjà — sans base ni réseau (testé dans
 * crypto-moves.test.ts) :
 * - un virement ou un paiement par carte vers une plateforme crypto, reconnu au libellé de la banque ;
 * - un solde qui a bougé entre deux lectures d'un portefeuille (achat, vente, échange, transfert).
 * Une proposition n'écrit rien : le membre la note, la corrige ou l'écarte.
 */

import { isCurrency } from "./currencies.ts";
import type { EventKind } from "./crypto-events.ts";

/* ---------- Plateformes reconnues dans un libellé bancaire ---------- */

/** Une plateforme crypto : son nom, et les mots qui la désignent sur un relevé (sa marque, la société qui encaisse pour elle). */
export type CryptoPlatform = { name: string; words: string[] };

export const CRYPTO_PLATFORMS: CryptoPlatform[] = [
  { name: "Kraken", words: ["kraken", "payward"] },
  { name: "Binance", words: ["binance", "bifinity"] },
  { name: "Coinbase", words: ["coinbase", "cb payments"] },
  { name: "Crypto.com", words: ["crypto.com", "cryptocom", "foris dax", "foris mt"] },
  { name: "Bitpanda", words: ["bitpanda"] },
  { name: "Bitvavo", words: ["bitvavo"] },
  { name: "OKX", words: ["okx"] },
  { name: "Bybit", words: ["bybit"] },
  { name: "KuCoin", words: ["kucoin"] },
  { name: "Bitget", words: ["bitget"] },
  { name: "Bitfinex", words: ["bitfinex"] },
  { name: "Bitstamp", words: ["bitstamp"] },
  { name: "SwissBorg", words: ["swissborg"] },
  { name: "Nexo", words: ["nexo"] },
  { name: "Coinhouse", words: ["coinhouse"] },
  { name: "Paymium", words: ["paymium"] },
  { name: "Bit2Me", words: ["bit2me"] },
  { name: "Relai", words: ["relai app", "relai ag"] },
];

/** Tous les mots à chercher dans les libellés : de quoi présélectionner les opérations avant de les lire une à une. */
export const PLATFORM_WORDS: string[] = CRYPTO_PLATFORMS.flatMap((p) => p.words);

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MATCHERS = CRYPTO_PLATFORMS.map((p) => ({ platform: p, re: new RegExp(`(^|[^a-z0-9])(${p.words.map(escaped).join("|")})($|[^a-z0-9])`) }));

/** Plateforme crypto que nomme un libellé (mot entier, sans tenir compte de la casse ni des accents) ; `null` sinon. */
export function platformOf(...texts: (string | null | undefined)[]): CryptoPlatform | null {
  const text = plain(texts.filter(Boolean).join(" · "));
  if (!text) return null;
  return MATCHERS.find((m) => m.re.test(text))?.platform ?? null;
}

/** Un mouvement d'argent déjà raconté au journal : de quoi ne pas reproposer l'opération bancaire qui lui correspond. */
export type ToldMove = { date: string; endDate: string | null; platform: string | null };

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / DAY);

/**
 * Vrai si le journal raconte déjà l'opération bancaire de ce jour vers cette plateforme : un dépôt, un retrait, un
 * achat ou une vente sur la même plateforme, le même jour à quelques jours près (un virement met jusqu'à trois jours
 * à arriver), ou sur une période qui couvre ce jour.
 */
export function alreadyTold(day: string, platform: string, told: ToldMove[], slack = 4): boolean {
  const name = plain(platform);
  return told.some((e) => e.platform != null && plain(e.platform).includes(name) && days(day, e.date) >= -slack && days(day, e.endDate ?? e.date) <= slack);
}

/* ---------- Soldes qui ont bougé entre deux lectures ---------- */

/** Ce qu'un portefeuille porte d'une crypto (ou d'une monnaie) à une lecture, et son cours en euros (le pivot des cours). */
export type Holding = { portfolioId: string; symbol: string; quantity: number; priceEur: number | null };

export type DetectedMove = {
  kind: EventKind;
  /** Portefeuille où le mouvement est noté (celui qui reçoit, pour un transfert). */
  portfolioId: string;
  /** Portefeuille d'où vient la crypto, pour un transfert entre deux portefeuilles du membre. */
  fromPortfolioId: string | null;
  /** Symbole ; « A → B » pour un échange. */
  asset: string;
  /** Quantité reçue ; cédée pour une vente ou une sortie. */
  quantity: number;
  /** Valeur en euros (le pivot) : la monnaie dépensée ou reçue, sinon la quantité au cours du jour. */
  valueEur: number | null;
  /** Sens d'un mouvement dont l'autre bout n'est pas connu : la crypto est arrivée, ou partie. */
  direction: "in" | "out" | null;
};

/** En dessous, un écart de solde ne se propose pas : poussière, récompenses au fil de l'eau, arrondis. */
export const MIN_MOVE_EUR = 20;
const MIN_SHARE = 0.02;
/** Un transfert arrive amputé de ses frais : jusqu'à 10 % de moins que ce qui est parti. */
const TRANSFER_LOSS = 0.1;

type Delta = { portfolioId: string; symbol: string; delta: number; valueEur: number; fiat: boolean };

function deltas(before: Holding[], after: Holding[], read: Set<string>): Delta[] {
  const sum = (rows: Holding[]) => {
    const map = new Map<string, { portfolioId: string; symbol: string; quantity: number; priceEur: number | null }>();
    for (const h of rows) {
      const symbol = h.symbol.toUpperCase();
      const key = `${h.portfolioId}\n${symbol}`;
      const line = map.get(key) ?? { portfolioId: h.portfolioId, symbol, quantity: 0, priceEur: null };
      line.quantity += Number(h.quantity);
      line.priceEur ??= h.priceEur;
      map.set(key, line);
    }
    return map;
  };
  const was = sum(before);
  const is = sum(after);
  const out: Delta[] = [];
  for (const key of new Set([...was.keys(), ...is.keys()])) {
    const a = was.get(key);
    const b = is.get(key);
    const line = (b ?? a)!;
    if (!read.has(line.portfolioId)) continue;
    const from = a?.quantity ?? 0;
    const to = b?.quantity ?? 0;
    const delta = to - from;
    const price = b?.priceEur ?? a?.priceEur ?? null;
    // Sans cours, on ne sait pas si l'écart compte : il n'est pas proposé (jeton inconnu, poussière d'airdrop).
    if (price == null || !(price > 0)) continue;
    const valueEur = Math.abs(delta) * price;
    if (valueEur < MIN_MOVE_EUR) continue;
    if (Math.min(from, to) > 0 && Math.abs(delta) < MIN_SHARE * Math.max(from, to)) continue;
    out.push({ portfolioId: line.portfolioId, symbol: line.symbol, delta, valueEur, fiat: isCurrency(line.symbol) });
  }
  return out;
}

/**
 * Mouvements que racontent deux lectures successives des portefeuilles d'un membre. `read` : les portefeuilles relus
 * avec succès, et qui avaient déjà été lus avant (un portefeuille qu'on vient de relier n'a pas d'« avant »).
 * - la même crypto en moins ici et en plus là, aux frais près : un transfert entre deux portefeuilles ;
 * puis, avec ce qui reste dans chaque portefeuille :
 * - de la monnaie en moins et une seule crypto en plus : un achat (l'inverse : une vente) ;
 * - une crypto en moins et une autre en plus, sans monnaie : un échange ;
 * - le reste : une arrivée ou un départ dont l'autre bout n'est pas connu.
 * La monnaie qui bouge seule (dépôt, retrait) n'est pas proposée ici : c'est l'opération bancaire qui la raconte.
 */
export function detectMoves(before: Holding[], after: Holding[], read: Set<string>): DetectedMove[] {
  const all = deltas(before, after, read);
  const moves: DetectedMove[] = [];
  // D'abord les transferts entre deux portefeuilles du membre — ce qui part d'ici arrive là, moins les frais — :
  // ils ne laissent aucun doute, et ce qui reste dans chaque portefeuille se lit alors plus simplement.
  const used = new Set<Delta>();
  const crypto = all.filter((d) => !d.fiat);
  for (const out of crypto.filter((d) => d.delta < 0)) {
    const sent = -out.delta;
    const arrival = crypto
      .filter((d) => !used.has(d) && d.delta > 0 && d.symbol === out.symbol && d.portfolioId !== out.portfolioId && d.delta <= sent * 1.001 && d.delta >= sent * (1 - TRANSFER_LOSS))
      .sort((a, b) => b.delta - a.delta)[0];
    if (!arrival) continue;
    used.add(out).add(arrival);
    moves.push({ kind: "transfert", portfolioId: arrival.portfolioId, fromPortfolioId: out.portfolioId, asset: out.symbol, quantity: arrival.delta, valueEur: arrival.valueEur, direction: null });
  }
  const rest = all.filter((d) => !used.has(d));
  for (const portfolioId of new Set(rest.map((d) => d.portfolioId))) {
    const mine = rest.filter((d) => d.portfolioId === portfolioId);
    const ups = mine.filter((d) => !d.fiat && d.delta > 0);
    const downs = mine.filter((d) => !d.fiat && d.delta < 0);
    const cashOut = mine.filter((d) => d.fiat && d.delta < 0).reduce((s, d) => s + d.valueEur, 0);
    const cashIn = mine.filter((d) => d.fiat && d.delta > 0).reduce((s, d) => s + d.valueEur, 0);
    const base = { portfolioId, fromPortfolioId: null, direction: null };
    if (cashOut > 0 && !cashIn && ups.length === 1 && !downs.length) moves.push({ ...base, kind: "achat", asset: ups[0].symbol, quantity: ups[0].delta, valueEur: cashOut });
    else if (cashIn > 0 && !cashOut && downs.length === 1 && !ups.length) moves.push({ ...base, kind: "vente", asset: downs[0].symbol, quantity: -downs[0].delta, valueEur: cashIn });
    else if (!cashIn && !cashOut && ups.length === 1 && downs.length === 1) moves.push({ ...base, kind: "echange", asset: `${downs[0].symbol} → ${ups[0].symbol}`, quantity: ups[0].delta, valueEur: ups[0].valueEur });
    // Le reste ne se devine pas : une arrivée ou un départ dont l'autre bout n'est pas connu.
    else for (const d of [...ups, ...downs]) moves.push({ kind: "transfert", portfolioId, fromPortfolioId: null, asset: d.symbol, quantity: Math.abs(d.delta), valueEur: d.valueEur, direction: d.delta > 0 ? "in" : "out" });
  }
  return moves;
}

/* ---------- Ce que le journal dit avoir versé ---------- */

/** Monnaie versée sur les plateformes et monnaie revenue, d'après les dépôts et les retraits notés au journal. */
export function cashFlows(events: { type: string | null; value: number | null; status?: string | null }[]): { deposited: number; withdrawn: number } {
  let deposited = 0;
  let withdrawn = 0;
  for (const e of events) {
    if (e.status === "attente" || e.value == null) continue;
    if (e.type === "depot") deposited += Math.abs(Number(e.value));
    else if (e.type === "retrait") withdrawn += Math.abs(Number(e.value));
  }
  return { deposited: Math.round(deposited * 100) / 100, withdrawn: Math.round(withdrawn * 100) / 100 };
}
