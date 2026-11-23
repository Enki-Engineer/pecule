/*
 * Jetons « dérivés » lus à une adresse publique en plus de la table fabriquée (crypto-tokens.ts) : les versions
 * pontées, sur les autres chaînes, de l'ether et du bitcoin enveloppés et de l'ether en staking liquide. CoinGecko
 * les range sous d'autres identifiants que le jeton d'origine, et la table ne les trouve pas. Tenus à la main :
 * chaque contrat a été vérifié à part (même symbole et même cours que son identifiant CoinGecko, chez DefiLlama).
 * Un jeton que la table finit par porter se retire d'ici (un test refuse le doublon).
 */

import { TOKENS, type TokenRow } from "./crypto-tokens.ts";

export const EXTRA_TOKENS: Record<string, readonly TokenRow[]> = {
  base: [
    ["0x4200000000000000000000000000000000000006", "weth", "WETH", "WETH"],
    ["0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", "wrapped-steth", "WSTETH", "Wrapped stETH"],
  ],
  arbitrum: [
    ["0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "weth", "WETH", "WETH"],
    ["0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", "wrapped-bitcoin", "WBTC", "Wrapped Bitcoin"],
    ["0x5979d7b546e38e414f7e9822514be443a4800529", "wrapped-steth", "WSTETH", "Wrapped stETH"],
  ],
  optimism: [
    ["0x4200000000000000000000000000000000000006", "weth", "WETH", "WETH"],
    ["0x1f32b1c2345538c0c6f582fcb022739c4a194ebb", "wrapped-steth", "WSTETH", "Wrapped stETH"],
  ],
  polygon: [
    ["0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", "weth", "WETH", "WETH"],
    ["0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", "wrapped-bitcoin", "WBTC", "Wrapped Bitcoin"],
  ],
  bnb: [
    ["0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", "binance-bitcoin", "BTCB", "Binance Bitcoin"],
    ["0x2170ed0880ac9a755fd29b2688956bd959f933f8", "binance-peg-weth", "ETH", "Binance-Peg WETH"],
  ],
  gnosis: [["0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1", "weth", "WETH", "WETH"]],
  linea: [["0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f", "weth", "WETH", "WETH"]],
};

/** Jetons lus sur une chaîne : la table fabriquée, puis les dérivés tenus à la main (un contrat ne compte qu'une fois). */
export function tokensOf(chain: string): readonly TokenRow[] {
  const table = TOKENS[chain] ?? [];
  const known = new Set(table.map((row) => row[0]));
  return [...table, ...(EXTRA_TOKENS[chain] ?? []).filter((row) => !known.has(row[0]))];
}
