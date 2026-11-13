import { labelKey } from "./labels.ts";

/*
 * Libellés de la banque. Finta (GoCardless) ne transmet souvent qu'une référence pour les
 * prélèvements et les virements SEPA (« 04170 N2200000000000000 ») ; l'export « Exporter les
 * opérations » de BoursoBank porte, lui, le nom du créancier (« PRLV SEPA TOTALENERGIES… »).
 * Ici : lecture de l'export, rapprochement avec les opérations de Pécule, nom à afficher.
 */

export type BankRow = {
  /** Date d'opération AAAA-MM-JJ (pour une carte : le lendemain de l'achat). */
  date: string;
  label: string;
  /** « Libellé suggéré » : le nom du marchand quand la banque l'a reconnu. */
  suggested: string | null;
  amount: number;
  /** Numéro du compte dans l'export (sert seulement à distinguer les comptes entre eux). */
  account: string;
  /** Catégorie de la banque (« Catégorie parente › Catégorie »), lue seulement à la demande. */
  category?: string | null;
};

export type BankTx = { id: string; accountId: string; date: string; amount: number; label: string };

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/** Découpe un CSV à points-virgules (champs entre guillemets, guillemets doublés, retours à la ligne dans un champ). */
function splitCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field), (field = "");
      if (row.some((f) => f.trim())) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) out.push(row);
  return out;
}

const isoDate = (s: string): string | null => {
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};

