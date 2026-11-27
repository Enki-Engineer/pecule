/*
 * Lecture d'un compte d'exchange, ramenée aux avoirs que Pécule sait valoriser : une crypto reconnue par son symbole
 * suit le cours de CoinGecko (src/lib/crypto-tokens.ts) ; le cours que donne l'exchange lui-même sert de contrôle,
 * et de cours pour ce que la table ne connaît pas ; une monnaie (euro, dollar) vaut son cours de change.
 */

import { EXCHANGES, holdingsOf, type ExchangeId } from "../../lib/crypto-exchanges.ts";
import { SYMBOLS } from "../../lib/crypto-tokens.ts";
import { isCurrency } from "../../lib/currencies.ts";
import { fxRate } from "../fx.ts";
import { readBinance } from "./binance.ts";
import { readBitfinex } from "./bitfinex.ts";
import { readBitget } from "./bitget.ts";
import { readBitvavo } from "./bitvavo.ts";
import { readBybit } from "./bybit.ts";
import { readCryptocom } from "./cryptocom.ts";
import { readKucoin } from "./kucoin.ts";
import { readOkx } from "./okx.ts";
import { readBitpanda } from "./bitpanda.ts";
import { readCoinbase } from "./coinbase.ts";
import { readKraken, readKrakenLedger } from "./kraken.ts";
import type { LedgerEntry } from "../../lib/crypto-ledger.ts";
import type { Credentials, ExchangeReading } from "./http.ts";

export { ExchangeError } from "./http.ts";
export type { Credentials } from "./http.ts";

const READERS: Record<ExchangeId, (creds: Credentials) => Promise<ExchangeReading>> = {
  kraken: readKraken,
  binance: readBinance,
  coinbase: readCoinbase,
  bitpanda: readBitpanda,
  bitvavo: readBitvavo,
  okx: readOkx,
  bybit: readBybit,
  kucoin: readKucoin,
  bitget: readBitget,
  bitfinex: readBitfinex,
  cryptocom: readCryptocom,
};
/** Cours en euros des monnaies du compte (euro, dollar…) ; une monnaie dont le cours manque reste sans valeur. */
async function fiatRates(symbols: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const symbol of new Set(symbols.filter(isCurrency))) out[symbol] = await fxRate(symbol, "EUR").catch(() => 0);
  return out;
}

export async function readExchange(id: ExchangeId, creds: Credentials) {
  const reading = await READERS[id](creds);
  const holdings = holdingsOf(reading.balances, reading.pricesEur, SYMBOLS, await fiatRates(reading.balances.map((b) => b.symbol)));
  return { holdings, note: `${EXCHANGES[id].name} · ${reading.note}`, unread: reading.unread };
}

/**
 * Exchanges dont Pécule sait lire le registre (les écritures du compte), quand la clé en a le droit : de quoi dater
 * et chiffrer un achat ou une vente qu'il a vus dans les soldes. Lecture seule, comme le reste.
 */
const HISTORY: Partial<Record<ExchangeId, (creds: Credentials, since: Date) => Promise<LedgerEntry[] | null>>> = { kraken: readKrakenLedger };

/** Écritures du registre d'un compte depuis un instant ; `null` si l'exchange n'est pas de ceux-là, ou si la clé n'en a pas le droit. */
export const readExchangeHistory = async (id: ExchangeId, creds: Credentials, since: Date): Promise<LedgerEntry[] | null> => (await HISTORY[id]?.(creds, since)) ?? null;
