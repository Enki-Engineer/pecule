/*
 * Adresse Solana lue par un nœud public, sans clé : SOL du portefeuille, SOL mis en staking (comptes de staking dont
 * l'adresse peut retirer les fonds) et jetons courants de la table (src/lib/crypto-tokens.ts).
 */

import { base58 } from "@scure/base";
import { toUnits, type Holding } from "../../lib/crypto-chains.ts";
import { tokensOf } from "../../lib/crypto-tokens-extra.ts";
import { rpcBatch, wait } from "./http.ts";

/** Le nœud public de Solana : le seul qui réponde sans clé à ces demandes. Il limite chaque genre d'appel. */
const RPC = ["https://api.mainnet-beta.solana.com"];
const TOKEN_PROGRAMS = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
const STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";
/** Place, dans un compte de staking, de l'adresse autorisée à retirer les fonds. */
const WITHDRAWER_OFFSET = 44;

/** Vrai pour une adresse Solana : trente-deux octets écrits en base 58. */
export function isSolanaAddress(address: string): boolean {
  try {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address) && base58.decode(address).length === 32;
  } catch {
    return false;
  }
}

type TokenAccounts = { value: { account: { data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } } } }[] };

export async function readSolanaAddress(address: string, batch: typeof rpcBatch = rpcBatch) {
  if (!isSolanaAddress(address)) throw new Error("Adresse Solana invalide");
  // Un appel à la fois, espacés : le nœud refuse plusieurs demandes du même genre dans un lot.
  const call = async <T>(method: string, params: unknown[]) => {
    const [result] = await batch(RPC, [{ method, params }], "Solana");
    await wait(400);
    return result as T;
  };
  const balance = await call<{ value: number }>("getBalance", [address]);
  const accounts: TokenAccounts[] = [await call<TokenAccounts>("getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAMS[0] }, { encoding: "jsonParsed" }])];
  const unread: string[] = [];
  // Ce qui suit ne doit pas empêcher de lire le reste : ce qui n'a pas été lu garde ses lignes d'avant.
  await call<TokenAccounts>("getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAMS[1] }, { encoding: "jsonParsed" }])
    .then((list) => accounts.push(list))
    .catch(() => unread.push("sol:token:"));
  const staked = await call<{ account: { lamports: number } }[]>("getProgramAccounts", [STAKE_PROGRAM, { encoding: "base64", dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: WITHDRAWER_OFFSET, bytes: address } }] }])
    .then((list) => list.reduce((sum, a) => sum + BigInt(a.account.lamports), 0n))
    .catch(() => null);
  if (staked === null) unread.push("sol:stake");

  // Deux lignes : le staking qu'un nœud refuse de lire une fois garde sa valeur d'avant, sans toucher au portefeuille.
  const wallet = BigInt(balance.value);
  const holdings: Holding[] = [];
  if (wallet > 0n) holdings.push({ key: "sol:native", symbol: "SOL", name: "Solana", coingeckoId: "solana", quantity: toUnits(wallet, 9) });
  if (staked) holdings.push({ key: "sol:stake", symbol: "SOL", name: "Solana", coingeckoId: "solana", quantity: toUnits(staked, 9), place: "staking" });
  const table = new Map(tokensOf("solana").map((row) => [row[0], row]));
  const byMint = new Map<string, { raw: bigint; decimals: number }>();
  for (const list of accounts)
    for (const { account } of list.value) {
      const { mint, tokenAmount } = account.data.parsed.info;
      if (!table.has(mint)) continue;
      const seen = byMint.get(mint);
      byMint.set(mint, { raw: (seen?.raw ?? 0n) + BigInt(tokenAmount.amount), decimals: tokenAmount.decimals });
    }
  for (const [mint, { raw, decimals }] of byMint) {
    if (raw <= 0n) continue;
    const [, coingeckoId, symbol, name] = table.get(mint)!;
    holdings.push({ key: `sol:token:${mint}`, symbol, name, coingeckoId, quantity: toUnits(raw, decimals) });
  }
  const parts = [`${toUnits(wallet, 9)} SOL`];
  if (staked) parts.push(`${toUnits(staked, 9)} SOL en staking`);
  if (staked === null) parts.push("staking non lu cette fois");
  return { holdings, unread, note: parts.join(" · ") };
}
