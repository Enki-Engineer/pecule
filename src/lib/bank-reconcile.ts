/*
 * Rapprochement de deux lectures d'un même compte (deux sources bancaires, ou une source et l'existant) :
 * une opération pour une opération, jamais deux fois la même. Pur et testé.
 *
 * Les deux lectures ne datent pas toujours une opération au même jour : un achat par carte à débit différé
 * porte chez l'une le jour du prélèvement réel, chez l'autre un prélèvement supposé (un mois plus tôt pour un
 * achat fait après l'arrêté de la carte). Le jour de l'achat, lui, est écrit dans le libellé des deux côtés.
 */

export type RecTx = { id: string; date: string; amount: number; label: string; status: string };

/** Jour de l'achat lu dans un libellé de carte : « CARTE 05/11/26 … », « Carte 05 11 26 … », « Avoir 05 11 26 … ». */
export function purchaseDay(label: string): string | null {
  const m = /^\s*(?:carte|avoir)\s+(\d{2})[/ .-](\d{2})[/ .-](\d{2}|\d{4})\b/i.exec(label);
  if (!m) return null;
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const day = `${year}-${m[2]}-${m[1]}`;
  // Un jour qui n'existe pas (« 31/02 ») n'est pas un jour d'achat.
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
}

/**
 * Jour d'achat à garder pour une opération écrite par la banque le `booked` : celui du libellé, s'il est plausible
 * (jamais après l'écriture, jamais plus de 70 jours avant : une carte à débit différé prélève le mois suivant).
 */
export function purchaseDateFor(label: string, booked: string): string | null {
  const day = purchaseDay(label);
  if (!day || day > booked) return null;
  const gap = (Date.parse(`${booked}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000;
  return gap <= 70 ? day : null;
}

export type RecPair = {
  incoming: RecTx;
  existing: RecTx;
  /** `achat` : même jour d'achat et même montant ; `date` : même date et même montant ; `proche` : même montant à quelques jours près. */
  how: "achat" | "date" | "proche";
};
export type Reconciliation = { pairs: RecPair[]; onlyIncoming: RecTx[]; onlyExisting: RecTx[] };

const cents = (t: RecTx) => Math.round(Number(t.amount) * 100);
const dayNumber = (d: string) => Math.round(Date.parse(d) / 86400_000);
/** Une opération marquée « doublon » ne sert qu'en dernier recours. */
const rank = (t: RecTx) => (t.status === "duplicate" ? 1 : 0);

/**
 * Apparie les opérations lues (`incoming`) à celles déjà connues (`existing`). Trois passes, de la plus sûre à
 * la moins sûre ; une opération n'est prise qu'une fois ; à égalité, la plus proche en date d'abord.
 */
export function reconcile(incoming: RecTx[], existing: RecTx[], opts: { nearDays?: number } = {}): Reconciliation {
  const near = opts.nearDays ?? 4;
  const pairs: RecPair[] = [];
  let left = [...incoming];
  let pool = [...existing];

  const pass = (how: RecPair["how"], keyOf: (t: RecTx) => string | null) => {
    const byKey = new Map<string, RecTx[]>();
    for (const t of pool) {
      const k = keyOf(t);
      if (k) byKey.set(k, [...(byKey.get(k) ?? []), t]);
    }
    const rest: RecTx[] = [];
    const used = new Set<RecTx>();
    for (const t of left) {
      const k = keyOf(t);
      const candidates = (k ? (byKey.get(k) ?? []) : []).filter((c) => !used.has(c));
      if (!candidates.length) {
        rest.push(t);
        continue;
      }
      const best = candidates.sort((a, b) => rank(a) - rank(b) || Math.abs(dayNumber(a.date) - dayNumber(t.date)) - Math.abs(dayNumber(b.date) - dayNumber(t.date)))[0];
      used.add(best);
      pairs.push({ incoming: t, existing: best, how });
    }
    left = rest;
    pool = pool.filter((t) => !used.has(t));
  };

  pass("achat", (t) => {
    const p = purchaseDay(t.label);
    return p ? `${p}|${cents(t)}` : null;
  });
  pass("date", (t) => `${t.date}|${cents(t)}`);

  // Dernière passe : même montant, jour d'achat (ou date) à quelques jours près, le plus proche d'abord.
  const ref = (t: RecTx) => dayNumber(purchaseDay(t.label) ?? t.date);
  const rest: RecTx[] = [];
  for (const t of left) {
    const best = pool
      .filter((c) => cents(c) === cents(t) && Math.abs(ref(c) - ref(t)) <= near)
      .sort((a, b) => rank(a) - rank(b) || Math.abs(ref(a) - ref(t)) - Math.abs(ref(b) - ref(t)))[0];
    if (!best) {
      rest.push(t);
      continue;
    }
    pool = pool.filter((c) => c !== best);
    pairs.push({ incoming: t, existing: best, how: "proche" });
  }
  return { pairs, onlyIncoming: rest, onlyExisting: pool };
}

export type ReconciliationSummary = {
  /** Appariées avec la même date des deux côtés. */
  same: number;
  /** Appariées, mais datées autrement (la source lue fait foi : c'est le jour d'écriture de la banque). */
  shifted: number;
  onlyIncoming: number;
  /** Connues de Pécule et absentes de la lecture, hors doublons déjà écartés. */
  onlyExisting: number;
};

export function summarize(r: Reconciliation): ReconciliationSummary {
  return {
    same: r.pairs.filter((p) => p.incoming.date === p.existing.date).length,
    shifted: r.pairs.filter((p) => p.incoming.date !== p.existing.date).length,
    onlyIncoming: r.onlyIncoming.length,
    onlyExisting: r.onlyExisting.filter((t) => t.status !== "duplicate").length,
  };
}
