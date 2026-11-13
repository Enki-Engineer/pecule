import { exec, one, q } from "./db.ts";
import { isDemo, runReal } from "./demo-context.ts";
import { householdCurrency, today } from "./region.ts";
import { type Converted, isCurrency, parseEcbRates, roundMoney } from "../lib/currencies.ts";

/*
 * Cours de change : les cours de référence de la Banque centrale européenne (gratuits, sans clé, un par jour ouvré,
 * pivot euro), gardés dans `fx_rates` pour les seules devises dont le foyer se sert. Un montant en devise est
 * converti au cours de son jour (le dernier cours connu à cette date : un samedi prend celui du vendredi).
 * Convertir un montant déjà dans la devise voulue ne lit ni ne télécharge rien ; le passage quotidien, lui, tient à
 * jour le dollar (coût de l'IA, cours des cryptos) en plus des devises du foyer et de ses comptes.
 */

const BASE = "https://www.ecb.europa.eu/stats/eurofxref/";
const RECENT = "eurofxref-hist-90d.xml"; // les 90 derniers jours
const ALL = "eurofxref-hist.xml"; // tout l'historique depuis 1999
const COVERAGE_KEY = "fx:depuis";
const RETRY_MS = 3 * 3600_000;

/** Cours introuvable : devise non cotée, ou service injoignable alors qu'aucun cours n'est encore gardé. */
export class FxError extends Error {
  constructor(
    message: string,
    readonly currency: string,
    /** Devise que Pécule ne sait pas convertir (réessayer n'y changera rien). */
    readonly unsupported = false,
  ) {
    super(message);
  }
}

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