const amountOf = (s: string): number | null => {
  const t = s.replace(/\s/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

/**
 * Lit l'export CSV de BoursoBank. Les colonnes sont repérées par leur intitulé (l'export de 2026
 * nomme « Solde » la colonne du montant, avant le vrai solde ; l'ancien format parlait anglais).
 * Renvoie une liste vide si le fichier n'est pas un export d'opérations.
 */
export function parseBoursoCsv(text: string, opts: { categories?: boolean } = {}): BankRow[] {
  const lines = splitCsv(text);
  if (lines.length < 2) return [];
  const head = lines[0].map(plain);
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const date = col("date operation", "dateop");
  const label = col("libelle", "label");
  const suggested = col("libelle suggere", "supplierfound");
  const account = col("numero compte", "accountnum");
  const amount = col("montant", "amount") >= 0 ? col("montant", "amount") : col("solde");
  const category = col("categorie", "category");
  const parent = col("categorie parente", "categoryparent");
  if (date < 0 || label < 0 || amount < 0) return [];
  const rows: BankRow[] = [];
  for (const l of lines.slice(1)) {
    const d = isoDate(l[date] ?? "");
    const a = amountOf(l[amount] ?? "");
    const text = (l[label] ?? "").replace(/\s+/g, " ").trim();
    if (!d || a == null || !text) continue;
    const row: BankRow = { date: d, label: text, suggested: (suggested >= 0 && l[suggested]?.trim()) || null, amount: a, account: (account >= 0 && l[account]?.trim()) || "" };
    if (opts.categories) {
      const c = (category >= 0 && l[category]?.trim()) || "";
      const p = (parent >= 0 && l[parent]?.trim()) || "";
      row.category = c ? (p && p !== c ? `${p} › ${c}` : c) : null;
    }
    rows.push(row);
  }
  return rows;
}

const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s\-'.(/])\p{L}/gu, (c) => c.toUpperCase()) : s);

/**
 * Nom de la contrepartie d'un prélèvement ou d'un virement, d'après le libellé de la banque :
 * le nom reconnu par BoursoBank s'il existe (« TotalEnergies Power & Gas »), sinon le créancier
 * du libellé (« PRLV SEPA SAS MULTI IMPACT » → « Sas Multi Impact »). Rien pour une carte, un
 * retrait ou un virement sans nom (« VIR Virement de… ») : le libellé de Finta dit déjà tout.
 */
export function bankCounterparty(label: string, suggested?: string | null): string | null {
  const m = /^(?:PRLV SEPA|VIR SEPA|VIR INST)\s+(.+)$/i.exec(label.trim());
  if (!m) return null;
  const known = suggested?.trim();
  const raw = known && !/^(vir|prlv|carte|avoir|retrait)\b/i.test(known) ? known : titleCase(m[1].trim());
  // « GC RE » : préfixe des prélèvements passés par GoCardless.
  const name = raw.replace(/^GC RE\s+/i, "").trim();
  return name.length >= 2 ? name.slice(0, 160) : null;
}

const words = (s: string) => new Set(labelKey(s).split(" ").filter((w) => w.length >= 3));
const shared = (a: Set<string>, b: Set<string>) => [...a].filter((w) => b.has(w)).length;

/** Le nom de la banque apporte-t-il quelque chose ? Non si le libellé de Pécule le contient déjà. */
export function nameAddsInfo(txLabel: string, name: string): boolean {
  const n = words(name);
  return n.size > 0 && shared(n, words(txLabel)) === 0;
}

/** Jour d'achat écrit dans un libellé de carte (« Carte 17 02 26 … », « CARTE 17/02/26 … », « Avoir … »). */
export const cardDay = (label: string): string | null => {
  const m = /^(?:carte|avoir)\s+(\d{2})[\s/](\d{2})[\s/](\d{2})\b/i.exec(label.trim());
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
};
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;
const cents = (n: number) => Math.round(Number(n) * 100);

/** Une ligne de l'export peut-elle être cette opération ? Même montant ; même jour d'achat pour une carte, sinon 4 jours d'écart au plus. */
export function couldBe(t: BankTx, r: BankRow): boolean {
  const tc = cardDay(t.label);
  const rc = cardDay(r.label);
  if (tc || rc) return tc && rc ? tc === rc : !tc && dayGap(t.date, r.date) <= 4;
  return dayGap(t.date, r.date) <= 4;
}

/**
 * Quel compte de Pécule correspond à quel compte de l'export ? Appris des couples sans équivoque
 * (une seule ligne possible pour l'opération, et réciproquement) : au moins 2 couples sûrs et un
 * quart des voix. Renvoie aussi les lignes possibles de chaque opération et les voix par compte.
 */
export function learnAccounts(txs: BankTx[], rows: BankRow[]) {
  const byCents = new Map<number, BankRow[]>();
  for (const r of rows) {
    const list = byCents.get(cents(r.amount));
    if (list) list.push(r);
    else byCents.set(cents(r.amount), [r]);
  }
  const candidates = new Map<string, BankRow[]>();
  const wanted = new Map<BankRow, number>();
  for (const t of txs) {
    const list = (byCents.get(cents(t.amount)) ?? []).filter((r) => couldBe(t, r));
    candidates.set(t.id, list);
    for (const r of list) wanted.set(r, (wanted.get(r) ?? 0) + 1);
  }

  const votes = new Map<string, Map<string, number>>();
  for (const t of txs) {
    const list = candidates.get(t.id)!;
    if (list.length !== 1 || wanted.get(list[0]) !== 1) continue;
    const v = votes.get(list[0].account) ?? new Map<string, number>();
    votes.set(list[0].account, v.set(t.accountId, (v.get(t.accountId) ?? 0) + 1));
  }
  /** Compte de l'export → comptes de Pécule qui lui correspondent. */
  const mapped = new Map<string, Set<string>>();
  const known = new Set<string>();
  for (const [account, v] of votes) {
    const total = [...v.values()].reduce((s, n) => s + n, 0);
    const ok = [...v].filter(([, n]) => n >= 2 && n / total >= 0.25).map(([id]) => id);
    if (!ok.length) continue;
    mapped.set(account, new Set(ok));
    for (const id of ok) known.add(id);
  }
  return { candidates, mapped, known, votes };
}

/**
 * Rapproche les opérations de Pécule des lignes de l'export.
 * 1. Les couples sans équivoque (une seule ligne possible pour l'opération, et réciproquement)
 *    apprennent quel compte de Pécule correspond à quel compte de l'export.
 * 2. Une ligne n'est ensuite retenue que si elle vient du bon compte : un prélèvement de même
 *    montant le même jour sur un autre compte de la famille ne prête pas son libellé.
 * 3. Entre plusieurs lignes possibles : le même jour d'abord, puis le libellé qui partage des
 *    mots avec celui de Pécule ; si plusieurs libellés restent en lice, on ne devine pas.
 */
export function matchBankRows(txs: BankTx[], rows: BankRow[]): { matches: { txId: string; row: BankRow }[]; ambiguous: number } {
  const { candidates, mapped, known } = learnAccounts(txs, rows);

  const matches: { txId: string; row: BankRow }[] = [];
  let ambiguous = 0;
  for (const t of txs) {
    const list = candidates.get(t.id)!;
    if (!list.length) continue;
    const tw = words(t.label);
    const overlap = (r: BankRow) => shared(tw, words(r.label));
    let pool = list.filter((r) => mapped.get(r.account)?.has(t.accountId));
    // Compte trop peu représenté pour être reconnu (carte clôturée…) : le libellé doit alors se ressembler.
    if (!pool.length && !known.has(t.accountId)) pool = list.filter((r) => !mapped.has(r.account) && overlap(r) > 0);
    if (!pool.length) continue;
    const sameDay = pool.filter((r) => r.date === t.date);
    if (sameDay.length) pool = sameDay;
    const labels = (l: BankRow[]) => new Set(l.map((r) => r.label));
    if (labels(pool).size > 1) {
      const best = Math.max(...pool.map(overlap));
      const top = pool.filter((r) => overlap(r) === best);
      if (best === 0 || labels(top).size > 1) {
        ambiguous++;
        continue;
      }
      pool = top;
    }
    matches.push({ txId: t.id, row: pool[0] });
  }
  return { matches, ambiguous };
}

/**
 * Une forme de libellé (`labelShape`) assez précise pour désigner un seul émetteur : elle garde
 * un code court ou un mot (« 04170 n9 », « identif9 9 9 »). Une simple suite de chiffres (« #11 »)
 * ne l'est pas : plusieurs créanciers envoient un numéro de même longueur.
 */
export function shapeIsSpecific(shape: string): boolean {
  // « Unknown », « (sans libellé) » : libellés de remplacement de Finta, communs à tous les créanciers.
  if (/^(unknown|\(sans)/.test(shape)) return false;
  return shape.split(" ").some((w) => /^\d{1,6}$/.test(w) || (w.match(/[a-z]/g) ?? []).length >= 2);
}
