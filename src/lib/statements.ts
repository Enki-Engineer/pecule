/*
 * Relevés de compte repris en masse (import massif) : règles pures, sans base de données. Reconnaître deux relevés
 * du même compte, dire ce qui expliquerait un relevé qui ne tombe pas juste, et vérifier qu'une série de relevés
 * s'enchaîne sans trou.
 */

export type StatementOp = { date: string; label: string; amount: number };

const cents = (n: number) => Math.round(n * 100);
const DAY = 86_400_000;
const dayNumber = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Quatre derniers caractères d'un numéro de compte tel qu'il a été lu (espaces et ponctuation retirés). */
export const tailKey = (tail: string | null | undefined): string | null =>
  (tail ?? "")
    .replace(/[^0-9a-z]/gi, "")
    .slice(-4)
    .toUpperCase() || null;

/** Nom ramené à ce qui se compare : sans accents, sans casse, sans ponctuation. */
const plain = (s: string | null | undefined) =>
  (s ?? "")
    .slice(0, 200)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

export type StatementAccount = { bank: string | null | undefined; label: string | null | undefined; tail: string | null | undefined };

/**
 * Deux relevés parlent-ils du même compte ? Le numéro fait foi (mêmes quatre derniers caractères, et la même banque
 * quand les deux la nomment) ; sans numéro des deux côtés, la même banque et le même intitulé.
 */
export function sameAccount(a: StatementAccount, b: StatementAccount): boolean {
  const ta = tailKey(a.tail);
  const tb = tailKey(b.tail);
  const sameBank = !plain(a.bank) || !plain(b.bank) || plain(a.bank) === plain(b.bank);
  if (ta || tb) return ta === tb && sameBank;
  return !!plain(a.bank) && plain(a.bank) === plain(b.bank) && !!plain(a.label) && plain(a.label) === plain(b.label);
}

/**
 * Écart d'un relevé : solde d'arrivée − (solde de départ + opérations). Zéro quand le relevé tombe juste ; positif
 * quand il manque de l'argent entré (un crédit oublié, un débit en trop), négatif dans l'autre sens.
 */
export function balanceGap(opening: number | null | undefined, closing: number | null | undefined, ops: { amount: number }[]): number | null {
  if (opening == null || closing == null) return null;
  return (cents(closing) - cents(opening) - ops.reduce((s, o) => s + cents(o.amount), 0)) / 100;
}

export type Suspect = { index: number; why: "signe" | "en_trop" };

/**
 * Opérations qui expliqueraient l'écart à elles seules, au centime : un signe inversé (un débit lu comme un crédit
 * déplace le solde de deux fois son montant) ou une ligne en trop (un total, une opération d'un autre compte).
 * Rien si l'écart est nul. Au plus six lignes : au-delà, l'indice n'aide plus.
 */
export function suspects(ops: { amount: number }[], gap: number | null): Suspect[] {
  if (!gap) return [];
  const g = cents(gap);
  const out: Suspect[] = [];
  ops.forEach((o, index) => {
    const a = cents(o.amount);
    if (a && -2 * a === g) out.push({ index, why: "signe" });
    else if (a && -a === g) out.push({ index, why: "en_trop" });
  });
  return out.length > 6 ? [] : out;
}

export type StatementPeriod = { id: number; start: string | null; end: string | null; opening: number | null; closing: number | null; operations: number };
export type Coverage = {
  statements: number;
  operations: number;
  from: string | null;
  to: string | null;
  /** Périodes sans relevé : du lendemain de la fin d'un relevé à la veille du suivant. */
  gaps: { from: string; to: string }[];
  /** Deux relevés qui se suivent sans trou de dates, mais dont les soldes ne s'enchaînent pas. */
  breaks: { at: string; before: number; after: number }[];
  /** Relevés dont la période n'a pas été lue : ils ne peuvent pas être placés dans la série. */
  undated: number;
};

/**
 * Une série de relevés d'un même compte couvre-t-elle sa période sans trou ? Deux relevés s'enchaînent quand le
 * solde d'arrivée de l'un est le solde de départ de l'autre : c'est la preuve qu'aucune opération ne manque entre
 * eux, quelles que soient leurs dates. Sinon, plus de quatre jours entre eux est un relevé manquant, et moins une
 * rupture de solde à regarder. Un relevé contenu dans le précédent (le même fichier déposé deux fois) ne compte pas.
 */
export function coverage(list: StatementPeriod[]): Coverage {
  const dated = list.filter((s): s is StatementPeriod & { start: string; end: string } => !!s.start && !!s.end && s.start <= s.end).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  const out: Coverage = { statements: list.length, operations: list.reduce((s, x) => s + x.operations, 0), from: dated[0]?.start ?? null, to: null, gaps: [], breaks: [], undated: list.length - dated.length };
  let prev: (typeof dated)[number] | null = null;
  for (const s of dated) {
    if (!prev) {
      prev = s;
      continue;
    }
    if (s.end <= prev.end) continue;
    const chained = prev.closing != null && s.opening != null && cents(prev.closing) === cents(s.opening);
    if (!chained) {
      if (dayNumber(s.start) - dayNumber(prev.end) > 4) out.gaps.push({ from: addDays(prev.end, 1), to: addDays(s.start, -1) });
      else if (prev.closing != null && s.opening != null) out.breaks.push({ at: s.start, before: prev.closing, after: s.opening });
    }
    prev = s;
  }
  out.to = prev?.end ?? null;
  return out;
}
