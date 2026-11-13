import { today } from "./region.ts";
import { isDemo } from "./demo-context.ts";
import { exec, one, q } from "./db.ts";
import { recordAlert } from "./journal.ts";
import { summarizeLoan, type ScheduleRow } from "../lib/loans.ts";
import { accountShare, assetValue, r2, valueCrypto } from "../lib/wealth.ts";
import { serviceKey } from "./service-keys.ts";
import { fxRate } from "./fx.ts";
import { isCurrency } from "../lib/currencies.ts";

/* ---------- Cours (CoinGecko pour la crypto, Yahoo Finance pour les titres cotés) ---------- */

/**
 * Les cours sont gardés en euros : pour valoriser dans la devise du foyer, on les multiplie par le cours du jour
 * (1 pour un foyer en euros, sans rien lire).
 */
export const priceFactor = (): Promise<number> => fxRate("EUR");

async function fetchJson(url: string, extraHeaders: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Pecule)", Accept: "application/json", ...extraHeaders }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} → HTTP ${res.status}`);
  return res.json();
}

/** Met à jour les cours utilisés par les positions et les placements cotés. */
export async function refreshPrices(): Promise<{ updated: number; errors: string[] }> {
  const errors: string[] = [];
  let updated = 0;
  const ids = (await q<{ id: string }>("SELECT DISTINCT coingecko_id AS id FROM crypto_positions WHERE coingecko_id IS NOT NULL AND archived_at IS NULL")).map((r) => r.id);
  if (ids.length) {
    try {
      const data = (await fetchJson(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=eur&include_24hr_change=true`,
        // Clé Demo : 10 000 appels/mois, au lieu de la limite par IP partagée du mutualisé.
        serviceKey("coingecko") ? { "x-cg-demo-api-key": serviceKey("coingecko")! } : {},
      )) as Record<string, { eur?: number; eur_24h_change?: number }>;
      for (const [id, p] of Object.entries(data)) {
        if (typeof p.eur !== "number") continue;
        await exec(
          "INSERT INTO prices (id, price_eur, change_24h) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE price_eur = VALUES(price_eur), change_24h = VALUES(change_24h), updated_at = UTC_TIMESTAMP()",
          [`cg:${id}`, p.eur, p.eur_24h_change ?? null],
        );
        updated++;
      }
    } catch (e) {
      errors.push(String(e));
    }
  }
  const tickers = (await q<{ ticker: string }>("SELECT DISTINCT ticker FROM assets WHERE valuation = 'cotation' AND ticker IS NOT NULL")).map((r) => r.ticker);
  for (const t of tickers) {
    try {
      const data = (await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(t)}?range=5d&interval=1d`)) as {
        chart: { result?: { meta: { regularMarketPrice?: number; chartPreviousClose?: number; currency?: string } }[] };
      };
      const meta = data.chart.result?.[0]?.meta;
      if (!meta?.regularMarketPrice || !meta.currency) throw new Error(`${t} : cours introuvable`);
      // Les cours sont gardés en euros (le pivot) : un titre coté dans une autre devise est converti au cours du jour.
      // La Bourse de Londres cote en pence (« GBp ») : cent pence pour une livre.
      const pence = meta.currency === "GBp" || meta.currency === "GBX";
      const quoted = pence ? "GBP" : meta.currency.toUpperCase();
      if (!isCurrency(quoted)) throw new Error(`${t} : coté en ${meta.currency}, une devise que Pécule ne sait pas convertir`);
      const priceEur = (meta.regularMarketPrice / (pence ? 100 : 1)) * (await fxRate(quoted, "EUR"));
      const change = meta.chartPreviousClose ? ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100 : null;
      await exec(
        "INSERT INTO prices (id, price_eur, change_24h) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE price_eur = VALUES(price_eur), change_24h = VALUES(change_24h), updated_at = UTC_TIMESTAMP()",
        [`yf:${t}`, priceEur, change],
      );
      updated++;
    } catch (e) {
      errors.push(String(e));
    }
  }
  return { updated, errors };
}

let refreshing: Promise<unknown> | null = null;

/**
 * Cours de plus de 2 h : on les rafraîchit et on attend le résultat (8 s au plus), pour que
 * Patrimoine et Crypto affichent la même valeur au même moment.
 */
