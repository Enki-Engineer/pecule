/*
 * Portefeuille MultiversX lu par son adresse, sans clé (API publique) : EGLD disponibles, EGLD délégués (staking) et
 * jetons que l'API sait valoriser. Un jeton MultiversX n'est pas la crypto du même symbole ailleurs : il garde le
 * cours que donne l'API, jamais celui de CoinGecko.
 */

import { toUnits, type Holding } from "../../lib/crypto-chains.ts";
import { egldStaking, isMultiversXAddress } from "../multiversx.ts";
import { getJson } from "./http.ts";

const API = ["https://api.multiversx.com"];
/** En dessous, un jeton est une poussière ou un dépôt publicitaire : il n'est pas gardé. */
const MIN_USD = 0.01;

type Token = { identifier?: string; ticker?: string; name?: string; balance?: string; decimals?: number; price?: number; valueUsd?: number };

/**
 * `usdEur` : ce que vaut un dollar en euros (les cours de l'API sont en dollars) ; à zéro, les jetons restent sans
 * cours. `staking` : la lecture des EGLD délégués, donnée à part pour les essais.
 */
export async function readMultiversxWallet(address: string, usdEur: number, get: typeof getJson = getJson, staking: typeof egldStaking = egldStaking) {
  if (!isMultiversXAddress(address)) throw new Error("Adresse MultiversX invalide");
  const account = await get<{ balance?: string }>(API.map((u) => `${u}/accounts/${address}`), "MultiversX");
  const holdings: Holding[] = [];
  const liquid = BigInt(/^\d+$/.test(account.balance ?? "") ? account.balance! : "0");
  if (liquid > 0n) holdings.push({ key: "egld", symbol: "EGLD", name: "MultiversX", coingeckoId: "elrond-erd-2", quantity: toUnits(liquid, 18) });

  // Le reste ne doit pas empêcher de lire le solde : ce qui échoue garde ses lignes d'avant.
  const unread: string[] = [];
  const parts = [`${toUnits(liquid, 18)} EGLD`];
  await staking(address)
    .then((st) => {
      // La même clé que l'ancienne lecture du seul staking : une source convertie garde sa ligne.
      if (st.total > 0) holdings.push({ key: "elrond-erd-2", symbol: "EGLD", name: "MultiversX", coingeckoId: "elrond-erd-2", quantity: st.total, place: "staking" });
      if (st.total > 0) parts.push(`${st.total.toFixed(4)} EGLD délégués`);
    })
    .catch(() => unread.push("elrond-erd-2"));
  await get<Token[]>(API.map((u) => `${u}/accounts/${address}/tokens?size=500`), "MultiversX")
    .then((tokens) => {
      let kept = 0;
      for (const t of Array.isArray(tokens) ? tokens : []) {
        const symbol = (t.ticker ?? t.identifier ?? "").split("-")[0].toUpperCase();
        const raw = /^\d+$/.test(t.balance ?? "") ? BigInt(t.balance!) : 0n;
        if (!symbol || raw <= 0n || !(Number(t.price) > 0) || Number(t.valueUsd ?? 0) < MIN_USD) continue;
        kept++;
        holdings.push({ key: `token:${t.identifier}`, symbol: symbol.slice(0, 24), name: (t.name ?? symbol).slice(0, 80), coingeckoId: null, quantity: toUnits(raw, Number(t.decimals ?? 18)), priceEur: usdEur > 0 ? Number(t.price) * usdEur : undefined });
      }
      if (kept) parts.push(`${kept} jetons`);
    })
    .catch(() => unread.push("token:"));
  return { holdings, unread, note: parts.join(" · ") };
}
