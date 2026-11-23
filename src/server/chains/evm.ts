/*
 * Adresse Ethereum (0x…) lue sur Ethereum et les blockchains compatibles, par des nœuds publics, sans clé :
 * la monnaie native de chaque chaîne et les jetons courants de la table (src/lib/crypto-tokens.ts). Un jeton hors
 * de la table n'est pas lu — c'est aussi ce qui écarte les jetons déposés sans demande.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { EVM_CHAINS, toUnits, type EvmChainKey, type Holding } from "../../lib/crypto-chains.ts";
import { TOKENS } from "../../lib/crypto-tokens.ts";
import { pooled, rpcBatch } from "./http.ts";

/** Nœuds publics de chaque chaîne, dans l'ordre d'essai. */
const RPC: Record<EvmChainKey, string[]> = {
  ethereum: ["https://ethereum-rpc.publicnode.com", "https://1rpc.io/eth", "https://cloudflare-eth.com"],
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://1rpc.io/base"],
  arbitrum: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc", "https://1rpc.io/arb"],
  optimism: ["https://optimism-rpc.publicnode.com", "https://mainnet.optimism.io", "https://1rpc.io/op"],
  polygon: ["https://polygon-bor.publicnode.com", "https://1rpc.io/matic"],
  bnb: ["https://bsc-rpc.publicnode.com", "https://bsc-dataseed.binance.org", "https://1rpc.io/bnb"],
  avalanche: ["https://avalanche-c-chain-rpc.publicnode.com", "https://api.avax.network/ext/bc/C/rpc", "https://1rpc.io/avax/c"],
  gnosis: ["https://gnosis-rpc.publicnode.com", "https://rpc.gnosischain.com", "https://1rpc.io/gnosis"],
  linea: ["https://linea-rpc.publicnode.com", "https://rpc.linea.build", "https://1rpc.io/linea"],
};
const BALANCE_OF = "0x70a08231";
const DECIMALS = "0x313ce567";
const CHUNK = 40;

/** Vrai pour une adresse 0x… ; écrite avec des majuscules, sa somme de contrôle (EIP-55) doit être juste. */
export function isEvmAddress(address: string): boolean {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return false;
  const hex = address.slice(2);
  if (hex === hex.toLowerCase() || hex === hex.toUpperCase()) return true;
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(hex.toLowerCase()))).toString("hex");
  return [...hex].every((c, i) => /\d/.test(c) || (parseInt(hash[i], 16) >= 8 ? c === c.toUpperCase() : c === c.toLowerCase()));
}

const big = (hex: unknown) => (typeof hex === "string" && /^0x[0-9a-fA-F]+$/.test(hex) ? BigInt(hex) : 0n);

/** Monnaie native et jetons de la table détenus par l'adresse sur une chaîne. */
async function readChain(chain: (typeof EVM_CHAINS)[number], address: string, batch: typeof rpcBatch): Promise<Holding[]> {
  const urls = RPC[chain.key];
  const tokens = TOKENS[chain.key] ?? [];
  const padded = address.slice(2).toLowerCase().padStart(64, "0");
  const calls = [
    { method: "eth_getBalance", params: [address, "latest"] },
    ...tokens.map(([contract]) => ({ method: "eth_call", params: [{ to: contract, data: `${BALANCE_OF}${padded}` }, "latest"] })),
  ];
  const replies: unknown[] = [];
  for (let i = 0; i < calls.length; i += CHUNK) replies.push(...(await batch(urls, calls.slice(i, i + CHUNK), chain.name)));

  const out: Holding[] = [];
  const native = big(replies[0]);
  if (native > 0n) out.push({ key: `${chain.key}:native`, symbol: chain.symbol, name: chain.coin, coingeckoId: chain.coingeckoId, quantity: toUnits(native, 18), place: chain.name });
  const held = tokens.map((token, i) => ({ token, raw: big(replies[i + 1]) })).filter((h) => h.raw > 0n);
  // Les décimales se demandent au contrat, pour les seuls jetons détenus.
  const decimals = await batch(urls, held.map((h) => ({ method: "eth_call", params: [{ to: h.token[0], data: DECIMALS }, "latest"] })), chain.name);
  held.forEach((h, i) => {
    const d = Number(big(decimals[i]));
    if (d > 36) return;
    const [contract, coingeckoId, symbol, name] = h.token;
    out.push({ key: `${chain.key}:${contract}`, symbol, name, coingeckoId, quantity: toUnits(h.raw, d), place: chain.name });
  });
  return out;
}

/**
 * Tout ce que l'adresse détient, chaîne par chaîne. Une chaîne dont aucun nœud ne répond est rendue dans `unread`
 * (le début de la clé de ses lignes) : ses lignes d'avant sont gardées, le reste est à jour. Si aucune chaîne ne répond, la lecture échoue.
 */
export async function readEvmAddress(address: string, batch: typeof rpcBatch = rpcBatch) {
  if (!isEvmAddress(address)) throw new Error("Adresse Ethereum invalide");
  type Chain = (typeof EVM_CHAINS)[number];
  const results = await pooled([...EVM_CHAINS], 3, async (chain): Promise<{ chain: Chain; holdings: Holding[]; error: string | null }> => {
    try {
      return { chain, holdings: await readChain(chain, address, batch), error: null };
    } catch (e) {
      return { chain, holdings: [], error: e instanceof Error ? e.message : String(e) };
    }
  });
  const failed = results.filter((r) => r.error !== null);
  if (failed.length === results.length) throw new Error(failed[0].error ?? "aucune chaîne lue");
  const holdings = results.flatMap((r) => r.holdings);
  const chains = new Set(holdings.map((h) => h.place));
  return {
    holdings,
    unread: failed.map((r) => `${r.chain.key}:`),
    note: `${holdings.length} lignes sur ${chains.size} chaînes${failed.length ? ` · non lues cette fois : ${failed.map((r) => r.chain.name).join(", ")}` : ""}`,
  };
}
