// Table des jetons que Pécule sait lire à une adresse publique, et des symboles qu'il sait valoriser dans un compte
// d'exchange (src/lib/crypto-tokens.ts).
// Pour chaque blockchain suivie, les jetons les mieux capitalisés qui y ont un contrat, avec leur identifiant
// CoinGecko : un jeton lu est donc toujours valorisé, et un jeton indésirable déposé sans demande n'est jamais vu.
// Source : CoinGecko (liste des contrats par plateforme, classement par capitalisation). Aucune clé n'est demandée.
// Usage : node scripts/jetons-crypto.mjs [--par-chaine 120] [--rangs 500]
// À relancer de temps en temps (un jeton qui entre dans le classement n'est lu qu'après).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage : node scripts/jetons-crypto.mjs [--par-chaine 120] [--rangs 500]\nRéécrit src/lib/crypto-tokens.ts depuis CoinGecko.");
  process.exit(0);
}
const opt = (name, def) => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : def);
const PER_CHAIN = opt("--par-chaine", 120);
const RANKS = opt("--rangs", 500);

/** Clé de la chaîne dans Pécule (src/lib/crypto-chains.ts) → plateforme de CoinGecko. */
const PLATFORMS = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum-one",
  optimism: "optimistic-ethereum",
  polygon: "polygon-pos",
  bnb: "binance-smart-chain",
  avalanche: "avalanche",
  gnosis: "xdai",
  linea: "linea",
  solana: "solana",
};
/** Jetons écartés de la table : leur nom heurte par hasard le garde-fou du dépôt (scripts/garde-fou.mjs). */
const EXCLUS = new Set(["impossible-cloud-network-token"]);
const EVM = /^0x[0-9a-f]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Adresses de convention (monnaie native, précompilés) : la monnaie native est lue à part, on ne la compterait deux fois.
const PLACEHOLDER = /^0x(0{40}|e{40}|0{36}[0-9a-f]{4})$/;

async function get(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Pecule (table des jetons)" } });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 20_000));
      continue;
    }
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
    return res.json();
  }
}

/** Les symboles sont pris plus loin dans le classement que les contrats : un exchange ou un export cite aussi de petites cryptos. */
const SYMBOL_RANKS = RANKS * 2;
const ranked = [];
for (let page = 1; ranked.length < SYMBOL_RANKS; page++) {
  const rows = await get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=eur&order=market_cap_desc&per_page=250&page=${page}`);
  if (!rows.length) break;
  ranked.push(...rows);
}
const rank = new Map(ranked.slice(0, RANKS).map((c, i) => [c.id, i]));
const list = await get("https://api.coingecko.com/api/v3/coins/list?include_platform=true");

const out = {};
for (const [chain, platform] of Object.entries(PLATFORMS)) {
  const seen = new Set();
  out[chain] = list
    .filter((c) => rank.has(c.id) && !EXCLUS.has(c.id) && c.platforms?.[platform])
    .map((c) => ({ address: chain === "solana" ? c.platforms[platform] : c.platforms[platform].toLowerCase(), id: c.id, symbol: c.symbol.toUpperCase(), name: c.name, rank: rank.get(c.id) }))
    .filter((c) => (chain === "solana" ? SOLANA.test(c.address) : EVM.test(c.address) && !PLACEHOLDER.test(c.address)))
    .filter((c) => c.symbol.length <= 24 && c.name.length <= 80 && /^[a-z0-9-]+$/.test(c.id))
    .sort((a, b) => a.rank - b.rank)
    .filter((c) => (seen.has(c.address) ? false : (seen.add(c.address), true)))
    .slice(0, PER_CHAIN);
}

// Symbole → cours : pour un exchange, qui ne donne qu'un symbole. Le mieux capitalisé l'emporte quand deux cryptos
// portent le même symbole ; c'est presque toujours celle que les exchanges cotent.
const symbols = new Map();
for (const c of ranked.slice(0, SYMBOL_RANKS)) {
  const symbol = String(c.symbol ?? "").toUpperCase();
  if (!/^[A-Z0-9]{1,24}$/.test(symbol) || EXCLUS.has(c.id) || !/^[a-z0-9-]+$/.test(c.id) || symbols.has(symbol)) continue;
  symbols.set(symbol, [c.id, String(c.name).slice(0, 80)]);
}

const lines = [
  "/*",
  " * Jetons lus à une adresse publique, par blockchain : contrat, identifiant CoinGecko, symbole, nom ;",
  " * et cryptos reconnues par leur symbole dans un compte d'exchange.",
  " * Fichier fabriqué par `node scripts/jetons-crypto.mjs` (source : CoinGecko) — ne pas le retoucher à la main.",
  " */",
  "",
  "export type TokenRow = readonly [address: string, coingeckoId: string, symbol: string, name: string];",
  "",
  "export const TOKENS: Record<string, readonly TokenRow[]> = {",
];
for (const [chain, rows] of Object.entries(out)) {
  lines.push(`  ${chain}: [`);
  for (const r of rows) lines.push(`    [${JSON.stringify(r.address)}, ${JSON.stringify(r.id)}, ${JSON.stringify(r.symbol)}, ${JSON.stringify(r.name)}],`);
  lines.push("  ],");
}
lines.push("};", "");
lines.push("/** Cryptos les mieux capitalisées, par symbole : identifiant CoinGecko et nom (lecture d'un compte d'exchange). */");
lines.push("export const SYMBOLS: Record<string, readonly [coingeckoId: string, name: string]> = {");
for (const [symbol, [id, name]] of symbols) lines.push(`  ${JSON.stringify(symbol)}: [${JSON.stringify(id)}, ${JSON.stringify(name)}],`);
lines.push("};", "");
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "crypto-tokens.ts");
writeFileSync(file, lines.join("\n"));
console.log(`${Object.entries(out).map(([k, v]) => `${k} : ${v.length}`).join(" · ")} · symboles : ${symbols.size}`);
