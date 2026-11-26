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
 * Deux écritures de la même banque : d'un relevé à l'autre, son nom est lu avec ou sans sa région, avec ou sans
 * accent (« Caisse du Maine » et « Caisse du Maine Anjou »). Égales, ou l'une contenue dans l'autre.
 */
function sameBankName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = plain(a);
  const y = plain(b);
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))));
}

/**
 * Deux relevés parlent-ils du même compte ? Le numéro fait foi (mêmes quatre derniers caractères, et la même banque
 * quand les deux la nomment) ; sans numéro des deux côtés, la même banque et le même intitulé.
 */
export function sameAccount(a: StatementAccount, b: StatementAccount): boolean {
  const ta = tailKey(a.tail);
  const tb = tailKey(b.tail);
  if (ta || tb) return ta === tb && (!plain(a.bank) || !plain(b.bank) || sameBankName(a.bank, b.bank));
  return sameBankName(a.bank, b.bank) && !!plain(a.label) && plain(a.label) === plain(b.label);
}

/**
 * Les quatre derniers chiffres du numéro qu'un compte de Pécule porte déjà, quand il en porte un : dans son nom
 * (« •••• 1234 »), ou parce que son identifiant est ce numéro. Sert à refuser un relevé rangé dans le mauvais compte.
 */
export function knownTail(name: string | null | undefined, id?: string | null): string | null {
  const inName = /••••\s*([0-9a-z]{4})(?![0-9a-z])/i.exec(name ?? "");
  if (inName) return inName[1].toUpperCase();
  const inId = /(?:^|:)(\d{8,})$/.exec(id ?? "");
  return inId ? inId[1].slice(-4) : null;
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

/**
 * Achat par carte écrit à la façon de certaines banques (« CB LEROY MERLIN FACT 090620 » : marchand, puis jour de la
 * facturette) → la forme que Pécule connaît (« CARTE 09/06/20 LEROY MERLIN »). Le marchand, le jour d'achat, la
 * nature de l'opération et les règles de classement se lisent alors comme pour une opération venue de la banque :
 * sans cela, un historique repris par ses relevés ne retrouve aucune des catégories déjà données au même marchand.
 * Ce qui suit le jour (une conversion de devise, une commission) reste à la fin du libellé. Tout autre libellé est
 * rendu tel quel.
 */
export function cardLabel(label: string): string {
  const m = /^\s*CB\s+(.+?)\s+FACT\s+(\d{2})(\d{2})(\d{2})(?![0-9a-z])\s*(.*)$/i.exec(label);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 31 || Number(m[3]) < 1 || Number(m[3]) > 12) return label;
  return `CARTE ${m[2]}/${m[3]}/${m[4]} ${m[1]}${m[5] ? ` ${m[5]}` : ""}`;
}

/**
 * Jour d'achat à garder pour une opération écrite par la banque le `booked` : celui que le relevé imprime, s'il est
 * plausible (jamais après l'écriture, jamais plus de 70 jours avant : une carte à débit différé prélève le mois
 * suivant). Le même jour que l'écriture n'apprend rien : null.
 */
export function purchaseDayFor(purchase: string | null | undefined, booked: string): string | null {
  if (!purchase || !/^\d{4}-\d{2}-\d{2}$/.test(purchase) || purchase >= booked) return null;
  return dayNumber(booked) - dayNumber(purchase) <= 70 ? purchase : null;
}

/** Ce qu'une carte fait prélever un jour donné : la somme, en centimes (négative), de ses achats écrits ce jour-là. */
export type CardTotal = { day: string; cents: number };

/**
 * Cette opération d'un compte est-elle le prélèvement des achats d'une carte déjà comptés un à un ? Le même montant
 * au centime, à quatre jours près (week-end, jour férié) : une coïncidence est très improbable.
 */
export function isCardTotal(op: { date: string; amount: number }, totals: CardTotal[]): boolean {
  if (op.amount >= 0) return false;
  return totals.some((x) => Number(x.cents) === cents(op.amount) && Math.abs(dayNumber(x.day) - dayNumber(op.date)) <= 4);
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
