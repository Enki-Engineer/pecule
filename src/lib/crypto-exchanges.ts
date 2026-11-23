/*
 * Comptes d'exchange lus par une clé d'API en lecture seule : ce que Pécule sait relier, ce qu'il demande au
 * membre, et comment il ramène les codes d'un exchange à un symbole — sans base ni réseau (testé dans
 * crypto-exchanges.test.ts). Une clé en lecture seule montre les soldes ; elle ne peut ni vendre ni retirer.
 */

import { tk } from "./i18n.ts";
import type { Holding } from "./crypto-chains.ts";

export const EXCHANGE_IDS = ["kraken", "binance", "coinbase", "bitpanda", "bitvavo", "okx", "bybit", "kucoin", "bitget", "bitfinex", "cryptocom"] as const;
export type ExchangeId = (typeof EXCHANGE_IDS)[number];
/** Genre d'une source d'exchange (colonne `crypto_sources.type`) : « x-kraken », « x-binance »… */
export type ExchangeKind = `x-${ExchangeId}`;
export const EXCHANGE_KINDS = EXCHANGE_IDS.map((id) => `x-${id}` as ExchangeKind);
export const isExchangeKind = (type: string): type is ExchangeKind => (EXCHANGE_KINDS as readonly string[]).includes(type);
export const exchangeOf = (kind: ExchangeKind) => kind.slice(2) as ExchangeId;

export type ExchangeInfo = {
  name: string;
  /** Libellé du premier champ, et du second quand la clé va par deux. */
  keyLabel: string;
  secretLabel: string | null;
  /** Le second champ est long (une clé privée sur plusieurs lignes). */
  longSecret?: boolean;
  /** Troisième valeur que certains exchanges font choisir à la création de la clé. */
  passLabel?: string;
  /** Où créer la clé, quoi cocher, quoi laisser décoché : dit pas à pas. */
  steps: string[];
  /** Ce que la lecture couvre, et ce qu'elle ne voit pas. */
  covers: string;
};

