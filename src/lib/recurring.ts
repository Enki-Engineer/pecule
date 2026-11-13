import { addMonths } from "./periods.ts";

/*
 * Récurrences : ce qui revient chaque mois (prélèvements, abonnements payés par carte, virements, salaire, loyers),
 * reconnu dans l'historique pour prévoir les mois à venir. Règles pures ; le serveur fournit les opérations avec une
 * clé de regroupement (forme du libellé pour un prélèvement, clé du marchand sinon). Une série se reconnaît à son
 * libellé — son montant peut alors bouger un peu — ou, à défaut, à son montant au centime : un prélèvement fixe reste
 * suivi quand son libellé change (autre source de synchronisation, opération renommée).
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

/** En dessous, un montant qui revient à l'identique tient du hasard (un café, un ticket de bus) plus que d'un engagement. */
const MIN_FIXED = 5;

const sign = (r: RecurringRow) => (r.amount < 0 ? "-" : "+");

/**
 * Clé d'un paiement fixe : même montant au centime, même catégorie et même moyen de paiement ; pour un achat par
 * carte, la même enseigne aussi (deux commerces au même prix ne font pas un abonnement).
 */
const fixedKey = (r: RecurringRow) => `montant:${r.nature === "carte" ? r.key : `${r.nature ?? ""}|${r.category ?? ""}`}|${Math.abs(r.amount).toFixed(2)}`;

function groupBy(rows: RecurringRow[], keyOf: (r: RecurringRow) => string): Map<string, RecurringRow[]> {
  const groups = new Map<string, RecurringRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return groups;
}

/** La série que forment ces opérations (même clé, même sens), si elles reviennent bien une fois par mois ; null sinon. */
function seriesOf(key: string, list: RecurringRow[], current: string, window: string[]): RecurringSeries | null {
  const byMonth = groupBy(list, (r) => r.date.slice(0, 7));
  const seen = window.filter((m) => byMonth.has(m));
  if (seen.length < 3) return null;
  // Une fois par mois : deux passages le même mois arrivent (rattrapage), pas trois.
  if (seen.some((m) => byMonth.get(m)!.length > 2) || median(seen.map((m) => byMonth.get(m)!.length)) > 1) return null;
  const lastMonth = [...byMonth.keys()].sort().at(-1)!;
  if (lastMonth < addMonths(current, -1)) return null;
  const recent = seen.flatMap((m) => byMonth.get(m)!);
  const amounts = recent.map((r) => Math.abs(r.amount));
  const mid = median(amounts);
  if (!(mid > 0) || amounts.some((a) => Math.abs(a - mid) > mid * 0.3)) return null;
  const last = [...list].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
  return {
    key,
    name: last.name,
    kind: last.kind,
    category: last.category,
    amount: Math.round((list[0].amount < 0 ? -mid : mid) * 100) / 100,
    day: Math.min(28, Math.round(median(recent.map((r) => Number(r.date.slice(8, 10)))))),
    lastMonth,
    months: byMonth.size,
    nature: last.nature,
  };
}

/**
 * Séries mensuelles vivantes au mois `current` : même sens, passées une fois par mois (jamais plus de deux) pendant
 * au moins trois des quatre derniers mois entiers, et vues le mois dernier ou ce mois-ci. Des courses hebdomadaires
 * ou un achat isolé n'en sont pas. Deux façons de se reconnaître :
 *  1. le même libellé (la clé donnée par le serveur), d'un montant stable à 30 % près — un salaire, une facture
 *     d'énergie ;
 *  2. pour ce qui reste, le même montant au centime (`fixedKey`) — une mensualité de crédit dont le libellé a changé
 *     avec la source, ou deux contrats du même créancier, que leur libellé commun ferait passer « deux fois par mois ».
 */
export function recurringSeries(rows: RecurringRow[], current: string): RecurringSeries[] {
  const window = [1, 2, 3, 4].map((n) => addMonths(current, -n));
  const usable = rows.filter((r) => r.key && r.amount);
  const out: RecurringSeries[] = [];
  const taken = new Set<RecurringRow>();
  for (const [key, list] of groupBy(usable, (r) => `${sign(r)}|${r.key}`)) {
    const s = seriesOf(key, list, current, window);
    if (!s) continue;
    out.push(s);
    for (const r of list) taken.add(r);
  }
  const rest = usable.filter((r) => !taken.has(r) && Math.abs(r.amount) >= MIN_FIXED);
  for (const [key, list] of groupBy(rest, (r) => `${sign(r)}|${fixedKey(r)}`)) {
    const s = seriesOf(key, list, current, window);
    if (s) out.push(s);
  }
  return out.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

export type Expected = { month: string; day: number; name: string; amount: number; kind: "depense" | "revenu"; category: string | null; nature?: string };

/**
 * Ce qui est attendu pendant les mois donnés : chaque série une fois par mois, sauf si elle y est déjà passée
 * (`rows` contient alors son opération) ; pour le mois en cours, c'est ce qui reste à venir.
 */
export function expectedIn(series: RecurringSeries[], rows: RecurringRow[], months: string[]): Expected[] {
  // Passée : une opération du mois porte la clé de la série — son libellé, ou son montant fixe.
  const passed = new Set(rows.flatMap((r) => [`${r.date.slice(0, 7)}|${sign(r)}|${r.key}`, `${r.date.slice(0, 7)}|${sign(r)}|${fixedKey(r)}`]));
  const out: Expected[] = [];
  for (const month of months)
    for (const s of series) {
      if (passed.has(`${month}|${s.key}`)) continue;
      out.push({ month, day: s.day, name: s.name, amount: s.amount, kind: s.kind, category: s.category, nature: s.nature });
    }
  return out;
}
