/*
 * Patrimoine de la démo : deux crédits (résidence principale commune pour moitié, studio d'Alex),
 * biens et placements (valeurs manuelles), crypto saisie à la main avec ses cours, et un instantané
 * par membre et par fin de mois, calculé comme computeWealth() (comptes : joint pour moitié).
 */
import type * as schema from "../db/schema/index.ts";
import type { Tx } from "./context.ts";
import type { CryptoBuy } from "./data-operations.ts";
import type { Balances } from "./data-simulation.ts";
import { type Echeance, type Scenario, remainingAt } from "./model.ts";
import { type DemoUser, type Insert, Rand, addDays, addMonths, eur, lastOfMonth, r2 } from "./rng.ts";

export const ASSET_IDS = { rp: 1, studio: 2, pea: 3, av: 4, pee: 5 } as const;

export const LOANS = {
  rp: { id: "pret-rp", name: "Prêt résidence principale", property: "Résidence principale (Nantes)", bank: "Crédit Agricole", reference: "PR-44-7741023", principal: 285_000, rate: 1.2, months: 300, insurance: 28.5, share: 0.5 },
  studio: { id: "pret-studio", name: "Prêt studio Angers", property: "Studio meublé (Angers)", bank: "Caisse d'Épargne", reference: "9127755E", principal: 92_000, rate: 3.55, months: 240, insurance: 23, share: 1 },
} as const;

/** Cours du jour : CoinGecko pour la crypto, taux du dollar (coût de l'assistant). */
export const PRICES = { btc: 81_450.37, eth: 2_945.1, usd: 0.8642 };

type Event = { date: string; symbol: "BTC" | "ETH"; quantity: number; value: number; title: string; note: string | null };

export type WealthInput = {
  s: Scenario;
  R: Rand;
  users: readonly [DemoUser, DemoUser];
  loans: { rp: Echeance[]; studio: Echeance[] };
  daily: Map<string, Balances>;
  final: Balances;
  txs: Tx[];
  cryptoBuys: CryptoBuy[];
};

