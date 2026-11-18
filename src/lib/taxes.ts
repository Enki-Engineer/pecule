/*
 * Déclarations d'impôt sur le revenu : règles pures. Une déclaration est celle du foyer (imposition commune,
 * déclarant 0) ou celle d'un membre ; une année de revenus peut en compter plusieurs (avant la vie commune, ou
 * dans un couple ni marié ni pacsé). L'écran, l'assistant et le serveur MCP lisent les mêmes totaux par année.
 */

/** Déclarant d'une déclaration commune. */
export const JOINT = 0;

export type ReturnFigures = {
  income_year: number;
  owner_user_id: number;
  taxable_income: number | null;
  rfr: number | null;
  net_tax: number | null;
  social_levies: number | null;
  total: number | null;
  balance: number | null;
  tmi: number | null;
  avg_rate: number | null;
};

export type TaxYear<T extends ReturnFigures = ReturnFigures> = {
  income_year: number;
  /** Déclarations de l'année : la commune d'abord, puis celles des membres. */
  returns: T[];
  taxable_income: number | null;
  rfr: number | null;
  net_tax: number | null;
  social_levies: number | null;
  total: number | null;
  balance: number | null;
  /** Tranche marginale la plus haute des déclarations de l'année. */
  tmi: number | null;
  /** Taux moyen : celui de l'avis s'il n'y a qu'une déclaration, sinon l'impôt net rapporté au revenu imposable de toutes. */
  avg_rate: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | null | undefined) => (v == null ? null : Number(v));
/** Somme des valeurs connues ; null si aucune ne l'est (une année sans prélèvements sociaux n'affiche pas « 0 »). */
const sum = (values: (number | null | undefined)[]) => {
  const known = values.map(num).filter((v): v is number => v != null);
  return known.length ? r2(known.reduce((s, v) => s + v, 0)) : null;
};

/** Totaux par année de revenus, la plus récente d'abord. */
export function taxYears<T extends ReturnFigures>(returns: readonly T[]): TaxYear<T>[] {
  const years = new Map<number, T[]>();
  for (const r of returns) years.set(r.income_year, [...(years.get(r.income_year) ?? []), r]);
  return [...years.entries()]
    .sort(([a], [b]) => b - a)
    .map(([income_year, list]) => {
      const sorted = [...list].sort((a, b) => a.owner_user_id - b.owner_user_id);
      const rated = sorted.filter((r) => r.net_tax != null && Number(r.taxable_income) > 0);
      const tmis = sorted.map((r) => num(r.tmi)).filter((v): v is number => v != null);
      return {
        income_year,
        returns: sorted,
        taxable_income: sum(sorted.map((r) => r.taxable_income)),
        rfr: sum(sorted.map((r) => r.rfr)),
        net_tax: sum(sorted.map((r) => r.net_tax)),
        social_levies: sum(sorted.map((r) => r.social_levies)),
        total: sum(sorted.map((r) => r.total)),
        balance: sum(sorted.map((r) => r.balance)),
        tmi: tmis.length ? Math.max(...tmis) : null,
        avg_rate: sorted.length === 1 ? num(sorted[0].avg_rate) : rated.length ? r2((100 * rated.reduce((s, r) => s + Number(r.net_tax), 0)) / rated.reduce((s, r) => s + Number(r.taxable_income), 0)) : null,
      };
    });
}

/**
 * Déclaration qui porte le salaire déclaré par un membre pour une année : la sienne s'il en a une, sinon la commune.
 * `owners` : déclarants des déclarations de l'année.
 */
export const salaryReturn = (userId: number, owners: readonly number[]): number => (owners.includes(userId) ? userId : JOINT);

const firstName = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

/**
 * Déclarant proposé pour un avis lu : un membre quand l'avis ne nomme que lui et que sa situation n'est pas une
 * imposition commune (marié, pacsé), dans un foyer de plusieurs membres ; sinon la déclaration commune. Ce n'est
 * qu'une proposition : elle se corrige à la relecture, puis à l'écran.
 */
export function proposedOwner(notice: { situation: string | null; declarants: readonly string[] }, members: readonly { id: number; name: string }[]): number {
  if (members.length < 2) return JOINT;
  if (/mari|pacs/i.test(notice.situation ?? "")) return JOINT;
  const names = [...new Set(notice.declarants.map(firstName).filter(Boolean))];
  if (names.length !== 1) return JOINT;
  return members.find((m) => firstName(m.name) === names[0])?.id ?? JOINT;
}
