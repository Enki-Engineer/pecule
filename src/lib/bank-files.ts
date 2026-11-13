/*
 * Lecture d'un fichier d'opérations exporté par une banque : OFX (et QFX), QIF, CSV. Pur et testé ; le fichier
 * est déjà du texte (l'écran se charge de l'encodage). Sert à qui ne veut relier aucun prestataire, et à
 * reprendre un historique.
 */

/** `account` : numéro du compte quand le fichier en mêle plusieurs (export de tous les comptes en un seul CSV). */
export type FileRow = { date: string; amount: number; label: string; ref: string | null; account?: string };

export type ParsedFile = {
  format: "ofx" | "qif" | "csv";
  rows: FileRow[];
  /** Lignes écartées faute de date ou de montant lisibles. */
  skipped: number;
  /** Solde annoncé par le fichier (OFX), quand il y en a un. */
  balance: { amount: number; date: string | null } | null;
  /** Devise annoncée par le fichier (OFX, `CURDEF`), quand il y en a une. */
  currency?: string | null;
  /** CSV : colonnes retenues (numéros à partir de 0), pour que l'écran dise ce qu'il a compris. */
  columns?: { date: number; label: number; amount?: number; debit?: number; credit?: number; account?: number };
};

const pad = (n: number | string) => String(n).padStart(2, "0");
const validDay = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const century = (yy: number) => (yy < 100 ? (yy > 69 ? 1900 + yy : 2000 + yy) : yy);

/**
 * Date écrite par une banque : « 2026-11-05 », « 20261105 », « 05/11/2026 », « 05.11.26 », « 5/11'26 ».
 * `monthFirst` : écriture américaine (mois avant le jour).
 */
export function parseDay(raw: string, monthFirst = false): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return validDay(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\-' ]\s?(\d{2}|\d{4})\b/.exec(s);
  if (m) return monthFirst ? validDay(century(+m[3]), +m[1], +m[2]) : validDay(century(+m[3]), +m[2], +m[1]);
  return null;
}

/** Montant écrit par une banque : « -1 234,56 », « 1.234,56 », « 1,234.56 », « (12.00) », « 12,00 € ». */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0\u202f]/g, "").replace(/[€$£]|EUR|CHF|USD|GBP/gi, "");
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  s = s.replace(/[()+-]/g, "");
  if (!/^[\d.,']+$/.test(s)) return null;
  s = s.replace(/'/g, "");
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  // Le dernier séparateur est celui des décimales ; l'autre, celui des milliers.
  if (comma > dot) s = s.replace(/\./g, "").replace(",", ".");
  else if (dot > comma) s = s.replace(/,/g, "");
  // Des points seuls par groupes de trois chiffres (« 1.234 », « 12.345.678 ») : des milliers.
  if (comma === -1 && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round((negative ? -n : n) * 100) / 100 : null;
}

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/* ---------- OFX ---------- */

function ofxField(block: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i").exec(block);
  return m ? clean(m[1]) || null : null;
}

function parseOfx(text: string): ParsedFile {
  const rows: FileRow[] = [];
  let skipped = 0;
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const body = block.split(/<\/STMTTRN>/i)[0];
    const date = parseDay(ofxField(body, "DTPOSTED") ?? ofxField(body, "DTUSER") ?? "");
    const amount = parseAmount(ofxField(body, "TRNAMT") ?? "");
    const name = ofxField(body, "NAME");
    const memo = ofxField(body, "MEMO");
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    rows.push({ date, amount, label: clean([name, memo && memo !== name ? memo : null].filter(Boolean).join(" ")) || "(sans libellé)", ref: ofxField(body, "FITID") });
  }
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|$)/i.exec(text)?.[1] ?? "";
  const amount = parseAmount(ofxField(ledger, "BALAMT") ?? "");
  const currency = (ofxField(text, "CURDEF") ?? "").toUpperCase();
  return { format: "ofx", rows, skipped, balance: amount === null ? null : { amount, date: parseDay(ofxField(ledger, "DTASOF") ?? "") }, currency: /^[A-Z]{3}$/.test(currency) ? currency : null };
}

/* ---------- QIF ---------- */

function parseQif(text: string): ParsedFile {
  const records = text
    .split(/^\^\s*$/m)
    .map((r) => r.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("!")))
    .filter((r) => r.length);
  const field = (r: string[], code: string) => r.find((l) => l.startsWith(code))?.slice(1).trim() ?? "";
  // Un fichier américain écrit le mois d'abord : reconnu quand un « jour » dépasse 12 en seconde position.
  const monthFirst = records.some((r) => {
    const m = /^(\d{1,2})[/.\- ](\d{1,2})/.exec(field(r, "D"));
    return !!m && +m[2] > 12 && +m[1] <= 12;
  });
  const rows: FileRow[] = [];
  let skipped = 0;
  for (const r of records) {
    const date = parseDay(field(r, "D"), monthFirst);
    const amount = parseAmount(field(r, "T") || field(r, "U"));
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    const payee = field(r, "P");
    const memo = field(r, "M");
    rows.push({ date, amount, label: clean([payee, memo && memo !== payee ? memo : null].filter(Boolean).join(" ")) || "(sans libellé)", ref: field(r, "N") || null });
  }
  return { format: "qif", rows, skipped, balance: null };
}

/* ---------- CSV ---------- */