export const EXCHANGES: Record<ExchangeId, ExchangeInfo> = {
  kraken: {
    name: "Kraken",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé privée"),
    steps: [
      tk("Dans Kraken : Réglages → API → créer une clé."),
      tk("Sous « Funds permissions », coche seulement « Query » (consulter les fonds). Laisse tout le reste décoché : ni ordres, ni retraits."),
      tk("Copie la clé d'API et la clé privée : Kraken ne montre la clé privée qu'une fois."),
    ],
    covers: tk("Soldes du compte, cryptos mises en staking ou en récompenses comprises."),
  },
  binance: {
    name: "Binance",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    steps: [
      tk("Dans Binance : Compte → Gestion des API → créer une clé générée par le système."),
      tk("Garde seulement « Enable Reading » (lecture). N'active ni le trading ni les retraits : Pécule refuse une clé qui peut faire plus que lire."),
      tk("Copie la clé d'API et la clé secrète : Binance ne montre la clé secrète qu'une fois."),
    ],
    covers: tk("Compte spot, portefeuille de financement et épargne (Simple Earn, souple et bloquée). Les contrats à terme ne sont pas lus."),
  },
  coinbase: {
    name: "Coinbase",
    keyLabel: tk("Nom de la clé (organizations/…/apiKeys/…)"),
    secretLabel: tk("Clé privée (-----BEGIN EC PRIVATE KEY-----)"),
    longSecret: true,
    steps: [
      tk("Sur portal.cdp.coinbase.com : Settings → API Keys → « Create secret API key »."),
      tk("Choisis l'algorithme ECDSA (l'autre, Ed25519, n'ouvre pas les comptes Coinbase) et garde le seul droit « Read » : ni Trade, ni Transfer, ni Receive."),
      tk("Copie le nom de la clé et sa clé privée, telle qu'elle est écrite dans le fichier téléchargé."),
    ],
    covers: tk("Tous les comptes de l'appli Coinbase (cryptos et monnaie)."),
  },
  bitpanda: {
    name: "Bitpanda",
    keyLabel: tk("Clé d'API"),
    secretLabel: null,
    steps: [
      tk("Dans Bitpanda : Réglages du compte → API Keys → nouvelle clé."),
      tk("Coche « Balances » et « Trade (Read) ». Laisse décoché tout ce qui écrit (« Write »)."),
      tk("Une clé Bitpanda vaut un an au plus : Pécule te le dira quand elle ne sera plus acceptée."),
    ],
    covers: tk("Cryptos et monnaie du compte, staking compris. Les actions, ETF et métaux n'entrent pas dans l'écran Crypto."),
  },
  bitvavo: {
    name: "Bitvavo",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    steps: [
      tk("Dans Bitvavo : Réglages → API → nouvelle clé."),
      tk("Coche seulement « View information » (consulter). Ni « Trade digital assets », ni « Withdraw digital assets »."),
      tk("Copie la clé d'API et la clé secrète : la clé secrète ne se montre qu'une fois."),
    ],
    covers: tk("Soldes du compte et cryptos mises en staking."),
  },
  okx: {
    name: "OKX",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    passLabel: tk("Phrase de passe de la clé"),
    steps: [
      tk("Dans OKX : profil → API → créer une clé d'API."),
      tk("Garde le seul droit « Read » (lecture), et choisis une phrase de passe : elle fait partie de la clé."),
      tk("Copie la clé d'API, la clé secrète et la phrase de passe."),
    ],
    covers: tk("Compte de trading, compte de financement et épargne souple (Simple Earn)."),
  },
  bybit: {
    name: "Bybit",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    steps: [
      tk("Dans Bybit : compte → API → créer une clé générée par le système."),
      tk("Choisis « Read-Only » (lecture seule) : Pécule refuse une clé qui peut faire plus que lire."),
      tk("Sans adresse IP déclarée, Bybit fait expirer la clé au bout de trois mois : Pécule te le dira quand elle ne sera plus acceptée."),
    ],
    covers: tk("Compte unifié (ou spot) et compte de financement."),
  },
  kucoin: {
    name: "KuCoin",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    passLabel: tk("Phrase de passe de la clé"),
    steps: [
      tk("Dans KuCoin : Gestion des API → créer une clé."),
      tk("Garde le seul droit « General » (lecture), et choisis une phrase de passe : elle fait partie de la clé."),
      tk("Copie la clé d'API, la clé secrète et la phrase de passe."),
    ],
    covers: tk("Tous les comptes : principal, trading, marge."),
  },
  bitget: {
    name: "Bitget",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    passLabel: tk("Phrase de passe de la clé"),
    steps: [
      tk("Dans Bitget : Gestion des API → créer une clé."),
      tk("Mets chaque droit en lecture seule (« Read-only »), et choisis une phrase de passe : elle fait partie de la clé."),
      tk("Copie la clé d'API, la clé secrète et la phrase de passe."),
    ],
    covers: tk("Compte spot. Les contrats à terme et l'épargne ne sont pas lus."),
  },
  bitfinex: {
    name: "Bitfinex",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    steps: [
      tk("Dans Bitfinex : compte → API keys → créer une clé."),
      tk("Laisse seulement les droits de lecture (« Read ») ; aucun droit d'écriture (« Write ») : Pécule refuse une clé qui peut écrire."),
      tk("Copie la clé d'API et la clé secrète : la clé secrète ne se montre qu'une fois."),
    ],
    covers: tk("Tous les portefeuilles du compte : exchange, marge, financement."),
  },
  cryptocom: {
    name: "Crypto.com Exchange",
    keyLabel: tk("Clé d'API"),
    secretLabel: tk("Clé secrète"),
    steps: [
      tk("Sur le site de Crypto.com Exchange (pas dans l'appli) : Réglages → API Keys → créer une clé."),
      tk("Laisse la clé telle qu'elle est créée : en lecture (« Can Read »), sans trading ni retrait."),
      tk("L'appli Crypto.com, elle, n'a pas de clé : son historique s'importe par un fichier."),
    ],
    covers: tk("Soldes du compte Exchange. L'appli Crypto.com est un autre compte."),
  },
};

/** Suffixes de Kraken : la même crypto, mise en staking (.S), en récompenses (.M, .F), en rendement (.B, .P). */
const KRAKEN_SUFFIX = /\.(S|M|F|B|P)$/;
/** Anciens codes de Kraken à quatre lettres (« XXBT », « ZEUR ») : la première lettre dit seulement crypto ou monnaie. */
const KRAKEN_LEGACY = new Set(["XXBT", "XETH", "XXRP", "XLTC", "XXLM", "XXMR", "XZEC", "XETC", "XREP", "XMLN", "XXDG", "ZEUR", "ZUSD", "ZGBP", "ZCAD", "ZJPY", "ZAUD", "ZCHF"]);
const KRAKEN_NAMES: Record<string, string> = { XBT: "BTC", XDG: "DOGE", ETH2: "ETH" };

