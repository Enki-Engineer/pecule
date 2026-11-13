/*
 * Thèmes de l'année : l'appli change d'allure d'elle-même — fond, couleur, boutons,
 * typographie des titres, motif et petit décor. Deux niveaux :
 *  - les fêtes (Jour de l'an, Épiphanie, Chandeleur, Saint-Valentin, Saint-Patrick, Pâques, 14 Juillet,
 *    Rentrée, Halloween, Fête des Lumières, Noël), courtes et marquées ;
 *  - les saisons (hiver, printemps, été, automne), plus douces, le reste de l'année.
 * Même calcul dans public/theme-init.js (appliqué avant le premier rendu) : à modifier aux deux endroits.
 * Une fête de plus = cette liste, FETES ci-dessous, theme-init.js, sa palette (src/styles/index.css), son
 * décor (SeasonDecor.tsx), son coffre (scripts/logo.mjs, LOGO_THEMES) et son unité amusante (src/lib/fun.ts).
 */

import { localized, tk } from "./i18n.ts";

export type Fete = "anniversaire" | "nouvel-an" | "epiphanie" | "chandeleur" | "saint-valentin" | "saint-patrick" | "paques" | "14-juillet" | "rentree" | "halloween" | "fete-lumieres" | "noel";
export type Saison = "hiver" | "printemps" | "ete" | "automne";
export type Season = Fete | Saison;

/** Réglage « Thèmes de l'année » : fêtes et saisons, fêtes seulement, ou aucun. */
export type SeasonMode = "tout" | "fetes" | "aucun";

export const SEASONS: Record<Season, { label: string; emoji: string; greeting: string | null; kind: "fete" | "saison"; dates: string }> = {
  anniversaire: localized({ label: tk("Anniversaire"), emoji: "🎂", greeting: tk("Joyeux anniversaire"), kind: "fete", dates: tk("le jour de chaque anniversaire saisi dans Réglages") }, "label", "greeting", "dates"),
  "nouvel-an": localized({ label: tk("Jour de l'an"), emoji: "🥂", greeting: tk("Bonne année"), kind: "fete", dates: tk("du 27 décembre au 3 janvier") }, "label", "greeting", "dates"),
  epiphanie: localized({ label: tk("Épiphanie"), emoji: "👑", greeting: tk("Bonne Épiphanie"), kind: "fete", dates: tk("du 4 au 10 janvier") }, "label", "greeting", "dates"),
  chandeleur: localized({ label: tk("Chandeleur"), emoji: "🥞", greeting: tk("Bonne Chandeleur"), kind: "fete", dates: tk("du 31 janvier au 2 février") }, "label", "greeting", "dates"),
  "saint-valentin": localized({ label: tk("Saint-Valentin"), emoji: "💝", greeting: tk("Joyeuse Saint-Valentin"), kind: "fete", dates: tk("du 8 au 14 février") }, "label", "greeting", "dates"),
  "saint-patrick": localized({ label: tk("Saint-Patrick"), emoji: "☘️", greeting: tk("Bonne Saint-Patrick"), kind: "fete", dates: tk("du 14 au 17 mars") }, "label", "greeting", "dates"),
  paques: localized({ label: tk("Pâques"), emoji: "🐣", greeting: tk("Joyeuses Pâques"), kind: "fete", dates: tk("des Rameaux au lundi de Pâques") }, "label", "greeting", "dates"),
  "14-juillet": localized({ label: tk("14 Juillet"), emoji: "🎆", greeting: tk("Bon 14 Juillet"), kind: "fete", dates: tk("du 12 au 14 juillet") }, "label", "greeting", "dates"),
  rentree: localized({ label: tk("Rentrée"), emoji: "✏️", greeting: tk("Bonne rentrée"), kind: "fete", dates: tk("du 25 août au 7 septembre") }, "label", "greeting", "dates"),
  halloween: localized({ label: tk("Halloween"), emoji: "🎃", greeting: tk("Joyeux Halloween"), kind: "fete", dates: tk("du 24 au 31 octobre") }, "label", "greeting", "dates"),
  "fete-lumieres": localized({ label: tk("Fête des Lumières"), emoji: "🕯️", greeting: tk("Belle Fête des Lumières"), kind: "fete", dates: tk("du 5 au 8 décembre") }, "label", "greeting", "dates"),
  noel: localized({ label: tk("Noël"), emoji: "🎄", greeting: tk("Joyeux Noël"), kind: "fete", dates: tk("du 1er au 26 décembre (sauf Fête des Lumières)") }, "label", "greeting", "dates"),
  hiver: localized({ label: tk("Hiver"), emoji: "❄️", greeting: null, kind: "saison", dates: tk("du 4 janvier au 19 mars") }, "label", "greeting", "dates"),
  printemps: localized({ label: tk("Printemps"), emoji: "🌸", greeting: null, kind: "saison", dates: tk("du 20 mars au 20 juin") }, "label", "greeting", "dates"),
  ete: localized({ label: tk("Été"), emoji: "☀️", greeting: null, kind: "saison", dates: tk("du 21 juin au 22 septembre") }, "label", "greeting", "dates"),
  automne: localized({ label: tk("Automne"), emoji: "🍂", greeting: null, kind: "saison", dates: tk("du 23 septembre au 30 novembre") }, "label", "greeting", "dates"),
};

