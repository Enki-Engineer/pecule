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

/**
 * Nature d'un contrat : ce qui se compare d'une offre à l'autre. Un document du coffre en porte une au plus
 * (colonne `documents.topic`), reconnue à la lecture, corrigible à la main ; le coffre en fait ses étiquettes.
 */
export const TOPICS = ["assurance_auto", "assurance_habitation", "assurance_emprunteur", "assurance_sante", "assurance_autre", "energie", "internet", "mobile", "vehicule"] as const;
export type Topic = (typeof TOPICS)[number];
export const isTopic = (v: unknown): v is Topic => typeof v === "string" && (TOPICS as readonly string[]).includes(v);

/** Types de documents où une nature se devine au titre et au résumé (un diagnostic ou un bail parlent d'énergie ou d'assurance sans en être). */
const GUESSABLE = new Set(["contrat", "assurance", "devis", "prospectus", "facture", "autre"]);
const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`]/g, "'")
    .toLowerCase();
/** Dans l'ordre : la première nature reconnue l'emporte (l'assurance d'un prêt immobilier est une assurance emprunteur). */
const TOPIC_RULES: [Topic, RegExp][] = [
  ["assurance_emprunteur", /assurance (de |du )?(pret|emprunteur|credit)|\bemprunteur\b|delegation d'assurance/],
  ["assurance_auto", /assurance (auto|automobile|moto|voiture|vehicule|scooter|deux[- ]roues)\b|\b(contrat|devis) auto\b/],
  [
    "assurance_habitation",
    /assurance (multirisques? )?(habitation|logement|maison|appartement|immeuble|copropriete|locataire|proprietaire|loyers? impayes?)|multirisques? (habitation|immeuble|copropriete)|\b(mrh|pno)\b/,
  ],
  ["assurance_sante", /\bmutuelle\b|complementaire sante|assurance sante|frais de sante/],
  ["vehicule", /\b(loa|lld)\b|location avec option d'achat|location longue duree|\bleasing\b|credit auto/],
  ["energie", /\bkwh\b|(fourniture|contrat|offre|facture|echeancier|abonnement|fournisseur) (d'|de |du )?(electricite|energie|gaz)|electricite et gaz|gaz et electricite/],
  ["internet", /\b(box internet|fibre|adsl|livebox|freebox|bbox)\b|(abonnement|offre|acces) (a )?internet/],
  ["mobile", /forfait (mobile|telephon)|(ligne|abonnement|telephonie) mobile/],
];

/**
 * Nature d'un contrat d'après son titre et son résumé, sans IA : sert aux documents déjà au coffre, à ceux rangés
 * sans IA, et de repli quand la lecture n'en donne pas. Null plutôt qu'une nature douteuse.
 */
export function guessTopic(d: { title: string; summary?: string | null; kind?: string | null }): Topic | null {
  if (d.kind && !GUESSABLE.has(d.kind)) return null;
  for (const text of [d.title, d.summary ?? ""]) {
    const t = plain(text);
    const hit = TOPIC_RULES.find(([, re]) => re.test(t));
    if (hit) return hit[0];
  }
  return null;
}

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
