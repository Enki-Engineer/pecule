/*
 * Hypothèses des projections : chaque scénario d'une poche porte une phrase libre, faite de
 * segments séparés par « · » ou « — », dont la plupart sont identiques d'un scénario à l'autre.
 * On sépare ce qui est commun (dit une fois) de ce qui change vraiment d'un scénario à l'autre,
 * et on isole le point de départ (« Net au 01/09/2026 : 100 000 € », ou le signe d'une autre devise).
 */

export type HypothesisSplit = {
  /** Point de départ commun, s'il est écrit en tête des hypothèses. */
  start: { date: string; amount: number } | null;
  /** Segments identiques dans tous les scénarios renseignés. */
  common: string[];
  /** Segments propres à chaque scénario. */
  specific: Record<string, string[]>;
};

const START = /^net au (\d{2}\/\d{2}\/\d{4})\s*:\s*(-?[\d\s  ]+(?:,\d+)?)\s*(?:\p{Sc}|[A-Za-z]{1,3}\$?|zł|Kč)$/iu;

const segments = (text: string | null | undefined) =>
  (text ?? "")
    .split(/\s+[·—]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/** Première lettre en capitale (les segments suivent un « · » et commencent en minuscule). */
export const sentence = (s: string) => s.charAt(0).toLocaleUpperCase("fr") + s.slice(1);

export function splitHypotheses(byScenario: Record<string, string | null | undefined>): HypothesisSplit {
  const lists = Object.entries(byScenario)
    .map(([key, text]) => [key, segments(text)] as const)
    .filter(([, list]) => list.length);
  const isCommon = (s: string) => lists.length > 1 && lists.every(([, list]) => list.includes(s));
  // Un seul scénario renseigné : tout lui est propre.
  const common = lists.length ? lists[0][1].filter(isCommon) : [];
  let start: HypothesisSplit["start"] = null;
  const rest: string[] = [];
  for (const s of common) {
    const m: RegExpExecArray | null = start ? null : START.exec(s);
    if (m) start = { date: m[1], amount: Number(m[2].replace(/[\s  ]/g, "").replace(",", ".")) };
    else rest.push(s);
  }
  return {
    start,
    common: rest.map(sentence),
    specific: Object.fromEntries(Object.keys(byScenario).map((key) => [key, (lists.find(([k]) => k === key)?.[1] ?? []).filter((s) => !isCommon(s)).map(sentence)])),
  };
}

/** La projection compte la résidence principale quand une de ses poches en porte le nom (sinon elle est « hors résidence principale »). */
export const includesHome = (pockets: string[]) => pockets.some((p) => /résidence principale/i.test(p));

/**
 * Patrimoine net du jour, sur la même base que les projections qui comptent la résidence principale : la dette du bien
 * y est comptée pour la part détenue (indivision 50/50), alors que le patrimoine compte ses prêts selon leur propre part
 * (prêts solidaires : en entier). On rend donc au net la part de dette comptée en trop.
 */
export function netWithHomeDebtShare(
  net: number,
  assets: { name: string; share: number; loanIds?: string[] | null }[],
  loans: { id: string; share: number; summary: { remaining: number } }[],
): number {
  const home = assets.find((a) => /résidence principale/i.test(a.name));
  if (!home?.loanIds?.length) return net;
  const ids = new Set(home.loanIds);
  const excess = loans.filter((l) => ids.has(l.id)).reduce((sum, l) => sum + l.summary.remaining * (l.share - home.share), 0);
  return Math.round((net + excess) * 100) / 100;
}
