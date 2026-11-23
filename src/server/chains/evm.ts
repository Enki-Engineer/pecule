/*
 * Adresse Ethereum (0x…) lue sur Ethereum et les blockchains compatibles, par des nœuds publics, sans clé :
 * la monnaie native de chaque chaîne et les jetons courants de la table (src/lib/crypto-tokens.ts). Un jeton hors
 * de la table n'est lu que là où un explorateur public liste les jetons de l'adresse, et seulement s'il a un cours
 * et une capitalisation connus — c'est ce qui écarte les jetons déposés sans demande.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { EVM_CHAINS, toUnits, type EvmChainKey, type Holding } from "../../lib/crypto-chains.ts";
import { tokensOf } from "../../lib/crypto-tokens-extra.ts";
import { getJson, pooled, rpcBatch } from "./http.ts";

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
/**
 * Explorateurs publics (Blockscout) qui listent tous les jetons d'une adresse, sans clé : ils trouvent ce que la
 * table ne connaît pas. Une chaîne sans explorateur, ou dont l'explorateur ne répond pas, se lit par la table seule.
 * N'y figurent que ceux qui répondent à un programme : ceux de Base, d'Arbitrum et de Polygon le refusent.
 */
const EXPLORERS: Partial<Record<EvmChainKey, string[]>> = {
  ethereum: ["https://eth.blockscout.com"],
  optimism: ["https://explorer.optimism.io"],
};
/** En dessous, un jeton trouvé par un explorateur est une poussière : il n'est pas gardé. */
const MIN_USD = 0.01;
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

/** VeChain n'est pas une chaîne compatible Ethereum, mais ses adresses ont la même forme : la même adresse y est lue aussi. */
const VECHAIN = ["https://mainnet.vechain.org", "https://sync-mainnet.vechain.org"];

/** VET et VTHO (le « gaz » que le VET produit) d'une adresse, sur VeChain. */
async function readVechain(address: string, get: typeof getJson): Promise<Holding[]> {
  const account = await get<{ balance?: string; energy?: string }>(VECHAIN.map((u) => `${u}/accounts/${address.toLowerCase()}`), "VeChain");
  const out: Holding[] = [];
  const vet = big(account.balance);
  const vtho = big(account.energy);
  if (vet > 0n) out.push({ key: "vechain:native", symbol: "VET", name: "VeChain", coingeckoId: "vechain", quantity: toUnits(vet, 18), place: "VeChain" });
  if (vtho > 0n) out.push({ key: "vechain:vtho", symbol: "VTHO", name: "VeThor", coingeckoId: "vethor-token", quantity: toUnits(vtho, 18), place: "VeChain" });
  return out;
}

const big = (hex: unknown) => (typeof hex === "string" && /^0x[0-9a-fA-F]+$/.test(hex) ? BigInt(hex) : 0n);

/** Monnaie native et jetons de la table détenus par l'adresse sur une chaîne. */
async function readChain(chain: (typeof EVM_CHAINS)[number], address: string, batch: typeof rpcBatch): Promise<Holding[]> {
  const urls = RPC[chain.key];
  const tokens = tokensOf(chain.key);
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

type Found = { token?: { address_hash?: string; symbol?: string | null; name?: string | null; decimals?: string | null; exchange_rate?: string | null; circulating_market_cap?: string | null; type?: string; reputation?: string | null }; value?: string | null };

/**
 * Jetons de l'adresse que la table ne connaît pas, trouvés par l'explorateur de la chaîne. N'est gardé qu'un jeton
 * au cours et à la capitalisation connus, que l'explorateur ne dit pas frauduleux, et qui vaut plus qu'une
 * poussière : un jeton déposé pour appâter n'a ni l'un ni l'autre. Son cours est celui de l'explorateur, en dollars.
 */
async function discover(chain: (typeof EVM_CHAINS)[number], urls: string[], address: string, usdEur: number, get: typeof getJson): Promise<Holding[]> {
  const known = new Set(tokensOf(chain.key).map(([contract]) => contract.toLowerCase()));
  const found = await get<Found[]>(urls.map((u) => `${u}/api/v2/addresses/${address}/token-balances`), chain.name);
  const out: Holding[] = [];
  for (const f of Array.isArray(found) ? found : []) {
    const token = f.token;
    const contract = (token?.address_hash ?? "").toLowerCase();
    const decimals = Number(token?.decimals);
    const rate = Number(token?.exchange_rate);
    const symbol = (token?.symbol ?? "").trim().toUpperCase();
    if (token?.type !== "ERC-20" || !/^0x[0-9a-f]{40}$/.test(contract) || known.has(contract) || token.reputation === "scam") continue;
    if (!/^[A-Z0-9.$-]{1,24}$/.test(symbol) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !(rate > 0) || !(Number(token.circulating_market_cap) > 0)) continue;
    const quantity = toUnits(/^\d+$/.test(f.value ?? "") ? BigInt(f.value!) : 0n, decimals);
    if (quantity * rate < MIN_USD) continue;
    out.push({ key: `${chain.key}+:${contract}`, symbol, name: (token.name ?? symbol).trim().slice(0, 80), coingeckoId: null, quantity, place: chain.name, priceEur: usdEur > 0 ? rate * usdEur : undefined });
  }
  return out;
}

/**
 * Tout ce que l'adresse détient, chaîne par chaîne. Une chaîne dont aucun nœud ne répond est rendue dans `unread`
 * (le début de la clé de ses lignes) : ses lignes d'avant sont gardées, le reste est à jour. Si aucune chaîne ne répond, la lecture échoue.
 */
export async function readEvmAddress(address: string, batch: typeof rpcBatch = rpcBatch, get: typeof getJson = getJson, usdEur = 0) {
  if (!isEvmAddress(address)) throw new Error("Adresse Ethereum invalide");
  type Chain = (typeof EVM_CHAINS)[number];
  const results = await pooled([...EVM_CHAINS], 3, async (chain): Promise<{ chain: Chain; holdings: Holding[]; error: string | null; rare: Holding[] | null }> => {
    // Les jetons hors de la table : cherchés à part, pour que leur explorateur n'empêche jamais de lire la chaîne.
    const explorer = EXPLORERS[chain.key];
    const rare = explorer ? discover(chain, explorer, address, usdEur, get).catch(() => null) : Promise.resolve<Holding[]>([]);
    try {
      return { chain, holdings: await readChain(chain, address, batch), error: null, rare: await rare };
    } catch (e) {
      return { chain, holdings: [], error: e instanceof Error ? e.message : String(e), rare: await rare };
    }
  });
  const failed = results.filter((r) => r.error !== null);
  if (failed.length === results.length) throw new Error(failed[0].error ?? "aucune chaîne lue");
  const holdings = results.flatMap((r) => [...r.holdings, ...(r.rare ?? [])]);
  // Un explorateur muet : les jetons qu'il avait trouvés gardent leur ligne d'avant.
  const silent = results.filter((r) => r.rare === null).map((r) => `${r.chain.key}+:`);
  const vechain = await readVechain(address, get).catch(() => null);
  if (vechain) holdings.push(...vechain);
  const chains = new Set(holdings.map((h) => h.place));
  return {
    holdings,
    unread: [...failed.map((r) => `${r.chain.key}:`), ...silent, ...(vechain ? [] : ["vechain:"])],
    note: `${holdings.length} lignes sur ${chains.size} chaînes${failed.length ? ` · non lues cette fois : ${failed.map((r) => r.chain.name).join(", ")}` : ""}`,
  };
}
