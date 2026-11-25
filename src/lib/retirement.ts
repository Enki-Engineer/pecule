/**
 * Ce que l'écran Retraite retrouve dans les données : ses chiffres clés parmi les faits (par le début de leur
 * libellé, celui qu'écrit la lecture d'un relevé de carrière) et la famille de chaque simulation.
 */
export const RETIREMENT_FACTS = {
  quarters: /^Trimestres enregistrés/i,
  required: /^Trimestres requis/i,
  legalAge: /^Âge légal/i,
  fullAge: /^Âge du taux plein/i,
  earliest: /départ au plus tôt/i,
} as const;

export type RetirementFact = keyof typeof RETIREMENT_FACTS;

/** La valeur du fait attendu, ou null s'il n'est pas enregistré. */
export function retirementFact(facts: readonly { label: string; value: string }[], key: RetirementFact): string | null {
  return facts.find((f) => RETIREMENT_FACTS[key].test(f.label))?.value ?? null;
}

export const SIM_FAMILIES = ["officielle", "complete", "fire"] as const;
export type SimFamily = (typeof SIM_FAMILIES)[number];

/**
 * Famille d'une simulation : l'estimation officielle (info-retraite), ou une hypothèse — carrière menée jusqu'au bout,
 * arrêt anticipé (FIRE) — reconnue à son libellé. Une hypothèse d'un autre genre n'a pas de famille.
 */
export function simFamily(s: { source?: string | null; label: string }): SimFamily | null {
  if (s.source === "info-retraite") return "officielle";
  if (/complète/i.test(s.label)) return "complete";
  if (/fire|arrêt/i.test(s.label)) return "fire";
  return null;
}
