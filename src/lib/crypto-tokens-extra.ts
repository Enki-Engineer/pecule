/*
 * Jetons « dérivés » lus à une adresse publique en plus de la table fabriquée (crypto-tokens.ts) : ether mis en
 * staking liquide, bitcoin et ether enveloppés. Le classement de CoinGecko, d'où vient la table, les écarte, alors
 * qu'ils sont parmi les plus détenus. Tenus à la main : chaque contrat a été vérifié à part (même symbole et même
 * cours que son identifiant CoinGecko, chez DefiLlama). Un jeton que la table finit par porter se retire d'ici
 * (un test refuse le doublon).
 */

import { TOKENS, type TokenRow } from "./crypto-tokens.ts";

export const EXTRA_TOKENS: Record<string, readonly TokenRow[]> = {
  ethereum: [
    ["0xae7ab96520de3a18e5e111b5eaab095312d7fe84", "staked-ether", "STETH", "Lido Staked Ether"],
    ["0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0", "wrapped-steth", "WSTETH", "Wrapped stETH"],
    ["0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", "wrapped-bitcoin", "WBTC", "Wrapped Bitcoin"],
    ["0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "weth", "WETH", "WETH"],
    ["0xbe9895146f7af43049ca1c1ae358b0541ea49704", "coinbase-wrapped-staked-eth", "CBETH", "Coinbase Wrapped Staked ETH"],
    ["0xae78736cd615f374d3085123a210448e74fc6393", "rocket-pool-eth", "RETH", "Rocket Pool ETH"],
    ["0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee", "wrapped-eeth", "WEETH", "Wrapped eETH"],
    ["0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "coinbase-wrapped-btc", "CBBTC", "Coinbase Wrapped BTC"],
  ],
  base: [
    ["0x4200000000000000000000000000000000000006", "weth", "WETH", "WETH"],
    ["0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", "coinbase-wrapped-btc", "CBBTC", "Coinbase Wrapped BTC"],
    ["0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", "wrapped-steth", "WSTETH", "Wrapped stETH"],
    ["0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22", "coinbase-wrapped-staked-eth", "CBETH", "Coinbase Wrapped Staked ETH"],
  ],
  arbitrum: [
    ["0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "weth", "WETH", "WETH"],
    ["0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", "wrapped-bitcoin", "WBTC", "Wrapped Bitcoin"],
    ["0x5979d7b546e38e414f7e9822514be443a4800529", "wrapped-steth", "WSTETH", "Wrapped stETH"],
  ],
  optimism: [
    ["0x4200000000000000000000000000000000000006", "weth", "WETH", "WETH"],
    ["0x1f32b1c2345538c0c6f582fcb022739c4a194ebb", "wrapped-steth", "WSTETH", "Wrapped stETH"],
    ["0x68f180fcce6836688e9084f035309e29bf0a2095", "wrapped-bitcoin", "WBTC", "Wrapped Bitcoin"],
  ],
  polygon: [
    ["0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", "weth", "WETH", "WETH"],
    ["0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6", "wrapped-bitcoin", "WBTC", "Wrapped Bitcoin"],
  ],
  bnb: [
    ["0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", "wbnb", "WBNB", "Wrapped BNB"],
    ["0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c", "binance-bitcoin", "BTCB", "Binance Bitcoin"],
    ["0x2170ed0880ac9a755fd29b2688956bd959f933f8", "binance-peg-weth", "ETH", "Binance-Peg WETH"],
  ],
  avalanche: [["0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", "wrapped-avax", "WAVAX", "Wrapped AVAX"]],
  gnosis: [["0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1", "weth", "WETH", "WETH"]],
  linea: [["0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f", "weth", "WETH", "WETH"]],
  solana: [
    ["J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", "jito-staked-sol", "JITOSOL", "Jito Staked SOL"],
    ["mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", "msol", "MSOL", "Marinade Staked SOL"],
    ["So11111111111111111111111111111111111111112", "wrapped-solana", "SOL", "Solana"],
  ],
};

/** Jetons lus sur une chaîne : la table fabriquée, puis les dérivés tenus à la main (un contrat ne compte qu'une fois). */
export function tokensOf(chain: string): readonly TokenRow[] {
  const table = TOKENS[chain] ?? [];
  const known = new Set(table.map((row) => row[0]));
  return [...table, ...(EXTRA_TOKENS[chain] ?? []).filter((row) => !known.has(row[0]))];
}
