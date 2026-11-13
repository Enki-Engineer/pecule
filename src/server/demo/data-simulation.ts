/*
 * Rejoue les opérations jour par jour : solde de fin de journée de chaque compte (table `balances`),
 * et gestes du foyer qui dépendent des soldes — complément du compte joint quand il passe sous 300 €,
 * ponction sur un livret si un compte perso est trop bas, « épargne du reste » en fin de mois (livret
 * sous son plafond, sinon PEA ou assurance-vie), intérêts des livrets au 31 décembre.
 */
import type { AccKey, Ops, Tx } from "./context.ts";
import { addDays, lastOfMonth, r2 } from "./rng.ts";

export type Balances = Record<AccKey, number>;

/** Plafonds gardés sous ceux du Livret A (22 950 €) et du LDDS (12 000 €), virements programmés compris. */
const LIVRET_ROOM = 21_500;
const LDDS_ROOM = 11_000;
/** Taux retenu pour les intérêts de fin d'année des livrets réglementés. */
const RATE = 0.017;

const up100 = (n: number) => Math.ceil(n / 100) * 100;
const down100 = (n: number) => Math.floor(n / 100) * 100;

export function simulate(ops: Ops, opening: Balances, names: { a: string; c: string }): { daily: Map<string, Balances>; final: Balances } {
  const bal: Balances = { ...opening };
  const byDate = new Map<string, Tx[]>();
  for (const t of ops.txs) {
    const list = byDate.get(t.date);
    if (list) list.push(t);
    else byDate.set(t.date, [t]);
  }
  const apply = (...list: (Tx | null)[]) => {
    for (const t of list) if (t) bal[t.acc] = r2(bal[t.acc] + t.amount);
  };
  const move = (pair: [Tx, Tx] | null) => {
    if (pair) apply(...pair);
  };
  /** Épargne du reste : au-delà de `keep`, vers le livret (sous `room`), le surplus vers le placement. */
  const sweep = (from: "a" | "c", d: string, trigger: number, keep: number) => {
    if (bal[from] <= trigger) return;
    const excess = down100(bal[from] - keep);
    const book = from === "a" ? "livret" : "ldds";
    const toBook = Math.max(0, Math.min(excess, down100((from === "a" ? LIVRET_ROOM : LDDS_ROOM) - bal[book])));
    if (toBook > 0)
      move(ops.transfer(from, book, d, toBook, from === "a" ? "Vir Virement Vers Livret A" : "Vir Virement Vers Ldds", "Vir Virement Depuis Compte Courant"));
    if (excess - toBook > 0) apply(ops.virOut(from, d, from === "a" ? "Versement Pea Boursobank" : "Versement Assurance Vie Ligeria", excess - toBook, "B8"));
  };

  const daily = new Map<string, Balances>();
  for (let d = ops.start; d <= ops.T; d = addDays(d, 1)) {
    apply(...(byDate.get(d) ?? []));
    if (bal.joint < 300) {
      const amount = up100(1000 - bal.joint);
      const from = bal.a - amount >= 500 ? "a" : "c";
      move(ops.transfer(from, "joint", d, amount, "Vir Inst Complement Compte Joint", `Vir Inst ${from === "a" ? names.a : names.c} Complement Compte Joint`));
    }
    if (bal.a < 200) move(ops.transfer("livret", "a", d, up100(900 - bal.a), "Vir Virement Vers Compte Courant", "Vir Virement Depuis Livret A"));
    if (bal.c < 150) move(ops.transfer("ldds", "c", d, up100(700 - bal.c), "Vir Virement Vers Compte Courant", "Vir Virement Depuis Ldds"));
    if (d === lastOfMonth(d)) {
      sweep("a", d, 2700, 2000);
      sweep("c", d, 1700, 1200);
      if (d.endsWith("-12-31")) {
        const livret = r2(bal.livret * RATE);
        const ldds = r2(bal.ldds * RATE);
        apply(
          ops.push({ acc: "livret", date: d, amount: livret, label: "Interets Crediteurs Annuels", merchant: null, cat: "A4", kind: "interet", fixed: true }),
          ops.push({ acc: "ldds", date: d, amount: ldds, label: "Interets Crediteurs Annuels", merchant: null, cat: "A4", kind: "interet", fixed: true }),
        );
      }
    }
    daily.set(d, { ...bal });
  }
  return { daily, final: { ...bal } };
}
