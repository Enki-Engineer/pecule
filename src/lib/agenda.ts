/* Échéancier : calculs purs (récurrence, calendrier fiscal). */

import { isFrance } from "./countries.ts";
import { t, tk } from "./i18n.ts";

export type Recurrence = "mensuel" | "trimestriel" | "annuel";

const MONTHS: Record<Recurrence, number> = { mensuel: 1, trimestriel: 3, annuel: 12 };

/** Occurrence suivante d'une date récurrente (le 31 devient le dernier jour du mois s'il le faut). */
export function nextOccurrence(date: string, recurrence: Recurrence): string {
  const [y, m, d] = date.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + MONTHS[recurrence], 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Calendrier fiscal d'un foyer français : dates indicatives, fixées chaque année par l'administration (la date
 * limite de la déclaration en ligne dépend du département : on retient la plus tardive). Rien pour un autre pays. Textes marqués ici (`tk`) et traduits au moment du calcul,
 * dans la langue de la requête.
 */
const FISCAL: { md: string; title: string; notes: string }[] = [
  { md: "04-10", title: tk("Ouverture de la déclaration de revenus"), notes: tk("Date indicative : la déclaration en ligne ouvre mi-avril.") },
  { md: "06-05", title: tk("Date limite de la déclaration de revenus"), notes: tk("Date indicative, la plus tardive : elle dépend du département, à vérifier sur impots.gouv.fr.") },
  { md: "09-25", title: tk("Solde d'impôt sur le revenu"), notes: tk("Prélèvement du solde de l'année précédente (fin septembre), date indicative.") },
  { md: "10-15", title: tk("Taxe foncière : date limite de paiement"), notes: tk("Avis disponible fin août ; prélèvement à l'échéance si mensualisation non choisie.") },
];

export function calendarDates(from: string, to: string, country = "FR"): { date: string; title: string; notes: string }[] {
  const out: { date: string; title: string; notes: string }[] = [];
  if (!isFrance(country)) return out;
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    for (const f of FISCAL) {
      const date = `${y}-${f.md}`;
      if (date >= from && date <= to) out.push({ date, title: t(f.title), notes: t(f.notes) });
    }
  return out;
}
