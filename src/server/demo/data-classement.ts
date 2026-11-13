/*
 * Classement des opérations comme le ferait Pécule : clé de libellé (`labelKey`), règles (motif le plus
 * long contenu dans la clé, comme `guessCategory`), une quinzaine d'achats récents laissés « à classer »,
 * origine de chaque catégorie (regle, manuel, auto = même libellé déjà classé, facture). Produit les
 * lignes des tables transactions, balances et rules.
 */
import type * as schema from "../db/schema/index.ts";
import { labelKey } from "../../lib/labels.ts";
import type { AccKey, Tx } from "./context.ts";
import { type AccountDef, RULE_CANDIDATES } from "./data-banque.ts";
import type { Balances } from "./data-simulation.ts";
import { type Insert, Rand, addDays } from "./rng.ts";

/** Nombre d'opérations « à classer » (trois nouveaux marchands compris). */
export const UNCATEGORIZED = 15;

type Rule = readonly [pattern: string, categoryId: string];
const effective = (key: string, rules: readonly Rule[]): Rule | null =>
  rules.filter(([p]) => key.includes(p)).sort((a, b) => b[0].length - a[0].length)[0] ?? null;

export function classify(txs: Tx[], R: Rand, T: string) {
  const sorted = [...txs].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.seq - y.seq));
  const keyOf = new Map<Tx, string>(sorted.map((t) => [t, labelKey(t.label, t.merchant)]));

  // Règles : on retire un motif contredit par une opération, jusqu'à ce que toutes soient cohérentes.
  let rules: readonly Rule[] = RULE_CANDIDATES;
  for (;;) {
    const used = new Set<string>();
    const bad = new Set<string>();
    for (const t of sorted) {
      if (!t.cat) continue;
      const r = effective(keyOf.get(t)!, rules);
      if (!r) continue;
      used.add(r[0]);
      if (r[1] !== t.cat) bad.add(r[0]);
    }
    const next = rules.filter(([p]) => used.has(p) && !bad.has(p));
    if (next.length === rules.length) break;
    rules = next;
  }
  const ruleOf = (t: Tx) => effective(keyOf.get(t)!, rules);

  // « À classer » : achats carte récents sans règle (une règle les aurait classés à la synchro).
  const already = sorted.filter((t) => !t.cat).length;
  const pool = (days: number) => sorted.filter((t) => t.kind === "carte" && !t.fixed && !t.ref && t.cat && t.date >= addDays(T, -days) && !ruleOf(t));
  const candidates = pool(21).length >= UNCATEGORIZED - already ? pool(21) : pool(45);
  for (const t of R.shuffle(candidates).slice(0, Math.max(0, UNCATEGORIZED - already))) t.cat = null;

  // Origine : règle, sinon « auto » si le même libellé a déjà été classé, sinon choix manuel.
  const known = new Set<string>();
  for (const t of sorted) {
    const key = keyOf.get(t)!;
    if (!t.cat) {
      t.source = null;
      continue;
    }
    if (!t.source) {
      const r = ruleOf(t);
      t.source = r && r[1] === t.cat ? "regle" : known.has(key) && R.chance(0.55) ? "auto" : "manuel";
    }
    if (t.source !== "auto") known.add(key);
  }
  return { sorted, keyOf, rules };
}

export function transactionRows(sorted: Tx[], keyOf: Map<Tx, string>, defs: Record<AccKey, AccountDef>, ids: Rand) {
  const rows: Insert<typeof schema.transactions>[] = [];
  const byRef = new Map<string, { id: string; amount: number }>();
  for (const t of sorted) {
    // Identifiant au format Finta « <compte>-<empreinte> », empreinte propre à chaque opération :
    // markCardDuplicates() n'y verra jamais de doublon (et il n'y a pas de compte carte).
    const id = `${defs[t.acc].id}-${ids.hex(32)}`;
    rows.push({
      id,
      fintaId: ids.uuid(),
      accountId: defs[t.acc].id,
      date: t.date,
      amount: t.amount,
      label: t.label,
      merchant: t.merchant,
      labelKey: keyOf.get(t)!,
      status: t.status,
      categoryId: t.cat,
      categorySource: t.source,
      note: t.note,
    });
    if (t.ref) byRef.set(t.ref, { id, amount: t.amount });
  }
  return { rows, byRef };
}

export function balanceRows(daily: Map<string, Balances>, defs: Record<AccKey, AccountDef>): Insert<typeof schema.balances>[] {
  const rows: Insert<typeof schema.balances>[] = [];
  for (const [date, b] of daily) for (const k of Object.keys(defs) as AccKey[]) rows.push({ accountId: defs[k].id, date, balance: b[k] });
  return rows;
}

export const ruleRows = (rules: readonly Rule[]): Insert<typeof schema.rules>[] => rules.map(([pattern, categoryId]) => ({ pattern, categoryId, priority: 100 }));