export function buildWealth(w: WealthInput) {
  const { s, R } = w;
  const [ua, uc] = w.users;

  const loans: Insert<typeof schema.loans>[] = (["rp", "studio"] as const).map((k, i) => {
    const l = LOANS[k];
    const rows = w.loans[k];
    return {
      id: l.id,
      name: l.name,
      property: l.property,
      bank: l.bank,
      reference: l.reference,
      type: "Amortissable",
      principal: l.principal,
      disbursed: l.principal,
      rate: l.rate,
      durationMonths: l.months,
      startDate: k === "rp" ? s.rpBought : s.studioBought,
      endDate: rows[rows.length - 1].date,
      notes: `Assurance emprunteur de ${eur(l.insurance)} par mois comprise dans l'échéance.`,
      sortOrder: i,
      ownerUserId: k === "rp" ? null : ua.id,
      share: l.share,
    };
  });

  // Mois de l'historique et trajectoires de valeur (versements réels du PEA et de l'assurance-vie).
  const keys: string[] = [];
  for (let d = s.start; d <= s.T; d = addMonths(d, 1, 1)) keys.push(d.slice(0, 7));
  const cur = keys[keys.length - 1];
  const paid = (re: RegExp) => {
    const map = new Map<string, number>();
    for (const t of w.txs) if (t.cat === "B8" && re.test(t.label)) map.set(t.date.slice(0, 7), r2((map.get(t.date.slice(0, 7)) ?? 0) - t.amount));
    return map;
  };
  const total = (m: Map<string, number>) => r2([...m.values()].reduce((a, b) => a + b, 0));
  const grow = (start: number, drift: number, vol: number, add: (k: string) => number) => {
    const out = new Map<string, number>();
    let v = start;
    for (const k of keys) {
      v = r2(v * (1 + drift + vol * R.normal()) + add(k));
      out.set(k, v);
    }
    return out;
  };
  const peaPaid = paid(/Pea/);
  const avPaid = paid(/Assurance Vie/);
  const pea = grow(9_800, 0.006, 0.025, (k) => peaPaid.get(k) ?? 0);
  const av = grow(7_200, 0.0022, 0.004, (k) => avPaid.get(k) ?? 0);
  const pee = grow(4_900, 0.004, 0.015, () => 150);
  const estate = (from: number, to: number) => new Map(keys.map((k, i) => [k, i === keys.length - 1 ? to : Math.round(from + ((to - from) * i) / (keys.length - 1) + R.normal() * 500)]));
  const rp = estate(361_000, 372_000);
  const studio = estate(101_500, 104_000);

  const assets: Insert<typeof schema.assets>[] = [
    { id: ASSET_IDS.rp, ownerUserId: null, name: "Résidence principale (Nantes)", category: "immobilier", value: rp.get(cur)!, valueDate: addMonths(s.T, -5, 12), invested: 371_800, share: 0.5, liquidity: "Illiquide", loanIds: LOANS.rp.id, notes: "Estimation d'après les ventes récentes du quartier", sortOrder: 0 },
    { id: ASSET_IDS.studio, ownerUserId: ua.id, name: "Studio meublé (Angers)", category: "immobilier", value: studio.get(cur)!, valueDate: addMonths(s.T, -2, 3), invested: 106_900, share: 1, liquidity: "Illiquide", loanIds: LOANS.studio.id, sortOrder: 1 },
    { id: ASSET_IDS.pea, ownerUserId: ua.id, name: "PEA", category: "placement", institution: "BoursoBank", value: pea.get(cur)!, valueDate: addDays(s.T, -3), invested: r2(8_900 + total(peaPaid)), liquidity: "Sous 1 semaine", notes: "ETF monde et ETF actions américaines", sortOrder: 2 },
    { id: ASSET_IDS.av, ownerUserId: uc.id, name: "Assurance-vie", category: "placement", institution: "Ligeria Vie", value: av.get(cur)!, valueDate: addDays(s.T, -20), invested: r2(6_900 + total(avPaid)), liquidity: "Sous 1 mois", notes: "Fonds euros 70 %, unités de compte 30 %", sortOrder: 3 },
    { id: ASSET_IDS.pee, ownerUserId: ua.id, name: "Plan d'épargne entreprise", category: "epargne", institution: "Amundi", value: pee.get(cur)!, valueDate: addDays(s.T, -35), invested: r2(4_300 + 150 * keys.length), liquidity: "Bloqué 5 ans", notes: "Intéressement et abondement de l'employeur", sortOrder: 4 },
  ];

  // Crypto d'Alex : deux achats avant l'historique, les suivants sont des virements vers Coinbase.
  const before: Event[] = [
    { date: addMonths(s.T, -30, 9), symbol: "BTC", quantity: 0.02, value: 1050, title: "Premier achat de bitcoin", note: null },
    { date: addMonths(s.T, -22, 18), symbol: "ETH", quantity: 0.45, value: 1240, title: "Achat d'ether", note: null },
  ];
  const bought: Event[] = w.cryptoBuys.map((b) => ({ ...b, title: b.symbol === "BTC" ? "Achat de bitcoin" : "Achat d'ether", note: "Virement depuis le compte courant" }));
  const events = [...before, ...bought].sort((a, b) => (a.date < b.date ? -1 : 1));
  const qty = (symbol: string, d: string) => Math.round(events.filter((e) => e.symbol === symbol && e.date <= d).reduce((t, e) => t + e.quantity, 0) * 1e8) / 1e8;
  const lastBuy = (symbol: string) => events.filter((e) => e.symbol === symbol).at(-1)?.date ?? null;
  const cryptoPositions: Insert<typeof schema.cryptoPositions>[] = [
    { ownerUserId: ua.id, symbol: "BTC", name: "Bitcoin", coingeckoId: "bitcoin", quantity: qty("BTC", s.T), location: "Coinbase", updatedAt: lastBuy("BTC"), sortOrder: 0, source: "manuel", lineKey: "BTC" },
    { ownerUserId: ua.id, symbol: "ETH", name: "Ethereum", coingeckoId: "ethereum", quantity: qty("ETH", s.T), location: "Coinbase", updatedAt: lastBuy("ETH"), sortOrder: 1, source: "manuel", lineKey: "ETH" },
  ];
  const cryptoEvents: Insert<typeof schema.cryptoEvents>[] = events.map((e) => ({
    ownerUserId: ua.id,
    date: e.date,
    title: e.title,
    asset: e.symbol,
    type: "achat",
    platform: "Coinbase",
    quantity: e.quantity,
    value: e.value,
    note: e.note,
    origin: "main",
  }));
  // Un ordre posé sous le cours du jour, pas encore exécuté : il reste en vue en tête du journal.
  const limit = Math.round((PRICES.eth * 0.93) / 10) * 10;
  cryptoEvents.push({
    ownerUserId: ua.id,
    date: addDays(s.T, -6),
    title: "Ordre d'achat d'ether à cours limité",
    asset: "ETH",
    type: "achat",
    platform: "Coinbase",
    quantity: 0.2,
    value: Math.round(limit * 0.2 * 100) / 100,
    price: limit,
    status: "attente",
    note: "Valable jusqu'à annulation : il passera si le cours descend jusque-là.",
    origin: "main",
  });
  const prices: Insert<typeof schema.prices>[] = [
    { id: "cg:bitcoin", priceEur: PRICES.btc, change24h: -1.82 },
    { id: "cg:ethereum", priceEur: PRICES.eth, change24h: 0.64 },
    { id: "fx:USD", priceEur: PRICES.usd, change24h: null },
  ];
  // Cours passés : marche aléatoire remontée depuis le cours du jour.
  const walk = (vol: number) => {
    const out = new Map<string, number>();
    let f = 1;
    for (let i = keys.length - 1; i >= 0; i--) {
      out.set(keys[i], f);
      f = f / (1 + 0.02 + vol * R.normal());
    }
    return out;
  };
  const btc = walk(0.1);
  const eth = walk(0.13);

  const dates = [...new Set([...keys.map((k) => lastOfMonth(`${k}-01`)).filter((d) => d < s.T), s.T])];
  const wealthSnapshots: Insert<typeof schema.wealthSnapshots>[] = [];
  for (const d of dates) {
    const k = d.slice(0, 7);
    const b = d === s.T ? w.final : w.daily.get(d)!;
    for (const who of ["a", "c"] as const) {
      const parts = {
        comptes: r2(b.joint * 0.5 + (who === "a" ? b.a + b.livret : b.c + b.ldds)),
        epargne: who === "a" ? pee.get(k)! : 0,
        placement: who === "a" ? pea.get(k)! : av.get(k)!,
        crypto: who === "a" ? r2(qty("BTC", d) * PRICES.btc * btc.get(k)! + qty("ETH", d) * PRICES.eth * eth.get(k)!) : 0,
        immobilier: r2(rp.get(k)! * 0.5 + (who === "a" ? studio.get(k)! : 0)),
        autre: 0,
      };
      const gross = r2(Object.values(parts).reduce((t, v) => t + v, 0));
      const debts = r2(remainingAt(w.loans.rp, d, LOANS.rp.principal) * LOANS.rp.share + (who === "a" ? remainingAt(w.loans.studio, d, LOANS.studio.principal) : 0));
      wealthSnapshots.push({ userId: (who === "a" ? ua : uc).id, date: d, gross, debts, net: r2(gross - debts), breakdown: JSON.stringify(parts), source: "auto" });
    }
  }

  return { loans, loanSchedule: [...w.loans.rp, ...w.loans.studio], assets, cryptoPositions, cryptoEvents, prices, wealthSnapshots };
}
