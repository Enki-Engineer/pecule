/*
 * Portefeuilles crypto lus par leur adresse publique : ce que Pécule sait reconnaître, sans base ni réseau
 * (testé dans crypto-chains.test.ts). Une adresse publique permet de lire un solde, jamais de dépenser.
 */

import { tk } from "./i18n.ts";

/** Genre d'une source lue directement (colonne `crypto_sources.type`). */
export const WALLET_KINDS = ["btc", "btc-xpub", "evm", "sol", "mvx-staking", "eth-validator"] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];
export const isWalletKind = (type: string): type is WalletKind => (WALLET_KINDS as readonly string[]).includes(type);

/** Ce que le membre lit quand Pécule a reconnu ce qu'il a collé. */
export const WALLET_LABELS: Record<WalletKind, string> = {
  btc: tk("Adresse Bitcoin"),
  "btc-xpub": tk("Compte Bitcoin (clé publique étendue)"),
  evm: tk("Adresse Ethereum et chaînes compatibles"),
  sol: tk("Adresse Solana"),
  "mvx-staking": tk("Adresse MultiversX (EGLD délégués)"),
  "eth-validator": tk("Validateur Ethereum"),
};

/** Nom donné au portefeuille quand le membre n'en choisit pas. */
export const WALLET_NAMES: Record<WalletKind, string> = {
  btc: "Bitcoin",
  "btc-xpub": "Bitcoin",
  evm: "Ethereum",
  sol: "Solana",
  "mvx-staking": "MultiversX",
  "eth-validator": "Ethereum",
};

const BASE58 = "[1-9A-HJ-NP-Za-km-z]";
const PATTERNS: [WalletKind, RegExp][] = [
  ["evm", /^0x[0-9a-fA-F]{40}$/],
  ["eth-validator", /^(0x[0-9a-fA-F]{96}|\d{1,9})$/],
  ["mvx-staking", /^erd1[02-9ac-hj-np-z]{58}$/],
  ["btc-xpub", new RegExp(`^[xyz]pub${BASE58}{100,110}$`)],
  // Adresses SegWit et Taproot (bc1…), puis anciennes adresses (1… et 3…).
  ["btc", /^(bc1[02-9ac-hj-np-z]{11,71}|BC1[02-9AC-HJ-NP-Z]{11,71})$/],
  ["btc", new RegExp(`^[13]${BASE58}{24,33}$`)],
  ["sol", new RegExp(`^${BASE58}{32,44}$`)],
];

/**
 * Ce que le texte collé a l'air d'être, à sa seule forme (le serveur contrôle ensuite la somme de contrôle).
 * Une ancienne adresse Bitcoin et une adresse Solana courte se ressemblent : la première forme l'emporte ici,
 * le serveur tranche.
 */
export function detectWallet(text: string): WalletKind | null {
  const s = text.trim();
  for (const [kind, re] of PATTERNS) if (re.test(s)) return kind;
  return null;
}

/** Ce qui ressemble à une clé privée ou à une phrase de récupération : à ne jamais saisir, on le dit tout de suite. */
export function looksSecret(text: string): boolean {
  const s = text.trim();
  if (/^[xyz]prv/.test(s)) return true;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) return true;
  if (new RegExp(`^[5KL]${BASE58}{50,51}$`).test(s)) return true;
  const words = s.split(/\s+/);
  return words.length >= 12 && words.length <= 24 && words.every((w) => /^[a-zA-Z]{3,8}$/.test(w));
}

/** « bc1qar0s…5mdq » : assez pour reconnaître une adresse sans l'afficher en entier. */
export function shortAddress(address: string): string {
  return address.length <= 16 ? address : `${address.slice(0, 8)}…${address.slice(-4)}`;
}

/** Blockchains compatibles Ethereum lues pour une adresse 0x…, avec leur monnaie native (identifiant CoinGecko). */
export const EVM_CHAINS = [
  { key: "ethereum", name: "Ethereum", symbol: "ETH", coin: "Ethereum", coingeckoId: "ethereum" },
  { key: "base", name: "Base", symbol: "ETH", coin: "Ethereum", coingeckoId: "ethereum" },
  { key: "arbitrum", name: "Arbitrum", symbol: "ETH", coin: "Ethereum", coingeckoId: "ethereum" },
  { key: "optimism", name: "Optimism", symbol: "ETH", coin: "Ethereum", coingeckoId: "ethereum" },
  { key: "polygon", name: "Polygon", symbol: "POL", coin: "POL (ex-MATIC)", coingeckoId: "polygon-ecosystem-token" },
  { key: "bnb", name: "BNB Chain", symbol: "BNB", coin: "BNB", coingeckoId: "binancecoin" },
  { key: "avalanche", name: "Avalanche", symbol: "AVAX", coin: "Avalanche", coingeckoId: "avalanche-2" },
  { key: "gnosis", name: "Gnosis", symbol: "XDAI", coin: "XDAI", coingeckoId: "xdai" },
  { key: "linea", name: "Linea", symbol: "ETH", coin: "Ethereum", coingeckoId: "ethereum" },
] as const;
export type EvmChainKey = (typeof EVM_CHAINS)[number]["key"];

/** Un avoir lu à une adresse : `key` le distingue dans son portefeuille (chaîne et contrat), `place` dit où il est. */
export type Holding = { key: string; symbol: string; name: string; coingeckoId: string; quantity: number; place?: string };

/**
 * Montant entier d'une blockchain (wei, satoshis, lamports) ramené à ses unités, sans passer par un nombre trop
 * grand pour être exact : dix décimales gardées, comme la colonne des quantités.
 */
export function toUnits(raw: bigint, decimals: number): number {
  if (raw <= 0n) return 0;
  const keep = 10;
  const scaled = decimals > keep ? raw / 10n ** BigInt(decimals - keep) : raw * 10n ** BigInt(keep - decimals);
  const text = scaled.toString().padStart(keep + 1, "0");
  return Number(`${text.slice(0, -keep)}.${text.slice(-keep)}`);
}
