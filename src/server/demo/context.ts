/*
 * Opérations bancaires de la démo en cours de fabrication : libellés au format des relevés BoursoBank
 * lus par `labels.ts`, `nature.ts` et `invoices.ts` (« Carte 17 02 26 Marchand Cb 1234 », « Prlv Sepa … »,
 * « Vir Sepa … », « Retrait Dab … », « Avoir … »). Rien n'est daté après le jour ni avant l'historique.
 */
import { Rand, addDays, addMonths, cardDay, daysIn, monthIndex, monthOf, r2, yearOf, ymd } from "./rng.ts";
import type { Scenario } from "./model.ts";

/** Comptes : joint, courant d'Alex (a), courant de Camille (c), Livret A d'Alex, LDDS de Camille. */
export type AccKey = "joint" | "a" | "c" | "livret" | "ldds";
export type CardAcc = "joint" | "a" | "c";
export type TxKind = "carte" | "prlv" | "vir" | "interne" | "retrait" | "frais" | "avoir" | "interet";

export type Tx = {
  seq: number;
  acc: AccKey;
  date: string;
  amount: number;
  label: string;
  merchant: string | null;
  cat: string | null;
  source: string | null;
  status: "posted" | "pending";
  note: string | null;
  kind: TxKind;
  /** Opération récurrente ou programmée : jamais retirée de son classement (« à classer »). */
  fixed: boolean;
  /** Clé de la facture payée par cette opération. */
  ref: string | null;
};

export type Extra = Partial<Pick<Tx, "note" | "ref" | "source" | "fixed" | "status">>;
type TxInput = Pick<Tx, "acc" | "date" | "amount" | "label" | "merchant" | "cat" | "kind"> & Extra;

/** Quatre derniers chiffres des cartes : deux sur le compte joint (une par adulte), une par compte perso. */
export const CARDS = { joint: { a: "3047", c: "5182" }, a: "7724", c: "9310" } as const;

export class Ops {
  readonly txs: Tx[] = [];
  private seq = 0;
  constructor(
    readonly R: Rand,
    readonly start: string,
    readonly T: string,
  ) {}

  push(t: TxInput): Tx | null {
    if (t.date < this.start || t.date > this.T) return null;
    const tx: Tx = { source: null, status: "posted", note: null, fixed: false, ref: null, ...t, amount: r2(t.amount), seq: this.seq++ };
    this.txs.push(tx);
    return tx;
  }

  /** Achat carte (débit immédiat), passé en compte 0 à 2 jours après l'achat ; souvent « en attente » la veille et le jour même. */
  card(acc: CardAcc, purchase: string, shop: string, merchant: string | null, amount: number, cat: string | null, extra: Extra = {}): Tx | null {
    if (purchase < this.start || purchase > this.T) return null;
    const no = acc === "joint" ? CARDS.joint[this.R.chance(0.5) ? "a" : "c"] : CARDS[acc];
    let date = addDays(purchase, this.R.weighted([[0, 3], [1, 4], [2, 2]] as const));
    if (date > this.T) date = this.T;
    const pending = date >= addDays(this.T, -1) && this.R.chance(0.6);
    return this.push({ acc, date, amount: -amount, label: `Carte ${cardDay(purchase)} ${shop} Cb ${no}`, merchant, cat, kind: "carte", status: pending ? "pending" : "posted", ...extra });
  }

  prlv(acc: AccKey, date: string, text: string, amount: number, cat: string, merchant: string | null = null, extra: Extra = {}) {
    return this.push({ acc, date, amount: -amount, label: `Prlv Sepa ${text}`, merchant, cat, kind: "prlv", fixed: true, ...extra });
  }

  virIn(acc: AccKey, date: string, text: string, amount: number, cat: string, merchant: string | null = null, extra: Extra = {}) {
    return this.push({ acc, date, amount, label: `Vir Sepa ${text}`, merchant, cat, kind: "vir", fixed: true, ...extra });
  }

  virOut(acc: AccKey, date: string, text: string, amount: number, cat: string, merchant: string | null = null, extra: Extra = {}) {
    return this.push({ acc, date, amount: -amount, label: `Vir Sepa ${text}`, merchant, cat, kind: "vir", fixed: true, ...extra });
  }

  /** Virement entre deux comptes de la famille : deux opérations « Transferts entre comptes » le même jour. */
  transfer(from: AccKey, to: AccKey, date: string, amount: number, outLabel: string, inLabel: string): [Tx, Tx] | null {
    if (date < this.start || date > this.T || amount <= 0) return null;
    const out = this.push({ acc: from, date, amount: -amount, label: outLabel, merchant: null, cat: "C1", kind: "interne", fixed: true });
    const into = this.push({ acc: to, date, amount, label: inLabel, merchant: null, cat: "C1", kind: "interne", fixed: true });
    return out && into ? [out, into] : null;
  }

  withdraw(acc: CardAcc, d: string, amount: number) {
    const no = acc === "joint" ? CARDS.joint.a : CARDS[acc];
    return this.push({ acc, date: d, amount: -amount, label: `Retrait Dab ${cardDay(d)} Nantes Bouffay Cb ${no}`, merchant: null, cat: "C2", kind: "retrait" });
  }
}

/** Un mois de l'historique (le mois en cours s'arrête au jour). */
export type Month = {
  y: number;
  m: number;
  first: string;
  /** Décalage par rapport au mois en cours (0, -1, -2…). */
  off: number;
  lastDay: number;
  /** Part du mois écoulée (1 pour un mois complet) : les fréquences en tiennent compte. */
  share: number;
  at: (d: number) => string;
  rnd: () => string;
  n: (mean: number) => number;
};

export function monthsOf(s: Scenario, R: Rand): Month[] {
  const out: Month[] = [];
  for (let first = s.start; first <= s.T; first = addMonths(first, 1, 1)) {
    const y = yearOf(first);
    const m = monthOf(first);
    const dim = daysIn(y, m);
    const lastDay = monthIndex(first) === monthIndex(s.T) ? s.TD : dim;
    out.push({
      y,
      m,
      first,
      off: monthIndex(first) - monthIndex(s.T),
      lastDay,
      share: lastDay / dim,
      at: (d) => ymd(y, m, d),
      rnd: () => ymd(y, m, R.int(1, lastDay)),
      n: (mean) => R.count((mean * lastDay) / dim),
    });
  }
  return out;
}
