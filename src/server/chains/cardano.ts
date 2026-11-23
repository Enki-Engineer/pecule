/*
 * Cardano lu par une adresse publique, sans clé : API Koios. Un portefeuille Cardano change d'adresse, mais toutes
 * portent la même clé de staking : l'adresse collée (addr1…) donne l'adresse de staking (stake1…), dont le solde
 * est celui du portefeuille entier, récompenses comprises. Les jetons natifs ne sont pas lus.
 */

import { bech32 } from "@scure/base";
import { toUnits, type Holding } from "../../lib/crypto-chains.ts";
import { postJson } from "./http.ts";

const API = ["https://api.koios.rest/api/v1"];
const LIMIT = 200;

/** Octets d'une adresse Cardano du réseau principal, ou `null`. */
function decode(address: string): { prefix: string; bytes: Uint8Array } | null {
  try {
    const { prefix, words } = bech32.decode(address.toLowerCase() as `${string}1${string}`, LIMIT);
    const bytes = bech32.fromWords(words);
    // Le demi-octet de poids faible dit le réseau : 1 pour le réseau principal.
    return (prefix === "addr" || prefix === "stake") && (bytes[0] & 0x0f) === 1 ? { prefix, bytes } : null;
  } catch {
    return null;
  }
}

export const isCardanoAddress = (address: string) => decode(address) !== null;

/**
 * Adresse de staking d'une adresse Cardano : elle-même si c'en est une, celle que porte une adresse « de base »
 * (paiement + staking), ou `null` pour une adresse sans staking, qui se lit alors seule.
 */
export function stakeAddress(address: string): string | null {
  const d = decode(address);
  if (!d) return null;
  if (d.prefix === "stake") return address.toLowerCase();
  const kind = d.bytes[0] >> 4;
  if (kind > 3 || d.bytes.length !== 57) return null;
  // Genres 2 et 3 : la part de staking est un script, pas une clé.
  const header = (kind & 2 ? 0xf0 : 0xe0) | 1;
  return bech32.encode("stake", bech32.toWords(Uint8Array.from([header, ...d.bytes.slice(29)])), LIMIT);
}

/** Ce qui nomme le portefeuille : son adresse de staking, sinon l'adresse elle-même. */
export const cardanoAccount = (address: string) => stakeAddress(address) ?? address.toLowerCase();

export async function readCardano(account: string, post: typeof postJson = postJson) {
  if (!isCardanoAddress(account)) throw new Error("Adresse Cardano invalide");
  const staking = account.startsWith("stake");
  const rows = staking
    ? await post<{ total_balance?: string }[]>(API.map((u) => `${u}/account_info`), { _stake_addresses: [account] }, "Cardano")
    : await post<{ balance?: string }[]>(API.map((u) => `${u}/address_info`), { _addresses: [account] }, "Cardano");
  const row = rows[0] as { total_balance?: string; balance?: string } | undefined;
  const lovelace = BigInt(/^\d+$/.test(row?.total_balance ?? row?.balance ?? "") ? (row!.total_balance ?? row!.balance)! : "0");
  const holdings: Holding[] = lovelace > 0n ? [{ key: "ada", symbol: "ADA", name: "Cardano", coingeckoId: "cardano", quantity: toUnits(lovelace, 6) }] : [];
  return { holdings, note: `${toUnits(lovelace, 6)} ADA${staking ? ", récompenses comprises" : ""}` };
}