/**
 * Symbole courant d'un code d'actif de Kraken (« XXBT », « ETH2.S », « DOT28.S », « USDT.F »), ou `null` pour ce
 * qui n'a pas de cours : crédits de frais (KFEE), actions tokenisées (.T). `altnames` : le nom courant que Kraken
 * donne à chaque code (sa liste publique des actifs), quand on l'a.
 */
export function krakenSymbol(code: string, altnames: Record<string, string> = {}): string | null {
  if (code === "KFEE" || code.endsWith(".T")) return null;
  let base = code.replace(/\.HOLD$/, "");
  if (KRAKEN_SUFFIX.test(base)) {
    base = base.replace(KRAKEN_SUFFIX, "");
    // « DOT28 » : la même crypto, immobilisée vingt-huit jours.
    if (base !== "ETH2") base = base.replace(/\d+$/, "");
  }
  const alt = altnames[base] ?? (KRAKEN_LEGACY.has(base) ? base.slice(1) : base);
  return (KRAKEN_NAMES[alt] ?? alt).toUpperCase();
}

/**
 * Solde d'un actif du compte spot de Binance à ne pas compter : « LDBTC » est le reçu d'un BTC placé en épargne
 * souple, relu à part. LDO (Lido) commence par les mêmes lettres sans en être un.
 */
export const isBinanceReceipt = (asset: string) => asset.startsWith("LD") && asset !== "LDO";

/** Nombre écrit par un exchange (« 0.0100 », « 1e-8 », 12), ou zéro pour ce qui n'en est pas un. */
export function amountOf(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Additionne des soldes par symbole (un même actif dans plusieurs comptes ou sous plusieurs codes). */
export function sumBySymbol(rows: { symbol: string | null; quantity: number }[]): { symbol: string; quantity: number }[] {
  const out = new Map<string, number>();
  for (const r of rows) if (r.symbol && r.quantity > 0) out.set(r.symbol, (out.get(r.symbol) ?? 0) + r.quantity);
  return [...out].map(([symbol, quantity]) => ({ symbol, quantity }));
}

/**
 * Le cours que donne l'exchange et celui de CoinGecko parlent-ils de la même crypto ? Deux cryptos peuvent porter
 * le même symbole : un écart de plus d'un tiers dit que la table s'est trompée de crypto, et le cours de l'exchange
 * est alors le seul retenu.
 */
export const sameCoin = (exchangePrice: number, coingeckoPrice: number) => exchangePrice > 0 && coingeckoPrice > 0 && exchangePrice / coingeckoPrice > 0.66 && exchangePrice / coingeckoPrice < 1.5;

/** Partie d'un compte dite à côté du nom de l'exchange (le compte courant ne se dit pas). */
const WALLET_PLACES: Record<string, string> = { financement: "financement", epargne: "épargne", bloque: "épargne bloquée", staking: "staking" };

/**
 * Avoirs d'un compte d'exchange, prêts à être valorisés : une crypto reconnue par son symbole (`symbols` : la table
 * fabriquée depuis CoinGecko) suit son cours CoinGecko, le cours de l'exchange servant de contrôle ; ce que la table
 * ne connaît pas garde le cours de l'exchange ; une monnaie (`fiat` : son cours en euros) n'est jamais prise pour la
 * crypto qui porterait le même symbole.
 */
export function holdingsOf(
  balances: { symbol: string; quantity: number; wallet?: string }[],
  pricesEur: ReadonlyMap<string, number>,
  symbols: Readonly<Record<string, readonly [coingeckoId: string, name: string]>>,
  fiat: Readonly<Record<string, number>>,
): Holding[] {
  return balances.map((b) => {
    const isFiat = b.symbol in fiat;
    const known = isFiat ? undefined : symbols[b.symbol];
    const price = isFiat ? fiat[b.symbol] : pricesEur.get(b.symbol);
    const wallet = b.wallet ?? "spot";
    return {
      key: `${wallet}:${b.symbol}`,
      symbol: b.symbol,
      name: known?.[1] ?? b.symbol,
      coingeckoId: known?.[0] ?? null,
      quantity: b.quantity,
      priceEur: price && price > 0 ? price : undefined,
      place: WALLET_PLACES[wallet],
    };
  });
}
