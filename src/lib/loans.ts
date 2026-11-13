import { tn } from "./i18n.ts";

export type ScheduleRow = {
  rang: number;
  date: string; // YYYY-MM-DD
  payment: number;
  principal: number;
  interest: number;
  insurance: number;
  deferred_interest: number;
  remaining: number;
};

export type LoanSummary = {
  remaining: number;
  repaidPrincipal: number;
  progress: number; // 0..1
  totalInterest: number;
  totalInsurance: number;
  totalCost: number;
  paidInterest: number;
  nextPayment: ScheduleRow | null;
  lastPayment: ScheduleRow | null;
  remainingPayments: number;
  currentMonthly: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Résume un échéancier à une date donnée : le capital restant dû est celui de la
 * dernière échéance passée (le tableau de la banque fait foi, pas un recalcul).
 */
export function summarizeLoan(schedule: ScheduleRow[], base: number, today: string): LoanSummary {
  const rows = [...schedule].sort((a, b) => a.rang - b.rang);
  const past = rows.filter((r) => r.date <= today);
  const future = rows.filter((r) => r.date > today);
  const last = past.at(-1) ?? null;
  const remaining = last ? last.remaining : base;
  const sum = (list: ScheduleRow[], key: keyof ScheduleRow) => round2(list.reduce((s, r) => s + Number(r[key]), 0));
  const totalInterest = sum(rows, "interest");
  const totalInsurance = sum(rows, "insurance");
  const nextPayment = future[0] ?? null;
  return {
    remaining,
    repaidPrincipal: round2(base - remaining),
    progress: base > 0 ? Math.min(1, Math.max(0, (base - remaining) / base)) : 0,
    totalInterest,
    totalInsurance,
    totalCost: round2(totalInterest + totalInsurance),
    paidInterest: sum(past, "interest"),
    nextPayment,
    lastPayment: last,
    remainingPayments: future.filter((r) => r.payment > 0).length,
    currentMonthly: nextPayment ? nextPayment.payment : null,
  };
}

/** « 25 ans 2 mois » à partir d'un nombre de mois. */
export function formatDuration(months: number): string {
  const y = Math.floor(months / 12);
  const m = months % 12;
  // Deux morceaux traduits séparément : « 25 ans » et « 2 mois » (le mot « mois » ne varie pas en français).
  return `${tn("{n} an", "{n} ans", y)} ${tn("{n} mois##durée", "{n} mois##durée", m)}`;
}

/** Nombre de mois entre deux dates YYYY-MM-DD (mois entamés non comptés). */
export function monthsBetween(start: string, end: string): number {
  const [ys, ms, ds] = start.split("-").map(Number);
  const [ye, me, de] = end.split("-").map(Number);
  return (ye - ys) * 12 + (me - ms) - (de < ds ? 1 : 0);
}
