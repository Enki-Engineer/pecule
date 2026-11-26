/*
 * Relevés de compte de la Caisse d'Épargne (PDF passés par `pdftotext -layout`). Un relevé porte
 * un ou plusieurs comptes (compte de dépôt, livrets) ; chaque compte a son solde précédent, ses
 * opérations sur deux colonnes (débit, crédit) et son nouveau solde — ce qui permet de vérifier
 * la lecture au centime : solde précédent + opérations = nouveau solde.
 */

import { cardLabel } from "./statements.ts";

export type CeOperation = { date: string; label: string; detail: string; amount: number };
export type CeAccount = {
  /** Numéro du compte (11 derniers chiffres du RIB imprimé). */
  number: string;
  name: string;
  from: string;
  to: string;
  before: number;
  after: number;
  operations: CeOperation[];
  /** Solde précédent + opérations = nouveau solde. */
  balanced: boolean;
};

const amountAt = (line: string): { value: number; end: number } | null => {
  const m = /(\d{1,3}(?:[  ]\d{3})*,\d{2})\s*$/.exec(line);
  return m ? { value: Number(m[1].replace(/[  ]/g, "").replace(",", ".")), end: m.index + m[1].length } : null;
};
const isoDay = (d: string, m: string, y: string) => `20${y}-${m}-${d}`;

/** Lit le texte d'un relevé (mise en page conservée) et renvoie ses comptes. */
export function parseCeStatement(text: string): CeAccount[] {
  const accounts: CeAccount[] = [];
  let current: CeAccount | null = null;
  let pending: { number: string; name: string } | null = null;
  let dateCol = 0;
  let debitEnd = 0;
  let creditEnd = 0;
  let last: CeOperation | null = null;
  const close = () => {
    if (!current) return;
    const sum = current.operations.reduce((s, o) => s + Math.round(o.amount * 100), 0);
    current.balanced = Math.round(current.before * 100) + sum === Math.round(current.after * 100);
    accounts.push(current);
    current = null;
    last = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    // En-tête d'un compte : « … COMPTE DE DEPOT - N° 13825 00200 04592281710 » ou « … - LIV.A EN CPTE - N° … (suite) ».
    const head = /^\s*(.*?)\s*-?\s*N° \d{5} \d{5} (\d{11})\s*(\(suite\))?$/.exec(line);
    if (head) {
      if (head[3] && current && current.number === head[2]) continue;
      if (!current || current.number !== head[2]) pending = { number: head[2], name: head[1].replace(/\s+/g, " ").replace(/^\d{6,}\s+/, "").replace(/\s*-\s*$/, "").trim() };
      continue;
    }
    if (/Détail des opérations en euros/.test(line)) {
      dateCol = line.indexOf("Date");
      debitEnd = line.indexOf("Débit") + "Débit".length;
      creditEnd = line.indexOf("Crédit") + "Crédit".length;
      continue;
    }
    const side = (end: number) => (Math.abs(end - creditEnd) <= Math.abs(end - debitEnd) ? 1 : -1);
    // Le premier relevé d'un compte porte « SOLDE PRECEDENT » sans date ni montant : il part de zéro.
    const before = /SOLDE PRECEDENT(?: AU (\d{2})\/(\d{2})\/(\d{2}))?/.exec(line);
    if (before) {
      close();
      const a = amountAt(line);
      current = { number: pending?.number ?? "", name: pending?.name ?? "", from: before[1] ? isoDay(before[1], before[2], before[3]) : "", to: "", before: a ? side(a.end) * a.value : 0, after: 0, operations: [], balanced: false };
      continue;
    }
    if (!current) continue;
    const after = /NOUVEAU SOLDE (?:CREDITEUR|DEBITEUR)? ?AU (\d{2})\/(\d{2})\/(\d{2})/.exec(line);
    if (after) {
      const a = amountAt(line.replace(/\(en francs[^)]*\)/, (m) => " ".repeat(m.length)));
      current.to = isoDay(after[1], after[2], after[3]);
      current.after = a ? side(a.end) * a.value : 0;
      if (!current.from) {
        // Relevé d'ouverture : l'année de chaque opération se déduit de la fin du relevé, le début est la première opération.
        const [ty, tm] = [Number(after[3]), Number(after[2])];
        for (const o of current.operations) o.date = isoDay(o.date.slice(8, 10), o.date.slice(5, 7), String(Number(o.date.slice(5, 7)) > tm ? ty - 1 : ty).padStart(2, "0"));
        current.from = current.operations.map((o) => o.date).sort()[0] ?? current.to;
      }
      close();
      continue;
    }
    // Une opération commence par sa date, dans la colonne « Date » (la marge gauche peut porter autre chose).
    let op: { day: string; month: string; start: number } | null = null;
    for (const m of line.matchAll(/(\d{2})\/(\d{2})\s+(?=\*?\s*\S)/g)) {
      if (Math.abs(m.index - dateCol) <= 3) {
        op = { day: m[1], month: m[2], start: m.index + m[0].length };
        break;
      }
    }
    const a = op ? amountAt(line) : null;
    if (op && a && a.end > op.start) {
      // L'année est celle de la période du relevé : un relevé de janvier porte encore des opérations de décembre.
      const [fy, fm] = [Number(current.from.slice(2, 4)), Number(current.from.slice(5, 7))];
      const year = !current.from ? 0 : Number(op.month) < fm ? fy + 1 : fy;
      const label = line
        .slice(op.start, a.end)
        .replace(/\d{1,3}(?:[  ]\d{3})*,\d{2}\s*$/, "")
        .replace(/\s+/g, " ")
        .replace(/^\*\s*/, "")
        .trim();
      last = { date: isoDay(op.day, op.month, String(year).padStart(2, "0")), label, detail: "", amount: side(a.end) * a.value };
      current.operations.push(last);
      continue;
    }
    // Ligne de détail d'une opération (motif, référence) : rattachée à la dernière opération.
    const detail = line.trim();
    if (last && detail && !/^(Virements reçus|Prélèvements|Paiements? |Retraits|Frais bancaires|Chèques|Opérations|Remises|Versements|\* Les lignes)/.test(detail) && !/ORIAS|Caisse d'Epargne et de Pr|Capital de |Page \d|^\d{4,}( \d+)?$|^EN\d+$|NS0300C/.test(detail) && detail.length < 110 && /^\s{10,}/.test(line))
      last.detail = (last.detail ? `${last.detail} · ` : "") + detail;
  }
  close();
  return accounts.filter((a) => a.number);
}

/**
 * Libellé d'une opération tel que la banque de Pécule l'écrirait : un achat par carte
 * (« CB LEROY MERLIN FACT 090620 ») devient « CARTE 09/06/20 LEROY MERLIN », pour que le jour d'achat, le
 * marchand et les règles de classement se lisent comme ailleurs ; un virement garde son motif.
 */
export function ceLabel(o: CeOperation): string {
  const card = cardLabel(o.label);
  if (card !== o.label) return card;
  const motif = o.detail.split(" · ").find((d) => d && !/^-?R[ée]f\./i.test(d) && !/^\d[\d\s/.-]*$/.test(d));
  return motif && /^(VIR|VIREMENT|PRLV)/.test(o.label) && !o.label.includes(motif) ? `${o.label} ${motif}`.slice(0, 250) : o.label;
}