/** Découpe un texte CSV (guillemets doublés, séparateur au choix, retours à la ligne dans une cellule). */
export function splitCsv(text: string, sep: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim())) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((v) => v.trim())) out.push(row);
  return out;
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const HEADERS = {
  date: /^(date ?(d[e' ]? ?)?(operation|op|comptabilisation|ecriture|valeur)?|dateop|booking ?date|transaction ?date|datum|buchungstag|fecha|data)$/,
  label: /libelle|label|description|intitule|designation|wording|details?|concepto|verwendungszweck|buchungstext|descrizione|payee|^name$|^memo$|^objet$/,
  amount: /^(montant|amount|betrag|importe|importo|valeur|value)\b/,
  debit: /debit|sortie|depense|soll|cargo|addebito|uscita/,
  credit: /credit|entree|recette|haben|abono|accredito|entrata/,
  account: /^(numero ?(de )?compte|n° ?(de )?compte|account ?(num(ber)?|no|id)?|iban|compte|konto(nummer)?|numero ?de ?cuenta|cuenta|conto)$/,
};

function parseCsv(text: string): ParsedFile {
  const head = text.split(/\r?\n/).slice(0, 12).join("\n");
  const sep = [";", "\t", ","].map((s) => [s, head.split(s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const table = splitCsv(text.replace(/^\ufeff/, ""), sep);
  const empty: ParsedFile = { format: "csv", rows: [], skipped: 0, balance: null };
  if (!table.length) return empty;

  // Ligne d'en-tête : la première qui nomme une date et un libellé (un préambule peut la précéder).
  let start = 0;
  let columns: ParsedFile["columns"] | null = null;
  for (let i = 0; i < Math.min(table.length, 15) && !columns; i++) {
    const names = table[i].map(plain);
    const find = (re: RegExp, except: number[] = []) => names.findIndex((n, j) => !except.includes(j) && re.test(n));
    const date = find(HEADERS.date);
    const label = find(HEADERS.label);
    if (date < 0 || label < 0) continue;
    const debit = find(HEADERS.debit, [date, label]);
    const credit = find(HEADERS.credit, [date, label, debit]);
    const amount = find(HEADERS.amount, [date, label, debit, credit]);
    if (amount < 0 && (debit < 0 || credit < 0)) continue;
    columns = amount >= 0 ? { date, label, amount } : { date, label, debit, credit };
    const account = find(HEADERS.account, [date, label, debit, credit, amount]);
    if (account >= 0) columns.account = account;
    start = i + 1;
  }
  // Pas d'en-tête reconnu : on regarde le contenu des colonnes.
  if (!columns) {
    const width = table.reduce((w, r) => Math.max(w, r.length), 0);
    const sample = table.slice(0, 60);
    const share = (j: number, ok: (v: string) => boolean) => sample.filter((r) => ok(r[j] ?? "")).length / sample.length;
    const cols = Array.from({ length: width }, (_, j) => j);
    const date = cols.find((j) => share(j, (v) => parseDay(v) !== null) > 0.7);
    if (date === undefined) return empty;
    const amount = cols.find((j) => j !== date && share(j, (v) => /[.,]\d{2}\b/.test(v) && parseAmount(v) !== null) > 0.7);
    const label = cols
      .filter((j) => j !== date && j !== amount)
      .sort((a, b) => sample.reduce((n, r) => n + (r[b]?.length ?? 0), 0) - sample.reduce((n, r) => n + (r[a]?.length ?? 0), 0))[0];
    if (amount === undefined || label === undefined) return empty;
    columns = { date, label, amount };
  }

  // Écriture américaine (mois d'abord) : reconnue quand un « jour » dépasse 12 en seconde position.
  const monthFirst = table.slice(start).some((r) => {
    const m = /^(\d{1,2})[/.\- ](\d{1,2})[/.\- ]/.exec((r[columns!.date] ?? "").trim());
    return !!m && +m[2] > 12 && +m[1] <= 12;
  });
  const rows: FileRow[] = [];
  let skipped = 0;
  for (const r of table.slice(start)) {
    const date = parseDay(r[columns.date] ?? "", monthFirst);
    let amount: number | null;
    if (columns.amount !== undefined) amount = parseAmount(r[columns.amount] ?? "");
    else {
      const debit = parseAmount(r[columns.debit!] ?? "");
      const credit = parseAmount(r[columns.credit!] ?? "");
      amount = debit === null && credit === null ? null : Math.round(((credit ?? 0) - Math.abs(debit ?? 0)) * 100) / 100;
    }
    if (!date || amount === null) {
      skipped++;
      continue;
    }
    const account = columns.account !== undefined ? clean(r[columns.account] ?? "") : "";
    rows.push({ date, amount, label: clean(r[columns.label] ?? "") || "(sans libellé)", ref: null, ...(account ? { account } : {}) });
  }
  return { format: "csv", rows, skipped, balance: null, columns };
}

/** Lit un fichier d'opérations, quel que soit son format (reconnu d'après son contenu). */
export function parseBankFile(text: string): ParsedFile {
  if (/<OFX>|<STMTTRN>/i.test(text)) return parseOfx(text);
  if (/^!Type:/im.test(text) || /^\^\s*$/m.test(text)) return parseQif(text);
  return parseCsv(text);
}

/** Comptes mêlés dans un fichier (CSV de tous les comptes) : leurs numéros et le nombre de lignes de chacun. */
export function fileAccounts(f: ParsedFile): { account: string; rows: number }[] {
  const count = new Map<string, number>();
  for (const r of f.rows) if (r.account) count.set(r.account, (count.get(r.account) ?? 0) + 1);
  return [...count].map(([account, rows]) => ({ account, rows })).sort((a, b) => b.rows - a.rows);
}
