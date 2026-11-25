/*
 * Opérations récurrentes, mois par mois : salaires et participation au compte joint, loyer du studio,
 * épargne programmée, échéances des crédits, charges fixes, abonnements, impôts (acomptes, solde en
 * septembre, taxes foncières en octobre), achats facturés et achats de crypto. La vie courante
 * (courses, sorties, vacances…) est dans data-depenses.ts.
 */
import type { Month, Ops } from "./context.ts";
import { spendMonth } from "./data-depenses.ts";
import { categoryTotals, type InvoiceSpec } from "./data-factures.ts";
import { type Echeance, type IncomeModel, type Scenario, rentAt } from "./model.ts";
import { MOIS, addDays, pad, workdayAfter, workdayBefore } from "./rng.ts";

export const RP_LOAN_LABEL = "Prêt résidence principale";
export const STUDIO_LOAN_LABEL = "Prêt studio Angers";

/** Libellé SEPA brut du prêt de la résidence principale (code créancier) : nommé d'après l'engagement, comme nameDebits(). */
export const rpDebitLabel = (rang: number, date: string) => `4410873 Ech${pad(rang, 7)} Prt${date.replace(/-/g, "")}`;

export type CryptoBuy = { date: string; symbol: "BTC" | "ETH"; quantity: number; value: number };
const CRYPTO_BUYS: readonly { off: number; symbol: "BTC" | "ETH"; quantity: number; value: number }[] = [
  { off: -12, symbol: "BTC", quantity: 0.012, value: 1000 },
  { off: -6, symbol: "ETH", quantity: 0.17, value: 500 },
  { off: -2, symbol: "BTC", quantity: 0.0105, value: 800 },
];

type Names = { a: string; c: string };

