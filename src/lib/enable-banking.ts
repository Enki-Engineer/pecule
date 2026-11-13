/*
 * Enable Banking : règles pures qui traduisent ce que renvoie l'API (comptes, soldes, opérations) dans les
 * termes de Pécule. Vérifiées sur l'API réelle (docs/connecteurs/enable-banking.md). Aucun appel réseau ici.
 */
import type { AccountKind } from "./labels.ts";

export type EbAccount = {
  uid: string;
  identification_hash?: string | null;
  identification_hashes?: string[] | null;
  account_id?: { iban?: string | null; other?: { identification?: string | null; scheme_name?: string | null } | null } | null;
  name?: string | null;
  details?: string | null;
  product?: string | null;
  cash_account_type?: string | null;
  currency?: string | null;
  usage?: string | null;
  psu_status?: string | null;
};

export type EbBalance = {
  name?: string | null;
  balance_type: string;
  balance_amount: { amount: string; currency: string };
  reference_date?: string | null;
  last_change_date_time?: string | null;
};

export type EbTransaction = {
  entry_reference?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "DBIT" | "CRDT";
  status: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  remittance_information?: string[] | null;
};

/** Nature du compte : carte, épargne, compte courant. */
export function ebAccountKind(a: Pick<EbAccount, "cash_account_type">): AccountKind {
  switch (a.cash_account_type) {
    case "CARD":
      return "carte";
    case "SVGS":
      return "epargne";
    case "CACC":
    case "CASH":
      return "courant";
    default:
      return "autre";
  }
}

/** Carte à débit différé : ses achats ne sont prélevés qu'à date fixe ; entre-temps ils forment son encours. */
export const ebDeferredCard = (a: Pick<EbAccount, "cash_account_type" | "details" | "product">) =>
  a.cash_account_type === "CARD" && (/delayed|deferred/i.test(a.details ?? "") || /diff[ée]r[ée]/i.test(a.product ?? ""));

/** Derniers caractères qui permettent de reconnaître le compte (IBAN ou numéro interne), jamais le numéro entier. */
export function ebAccountTail(a: Pick<EbAccount, "account_id">): string | null {
  const id = (a.account_id?.iban ?? a.account_id?.other?.identification ?? "").replace(/\s+/g, "");
  return id.length >= 4 ? id.slice(-4) : null;
}

const num = (b: EbBalance) => Number(b.balance_amount.amount);
/** Code de devise tel que la banque l'écrit, en majuscules ; null s'il est absent ou mal formé. */
export const isoCurrency = (v: string | null | undefined): string | null => (/^[A-Za-z]{3}$/.test(v ?? "") ? v!.toUpperCase() : null);
const day = (b: EbBalance) => b.reference_date ?? b.last_change_date_time?.slice(0, 10) ?? null;

/**
 * Solde à garder pour un compte. Compte courant : le solde comptable (`CLBD`), à défaut un solde du jour.
 * Carte : son encours (`OTHR`), c'est-à-dire ce qui sera prélevé — un montant négatif.
 */
export function ebBalance(kind: AccountKind, balances: EbBalance[]): { balance: number; date: string | null; currency: string | null } | null {
  const order = kind === "carte" ? ["OTHR", "XPCD", "CLBD"] : ["CLBD", "ITBD", "XPCD", "CLAV", "ITAV", "OTHR"];
  for (const type of order) {
    const b = balances.find((x) => x.balance_type === type);
    if (b && Number.isFinite(num(b))) return { balance: num(b), date: day(b), currency: isoCurrency(b.balance_amount.currency) };
  }
  return null;
}

/** Libellé sans les séparateurs de la banque (« ENSEIGNE\VILLE\    FR » → « ENSEIGNE VILLE FR »). */
export const ebLabel = (t: Pick<EbTransaction, "remittance_information">) =>
  (t.remittance_information ?? [])
    .join(" ")
    .replace(/\\/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);

export type EbMapped = {
  /** Référence de l'opération dans son compte (stable), ou null si la banque n'en donne pas. */
  reference: string | null;
  /** Date retenue par Pécule : le jour d'écriture (pour une carte à débit différé, le jour du prélèvement). */
  date: string;
  /** Jour de l'achat ou de l'ordre, quand il diffère du jour d'écriture. */
  purchaseDate: string | null;
  amount: number;
  /** Devise du montant, telle que la banque l'écrit (null si elle ne la donne pas). */
  currency: string | null;
  label: string;
  /** `pending` : écrite d'avance par la banque (achat d'une carte à débit différé pas encore prélevé). */
  status: "posted" | "pending";
};

/**
 * Une opération de l'API dans les termes de Pécule, ou null si elle n'est pas à garder :
 * rejetée ou annulée, ou **sans date d'écriture** — un achat du jour, que la banque annonce sous une
 * référence provisoire (et recopie sur le compte courant) avant de l'écrire pour de bon.
 */
export function ebTransaction(t: EbTransaction): EbMapped | null {
  if (t.status === "RJCT" || t.status === "CNCL") return null;
  if (!t.booking_date) return null;
  const amount = Number(t.transaction_amount.amount) * (t.credit_debit_indicator === "DBIT" ? -1 : 1);
  if (!Number.isFinite(amount)) return null;
  return {
    reference: t.entry_reference?.trim() || null,
    date: t.booking_date,
    purchaseDate: t.transaction_date && t.transaction_date !== t.booking_date ? t.transaction_date : null,
    amount: Math.round(amount * 100) / 100,
    currency: isoCurrency(t.transaction_amount.currency),
    label: ebLabel(t) || "(sans libellé)",
    status: t.status === "BOOK" ? "posted" : "pending",
  };
}

export type CardOutstanding = {
  /** Ce qui sera prélevé à la prochaine échéance (négatif), d'après le solde de la carte. */
  amount: number;
  /** Le même avec les achats du jour, quand la banque le donne. */
  realtime: number | null;
  /** Date du prochain prélèvement. */
  debitDate: string | null;
  /** Achats pas encore prélevés, et leur somme : elle doit égaler `amount`. */
  count: number;
  sum: number;
  /** Le solde et la somme des achats disent la même chose, au centime. */
  consistent: boolean;
};

/** Encours d'une carte à débit différé : son solde, recoupé avec ses achats pas encore prélevés. */
export function ebCardOutstanding(balances: EbBalance[], transactions: EbTransaction[]): CardOutstanding | null {
  const other = balances.find((b) => b.balance_type === "OTHR");
  const pending = transactions.map(ebTransaction).filter((t): t is EbMapped => t?.status === "pending");
  if (!other && !pending.length) return null;
  const sum = Math.round(pending.reduce((a, t) => a + t.amount, 0) * 100) / 100;
  const amount = other ? num(other) : sum;
  const realtime = balances.find((b) => b.balance_type === "XPCD");
  return {
    amount,
    realtime: realtime ? num(realtime) : null,
    debitDate: pending.map((t) => t.date).sort()[0] ?? null,
    count: pending.length,
    sum,
    consistent: Math.abs(amount - sum) < 0.005,
  };
}

/** Titulaire d'après le lien du client avec le compte, quand la banque le dit : seul titulaire, cotitulaire, mandataire. */
export function ebHolding(a: Pick<EbAccount, "psu_status">): "seul" | "joint" | "mandataire" | null {
  const s = (a.psu_status ?? "").toLowerCase();
  if (!s) return null;
  if (s.startsWith("co-")) return "joint";
  if (s.includes("attorney")) return "mandataire";
  if (s.includes("holder")) return "seul";
  return null;
}
