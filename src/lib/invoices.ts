/**
 * Rapprochement facture ↔ opération bancaire. Les cartes à débit différé sont débitées le
 * 1er du mois suivant, mais le libellé garde la date d'achat (« Carte 17 02 26 Amazon… ») :
 * c'est elle qu'on compare à la date de la facture.
 */

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Date d'achat portée par un libellé de carte (« Carte 17 02 26 … » → 2026-02-17), sinon null. */
export function cardDate(label: string): string | null {
  const m = /^(?:carte|avoir)\s+(\d{2})\s(\d{2})\s(\d{2}|\d{4})\b/i.exec(label.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${mo}-${d}`;
  return Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) ? null : iso;
}

/** Libellés bancaires et noms commerciaux d'un même marchand → une seule clé. */
const ALIASES: [RegExp, string][] = [
  [/\b(amazon|amzn)\b/, "amazon"],
  [/\bcdiscount\b/, "cdiscount"],
  [/\bleroy ?merlin\b/, "leroy merlin"],
  [/\bfnac\b/, "fnac"],
  [/\bdarty\b/, "darty"],
  [/\bldlc\b/, "ldlc"],
  [/\baliexpress\b/, "aliexpress"],
  [/\b(ui com|ubiquiti)\b/, "ubiquiti"],
  [/\bapple\b/, "apple"],
  [/\bdecathlon\b/, "decathlon"],
  [/\bikea\b/, "ikea"],
  [/\bcastorama\b/, "castorama"],
];

const STOP = new Set(["carte", "avoir", "www", "com", "fr", "sas", "sarl", "eu", "the", "les", "le", "la"]);

/** Clé de marchand : « AMZN Mktp FR », « Amazon EU SARL » → « amazon » ; sinon le premier mot significatif. */
export function merchantKey(name: string): string {
  const n = norm(name);
  for (const [re, key] of ALIASES) if (re.test(n)) return key;
  return n.split(" ").find((w) => w.length >= 3 && !STOP.has(w) && !/\d/.test(w)) ?? n;
}

/** Le libellé bancaire désigne-t-il ce marchand ? */
export function labelMatchesMerchant(label: string, merchant: string): boolean {
  const key = merchantKey(merchant);
  if (!key) return false;
  const n = norm(label);
  for (const [re, k] of ALIASES) if (k === key && re.test(n)) return true;
  return new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n);
}

const days = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400_000);

export type MatchInvoice = { invoice_date: string | null; total: number | null; merchant: string };
export type MatchTransaction = { id: string; date: string; amount: number; label: string };
export type Candidate = { id: string; score: number; amount: boolean; merchant: boolean; gap: number };

/**
 * Note une opération candidate pour une facture : montant identique, même marchand, date d'achat
 * proche (la facture suit souvent l'achat : expédition, livraison). null si hors fenêtre.
 */
export function scoreCandidate(inv: MatchInvoice, tx: MatchTransaction): Candidate | null {
  if (!inv.invoice_date) return null;
  const purchase = cardDate(tx.label) ?? tx.date;
  const gap = days(purchase, inv.invoice_date);
  if (gap < -20 || gap > 7) return null;
  const amount = inv.total != null && Math.abs(-tx.amount - inv.total) <= 0.01;
  const merchant = labelMatchesMerchant(tx.label, inv.merchant);
  if (!amount && !merchant) return null;
  const score = (amount ? 60 : 0) + (merchant ? 30 : 0) + Math.max(0, 10 - Math.abs(gap));
  return { id: tx.id, score, amount, merchant, gap };
}

/** Opération à relier sans demander : une seule candidate avec le même montant et le même marchand. */
export function autoMatch(inv: MatchInvoice, txs: MatchTransaction[]): string | null {
  const sure = txs.map((t) => scoreCandidate(inv, t)).filter((c): c is Candidate => !!c && c.amount && c.merchant);
  return sure.length === 1 ? sure[0].id : null;
}

/** Garantie légale de conformité (2 ans) à partir de la date d'achat. */
export function legalWarranty(date: string, months = 24): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}
