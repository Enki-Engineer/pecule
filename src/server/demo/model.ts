/*
 * Modèle de la famille démo : dates clés (toutes relatives au jour), tableaux d'amortissement, paie,
 * impôt sur le revenu (barème 2025 approché, quotient familial plafonné) et taxe foncière. Pur et
 * déterministe : opérations, bulletins, avis et engagements disent les mêmes chiffres.
 */
import { addDays, addMonths, dayOf, fnv1a, monthOf, parisDate, r2, yearOf, ymd } from "./rng.ts";

/** Mois d'historique avant le mois en cours (≈ 14 mois d'opérations). */
export const HISTORY_MONTHS = 14;

export type Scenario = {
  /** Date du jour à Paris (AAAA-MM-JJ). */
  T: string;
  TY: number;
  TM: number;
  TD: number;
  /** Premier jour de l'historique des opérations. */
  start: string;
  rpBought: string;
  rpFirst: string;
  studioBought: string;
  studioFirst: string;
  /** Premier loyer du studio (deux mois après l'achat). */
  rentFrom: string;
  /** Bail de la locataire actuelle, révision annuelle passée et prochaine. */
  leaseStart: string;
  lastRevision: string;
  nextRevision: string;
  carInsuranceRenewal: string;
  canalEnd: string;
  /** Décalage (en mois, ≤ 0) du dernier mois de décembre de l'historique. */
  decOff: number;
};

export function scenario(today: Date): Scenario {
  const T = parisDate(today);
  const rpBought = addMonths(T, -65, 18);
  const studioBought = addMonths(T, -41, 7);
  const leaseStart = addMonths(T, -20, 1);
  return {
    T,
    TY: yearOf(T),
    TM: monthOf(T),
    TD: dayOf(T),
    start: addMonths(T, -HISTORY_MONTHS, 1),
    rpBought,
    rpFirst: addMonths(rpBought, 1, 5),
    studioBought,
    studioFirst: addMonths(studioBought, 1, 10),
    rentFrom: addMonths(studioBought, 2, 1),
    leaseStart,
    lastRevision: addMonths(leaseStart, 12, 1),
    nextRevision: addMonths(leaseStart, 24, 1),
    carInsuranceRenewal: addDays(T, 28),
    canalEnd: addMonths(T, -5, 1),
    decOff: -(monthOf(T) === 12 ? 12 : monthOf(T)),
  };
}

/** Loyer charges comprises encaissé à une date (0 avant la première location). */
export function rentAt(s: Scenario, d: string): number {
  return d < s.rentFrom ? 0 : d < s.leaseStart ? 535 : d < s.lastRevision ? 548 : 560;
}

/** Années de revenus dont l'avis est déjà arrivé (fin juillet), la plus récente en dernier. */
export function taxYears(s: Scenario): number[] {
  const last = s.T >= ymd(s.TY, 8, 1) ? s.TY - 1 : s.TY - 2;
  return [last - 1, last];
}

/** Années de taxe foncière dont l'avis est arrivé (fin août). */
export function tfYears(s: Scenario): number[] {
  const last = s.T >= ymd(s.TY, 9, 1) ? s.TY : s.TY - 1;
  return [last - 1, last];
}

/* ---------- Crédits ---------- */

export type Echeance = {
  loanId: string;
  rang: number;
  date: string;
  payment: number;
  principal: number;
  interest: number;
  insurance: number;
  deferredInterest: number;
  remaining: number;
};

/** Tableau d'amortissement à mensualités constantes (assurance fixe ajoutée à chaque échéance). */
export function amortize(loanId: string, principal: number, ratePct: number, months: number, first: string, insurance: number): Echeance[] {
  const r = ratePct / 100 / 12;
  const pmt = r2((principal * r) / (1 - (1 + r) ** -months));
  let remaining = principal;
  const rows: Echeance[] = [];
  for (let k = 1; k <= months; k++) {
    const interest = r2(remaining * r);
    const part = k === months ? remaining : Math.min(remaining, r2(pmt - interest));
    remaining = r2(remaining - part);
    rows.push({ loanId, rang: k, date: addMonths(first, k - 1, dayOf(first)), payment: r2(part + interest + insurance), principal: r2(part), interest, insurance, deferredInterest: 0, remaining });
  }
  return rows;
}

/** Capital restant dû à une date : dernière échéance passée (comme `summarizeLoan`). */
export function remainingAt(rows: Echeance[], d: string, base: number): number {
  let rem = base;
  for (const r of rows) if (r.date <= d) rem = r.remaining;
  return rem;
}

/* ---------- Impôt sur le revenu ---------- */

const BRACKETS: readonly (readonly [number, number])[] = [
  [11_497, 0],
  [29_315, 0.11],
  [83_823, 0.3],
  [180_294, 0.41],
  [Infinity, 0.45],
];
const perPart = (q: number) => {
  let tax = 0;
  let prev = 0;
  for (const [limit, rate] of BRACKETS) {
    if (q > prev) tax += (Math.min(q, limit) - prev) * rate;
    prev = limit;
  }
  return tax;
};
/** IR au barème ; l'avantage des demi-parts au-delà de 2 est plafonné à 1 791 € chacune. */
export const bareme = (income: number, parts: number) => Math.round(Math.max(perPart(income / parts) * parts, perPart(income / 2) * 2 - (parts - 2) * 2 * 1_791));
/** IR d'une personne imposée seule (une part), et son taux marginal (en %). */
export const baremeSeul = (income: number) => Math.round(perPart(income));
export const tmiSeul = (income: number) => 100 * (BRACKETS.find(([limit]) => income <= limit)?.[1] ?? 0.45);
/** Taux marginal (en %) : celui de la tranche du revenu par part (deux parts, le quotient étant plafonné). */
export const tmiOf = (income: number) => 100 * (BRACKETS.find(([limit]) => income / 2 <= limit)?.[1] ?? 0.45);

