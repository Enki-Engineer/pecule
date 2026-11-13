/*
 * Équivalences amusantes (11/11/2026) : pendant un thème de l'année, un montant se lit
 * aussi dans l'unité du moment — litres de bière à la Saint-Patrick, kilos d'œufs en chocolat à Pâques, kilos de
 * bonbons à Halloween… — et, toute l'année, en temps de travail (d'après les bulletins de paie du membre).
 * Ce n'est qu'une autre façon d'écrire le même montant : aucun chiffre ni aucune statistique ne change.
 * Les prix de référence sont fixés ici (décision de conception) et toujours affichés avec l'équivalence.
 */
import type { Season } from "./seasons.ts";
import { currentLang, locale, localized, t, tk } from "./i18n.ts";

/** Palier d'affichage : en dessous de `upTo` unités de base, on écrit `quantité × factor` avec ce nom. */
type Step = { upTo: number; factor: number; one: string; many: string; round?: number };
export type FunUnit = { emoji: string; /** Prix d'une unité de base, en euros. */ price: number; /** Rappel du prix, affiché. */ ref: string; /** En dessous : pas d'équivalence. */ min: number; steps: Step[] };

// Les noms et le rappel du prix sont écrits en français (marqués tk) et traduits à la lecture.
const item = (emoji: string, one: string, many: string, price: number, ref: string): FunUnit => localized({ emoji, price, ref, min: 1, steps: [{ upTo: Infinity, factor: 1, one, many }] }, "ref");
/** Unité au poids : les quatre noms (grammes, kilos, tonne, tonnes) sont écrits en entier, pour être traduits. */
const kilo = (emoji: string, names: { g: string; kg: string; tonne: string; tonnes: string }, price: number): FunUnit => ({
  emoji,
  price,
  get ref() {
    return t("à {prix} € le kilo", { prix: price });
  },
  min: 0.1,
  steps: [
    { upTo: 1, factor: 1000, one: names.g, many: names.g, round: 10 },
    { upTo: 1000, factor: 1, one: names.kg, many: names.kg },
    { upTo: Infinity, factor: 0.001, one: names.tonne, many: names.tonnes },
  ],
});

export const FUN_UNITS: Record<Season, FunUnit> = {
  anniversaire: item("🎂", tk("gâteau d'anniversaire"), tk("gâteaux d'anniversaire"), 25, tk("à 25 € le gâteau")),
  "nouvel-an": item("🍾", tk("bouteille de champagne"), tk("bouteilles de champagne"), 30, tk("à 30 € la bouteille")),
  epiphanie: item("👑", tk("galette des rois"), tk("galettes des rois"), 20, tk("à 20 € la galette")),
  chandeleur: item("🥞", tk("crêpe"), tk("crêpes"), 3.5, tk("à 3,50 € la crêpe")),
  "saint-valentin": item("🌹", tk("bouquet de roses"), tk("bouquets de roses"), 35, tk("à 35 € le bouquet")),
  "saint-patrick": localized(
    {
    emoji: "🍺",
    price: 14, // le litre
    ref: tk("à 7 € la pinte"),
    min: 0.5,
    steps: [
      { upTo: 5, factor: 2, one: tk("pinte de bière"), many: tk("pintes de bière") },
      { upTo: 60, factor: 1, one: tk("L de bière"), many: tk("L de bière") },
      { upTo: Infinity, factor: 1 / 30, one: tk("fût de bière"), many: tk("fûts de bière") },
    ],
    },
    "ref",
  ),
  paques: kilo("🍫", { g: tk("g d'œufs en chocolat"), kg: tk("kg d'œufs en chocolat"), tonne: tk("tonne d'œufs en chocolat"), tonnes: tk("tonnes d'œufs en chocolat") }, 30),
  "14-juillet": item("🌭", tk("sandwich merguez"), tk("sandwichs merguez"), 6, tk("à 6 € le sandwich du bal")),
  rentree: item("🖊️", tk("stylo quatre couleurs"), tk("stylos quatre couleurs"), 3, tk("à 3 € le stylo")),
  halloween: kilo("🍬", { g: tk("g de bonbons"), kg: tk("kg de bonbons"), tonne: tk("tonne de bonbons"), tonnes: tk("tonnes de bonbons") }, 10),
  "fete-lumieres": item("🕯️", tk("lumignon"), tk("lumignons"), 0.5, tk("à 0,50 € le lumignon")),
  noel: kilo("🎄", { g: tk("g de papillotes"), kg: tk("kg de papillotes"), tonne: tk("tonne de papillotes"), tonnes: tk("tonnes de papillotes") }, 20),
  hiver: item("🧀", tk("part de raclette"), tk("parts de raclette"), 8, tk("à 8 € la part")),
  printemps: item("🌷", tk("bouquet de tulipes"), tk("bouquets de tulipes"), 10, tk("à 10 € le bouquet")),
  ete: item("🍦", tk("boule de glace"), tk("boules de glace"), 3, tk("à 3 € la boule")),
  automne: kilo("🌰", { g: tk("g de châtaignes"), kg: tk("kg de châtaignes"), tonne: tk("tonne de châtaignes"), tonnes: tk("tonnes de châtaignes") }, 8),
};

