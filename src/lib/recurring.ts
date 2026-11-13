import { addMonths } from "./periods.ts";

/*
 * Récurrences : ce qui revient chaque mois (prélèvements, abonnements payés par carte, virements, salaire, loyers),
 * reconnu dans l'historique pour prévoir les mois à venir. Règles pures ; le serveur fournit les opérations avec une
 * clé de regroupement (forme du libellé pour un prélèvement, clé du marchand sinon).
 */

export type RecurringRow = { date: string; amount: number; key: string; name: string; kind: "depense" | "revenu"; category: string | null; /** Moyen de paiement (carte, prélèvement, virement…), repris tel quel dans la série. */ nature?: string };

export type RecurringSeries = {
  key: string;
  name: string;
  kind: "depense" | "revenu";
  category: string | null;
  /** Montant habituel, signé (médiane des derniers mois). */
  amount: number;
  /** Jour habituel dans le mois. */
  day: number;
  /** Dernier mois où la série est passée. */
  lastMonth: string;
  /** Nombre de mois où elle est passée, parmi les mois observés. */
  months: number;
  nature?: string;
};

const MONTH_NAMES = new Set(
  // Noms de mois (sans accents, comme une clé de libellé) : français, anglais, allemand, italien, espagnol.
  "janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre january february march april may june july august september october november december januar februar marz mai juni juli oktober dezember gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre dicembre enero febrero abril mayo junio julio septiembre octubre noviembre diciembre".split(
    " ",
  ),
);

/** Clé d'une récurrence d'après la clé d'un libellé : sans le nom du mois, qui change à chaque passage (« salaire octobre », « loyer novembre »). */
export const recurringKey = (labelKey: string): string =>
  labelKey
    .split(" ")
    .filter((w) => !MONTH_NAMES.has(w))
    .join(" ") || labelKey;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Séries mensuelles vivantes au mois `current` : même clé et même sens, passées une fois par mois (jamais plus de
 * deux) pendant au moins trois des quatre derniers mois entiers, d'un montant stable (à 30 % près), et vues le mois
 * dernier ou ce mois-ci. Des courses hebdomadaires ou un achat isolé n'en sont pas.
 */
export function recurringSeries(rows: RecurringRow[], current: string): RecurringSeries[] {
  const window = [1, 2, 3, 4].map((n) => addMonths(current, -n));
  const groups = new Map<string, RecurringRow[]>();
  for (const r of rows) {
    if (!r.key || !r.amount) continue;
    const k = `${r.amount < 0 ? "-" : "+"}|${r.key}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: RecurringSeries[] = [];
  for (const [key, list] of groups) {
    const byMonth = new Map<string, RecurringRow[]>();
    for (const r of list) byMonth.set(r.date.slice(0, 7), [...(byMonth.get(r.date.slice(0, 7)) ?? []), r]);
    const seen = window.filter((m) => byMonth.has(m));
    if (seen.length < 3) continue;
    // Une fois par mois : deux passages le même mois arrivent (rattrapage), pas trois.
    if (seen.some((m) => byMonth.get(m)!.length > 2) || median(seen.map((m) => byMonth.get(m)!.length)) > 1) continue;
    const lastMonth = [...byMonth.keys()].sort().at(-1)!;
    if (lastMonth < addMonths(current, -1)) continue;
    const recent = seen.flatMap((m) => byMonth.get(m)!);
    const amounts = recent.map((r) => Math.abs(r.amount));
    const mid = median(amounts);
    if (!(mid > 0) || amounts.some((a) => Math.abs(a - mid) > mid * 0.3)) continue;
    const last = [...list].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
    out.push({
      key,
      name: last.name,
      kind: last.kind,
      category: last.category,
      amount: Math.round((list[0].amount < 0 ? -mid : mid) * 100) / 100,
      day: Math.min(28, Math.round(median(recent.map((r) => Number(r.date.slice(8, 10)))))),
      lastMonth,
      months: byMonth.size,
      nature: last.nature,
    });
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export type Expected = { month: string; day: number; name: string; amount: number; kind: "depense" | "revenu"; category: string | null; nature?: string };

/**
 * Ce qui est attendu pendant les mois donnés : chaque série une fois par mois, sauf si elle y est déjà passée
 * (`rows` contient alors son opération) ; pour le mois en cours, c'est ce qui reste à venir.
 */
export function expectedIn(series: RecurringSeries[], rows: RecurringRow[], months: string[]): Expected[] {
  const passed = new Set(rows.map((r) => `${r.date.slice(0, 7)}|${r.amount < 0 ? "-" : "+"}|${r.key}`));
  const out: Expected[] = [];
  for (const month of months)
    for (const s of series) {
      if (passed.has(`${month}|${s.key}`)) continue;
      out.push({ month, day: s.day, name: s.name, amount: s.amount, kind: s.kind, category: s.category, nature: s.nature });
    }
  return out;
}
