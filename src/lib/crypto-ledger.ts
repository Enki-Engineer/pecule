/*
 * Registre d'un exchange : ses écritures (ce qui est entré ou sorti d'un actif, et quand), et ce qu'on en tire pour
 * le journal — la date, le cours et les frais exacts d'un achat ou d'une vente que Pécule a seulement vu dans les
 * soldes. Sans base ni réseau (testé dans crypto-ledger.test.ts).
 */

import { isCurrency } from "./currencies.ts";

/** Une écriture du registre : un actif, un montant signé (négatif : il part), des frais pris dans le même actif. */
export type LedgerEntry = { id: string; ref: string; at: string; type: string; symbol: string; amount: number; fee: number };

/** Un ordre exécuté, en tout ou en partie : ce qui est parti, ce qui est arrivé, à quel instant. */
export type Fill = { ref: string; at: string; sold: { symbol: string; amount: number; fee: number }; bought: { symbol: string; amount: number; fee: number } };

/** Écritures qui vont par deux sous une même référence : un actif part, un autre arrive. */
const PAIRED = new Set(["trade", "spend", "receive", "conversion"]);

/** Exécutions que racontent des écritures : celles qui vont par deux sous une même référence, une sortie et une entrée. */
export function fillsOf(entries: LedgerEntry[]): Fill[] {
  const byRef = new Map<string, LedgerEntry[]>();
  for (const e of entries) if (PAIRED.has(e.type) && e.ref) byRef.set(e.ref, [...(byRef.get(e.ref) ?? []), e]);
  const out: Fill[] = [];
  for (const [ref, legs] of byRef) {
    const outs = legs.filter((l) => l.amount < 0);
    const ins = legs.filter((l) => l.amount > 0);
    // Autre chose qu'une sortie et une entrée : on ne sait pas le lire, rien n'est deviné.
    if (outs.length !== 1 || ins.length !== 1) continue;
    out.push({ ref, at: [outs[0].at, ins[0].at].sort()[1], sold: { symbol: outs[0].symbol, amount: -outs[0].amount, fee: outs[0].fee }, bought: { symbol: ins[0].symbol, amount: ins[0].amount, fee: ins[0].fee } });
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export type ExactTrade = {
  /** Instant de la dernière exécution. */
  at: string;
  /** Monnaie de l'échange (« EUR », « USD »). */
  currency: string;
  /** Crypto reçue ou cédée, frais déduits ou ajoutés : ce que le solde a vu bouger. */
  quantity: number;
  /** Monnaie dépensée (achat) ou reçue (vente), frais en monnaie compris. */
  amount: number;
  /** Cours d'exécution, dans la monnaie de l'échange : la monnaie échangée divisée par la crypto échangée, avant frais. */
  price: number;
  /** Frais, ramenés à la monnaie de l'échange (ceux pris en crypto sont comptés au cours d'exécution). */
  fee: number;
};

/**
 * L'achat ou la vente d'une crypto contre de la monnaie que racontent des exécutions, si elles expliquent bien ce
 * que le solde a vu bouger (`quantity`, à 1 % près) : sa date, son cours et ses frais exacts. `null` si les
 * exécutions ne collent pas — plusieurs monnaies, une quantité différente — : on garde alors l'estimation.
 */
export function exactTrade(fills: Fill[], kind: "achat" | "vente", asset: string, quantity: number): ExactTrade | null {
  const symbol = asset.toUpperCase();
  const mine = fills.filter((f) => (kind === "achat" ? f.bought.symbol === symbol && isCurrency(f.sold.symbol) : f.sold.symbol === symbol && isCurrency(f.bought.symbol)));
  if (!mine.length) return null;
  const currencies = new Set(mine.map((f) => (kind === "achat" ? f.sold.symbol : f.bought.symbol)));
  if (currencies.size !== 1) return null;
  const crypto = (f: Fill) => (kind === "achat" ? f.bought : f.sold);
  const cash = (f: Fill) => (kind === "achat" ? f.sold : f.bought);
  const gross = mine.reduce((s, f) => s + crypto(f).amount, 0);
  const cryptoFee = mine.reduce((s, f) => s + crypto(f).fee, 0);
  const traded = mine.reduce((s, f) => s + cash(f).amount, 0);
  const cashFee = mine.reduce((s, f) => s + cash(f).fee, 0);
  if (!(gross > 0) || !(traded > 0)) return null;
  // Ce que le solde a vu : la crypto reçue moins ses frais, ou la crypto cédée plus ses frais.
  const moved = kind === "achat" ? gross - cryptoFee : gross + cryptoFee;
  if (Math.abs(moved - quantity) > Math.max(quantity * 0.01, 1e-9)) return null;
  const price = traded / gross;
  return { at: mine.at(-1)!.at, currency: [...currencies][0], quantity: moved, amount: kind === "achat" ? traded + cashFee : traded - cashFee, price, fee: cashFee + cryptoFee * price };
}