/** Nombre écrit selon la langue courante. */
const fr = (n: number, digits: number) => n.toLocaleString(locale(), { maximumFractionDigits: digits });
/** Singulier : jusqu'à 1,9 en français (« 1,5 pinte »), seulement 1 dans les autres langues. */
const single = (qty: number) => (currentLang() === "fr" ? qty < 2 : qty === 1);

/** Montant écrit dans l'unité du thème (« 12 pintes de bière »), ou null s'il ne fait pas une unité. Le signe est ignoré. */
export function equivalence(amount: number, season: Season): { text: string; ref: string; emoji: string } | null {
  const u = FUN_UNITS[season];
  const base = Math.abs(amount) / u.price;
  if (!Number.isFinite(base) || base < u.min) return null;
  const step = u.steps.find((s) => base < s.upTo) ?? u.steps[u.steps.length - 1]!;
  const raw = base * step.factor;
  // Une décimale sous 10, l'entier au-delà ; les grammes à la dizaine.
  const qty = step.round ? Math.round(raw / step.round) * step.round : raw < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
  return { text: `${fr(qty, 1)} ${t(single(qty) ? step.one : step.many)}`, ref: u.ref, emoji: u.emoji };
}

/** Heures d'un mois de travail à temps plein (35 h par semaine) : base du taux horaire net. */
export const MONTH_HOURS = 151.67;
const DAY_HOURS = 7;

/** Montant écrit en temps de travail (« 3 h 20 de travail »), au taux horaire net du membre ; null sous 5 minutes ou sans taux. */
export function workTime(amount: number, hourly: number | null | undefined): string | null {
  if (!hourly || hourly <= 0) return null;
  const hours = Math.abs(amount) / hourly;
  if (!Number.isFinite(hours) || hours < 5 / 60) return null;
  if (hours < 1) return t("{n} min de travail", { n: Math.round((hours * 60) / 5) * 5 });
  if (hours < DAY_HOURS) {
    const h = Math.floor(hours);
    const m = Math.round(((hours - h) * 60) / 5) * 5;
    return m === 60 ? t("{h} h de travail", { h: h + 1 }) : m ? t("{h} h {min} de travail", { h, min: String(m).padStart(2, "0") }) : t("{h} h de travail", { h });
  }
  const days = hours / DAY_HOURS;
  const month = MONTH_HOURS / DAY_HOURS;
  if (days < month) return days < 1.75 ? t("{n} jour de travail", { n: fr(Math.round(days * 2) / 2, 1) }) : t("{n} jours de travail", { n: fr(Math.round(days * 2) / 2, 1) });
  const months = days / month;
  if (months < 12) return t("{n} mois de travail", { n: fr(Math.round(months * 10) / 10, 1) });
  const years = months / 12;
  return years < 1.95 ? t("{n} an de travail", { n: fr(Math.round(years * 10) / 10, 1) }) : t("{n} ans de travail", { n: fr(Math.round(years * 10) / 10, 1) });
}