export async function ensureFreshPrices(maxAgeMinutes = 120) {
  if (isDemo()) return; // démo : cours fictifs, aucun appel extérieur
  const row = await one<{ age: number | null }>("SELECT TIMESTAMPDIFF(MINUTE, MAX(updated_at), UTC_TIMESTAMP()) AS age FROM prices WHERE id NOT LIKE 'cs:%' AND id NOT LIKE 'fx:%'");
  if (row?.age != null && row.age <= maxAgeMinutes) return;
  refreshing ??= refreshPrices()
    .then(async (r) => {
      if (r.errors.length) await recordPriceErrors(r.errors);
    })
    .catch((e) => recordAlert("cours", `Mise à jour des cours impossible : ${e instanceof Error ? e.message : String(e)}`, e))
    .finally(() => {
      refreshing = null;
    });
  await Promise.race([refreshing, new Promise((resolve) => setTimeout(resolve, 8000))]);
}

/* ---------- Calcul du patrimoine d'un membre ---------- */

export type WealthCategory = "comptes" | "epargne" | "placement" | "crypto" | "immobilier" | "autre";
export const CATEGORY_LABELS: Record<WealthCategory, string> = {
  comptes: "Comptes",
  epargne: "Épargne",
  placement: "Placements",
  crypto: "Crypto",
  immobilier: "Immobilier",
  autre: "Autres",
};

type AssetRow = {
  id: number;
  owner_user_id: number | null;
  name: string;
  category: WealthCategory;
  institution: string | null;
  valuation: "manuel" | "cotation";
  ticker: string | null;
  quantity: number | null;
  cash: number | null;
  value: number | null;
  value_date: string | null;
  invested: number | null;
  share: number;
  liquidity: string | null;
  loan_ids: string | null;
  notes: string | null;
  price: number | null;
  price_change: number | null;
  price_at: string | null;
};


export async function cryptoPositions(userId: number) {
  // Cours CoinGecko (horaire) si la ligne y est rattachée, sinon cours CoinStats du jour (longue traîne).
  const rows = await q<{
    id: number;
    symbol: string;
    name: string;
    coingecko_id: string | null;
    quantity: number;
    manual_value: number | null;
    location: string | null;
    updated_at: string | null;
    source: string;
    portfolio_id: string | null;
    synced_at: string | null;
    price: number | null;
    change_24h: number | null;
    price_at: string | null;
    price_source: "coingecko" | "coinstats" | null;
  }>(
    `SELECT c.id, c.symbol, c.name, c.coingecko_id, c.quantity, c.manual_value, c.location, c.updated_at, c.source, c.portfolio_id, c.synced_at,
            COALESCE(pg.price_eur, ps.price_eur) * ? AS price, COALESCE(pg.change_24h, ps.change_24h) AS change_24h,
            COALESCE(pg.updated_at, ps.updated_at) AS price_at,
            CASE WHEN pg.id IS NOT NULL THEN 'coingecko' WHEN ps.id IS NOT NULL THEN 'coinstats' END AS price_source
     FROM crypto_positions c
     LEFT JOIN prices pg ON pg.id = CONCAT('cg:', c.coingecko_id)
     LEFT JOIN prices ps ON ps.id = CONCAT('cs:', c.coinstats_id)
     WHERE c.owner_user_id = ? AND c.archived_at IS NULL ORDER BY c.sort_order, c.symbol`,
    [await priceFactor(), userId],
  );
  return valueCrypto(rows);
}