/** Fêtes propres à la France : dans un autre pays, la saison (ou rien) prend leur place. */
export const FRENCH_FETES: ReadonlySet<Season> = new Set<Season>(["epiphanie", "chandeleur", "14-juillet", "rentree", "fete-lumieres"]);
/** Pays de l'hémisphère sud parmi ceux proposés : les saisons y sont inversées, on n'y applique donc aucun thème de saison. */
export const SOUTHERN: ReadonlySet<string> = new Set(["AU", "NZ", "BR", "ZA"]);
/** Un thème s'applique-t-il dans ce pays ? */
export const seasonApplies = (season: Season, country: string): boolean =>
  country === "FR" || (SEASONS[season].kind === "saison" ? !SOUTHERN.has(country) : !FRENCH_FETES.has(season));

/** Dimanche de Pâques (calendrier grégorien, algorithme de Meeus/Jones/Butcher). */
export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Fêtes d'une année civile, dans l'ordre de priorité quand deux se chevauchent (Fête des Lumières avant Noël,
 * Saint-Patrick avant Pâques) : début et fin compris. Le Jour de l'an est à cheval sur deux années.
 */
export function fetesOf(y: number): { season: Fete; start: Date; end: Date }[] {
  const e = easterSunday(y);
  return [
    { season: "nouvel-an", start: new Date(y - 1, 11, 27), end: new Date(y, 0, 3) },
    { season: "epiphanie", start: new Date(y, 0, 4), end: new Date(y, 0, 10) },
    { season: "chandeleur", start: new Date(y, 0, 31), end: new Date(y, 1, 2) },
    { season: "saint-valentin", start: new Date(y, 1, 8), end: new Date(y, 1, 14) },
    { season: "saint-patrick", start: new Date(y, 2, 14), end: new Date(y, 2, 17) },
    { season: "paques", start: new Date(y, e.getMonth(), e.getDate() - 7), end: new Date(y, e.getMonth(), e.getDate() + 1) }, // des Rameaux au lundi de Pâques
    { season: "14-juillet", start: new Date(y, 6, 12), end: new Date(y, 6, 14) },
    { season: "rentree", start: new Date(y, 7, 25), end: new Date(y, 8, 7) },
    { season: "halloween", start: new Date(y, 9, 24), end: new Date(y, 9, 31) },
    { season: "fete-lumieres", start: new Date(y, 11, 5), end: new Date(y, 11, 8) },
    { season: "noel", start: new Date(y, 11, 1), end: new Date(y, 11, 26) },
    { season: "nouvel-an", start: new Date(y, 11, 27), end: new Date(y + 1, 0, 3) },
  ];
}

/** Fête en cours à une date (heure locale), sinon null ; hors de France, sans les fêtes qui lui sont propres. */
export function feteAt(date: Date, country = "FR"): Fete | null {
  const d = dayStart(date);
  return fetesOf(d.getFullYear()).find((f) => seasonApplies(f.season, country) && d >= f.start && d <= f.end)?.season ?? null;
}

/** Saison astronomique arrondie (20 mars, 21 juin, 23 septembre), décembre étant pris par les fêtes. */
export function saisonAt(date: Date): Saison {
  const m = date.getMonth() + 1;
  const day = date.getDate();
  const md = m * 100 + day;
  if (md >= 320 && md <= 620) return "printemps";
  if (md >= 621 && md <= 922) return "ete";
  if (md >= 923 && md <= 1130) return "automne";
  return "hiver";
}

/** Anniversaire d'un proche (saisi dans Réglages, partagé par le foyer) : un jour et un mois ; l'année de naissance est facultative. */
export type Birthday = { name: string; month: number; day: number; year?: number };

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Liste d'anniversaires valide tirée d'une valeur quelconque (réglage gardé sur l'appareil, corps d'une requête) : 12 au plus. */
export function parseBirthdays(raw: unknown): Birthday[] {
  if (!Array.isArray(raw)) return [];
  const out: Birthday[] = [];
  for (const b of raw as { name?: unknown; month?: unknown; day?: unknown; year?: unknown }[]) {
    const name = typeof b?.name === "string" ? b.name.trim().slice(0, 40) : "";
    const month = Number(b?.month);
    const day = Number(b?.day);
    const year = Number(b?.year);
    if (!(name && Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= DAYS_IN_MONTH[month - 1]!)) continue;
    // Année gardée si elle est plausible (et le 29 février, seulement une année bissextile).
    const withYear = Number.isInteger(year) && year >= 1900 && year <= 2100 && !(month === 2 && day === 29 && !isLeap(year));
    out.push(withYear ? { name, month, day, year } : { name, month, day });
  }
  return out.slice(0, 12);
}