/** Ce que coûte une fête : les catégories du référentiel qu'on additionne pendant la fête (comparées à l'an dernier). */
export const FETE_BUDGETS: Partial<Record<Season, { title: string; what: string; categories: string[] }>> = {
  anniversaire: localized({ title: tk("L'anniversaire"), what: tk("cadeaux, restaurants et sorties du jour"), categories: ["B12-01", "B3-04", "B9-01"] }, "title", "what"),
  "nouvel-an": localized({ title: tk("Le réveillon"), what: tk("restaurants, sorties, hébergements et voyages"), categories: ["B3-04", "B9-01", "B9-03", "B9-04"] }, "title", "what"),
  epiphanie: localized({ title: tk("L'Épiphanie"), what: tk("boulangerie"), categories: ["B3-03"] }, "title", "what"),
  chandeleur: localized({ title: tk("La Chandeleur"), what: tk("courses, marché et boulangerie"), categories: ["B3-01", "B3-02", "B3-03"] }, "title", "what"),
  "saint-valentin": localized({ title: tk("La Saint-Valentin"), what: tk("cadeaux, restaurants et sorties"), categories: ["B12-01", "B3-04", "B9-01"] }, "title", "what"),
  "saint-patrick": localized({ title: tk("La Saint-Patrick"), what: tk("restaurants, cafés et sorties"), categories: ["B3-04", "B3-03", "B9-01"] }, "title", "what"),
  paques: localized({ title: tk("Pâques"), what: tk("courses, marché, boulangerie et cadeaux"), categories: ["B3-01", "B3-02", "B3-03", "B12-01"] }, "title", "what"),
  "14-juillet": localized({ title: tk("Le 14 Juillet"), what: tk("restaurants et sorties"), categories: ["B3-04", "B9-01"] }, "title", "what"),
  rentree: localized({ title: tk("La rentrée"), what: tk("école et fournitures, vêtements et activités de l'enfant"), categories: ["B4-01", "B4-04", "B4-02"] }, "title", "what"),
  halloween: localized({ title: tk("Halloween"), what: tk("courses et loisirs"), categories: ["B3-01", "B9-01", "B4-02"] }, "title", "what"),
  "fete-lumieres": localized({ title: tk("La Fête des Lumières"), what: tk("restaurants, cafés et sorties"), categories: ["B3-04", "B3-03", "B9-01"] }, "title", "what"),
  noel: localized({ title: tk("Noël"), what: tk("cadeaux, restaurants et sorties"), categories: ["B12-01", "B3-04", "B9-01"] }, "title", "what"),
  ete: localized({ title: tk("Les vacances d'été"), what: tk("hébergements, voyages et restaurants"), categories: ["B9-03", "B9-04", "B3-04"] }, "title", "what"),
};

export type FunHighlight = { kind: "depense" | "poste" | "abonnement"; label: string; amount: number; detail: string; transactionId?: string; date?: string };
export type FunBudget = { title: string; what: string; from: string; to: string; total: number; lines: { id: string; name: string; total: number }[]; lastYear: number | null };
/** Réponse de GET /api/fun. */
export type FunData = { enabled: boolean; hourly: number | null; highlights: FunHighlight[]; budget: FunBudget | null };

/** Le chiffre du moment : une mise en lumière par jour, à tour de rôle. */
export function pickHighlight<T>(list: T[], date: Date): T | null {
  if (!list.length) return null;
  const day = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0)) / 86_400_000);
  return list[day % list.length]!;
}
