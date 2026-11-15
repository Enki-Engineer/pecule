/*
 * Comparaison de contrats (électricité, gaz, assurances, télécoms, véhicule…) : règles pures, partagées par
 * l'outil de l'assistant et par l'écran. Les dates sont des jours « AAAA-MM-JJ ».
 */

/** Types de documents du coffre qui décrivent un contrat en cours. */
export const CONTRACT_KINDS = ["contrat", "assurance", "pret"] as const;
/** Types de documents du coffre qui décrivent une offre pas encore acceptée. */
export const OFFER_KINDS = ["devis", "prospectus"] as const;
/** Types d'engagements du budget qu'une offre peut remplacer (ni taxe ni budget courant). */
export const COMPARABLE_COMMITMENTS = ["assurance", "abonnement", "credit", "garde"] as const;

const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T12:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Jour décalé de n jours. */
export const shiftDays = (d: string, n: number): string => iso(utc(d) + n * DAY);
/** Nombre de jours de `from` à `to` (négatif si `to` est passé). */
export const daysBetween = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / DAY);

/** Même jour, n années plus tard (un 29 février retombe sur le 28). */
function shiftYears(d: string, n: number): string {
  const [y, m, day] = d.split("-").map(Number);
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

export type Renewal = {
  /** Date enregistrée sur l'engagement. */
  recorded: string;
  /** Prochaine échéance : la date enregistrée, ou son anniversaire si elle est passée. */
  next: string;
  /** Vrai si la prochaine échéance est déduite d'une reconduction annuelle (date enregistrée passée). */
  assumedYearly: boolean;
  noticeDays: number | null;
  /** Dernier jour pour résilier avant la prochaine échéance (échéance moins le préavis). */
  cancelBefore: string;
  /** Jours restants avant ce dernier jour ; négatif : le préavis de cette échéance est dépassé. */
  daysLeft: number;
};

/**
 * Prochaine échéance d'un engagement et date limite de résiliation. Une date de renouvellement passée est reportée
 * d'année en année (reconduction tacite, le cas courant) : `assumedYearly` le signale, c'est une hypothèse.
 */
export function renewal(recorded: string | null | undefined, noticeDays: number | null | undefined, today: string): Renewal | null {
  if (!recorded || !/^\d{4}-\d{2}-\d{2}$/.test(recorded)) return null;
  let next = recorded;
  for (let n = 1; next < today && n <= 100; n++) next = shiftYears(recorded, n);
  const notice = noticeDays != null && noticeDays > 0 ? Math.round(noticeDays) : null;
  const cancelBefore = shiftDays(next, -(notice ?? 0));
  return { recorded, next, assumedYearly: next !== recorded, noticeDays: notice, cancelBefore, daysLeft: daysBetween(today, cancelBefore) };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Montant d'un engagement par mois et par an : ce qui est saisi, l'autre s'en déduit. Null si aucun des deux. */
export function yearlyCost(c: { monthly: number | null; annual: number | null }): { monthly: number; annual: number } | null {
  if (c.monthly == null && c.annual == null) return null;
  const annual = c.annual != null ? Number(c.annual) : Number(c.monthly) * 12;
  const monthly = c.monthly != null ? Number(c.monthly) : Number(c.annual) / 12;
  return { monthly: r2(monthly), annual: r2(annual) };
}

export type PaidMonth = { month: string; total: number; count: number };
export type Paid = {
  /** Total net prélevé sur la période (remboursements déduits). */
  total: number;
  /** Nombre de prélèvements. */
  count: number;
  /** Mois où quelque chose a été prélevé. */
  months: number;
  /** Moyenne par mois prélevé. */
  monthlyAverage: number;
  /** Premier et dernier mois vus : moins de douze mois d'écart = historique incomplet. */
  firstMonth: string;
  lastMonth: string;
  /** Vrai si l'historique couvre moins que la période demandée : le total n'est pas une année pleine. */
  partial: boolean;
  byMonth: PaidMonth[];
};

/**
 * Ce qui a été réellement prélevé pour un contrat, d'après ses mois de prélèvement. `since` : premier mois où le
 * foyer a des opérations ; si la période demandée commence avant, le total ne couvre pas douze mois.
 */
export function paidSummary(byMonth: PaidMonth[], periodStart: string, since: string | null): Paid | null {
  const rows = byMonth.filter((m) => m.count > 0).sort((a, b) => a.month.localeCompare(b.month));
  if (!rows.length) return null;
  const total = r2(rows.reduce((s, m) => s + m.total, 0));
  return {
    total,
    count: rows.reduce((s, m) => s + m.count, 0),
    months: rows.length,
    monthlyAverage: r2(total / rows.length),
    firstMonth: rows[0].month,
    lastMonth: rows[rows.length - 1].month,
    partial: since != null && since.slice(0, 7) > periodStart.slice(0, 7),
    byMonth: rows.map((m) => ({ ...m, total: r2(m.total) })),
  };
}

/**
 * Partage un nombre de caractères entre plusieurs textes : un texte court est donné en entier, ce qu'il n'utilise
 * pas revient aux plus longs, à parts égales. Rend la longueur accordée à chacun, dans l'ordre reçu.
 */
export function shareBudget(lengths: number[], total: number): number[] {
  const out = lengths.map(() => 0);
  let left = Math.max(0, Math.floor(total));
  let open = lengths.map((_, i) => i).filter((i) => lengths[i] > 0);
  while (open.length && left > 0) {
    const share = Math.floor(left / open.length);
    if (share === 0) break;
    const small = open.filter((i) => lengths[i] - out[i] <= share);
    if (!small.length) {
      for (const i of open) out[i] += share;
      break;
    }
    for (const i of small) {
      left -= lengths[i] - out[i];
      out[i] = lengths[i];
    }
    open = open.filter((i) => !small.includes(i));
  }
  return out;
}
