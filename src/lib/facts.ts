/*
 * Faits clés d'une entité (un bien, une retraite…) : ce que la fiche affiche sous « Faits clés ».
 * `planFacts` range une demande de modification — un fait connu change de valeur, un fait nouveau s'ajoute à la fin,
 * une valeur nulle retire le fait — sans rien écrire : la même liste sert à annoncer le changement et à l'appliquer.
 */

export type Fact = { fact_key: string; label: string; value: string; unit: string | null; as_of: string | null };

export type FactInput = { key: string; label?: string | null; value: string | number | null; unit?: string | null; as_of?: string | null };

export type FactPlan = {
  /** Faits écrits : `before` est l'ancienne valeur affichée, `null` pour un fait nouveau. */
  set: { key: string; label: string; value: string; unit: string | null; as_of: string | null; before: string | null }[];
  remove: { key: string; label: string }[];
  /** Clés inconnues qu'on ne peut ni créer (pas de libellé) ni retirer. */
  unknown: string[];
};

/** Valeur telle que la fiche la montre : « 94,20 € par an » se lit « 94.20 €/an » en base, valeur puis unité. */
export const factText = (value: string, unit: string | null): string => (unit ? `${value} ${unit}` : value);

export function planFacts(existing: Fact[], wanted: FactInput[], today: string): FactPlan {
  const known = new Map(existing.map((f) => [f.fact_key, f]));
  const plan: FactPlan = { set: [], remove: [], unknown: [] };
  // Une clé donnée deux fois : la dernière demande l'emporte.
  const last = new Map(wanted.map((w) => [w.key.trim(), w]));
  for (const [key, w] of last) {
    const old = known.get(key);
    if (w.value === null) {
      if (old) plan.remove.push({ key, label: old.label });
      else plan.unknown.push(key);
      continue;
    }
    const label = w.label?.trim() || old?.label;
    if (!label) {
      plan.unknown.push(key);
      continue;
    }
    plan.set.push({
      key,
      label,
      value: String(w.value),
      // Unité non précisée : celle du fait connu est gardée ; `null` l'efface.
      unit: w.unit === undefined ? (old?.unit ?? null) : w.unit,
      as_of: w.as_of ?? today,
      before: old ? factText(old.value, old.unit) : null,
    });
  }
  return plan;
}