export function generateOperations(ops: Ops, s: Scenario, model: IncomeModel, months: Month[], names: Names, loans: { rp: Echeance[]; studio: Echeance[] }, invoices: InvoiceSpec[]) {
  const R = ops.R;
  const cryptoBuys: CryptoBuy[] = [];
  const byMonth = (rows: Echeance[]) => new Map(rows.map((e) => [e.date.slice(0, 7), e]));
  const rpByMonth = byMonth(loans.rp);
  const studioByMonth = byMonth(loans.studio);

  for (const mo of months) {
    const { y, m, at, off } = mo;
    const label = `${MOIS[m - 1]} ${y}`;
    const school = m !== 7 && m !== 8;

    // Salaires (net versé = bulletin), puis participation de chacun au compte joint.
    const payA = workdayBefore(at(27));
    ops.virIn("a", payA, `Nexalia Conseil Salaire ${m === 3 ? "Et Prime " : ""}${label}`, model.payslip("a", y, m).netPaid, "A1");
    ops.transfer("a", "joint", addDays(payA, 1), 2200, "Vir Inst Participation Compte Joint", `Vir Inst ${names.a} Participation Mensuelle`);
    const payC = workdayBefore(at(28));
    ops.virIn("c", payC, `Clinique De L'estuaire Salaire ${label}`, model.payslip("c", y, m).netPaid, "A1");
    ops.transfer("c", "joint", addDays(payC, 1), 1400, "Vir Inst Participation Compte Joint", `Vir Inst ${names.c} Participation Mensuelle`);

    // Loyer du studio meublé, épargne programmée.
    const rent = rentAt(s, at(5));
    if (rent) ops.virIn("a", workdayAfter(at(5)), `Lucie Garnier Loyer ${MOIS[m - 1]}`, rent, "A2");
    ops.transfer("a", "livret", at(2), 250, "Vir Permanent Vers Livret A", "Vir Permanent Depuis Compte Courant");
    ops.transfer("c", "ldds", at(3), 150, "Vir Permanent Vers Ldds", "Vir Permanent Depuis Compte Courant");
    ops.virOut("a", at(10), "Versement Pea Boursobank", 150, "B8");
    ops.virOut("c", at(12), "Versement Assurance Vie Ligeria", 100, "B8");

    // Crédits immobiliers : montant de l'échéance du tableau d'amortissement.
    const rp = rpByMonth.get(mo.first.slice(0, 7));
    if (rp) ops.push({ acc: "joint", date: workdayAfter(rp.date), amount: -rp.payment, label: rpDebitLabel(rp.rang, rp.date), merchant: RP_LOAN_LABEL, cat: "B1-01", kind: "prlv", fixed: true, source: "regle" });
    const st = studioByMonth.get(mo.first.slice(0, 7));
    if (st) ops.prlv("a", workdayAfter(st.date), "Caisse D'epargne Bretagne Pays De Loire Echeance Pret", st.payment, "B1-01", "Caisse d'Épargne");

    // Logement : copropriété (trimestrielle), énergie, eau, assurances, télécoms.
    if ([1, 4, 7, 10].includes(m)) {
      ops.prlv("joint", workdayAfter(at(3)), "Syndic Atlantique Gestion Appel De Fonds", 366, "B1-02");
      ops.prlv("a", workdayAfter(at(4)), "Cabinet Gerance Anjou Charges Copro", 208, "B1-02");
    }
    if (off === -7) ops.prlv("joint", workdayAfter(at(20)), "Syndic Atlantique Gestion Travaux Toiture", 640, "B1-02", null, { note: "Quote-part des travaux de toiture votés en assemblée générale" });
    ops.prlv("joint", workdayAfter(at(6)), "Edf Clients Particuliers Mensualite", y < s.TY || m < 2 ? 91 : 96, "B1-03", "EDF");
    if (m === 6) ops.prlv("joint", workdayAfter(at(6)), "Edf Clients Particuliers Facture De Regularisation", 64.18, "B1-03", "EDF");
    if ([2, 5, 8, 11].includes(m)) ops.prlv("joint", workdayAfter(at(20)), "Saur Facture Eau", R.amount(82, 94), "B1-03", "Saur");
    ops.prlv("joint", workdayAfter(at(10)), "Maif Assurance Habitation", 27.4, "B1-04", "MAIF");
    ops.prlv("a", workdayAfter(at(10)), "Axa France Iard Pno Studio", 8.9, "B1-04", "AXA");
    ops.prlv("joint", workdayAfter(at(18)), "Free Telecom Freebox", 35.99, "B1-05", "Freebox");
    ops.prlv("a", workdayAfter(at(18)), "Free Mobile Forfait", 15.99, "B1-05", "Free Mobile");
    ops.prlv("c", workdayAfter(at(22)), "Orange Sa Forfait Mobile", 19.99, "B1-05", "Orange");

    // Transports, santé, sport, banque.
    ops.prlv("joint", workdayAfter(at(8)), "Orvane Assurance Auto", 47.8, "B2-02", "Orvane");
    ops.prlv("c", workdayAfter(at(3)), "Naolib Abonnement Mensuel", 49.5, "B2-04");
    ops.prlv("c", workdayAfter(at(1)), "Basic Fit France Abonnement", 29.99, "B9-01");
    ops.prlv("c", workdayAfter(at(5)), "Harmonie Mutuelle Cotisation", 61.9, "B6-02", "Harmonie Mutuelle");
    ops.push({ acc: "c", date: at(6), amount: -6.2, label: "Cotisation Offre Compte A Composer", merchant: null, cat: "B11", kind: "frais", fixed: true });

    // Léo : cantine et périscolaire pendant l'année scolaire, accueil de loisirs pendant les vacances.
    if (school) {
      ops.prlv("joint", workdayAfter(at(10)), "Ville De Nantes Restauration Scolaire", R.amount(52, 84), "B4-01");
      ops.prlv("joint", workdayAfter(at(10)), "Ville De Nantes Periscolaire", R.amount(34, 58), "B4-03");
    }
    if ([2, 4, 7, 8, 10].includes(m)) ops.prlv("joint", workdayAfter(at(14)), "Ville De Nantes Accueil De Loisirs", R.amount(64, 138), "B4-02");

    // Abonnements payés par carte.
    ops.card("joint", at(14), "Netflix.com", "Netflix", 13.49, "B9-02", { fixed: true });
    ops.card("a", at(9), `Spotify P${R.hex(9).toUpperCase()}`, "Spotify", 21.99, "B9-02", { fixed: true });
    ops.card("c", at(21), "Disneyplus", "Disney+", 9.99, "B9-02", { fixed: true });
    ops.card("a", at(3), "Apple.com/bill", "Apple", 2.99, "B9-02", { fixed: true });
    if (at(16) < s.canalEnd) ops.prlv("joint", workdayAfter(at(16)), "Canal+ Abonnement", 24.99, "B9-02", "Canal+");

    // Impôts : acomptes sur les loyers, solde de l'IR en septembre, taxes foncières en octobre.
    const acompte = model.acompteAt(y, m);
    if (acompte > 0) ops.prlv("a", workdayAfter(at(15)), "Dgfip Impot Acompte Revenus Locatifs", acompte, "B7");
    if (m === 9) {
      const solde = model.tax(y - 1).balance;
      const d = workdayBefore(at(25));
      if (solde > 0) ops.prlv("joint", d, `Dgfip Impot Solde Revenus ${y - 1}`, solde, "B7");
      else if (solde < 0) ops.virIn("joint", d, `Dgfip Remboursement Impot Revenus ${y - 1}`, -solde, "B7");
    }
    if (m === 10) {
      const d = workdayAfter(at(15));
      ops.prlv("joint", d, `Dgfip Taxe Fonciere Nantes ${y}`, model.tf("rp", y).total, "B7");
      ops.prlv("a", d, `Dgfip Taxe Fonciere Angers ${y}`, model.tf("studio", y).total, "B7");
    }

    // Maison de famille (SCI) : appels de fonds au printemps et à l'automne.
    if (m === 3 || m === 9) ops.virOut("a", at(R.int(5, 20)), "Sci Les Tilleuls Appel De Fonds", m === 3 ? 280 : 240, "B10");

    // Achats avec facture : l'opération prend la catégorie principale des articles (source « facture »).
    for (const inv of invoices)
      if (inv.off === off && inv.payment)
        ops.card(inv.payment.acc, at(inv.day), inv.payment.shop, inv.payment.merchant, inv.total, categoryTotals(inv.items)[0][0], { ref: inv.ref, source: "facture", fixed: true });

    for (const b of CRYPTO_BUYS)
      if (b.off === off) {
        const t = ops.virOut("a", at(R.int(8, 20)), "Coinbase Europe Ltd", b.value, "B8", "Coinbase");
        if (t) cryptoBuys.push({ date: t.date, symbol: b.symbol, quantity: b.quantity, value: b.value });
      }

    spendMonth(ops, mo);
  }

  // Trois marchands jamais vus, achetés ces deux dernières semaines : restent « à classer ».
  ops.card("joint", addDays(s.T, -3), "Fleuriste Graslin", null, 32.5, null);
  ops.card("c", addDays(s.T, -9), "Escape Game Nantes", null, 84, null);
  ops.card("a", addDays(s.T, -12), "Librairie Du Passage", null, 23.9, null);
  return { cryptoBuys };
}