export const PARTS = 2.5;
/** Le foyer a modulé son taux de prélèvement à la source à la hausse (revenus locatifs en plus). */
export const MODULATION = 0.8;
/** Dons aux associations chaque décembre (réduction d'impôt de 66 %). */
export const DONS = 150;

export type Payslip = { gross: number; bonus: number; netBefore: number; netTaxable: number; rate: number; pas: number; netPaid: number; employerCost: number };

/** Paie (brut revalorisé chaque janvier, prime d'Alex en mars), impôt du foyer, taxe foncière. */
export function incomeModel(s: Scenario) {
  const jitter = (key: string) => ((fnv1a(key) % 2401) - 1200) / 100;
  const base = (who: "a" | "c", y: number, m: number) => r2((who === "a" ? 5750 * 1.025 ** (y - s.TY) : 3780 * 1.02 ** (y - s.TY)) + jitter(`${who}${y}-${m}`));
  const bonus = (who: "a" | "c", y: number, m: number) => (who === "a" && m === 3 ? Math.round(7000 * 1.03 ** (y - s.TY)) : 0);
  const rentYear = (y: number) => Array.from({ length: 12 }, (_, i) => rentAt(s, ymd(y, i + 1, 5))).reduce((a, b) => a + b, 0);

  const raw = new Map<number, ReturnType<typeof computeRaw>>();
  function computeRaw(y: number) {
    let salA = 0;
    let salC = 0;
    for (let m = 1; m <= 12; m++) {
      salA += r2((base("a", y, m) + bonus("a", y, m)) * 0.8);
      salC += r2(base("c", y, m) * 0.8);
    }
    const rent = rentYear(y);
    const bic = Math.round(rent * 0.5); // micro-BIC : abattement de 50 %
    const taxable = Math.round(0.9 * (salA + salC) + bic);
    const ir = bareme(taxable, PARTS);
    const credits = Math.round(DONS * 0.66);
    const ps = Math.round(bic * 0.172);
    // Taux du foyer pour le prélèvement à la source : IR rapporté aux revenus nets imposables.
    const rate = Math.round((1000 * ir) / (salA + salC + rent)) / 10;
    return { salA: r2(salA), salC: r2(salC), rent, bic, taxable, ir, credits, netTax: ir - credits, ps, total: ir - credits + ps, rate };
  }
  const rawTax = (y: number) => raw.get(y) ?? raw.set(y, computeRaw(y)).get(y)!;
  /** Taux appliqué un mois donné : celui du dernier avis (de septembre à août), modulé à la hausse. */
  const rateAt = (y: number, m: number) => Math.round((rawTax(m >= 9 ? y - 1 : y - 2).rate + MODULATION) * 10) / 10;
  /** Acompte mensuel sur les loyers (IR au taux du foyer + prélèvements sociaux). */
  const acompteAt = (y: number, m: number) => {
    const t = rawTax(m >= 9 ? y - 1 : y - 2);
    return Math.round(((rateAt(y, m) / 100 + 0.172) * t.bic) / 12);
  };

  function payslip(who: "a" | "c", y: number, m: number): Payslip {
    const b = bonus(who, y, m);
    const gross = r2(base(who, y, m) + b);
    const netBefore = r2(gross * 0.778);
    const netTaxable = r2(gross * 0.8);
    const rate = rateAt(y, m);
    const pas = r2((netTaxable * rate) / 100);
    const meal = who === "a" ? 63 : 0; // part salariale des titres-restaurant
    return { gross, bonus: b, netBefore, netTaxable, rate, pas, netPaid: r2(netBefore - meal - pas), employerCost: r2(gross * 1.42) };
  }

  /** Impôt d'une année de revenus et solde (positif : à payer en septembre, négatif : remboursé). */
  function tax(y: number) {
    const t = rawTax(y);
    let withheld = 0;
    for (let m = 1; m <= 12; m++) withheld += payslip("a", y, m).pas + payslip("c", y, m).pas + acompteAt(y, m);
    return { ...t, withheld: r2(withheld), balance: Math.round(t.total - withheld) };
  }

  /**
   * Impôt d'une année d'imposition séparée, avant le Pacs : chacun sa déclaration, une part, ses seuls salaires
   * (les loyers du studio, à Alex, n'avaient pas commencé).
   */
  function taxAlone(who: "a" | "c", y: number) {
    const t = rawTax(y);
    const salary = who === "a" ? t.salA : t.salC;
    const taxable = Math.round(0.9 * salary);
    const ir = baremeSeul(taxable);
    return { salary, taxable, netTax: ir, total: ir, tmi: tmiSeul(taxable), avgRate: r2((100 * ir) / taxable) };
  }

  /** Taxe foncière d'une année (résidence principale ou studio), +4 % par an. */
  function tf(kind: "rp" | "studio", y: number) {
    const total = Math.round((kind === "rp" ? 1412 : 702) * 1.04 ** (y - s.TY));
    const teom = Math.round(total * (kind === "rp" ? 0.115 : 0.12));
    const fees = Math.round(total * 0.028);
    const contributions = total - teom - fees;
    return { total, teom, fees, contributions, base: Math.round(contributions / 0.46) };
  }

  return { payslip, tax, taxAlone, rateAt, acompteAt, tf };
}

export type IncomeModel = ReturnType<typeof incomeModel>;