/** Anniversaires fêtés à une date ; un 29 février se fête le 28 les années ordinaires. */
export function birthdaysAt(date: Date, list: Birthday[]): Birthday[] {
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return list.filter((b) => (b.month === m && b.day === d) || (b.month === 2 && b.day === 29 && m === 2 && d === 28 && !isLeap(date.getFullYear())));
}

/** Thème à appliquer à une date : un anniversaire prime sur la fête, qui prime sur la saison. */
export function seasonAt(date: Date, mode: SeasonMode = "tout", birthdays: Birthday[] = [], country = "FR"): Season | null {
  if (mode === "aucun") return null;
  if (birthdaysAt(date, birthdays).length) return "anniversaire";
  return feteAt(date, country) ?? (mode === "tout" && !SOUTHERN.has(country) ? saisonAt(date) : null);
}

/** Prochaines fêtes (pour Réglages) : début et fin, à partir d'une date. */
export function upcomingSeasons(from: Date, count = 6, country = "FR"): { season: Fete; start: Date; end: Date }[] {
  const y = from.getFullYear();
  // Le Jour de l'an figure à la fin d'une année et au début de la suivante : on ne le garde qu'une fois.
  return [...fetesOf(y), ...fetesOf(y + 1).slice(1)]
    .filter((s) => seasonApplies(s.season, country) && s.end >= dayStart(from))
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, count);
}

const SAISON_SPANS: Record<Saison, [number, number, number, number]> = { hiver: [0, 4, 2, 19], printemps: [2, 20, 5, 20], ete: [5, 21, 8, 22], automne: [8, 23, 10, 30] };

/**
 * Période d'un thème autour d'une date : la fête en cours (ou la dernière passée), ou la saison de l'année.
 * `yearOffset` −1 donne la même période un an plus tôt (Pâques suit son calendrier).
 */
export function seasonWindow(season: Season, date: Date, yearOffset = 0): { start: Date; end: Date } {
  const d = dayStart(date);
  if (SEASONS[season].kind === "saison") {
    const [m1, d1, m2, d2] = SAISON_SPANS[season as Saison];
    const y = d.getFullYear() + yearOffset;
    return { start: new Date(y, m1, d1), end: new Date(y, m2, d2) };
  }
  // Un anniversaire ne dure qu'un jour : ce jour-là, ou le même un an plus tôt.
  if (season === "anniversaire") {
    const day = new Date(d.getFullYear() + yearOffset, d.getMonth(), d.getDate());
    return { start: day, end: day };
  }
  // Toutes les occurrences de la fête sur quatre ans, dans l'ordre : celle qui contient la date, sinon la dernière commencée.
  const y = d.getFullYear();
  const all = [y - 2, y - 1, y, y + 1].flatMap((yy, i) => (i === 0 ? fetesOf(yy) : fetesOf(yy).slice(1))).filter((f) => f.season === season);
  const idx = all.findLastIndex((f) => f.start <= d);
  const w = all[idx + yearOffset] ?? all[Math.max(idx, 0)]!;
  return { start: w.start, end: w.end };
}

/**
 * Délai entre deux décors de l'accueil : une fête est courte, on la revoit plusieurs fois dans la journée ;
 * une saison dure trois mois, deux fois par jour suffisent (matin et soir, en pratique).
 */
export const DECOR_EVERY_MS: Record<"fete" | "saison", number> = { fete: 3 * 3_600_000, saison: 8 * 3_600_000 };

/**
 * Le décor de l'accueil doit-il être rejoué ? Oui pour un thème qui n'est pas le dernier joué (une fête commence),
 * sinon une fois le délai du thème écoulé. `last` = dernier décor joué sur l'appareil.
 */
export function decorDue(season: Season, last: { season: string; at: number } | null, now: number): boolean {
  if (!last || last.season !== season || !Number.isFinite(last.at)) return true;
  const since = now - last.at;
  // Horloge de l'appareil reculée : on ne reste pas bloqué sur une date à venir.
  return since < 0 || since >= DECOR_EVERY_MS[SEASONS[season].kind];
}

/** Couleurs d'accent proposées (mémorisées sur l'appareil) ; l'indigo est celui d'origine. */
export const ACCENTS = [
  localized({ id: "indigo", label: tk("Indigo"), light: "#5a50f0", dark: "#8f88ff" }, "label"),
  localized({ id: "ocean", label: tk("Océan"), light: "#1863c2", dark: "#4d94ea" }, "label"),
  localized({ id: "sauge", label: tk("Sauge"), light: "#1f7a5c", dark: "#3fae86" }, "label"),
  localized({ id: "corail", label: tk("Corail"), light: "#b83e33", dark: "#e5675a" }, "label"),
  localized({ id: "ardoise", label: tk("Ardoise"), light: "#3d4a5c", dark: "#7a879a" }, "label"),
] as const;
export type Accent = (typeof ACCENTS)[number]["id"];