async function download(file: string) {
  const res = await fetch(BASE + file, { headers: { Accept: "application/xml", "User-Agent": "Mozilla/5.0 (Pecule)" }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Banque centrale européenne → HTTP ${res.status}`);
  const days = parseEcbRates(await res.text());
  if (!days.length) throw new Error("Banque centrale européenne : fichier de cours illisible");
  return days;
}

async function store(days: { date: string; rates: Record<string, number> }[], currencies: string[]) {
  const rows: [string, string, number][] = [];
  for (const d of days) for (const c of currencies) if (d.rates[c] > 0) rows.push([d.date, c, d.rates[c]]);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await exec(`INSERT INTO fx_rates (date, currency, rate) VALUES ${chunk.map(() => "(?, ?, ?)").join(", ")} ON DUPLICATE KEY UPDATE rate = VALUES(rate)`, chunk.flat());
  }
}

async function coverage(): Promise<Record<string, string>> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [COVERAGE_KEY]);
  try {
    return row ? (JSON.parse(row.value) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let queue: Promise<unknown> = Promise.resolve();
let lastRefreshTry = 0;
/** Dernier premier téléchargement en échec : on n'insiste pas tout de suite (le service ne répond pas). */
let lastFailure = 0;
const FAILURE_PAUSE_MS = 5 * 60_000;

/**
 * S'assure que les cours de ces devises sont gardés depuis `from` et jusqu'au dernier jour publié.
 * Les téléchargements passent un par un ; un échec de mise à jour n'empêche pas de convertir avec les cours gardés.
 */
export function ensureRates(currencies: string[], from: string): Promise<void> {
  const need = [...new Set(currencies)].filter((c) => c !== "EUR" && isCurrency(c));
  if (!need.length || isDemo()) return Promise.resolve();
  const job = queue.then(() =>
    runReal(async () => {
      // Une date à venir n'a pas de cours : on s'assure de ceux d'aujourd'hui.
      const day = today();
      const start = shift(from > day ? day : from, -10);
      const known = await coverage();
      const missing = need.filter((c) => !known[c] || known[c] > start);
      if (missing.length) {
        if (Date.now() - lastFailure < FAILURE_PAUSE_MS) throw new Error("Banque centrale européenne : service injoignable il y a un instant, nouvel essai dans quelques minutes");
        const days = await download(start >= shift(day, -80) ? RECENT : ALL).catch((e: unknown) => {
          lastFailure = Date.now();
          throw e;
        });
        await store(days.filter((d) => d.date >= start), missing);
        for (const c of missing) known[c] = start;
        await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [COVERAGE_KEY, JSON.stringify(known)]);
        return;
      }
      // Mise à jour : un fichier de 90 jours comble tout retard courant (essai au plus toutes les 3 h : rien ne paraît le week-end).
      const tracked = Object.keys(known).filter(isCurrency);
      const row = await one<{ last: string | null }>(
        `SELECT DATE_FORMAT(MIN(m), '%Y-%m-%d') AS last FROM (SELECT MAX(date) AS m FROM fx_rates WHERE currency IN (${tracked.map(() => "?").join(", ")}) GROUP BY currency) x`,
        tracked,
      );
      if (row?.last && row.last >= shift(today(), -1)) return;
      if (Date.now() - lastRefreshTry < RETRY_MS) return;
      lastRefreshTry = Date.now();
      try {
        const last = row?.last ?? start;
        const days = await download(last >= shift(today(), -80) ? RECENT : ALL);
        await store(days.filter((d) => d.date > last), tracked);
      } catch (e) {
        if (!row?.last) throw e;
        console.error("[cours de change] mise à jour impossible, derniers cours gardés", e);
      }
    }),
  );
  queue = job.catch(() => {});
  return job;
}

type Series = { dates: string[]; rates: number[] };

async function loadSeries(currencies: string[], from: string): Promise<Map<string, Series>> {
  const out = new Map<string, Series>();
  const wanted = currencies.filter((c) => c !== "EUR");
  if (!wanted.length) return out;
  const rows = await runReal(() =>
    q<{ currency: string; day: string; rate: number }>(
      `SELECT currency, DATE_FORMAT(date, '%Y-%m-%d') AS day, rate FROM fx_rates
       WHERE currency IN (${wanted.map(() => "?").join(", ")}) AND date >= ? ORDER BY currency, date`,
      [...wanted, from],
    ),
  );
  for (const r of rows) {
    let s = out.get(r.currency);
    if (!s) out.set(r.currency, (s = { dates: [], rates: [] }));
    s.dates.push(r.day);
    s.rates.push(Number(r.rate));
  }
  return out;
}

/** Cours de la devise pour 1 euro à une date : le dernier publié ce jour-là ou avant, sinon le premier connu. */
function rateOn(series: Map<string, Series>, currency: string, date: string): number | null {
  if (currency === "EUR") return 1;
  const s = series.get(currency);
  if (!s?.dates.length) return null;
  let lo = 0;
  let hi = s.dates.length - 1;
  if (date < s.dates[0]) return s.rates[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s.dates[mid] <= date) lo = mid;
    else hi = mid - 1;
  }
  return s.rates[lo];
}

export type Converter = (amount: number, currency: string, date: string) => Converted;

const same: Converter = (amount) => ({ amount, originalAmount: null, originalCurrency: null });

/** Cours croisés (combien de `to` pour 1 de la devise, à une date) pour ces devises, à partir de `from`. */
async function crossRates(currencies: string[], from: string, to: string): Promise<(currency: string, date: string) => number> {
  const unknown = [...currencies, to].find((c) => !isCurrency(c));
  if (unknown) throw new FxError(`Devise non prise en charge : ${unknown}`, unknown, true);
  const needed = [...new Set([...currencies, to])];
  try {
    await ensureRates(needed, from);
  } catch (e) {
    // Service injoignable : on convertit avec ce qui est gardé, s'il y a de quoi.
    console.error("[cours de change] lecture impossible", e);
  }
  const series = await loadSeries(needed, shift(from, -10));
  return (currency, date) => {
    const a = rateOn(series, currency, date);
    const b = rateOn(series, to, date);
    if (!a || !b) throw new FxError(`Cours de change introuvable pour ${!a ? currency : to} au ${date}`, !a ? currency : to);
    return b / a;
  };
}

/**
 * Prépare la conversion vers `to` (la devise du foyer par défaut) de montants écrits dans ces devises, datés
 * de `from` au plus tôt. Sans devise étrangère, rien n'est lu ni téléchargé.
 */
export async function fxConverter(currencies: string[], from: string, to: string = householdCurrency()): Promise<Converter> {
  const foreign = [...new Set(currencies)].filter((c) => c !== to);
  if (!foreign.length) return same;
  const rate = await crossRates(foreign, from, to);
  return (amount, currency, date) =>
    currency === to ? same(amount, currency, date) : { amount: roundMoney(amount * rate(currency, date), to), originalAmount: amount, originalCurrency: currency };
}

/** Cours du jour : combien de `to` pour 1 `from` (1 si la devise est la même). */
export async function fxRate(from: string, to: string = householdCurrency()): Promise<number> {
  if (from === to) return 1;
  const day = today();
  return (await crossRates([from], shift(day, -10), to))(from, day);
}

/** Devises suivies : celle du foyer, celles des comptes, et le dollar (coût de l'IA, cours des cryptos). */
export async function trackedCurrencies(): Promise<string[]> {
  const rows = await q<{ currency: string }>("SELECT DISTINCT currency FROM accounts");
  return [...new Set([householdCurrency(), "USD", ...rows.map((r) => r.currency)])].filter((c) => c !== "EUR" && isCurrency(c));
}

/**
 * Passage quotidien : cours à jour, puis soldes des comptes en devise ramenés à la devise du foyer au cours du jour
 * (le solde d'origine, lui, ne bouge qu'à la lecture de la banque).
 */
export async function refreshFx(): Promise<{ revalued: number }> {
  if (isDemo()) return { revalued: 0 };
  const home = householdCurrency();
  await ensureRates(await trackedCurrencies(), shift(today(), -10));
  const accounts = await q<{ id: string; currency: string; balance_original: number }>(
    "SELECT id, currency, balance_original FROM accounts WHERE currency <> ? AND balance_original IS NOT NULL",
    [home],
  );
  if (!accounts.length) return { revalued: 0 };
  const day = today();
  const convert = await fxConverter(accounts.map((a) => a.currency), shift(day, -10));
  let revalued = 0;
  for (const a of accounts) {
    try {
      const { amount } = convert(Number(a.balance_original), a.currency, day);
      const done = await exec("UPDATE accounts SET balance = ? WHERE id = ? AND (balance IS NULL OR balance <> ?)", [amount, a.id, amount]);
      revalued += done.affectedRows;
    } catch (e) {
      console.error("[cours de change] solde non converti", a.id, e);
    }
  }
  return { revalued };
}
