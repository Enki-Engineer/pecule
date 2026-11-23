import { cardDay, couldBe, learnAccounts, type BankRow, type BankTx } from "./bourso.ts";

/*
 * Historique de la banque. Finta ne garde qu'environ trois mois ; la banque (export « Exporter les
 * opérations » de BoursoBank) et un agrégateur gardent tout depuis l'ouverture des comptes. Ici, sans
 * base de données : quelles lignes de la banque manquent dans Pécule, à quelle date et sous quel
 * libellé les créer pour qu'elles ressemblent aux opérations venues de Finta.
 */

/** Ligne d'un relevé de la banque ; `card` = compte de carte à débit différé. */
export type HistoryRow = BankRow & { card: boolean };

const DAY = 86400_000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);

/** Dimanche de Pâques (calendrier grégorien). */
function easter(y: number): Date {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return utc(y, Math.floor(n / 31) - 1, (n % 31) + 1);
}

/**
 * Jour ouvré des banques (calendrier TARGET : ni samedi, ni dimanche, ni 1er janvier, Vendredi
 * saint, lundi de Pâques, 1er mai, 25 et 26 décembre). Le 8 mai, le 14 juillet ou le 1er novembre
 * sont ouvrés : les relevés de carte y sont bien débités.
 */
export function isBankDay(day: string): boolean {
  const d = new Date(`${day}T00:00:00Z`);
  const w = d.getUTCDay();
  if (w === 0 || w === 6) return false;
  const e = easter(d.getUTCFullYear());
  const closed = ["01-01", "05-01", "12-25", "12-26"].map((x) => `${d.getUTCFullYear()}-${x}`).concat(iso(addDays(e, -2)), iso(addDays(e, 1)));
  return !closed.includes(day);
}

/**
 * Jour où un achat par carte à débit différé est daté dans Pécule, d'après sa date d'opération à
 * la banque (le lendemain de l'achat, en général) : le premier jour ouvré du mois suivant, ou du
 * mois d'après pour une opération du dernier jour ouvré du mois. C'est la date que Finta donne à
 * ces achats (vérifiée sur ceux de 2026) : l'historique repris de la banque tombe ainsi dans les
 * mêmes mois que le reste. Le vrai relevé de la banque s'arrête un jour ouvré plus tôt (`early`,
 * règle retrouvée au centime sur 147 relevés sur 148 de 2020 à 2026).
 */
export function debitDay(opDate: string, early = false): string {
  const [y, m] = opDate.split("-").map(Number);
  let cutoff = utc(y, m, 0); // dernier jour du mois
  const back = () => {
    while (!isBankDay(iso(cutoff))) cutoff = addDays(cutoff, -1);
  };
  back();
  for (let i = 0; i < (early ? 2 : 1); i++) {
    cutoff = addDays(cutoff, -1);
    back();
  }
  let debit = utc(y, m + (opDate > iso(cutoff) ? 1 : 0), 1);
  while (!isBankDay(iso(debit))) debit = addDays(debit, 1);
  return iso(debit);
}

/**
 * Libellé d'une ligne de la banque, écrit comme Finta l'écrit : ponctuation en espaces, une
 * majuscule par mot (« CARTE 14/04/26 EU.STORE.COM » → « Carte 14 04 26 Eu Store Com »). La nature
 * de l'opération, le nom du marchand et le jour d'achat se lisent ainsi comme pour le reste.
 */
export function historyLabel(label: string): string {
  return (
    label
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase()
      .replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase()) || "(sans libellé)"
  );
}

/** Date de l'opération dans Pécule : le jour du prélèvement pour une carte à débit différé, sinon la date de la banque. */
export const historyDate = (r: HistoryRow) => (r.card ? debitDay(r.date) : r.date);

const cents = (n: number) => Math.round(Number(n) * 100);
const gap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/** Cette opération peut-elle être cette ligne ? Comme pour les libellés, plus le cas d'une ligne de carte sans jour d'achat. */
function fits(t: BankTx, r: HistoryRow): boolean {
  if (couldBe(t, r)) return true;
  // Achat en devise, commission : Finta n'en garde que le cours (« 59 99 Pln 1 Euro 4 … »), sans jour d'achat ;
  // l'opération porte la date du prélèvement de la ligne.
  return r.card && !cardDay(t.label) && t.date === debitDay(r.date);
}

export type Reconciled<R extends HistoryRow> = {
  /** Compte de l'export → compte de Pécule (celui que désignent le plus de couples sûrs). */
  accounts: Map<string, string>;
  /** Lignes déjà dans Pécule, avec l'opération qui leur correspond. */
  pairs: { row: R; txId: string }[];
  /** Lignes absentes de Pécule. */
  missing: R[];
  /** Lignes sans couple, mais qu'une opération d'un autre compte pourrait être : on ne crée pas. */
  doubtful: R[];
  /** Opérations de Pécule sans ligne, par compte, dans la période que couvre l'export de ce compte. */
  orphans: Map<string, number>;
};

