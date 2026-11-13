/*
 * Outils purs du générateur démo : hasard déterministe (mulberry32 sur une graine texte), dates en
 * chaînes « AAAA-MM-JJ » calculées en UTC, montants arrondis au centime.
 */

export type DemoUser = { id: number; name: string };

/** Ligne à insérer dans une table Drizzle. */
export type Insert<T extends { $inferInsert: unknown }> = T["$inferInsert"];

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Empreinte FNV-1a 32 bits d'un texte (graines, petites variations reproductibles). */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même graine → même suite. */
export class Rand {
  private s: number;
  constructor(seed: string) {
    this.s = fnv1a(seed);
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }
  weighted<T>(list: readonly (readonly [T, number])[]): T {
    const total = list.reduce((s, [, w]) => s + w, 0);
    let x = this.next() * total;
    for (const [v, w] of list) {
      x -= w;
      if (x < 0) return v;
    }
    return list[list.length - 1][0];
  }
  amount(min: number, max: number): number {
    return r2(min + this.next() * (max - min));
  }
  /** Nombre d'événements d'une loi de Poisson de moyenne `mean`. */
  count(mean: number): number {
    if (mean <= 0) return 0;
    const limit = Math.exp(-mean);
    let k = 0;
    let p = this.next();
    while (p > limit) {
      k++;
      p *= this.next();
    }
    return k;
  }
  /** Loi normale centrée réduite, approchée par une somme d'uniformes. */
  normal(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * Math.sqrt(3);
  }
  hex(n: number): string {
    let s = "";
    while (s.length < n) s += Math.floor(this.next() * 16).toString(16);
    return s;
  }
  uuid(): string {
    const h = this.hex(32);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[this.int(0, 3)]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
  }
  shuffle<T>(list: readonly T[]): T[] {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

/* ---------- Dates ---------- */

const DAY = 86_400_000;
export const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fromMs(toMs(d) + n * DAY);
export const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const yearOf = (d: string) => Number(d.slice(0, 4));
export const monthOf = (d: string) => Number(d.slice(5, 7));
export const dayOf = (d: string) => Number(d.slice(8, 10));

/** Date d'un jour du mois : mois hors bornes ramené dans l'année, jour borné à la fin du mois. */
export function ymd(y: number, m: number, d: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1));
  const yy = first.getUTCFullYear();
  const mm = first.getUTCMonth() + 1;
  return `${yy}-${pad(mm)}-${pad(Math.min(Math.max(1, d), daysIn(yy, mm)))}`;
}

export const addMonths = (d: string, n: number, dayOfMonth = dayOf(d)) => ymd(yearOf(d), monthOf(d) + n, dayOfMonth);
export const lastOfMonth = (d: string) => ymd(yearOf(d), monthOf(d), 31);
export const monthIndex = (d: string) => yearOf(d) * 12 + monthOf(d) - 1;
const weekday = (d: string) => new Date(toMs(d)).getUTCDay();
/** Jour ouvré : un samedi ou un dimanche passe au vendredi précédent (paie) ou au lundi suivant (prélèvements). */
export const workdayBefore = (d: string) => (weekday(d) === 6 ? addDays(d, -1) : weekday(d) === 0 ? addDays(d, -2) : d);
export const workdayAfter = (d: string) => (weekday(d) === 6 ? addDays(d, 2) : weekday(d) === 0 ? addDays(d, 1) : d);
/** Date d'achat telle que l'écrit la banque dans un libellé de carte : « 17 02 26 ». */
export const cardDay = (d: string) => `${d.slice(8, 10)} ${d.slice(5, 7)} ${d.slice(2, 4)}`;
export const dateFr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** Date du jour à Paris, comme le serveur (`toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" })`). */
export const parisDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

export const MOIS = ["Janvier", "Fevrier", "Mars", "Avril", "Mai", "Juin", "Juillet", "Aout", "Septembre", "Octobre", "Novembre", "Decembre"];

/** « 1 234,56 € » (espaces simples : le texte va aussi dans des PDF en WinAnsi). */
export function eur(n: number, decimals = 2): string {
  const [int, dec] = Math.abs(n).toFixed(decimals).split(".");
  return `${n < 0 ? "-" : ""}${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${dec ? `,${dec}` : ""} €`;
}

/**
 * Code titulaire d'un compte personnel (`accounts.owner`) : le prénom du membre en minuscules, car le
 * serveur reconnaît « ses » comptes par `LOWER(users.name)` (périmètre « Moi », quote-part du patrimoine).
 */
export const memberKey = (name: string) => name.trim().toLowerCase().slice(0, 16);
