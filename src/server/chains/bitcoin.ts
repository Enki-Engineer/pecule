/*
 * Bitcoin lu par une adresse publique ou par la clé publique étendue d'un compte (xpub, ypub, zpub : ce que donnent
 * Ledger et Trezor). Lecture seule, sans clé d'API : blockchain.info, qui rend les soldes de vingt adresses en une
 * requête ; en secours l'API Esplora (blockstream.info, mempool.space), adresse par adresse et sans hâte — ces
 * services coupent l'accès à qui les interroge en rafale.
 * Une clé étendue ne permet pas de dépenser ; elle donne toutes les adresses du compte, que le serveur dérive
 * lui-même (BIP32) pour ne demander au réseau que des soldes d'adresses.
 */

import { HDKey } from "@scure/bip32";
import { bech32, bech32m, createBase58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { schnorr, secp256k1 } from "@noble/curves/secp256k1.js";
import { toUnits, type Holding } from "../../lib/crypto-chains.ts";
import { getJson, wait } from "./http.ts";

const base58check = createBase58check(sha256);
const hash160 = (bytes: Uint8Array) => ripemd160(sha256(bytes));
const ESPLORA = ["https://blockstream.info/api", "https://mempool.space/api"];

/** Formes d'adresse d'un compte : ancienne (1…), SegWit emboîté (3…), SegWit natif (bc1q…), Taproot (bc1p…). */
export type Script = "p2pkh" | "p2sh-p2wpkh" | "p2wpkh" | "p2tr";
const SCRIPT_NAMES: Record<Script, string> = { p2pkh: "Legacy", "p2sh-p2wpkh": "SegWit", p2wpkh: "Native SegWit", p2tr: "Taproot" };

/** Préfixes des clés étendues : celui d'une ypub ou d'une zpub dit la forme d'adresse, celui d'une xpub ne dit rien. */
const VERSIONS: Record<string, Script[]> = {
  "0488b21e": ["p2wpkh", "p2sh-p2wpkh", "p2pkh", "p2tr"],
  "049d7cb2": ["p2sh-p2wpkh"],
  "04b24746": ["p2wpkh"],
};
const XPUB = Uint8Array.from([0x04, 0x88, 0xb2, 0x1e]);
const GAP = 20;

/** Vrai pour une adresse Bitcoin du réseau principal, somme de contrôle comprise. */
export function isBitcoinAddress(address: string): boolean {
  try {
    if (/^bc1/i.test(address)) {
      const lower = address.toLowerCase();
      // SegWit version 0 : bech32 ; versions suivantes (Taproot) : bech32m.
      for (const codec of [bech32, bech32m]) {
        const decoded = codec.decodeUnsafe(lower as `${string}1${string}`);
        if (!decoded || decoded.prefix !== "bc") continue;
        const [version, ...words] = decoded.words;
        const program = codec.fromWords(words);
        if (codec === bech32) return version === 0 && (program.length === 20 || program.length === 32);
        return version >= 1 && version <= 16 && program.length >= 2 && program.length <= 40;
      }
      return false;
    }
    const raw = base58check.decode(address);
    return raw.length === 21 && (raw[0] === 0x00 || raw[0] === 0x05);
  } catch {
    return false;
  }
}

/** Clé étendue lue : le compte, et les formes d'adresse à essayer. Rend `null` si ce n'en est pas une. */
export function parseXpub(xpub: string): { account: HDKey; scripts: Script[] } | null {
  try {
    const raw = base58check.decode(xpub.trim());
    if (raw.length !== 78) return null;
    const scripts = VERSIONS[Buffer.from(raw.slice(0, 4)).toString("hex")];
    if (!scripts) return null;
    const account = HDKey.fromExtendedKey(base58check.encode(Uint8Array.from([...XPUB, ...raw.slice(4)])));
    return account.publicKey ? { account, scripts } : null;
  } catch {
    return null;
  }
}

/** Adresse d'une clé publique compressée, dans la forme demandée. */
export function addressOf(publicKey: Uint8Array, script: Script): string {
  if (script === "p2pkh") return base58check.encode(Uint8Array.from([0x00, ...hash160(publicKey)]));
  if (script === "p2sh-p2wpkh") return base58check.encode(Uint8Array.from([0x05, ...hash160(Uint8Array.from([0x00, 0x14, ...hash160(publicKey)]))]));
  if (script === "p2wpkh") return bech32.encode("bc", [0, ...bech32.toWords(hash160(publicKey))]);
  // Taproot (BIP86) : la clé est ajustée par l'empreinte d'elle-même, sans arbre de scripts.
  const x = publicKey.slice(1);
  const tweak = BigInt(`0x${Buffer.from(schnorr.utils.taggedHash("TapTweak", x)).toString("hex")}`);
  const output = schnorr.utils.lift_x(BigInt(`0x${Buffer.from(x).toString("hex")}`)).add(secp256k1.Point.BASE.multiply(tweak));
  return bech32m.encode("bc", [1, ...bech32m.toWords(schnorr.utils.pointToBytes(output))]);
}

/** Adresse n° `index` d'un compte : `chain` 0 pour les adresses de réception, 1 pour la monnaie rendue. */
export function derivedAddress(account: HDKey, script: Script, chain: 0 | 1, index: number): string {
  const key = account.deriveChild(chain).deriveChild(index).publicKey;
  if (!key) throw new Error("Clé publique introuvable");
  return addressOf(key, script);
}

type Stats = { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
type AddressInfo = { chain_stats: Stats; mempool_stats: Stats };
export type Balance = { sats: bigint; used: boolean };

/** Solde (en satoshis, opérations en attente comprises) d'une adresse, et si elle a déjà servi : API Esplora. */
async function esplora(address: string): Promise<Balance> {
  const info = await getJson<AddressInfo>(ESPLORA.map((h) => `${h}/address/${address}`), "Bitcoin");
  const net = (s: Stats) => BigInt(s.funded_txo_sum) - BigInt(s.spent_txo_sum);
  return { sats: net(info.chain_stats) + net(info.mempool_stats), used: info.chain_stats.tx_count + info.mempool_stats.tx_count > 0 };
}

/** Soldes de quelques adresses (vingt au plus), dans l'ordre : une requête, sinon une par adresse, espacées. */
export async function balances(addresses: string[]): Promise<Balance[]> {
  try {
    const data = await getJson<Record<string, { final_balance: number; n_tx: number }>>([`https://blockchain.info/balance?active=${addresses.join("|")}`], "Bitcoin");
    return addresses.map((a) => {
      const row = data[a];
      if (!row || typeof row.final_balance !== "number") throw new Error("réponse incomplète");
      return { sats: BigInt(row.final_balance), used: row.n_tx > 0 };
    });
  } catch {
    const out: Balance[] = [];
    for (const a of addresses) {
      if (out.length) await wait(300);
      out.push(await esplora(a));
    }
    return out;
  }
}

const holding = (sats: bigint): Holding[] => (sats > 0n ? [{ key: "btc", symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", quantity: toUnits(sats, 8) }] : []);

export async function readBitcoinAddress(address: string, read: typeof balances = balances) {
  if (!isBitcoinAddress(address)) throw new Error("Adresse Bitcoin invalide");
  const [{ sats }] = await read([address]);
  return { holdings: holding(sats), note: `${toUnits(sats, 8)} BTC` };
}

/**
 * Suite des adresses d'une chaîne du compte, lue jusqu'à vingt adresses de suite jamais servies (la règle des
 * portefeuilles : au-delà, rien n'a pu être reçu). Rend le solde et le nombre d'adresses qui ont servi.
 */
async function scanChain(account: HDKey, script: Script, chain: 0 | 1, read: typeof balances): Promise<{ sats: bigint; used: number }> {
  let sats = 0n;
  let used = 0;
  let unused = 0;
  for (let from = 0; unused < GAP; from += GAP) {
    if (from) await wait(200);
    const batch = await read(Array.from({ length: GAP }, (_, i) => derivedAddress(account, script, chain, from + i)));
    for (const a of batch) {
      if (a.used) {
        used++;
        unused = 0;
        sats += a.sats;
      } else unused++;
    }
    // Garde-fou : un compte de plus de deux mille adresses par chaîne n'est pas un portefeuille de particulier.
    if (from >= 2000) throw new Error("Compte Bitcoin trop grand pour être lu");
  }
  return { sats, used };
}

/**
 * Solde d'un compte par sa clé étendue. Une xpub ne dit pas la forme de ses adresses (Ledger donne « xpub » pour
 * toutes) : chaque forme est essayée, et la monnaie rendue n'est cherchée que là où des adresses ont servi.
 */
export async function readBitcoinXpub(xpub: string, read: typeof balances = balances) {
  const parsed = parseXpub(xpub);
  if (!parsed) throw new Error("Clé publique étendue Bitcoin invalide");
  let sats = 0n;
  let used = 0;
  const forms: string[] = [];
  for (const script of parsed.scripts) {
    const received = await scanChain(parsed.account, script, 0, read);
    if (!received.used) continue;
    const change = await scanChain(parsed.account, script, 1, read);
    sats += received.sats + change.sats;
    used += received.used + change.used;
    forms.push(SCRIPT_NAMES[script]);
  }
  return { holdings: holding(sats), note: used ? `${toUnits(sats, 8)} BTC · ${used} adresses (${forms.join(", ")})` : "aucune adresse utilisée" };
}