/**
 * Rapproche les lignes de la banque des opérations de Pécule, une pour une : même compte (appris
 * des couples sans équivoque), même montant, même jour d'achat pour une carte, quatre jours d'écart
 * au plus sinon. Trois achats identiques le même jour contre deux opérations = une ligne manquante.
 * Les opérations écartées comme doublons doivent être fournies aussi : elles couvrent leur ligne.
 * `forced` : compte de l'export → compte de Pécule imposé (prioritaire sur l'apprentissage).
 */
export function reconcileHistory<R extends HistoryRow>(txs: BankTx[], rows: R[], forced?: Map<string, string>): Reconciled<R> {
  const { mapped, votes } = learnAccounts(txs, rows);
  const accounts = new Map<string, string>();
  for (const [account, ids] of mapped) {
    const v = votes.get(account)!;
    accounts.set(account, [...ids].sort((a, b) => (v.get(b) ?? 0) - (v.get(a) ?? 0))[0]);
  }
  // Compte désigné à la main : il l'emporte sur ce que les couples apprennent. Deux membres du foyer qui
  // virent le même jour la même somme au compte commun feraient sinon passer le compte de l'un pour celui de l'autre.
  for (const [account, id] of forced ?? []) {
    mapped.set(account, new Set([id]));
    accounts.set(account, id);
  }

  const txsByCents = new Map<number, BankTx[]>();
  for (const t of txs) {
    const list = txsByCents.get(cents(t.amount));
    if (list) list.push(t);
    else txsByCents.set(cents(t.amount), [t]);
  }
  const rowsByCents = new Map<number, R[]>();
  for (const r of rows) {
    const list = rowsByCents.get(cents(r.amount));
    if (list) list.push(r);
    else rowsByCents.set(cents(r.amount), [r]);
  }

  const txOf = new Map<R, BankTx>();
  const taken = new Set<string>();
  for (const [amount, rs] of rowsByCents) {
    const ts = txsByCents.get(amount);
    if (!ts) continue;
    rs.sort((a, b) => a.date.localeCompare(b.date));
    // Opérations possibles de chaque ligne, les plus proches d'abord.
    const options = rs.map((r) =>
      ts
        .map((t, j) => ({ j, t }))
        .filter(({ t }) => mapped.get(r.account)?.has(t.accountId) && fits(t, r))
        .sort((a, b) => gap(a.t.date, historyDate(r)) - gap(b.t.date, historyDate(r)))
        .map(({ j }) => j),
    );
    // Couplage maximal (chemins augmentants) : une opération ne couvre qu'une ligne.
    const rowOfTx = new Array<number>(ts.length).fill(-1);
    const place = (i: number, seen: Set<number>): boolean => {
      for (const j of options[i]) {
        if (seen.has(j)) continue;
        seen.add(j);
        if (rowOfTx[j] < 0 || place(rowOfTx[j], seen)) {
          rowOfTx[j] = i;
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < rs.length; i++) if (options[i].length) place(i, new Set());
    rowOfTx.forEach((i, j) => {
      if (i < 0) return;
      txOf.set(rs[i], ts[j]);
      taken.add(ts[j].id);
    });
  }

  const out: Reconciled<R> = { accounts, pairs: [], missing: [], doubtful: [], orphans: new Map() };
  const span = new Map<string, { from: string; to: string }>();
  for (const r of rows) {
    const t = txOf.get(r);
    if (t) out.pairs.push({ row: r, txId: t.id });
    // Compte désigné : seule une opération de ce compte peut encore être cette ligne, celles des autres comptes ne font pas douter.
    else if ((txsByCents.get(cents(r.amount)) ?? []).some((x) => !taken.has(x.id) && fits(x, r) && (!forced?.has(r.account) || x.accountId === forced.get(r.account)))) out.doubtful.push(r);
    else out.missing.push(r);
    const target = accounts.get(r.account);
    if (!target) continue;
    const day = historyDate(r);
    const s = span.get(target);
    if (!s) span.set(target, { from: r.date, to: day });
    else {
      if (r.date < s.from) s.from = r.date;
      if (day > s.to) s.to = day;
    }
  }
  for (const t of txs) {
    const s = span.get(t.accountId);
    if (!s || taken.has(t.id) || t.date < s.from || t.date > s.to) continue;
    out.orphans.set(t.accountId, (out.orphans.get(t.accountId) ?? 0) + 1);
  }
  return out;
}

/** Rang d'une ligne parmi les lignes identiques (même compte, même jour, même montant, même libellé) : deux cafés le même jour restent deux opérations. */
export function rowRanks<R extends HistoryRow>(rows: R[]): Map<R, number> {
  const seen = new Map<string, number>();
  const out = new Map<R, number>();
  for (const r of rows) {
    const key = `${r.account}|${r.date}|${cents(r.amount)}|${r.label}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    out.set(r, n);
  }
  return out;
}

/** La catégorie la plus fréquente d'une liste, si elle domine (part et nombre minimaux). */
export function dominant(counts: Map<string, number> | undefined, minShare: number, minCount: number): string | null {
  if (!counts?.size) return null;
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const [id, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return n >= minCount && n / total >= minShare ? id : null;
}

export { cardDay };