export async function computeWealth(userId: number) {
  const user = await one<{ name: string }>("SELECT name FROM users WHERE id = ?", [userId]);
  const ownerKey = (user?.name ?? "").toLowerCase();

  // Comptes : vue de l'utilisateur (masqués / hors stats exclus), cartes sans solde ignorées ; compte commun pour moitié.
  const accounts = (
    await q<{ id: string; name: string; display_name: string | null; owner: string; kind: string; balance: number | null; institution: string | null }>(
      `SELECT a.id, a.name, a.display_name, a.owner, a.kind, a.balance, a.institution
       FROM accounts a LEFT JOIN account_prefs p ON p.account_id = a.id AND p.user_id = ?
       WHERE COALESCE(p.excluded, a.excluded) = 0 AND COALESCE(p.hidden, a.hidden) = 0 AND a.kind <> 'carte' AND a.balance IS NOT NULL`,
      [userId],
    )
  )
    .map((a) => ({ ...a, share: accountShare(a.owner, ownerKey), balance: Number(a.balance) }))
    .filter((a) => a.share > 0);

  const assetRows = await q<AssetRow>(
    `SELECT a.*, p.price_eur * ? AS price, p.change_24h AS price_change, p.updated_at AS price_at
     FROM assets a LEFT JOIN prices p ON p.id = CONCAT('yf:', a.ticker)
     WHERE a.closed = 0 AND (a.owner_user_id IS NULL OR a.owner_user_id = ?) ORDER BY a.category, a.sort_order, a.name`,
    [await priceFactor(), userId],
  );
  const assets = assetRows.map((a) => {
    const { quoted, value } = assetValue(a);
    return {
      ...a,
      share: Number(a.share),
      value: r2(value),
      valueDate: quoted ? (a.price_at ?? "").slice(0, 10) : a.value_date,
      shareValue: r2(value * Number(a.share)),
      loanIds: a.loan_ids ? a.loan_ids.split(",") : [],
    };
  });

  const crypto = await cryptoPositions(userId);

  const d = today();
  const loanRows = await q<{ id: string; name: string; property: string; bank: string; principal: number; disbursed: number | null; end_date: string; share: number }>(
    "SELECT id, name, property, bank, principal, disbursed, end_date, share FROM loans WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY sort_order, id",
    [userId],
  );
  const loans = await Promise.all(
    loanRows.map(async (l) => {
      const schedule = await q<ScheduleRow>(
        "SELECT rang, date, payment, principal, interest, insurance, deferred_interest, remaining FROM loan_schedule WHERE loan_id = ? ORDER BY rang",
        [l.id],
      );
      const summary = summarizeLoan(schedule, Number(l.disbursed ?? l.principal), d);
      return { ...l, share: Number(l.share), summary, shareRemaining: r2(summary.remaining * Number(l.share)) };
    }),
  );

  const byCategory: Record<WealthCategory, number> = { comptes: 0, epargne: 0, placement: 0, crypto: 0, immobilier: 0, autre: 0 };
  for (const a of accounts) byCategory.comptes += a.balance * a.share;
  for (const a of assets) byCategory[a.category] = (byCategory[a.category] ?? 0) + a.shareValue;
  byCategory.crypto += crypto.total;
  for (const k of Object.keys(byCategory) as WealthCategory[]) byCategory[k] = r2(byCategory[k]);

  const gross = r2(Object.values(byCategory).reduce((s, v) => s + v, 0));
  const debts = r2(loans.reduce((s, l) => s + l.shareRemaining, 0));
  return { date: d, gross, debts, net: r2(gross - debts), byCategory, accounts, assets, crypto, loans };
}

/** Enregistre (ou remplace) l'instantané du jour pour un membre. */
export async function snapshotWealth(userId: number) {
  const w = await computeWealth(userId);
  await exec(
    `INSERT INTO wealth_snapshots (user_id, date, gross, debts, net, breakdown, source) VALUES (?, ?, ?, ?, ?, ?, 'auto')
     ON DUPLICATE KEY UPDATE gross = VALUES(gross), debts = VALUES(debts), net = VALUES(net), breakdown = VALUES(breakdown), source = 'auto'`,
    [userId, w.date, w.gross, w.debts, w.net, JSON.stringify(w.byCategory)],
  );
  return w;
}

/** Erreurs de cours (CoinGecko refusé, ticker introuvable…) : alertes regroupées par source. */
function recordPriceErrors(errors: string[]) {
  console.error("[cours]", errors.join(" ; "));
  return Promise.all(errors.map((e) => recordAlert("cours", `Cours non mis à jour : ${e}`, undefined, "alerte")));
}

/** Tâche horaire : cours puis instantané de chaque membre. */
export async function refreshWealth() {
  if (isDemo()) return;
  const prices = await refreshPrices();
  if (prices.errors.length) await recordPriceErrors(prices.errors);
  for (const u of await q<{ id: number }>("SELECT id FROM users")) await snapshotWealth(u.id);
  return prices;
}

export async function wealthHistory(userId: number) {
  const rows = await q<{ date: string; gross: number; debts: number; net: number; breakdown: string | null }>(
    "SELECT date, gross, debts, net, breakdown FROM wealth_snapshots WHERE user_id = ? ORDER BY date",
    [userId],
  );
  // Répartition par poche de chaque instantané (graphique empilé de l'écran Patrimoine).
  return rows.map(({ breakdown, ...r }) => {
    let parts: Record<string, number> | null = null;
    try {
      parts = breakdown ? (JSON.parse(breakdown) as Record<string, number>) : null;
    } catch {
      parts = null;
    }
    return { ...r, breakdown: parts };
  });
}
