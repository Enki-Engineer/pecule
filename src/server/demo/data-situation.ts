/*
 * Situation du foyer : biens immobiliers, engagements récurrents (motifs qui retrouvent les
 * prélèvements générés), revenus, bulletins de paie d'Alex (12 derniers mois, net versé = virement
 * reçu), impôt sur le revenu (2 années) et taxes foncières.
 */
import type * as schema from "../db/schema/index.ts";
import { labelShape, shapeRegex } from "../../lib/nature.ts";
import type { DocIds } from "./data-documents.ts";
import { RP_LOAN_LABEL, STUDIO_LOAN_LABEL, rpDebitLabel } from "./data-operations.ts";
import { ASSET_IDS, LOANS } from "./data-patrimoine.ts";
import { DONS, type Echeance, type IncomeModel, PARTS, type Scenario, rentAt, taxYears, tfYears, tmiOf } from "./model.ts";
import { type DemoUser, type Insert, addMonths, monthOf, pad, r2, workdayBefore, yearOf, ymd } from "./rng.ts";

export const PROPERTY_IDS = { rp: "rp-nantes", studio: "studio-angers" } as const;

type Commitment = Insert<typeof schema.commitments>;

export function buildSituation(s: Scenario, model: IncomeModel, [ua, uc]: readonly [DemoUser, DemoUser], loans: { rp: Echeance[]; studio: Echeance[] }, docs: DocIds) {
  const properties: Insert<typeof schema.properties>[] = [
    { id: PROPERTY_IDS.rp, ownerUserId: null, name: "Résidence principale — Nantes", kind: "residence_principale", city: "Nantes", surface: 86, rooms: 4, acquisitionDate: s.rpBought, acquisitionPrice: 345_000, acquisitionCosts: 26_800, chargesMonthly: 122, assetId: ASSET_IDS.rp, loanIds: LOANS.rp.id, sortOrder: 0 },
    {
      id: PROPERTY_IDS.studio,
      ownerUserId: ua.id,
      name: "Studio meublé — Angers",
      kind: "locatif",
      city: "Angers",
      surface: 24.3,
      rooms: 1,
      acquisitionDate: s.studioBought,
      acquisitionPrice: 98_000,
      acquisitionCosts: 8_900,
      rentMonthly: rentAt(s, s.T),
      chargesMonthly: 137,
      deposit: 1_040,
      leaseKind: "meublé",
      leaseStart: s.leaseStart,
      nextRentRevision: s.nextRevision,
      taxRegime: "LMNP micro-BIC",
      assetId: ASSET_IDS.studio,
      loanIds: LOANS.studio.id,
      sortOrder: 1,
    },
  ];

  const next = (rows: Echeance[]) => rows.find((r) => r.date > s.T) ?? rows[rows.length - 1];
  const jan1 = ymd(s.TY + 1, 1, 1);
  const c = (label: string, groupName: string, type: string, categoryId: string, amount: { monthly?: number; annual?: number }, more: Partial<Commitment> = {}): Commitment => ({
    label,
    groupName,
    type,
    status: "actif",
    categoryId,
    monthly: amount.monthly ?? null,
    annual: amount.annual ?? null,
    ...more,
  });
  const commitments: Commitment[] = [
    c(RP_LOAN_LABEL, "Logement", "credit", "B1-01", { monthly: next(loans.rp).payment }, { labelRegex: shapeRegex(labelShape(rpDebitLabel(1, s.rpFirst))), provider: LOANS.rp.bank, propertyId: PROPERTY_IDS.rp, startDate: s.rpFirst, endDate: loans.rp[loans.rp.length - 1].date }),
    c("Charges de copropriété", "Logement", "abonnement", "B1-02", { annual: 1464 }, { matchPattern: "syndic atlantique", provider: "Syndic Atlantique Gestion", propertyId: PROPERTY_IDS.rp }),
    c("Électricité", "Logement", "abonnement", "B1-03", { monthly: 96 }, { matchPattern: "edf", provider: "EDF" }),
    c("Eau", "Logement", "abonnement", "B1-03", { annual: 352 }, { matchPattern: "saur", provider: "Saur" }),
    c("Assurance habitation", "Logement", "assurance", "B1-04", { monthly: 27.4 }, { matchPattern: "maif", provider: "MAIF", propertyId: PROPERTY_IDS.rp, renewalDate: jan1, noticeDays: 30 }),
    c("Box internet", "Logement", "abonnement", "B1-05", { monthly: 35.99 }, { matchPattern: "freebox", provider: "Free" }),
    c(`Forfait mobile ${ua.name}`, "Téléphonie", "abonnement", "B1-05", { monthly: 15.99 }, { matchPattern: "free mobile", provider: "Free Mobile", ownerUserId: ua.id }),
    c(`Forfait mobile ${uc.name}`, "Téléphonie", "abonnement", "B1-05", { monthly: 19.99 }, { matchPattern: "orange", provider: "Orange", ownerUserId: uc.id }),
    c("Assurance auto", "Transports", "assurance", "B2-02", { monthly: 47.8 }, { matchPattern: "macif", provider: "Macif", renewalDate: s.macifRenewal, noticeDays: 30 }),
    c(`Abonnement Naolib ${uc.name}`, "Transports", "abonnement", "B2-04", { monthly: 49.5 }, { matchPattern: "naolib abonnement", provider: "Naolib", ownerUserId: uc.id, notes: "Remboursé à 50 % par l'employeur sur la fiche de paie" }),
    c("Restauration scolaire", "Famille", "abonnement", "B4-01", { monthly: 68 }, { matchPattern: "restauration scolaire", provider: "Ville de Nantes", notes: "Facturée au nombre de repas, hors juillet et août" }),
    c("Accueil périscolaire", "Famille", "garde", "B4-03", { monthly: 46 }, { matchPattern: "periscolaire", provider: "Ville de Nantes" }),
    c("Judo de Léo", "Famille", "abonnement", "B4-02", { annual: 185 }, { matchPattern: "judo club", renewalDate: s.TM >= 9 ? ymd(s.TY + 1, 9, 1) : ymd(s.TY, 9, 1) }),
    c(`Mutuelle santé ${uc.name}`, "Santé", "assurance", "B6-02", { monthly: 61.9 }, { matchPattern: "harmonie mutuelle", provider: "Harmonie Mutuelle", ownerUserId: uc.id, renewalDate: jan1, noticeDays: 30 }),
    c("Netflix", "Abonnements", "abonnement", "B9-02", { monthly: 13.49 }, { matchPattern: "netflix", provider: "Netflix" }),
    c("Spotify Famille", "Abonnements", "abonnement", "B9-02", { monthly: 21.99 }, { matchPattern: "spotify", provider: "Spotify", ownerUserId: ua.id }),
    c("Disney+", "Abonnements", "abonnement", "B9-02", { monthly: 9.99 }, { matchPattern: "disney", provider: "Disney+", ownerUserId: uc.id }),
    c("Stockage iCloud", "Abonnements", "abonnement", "B9-02", { monthly: 2.99 }, { matchPattern: "apple", provider: "Apple", ownerUserId: ua.id }),
    c(`Salle de sport ${uc.name}`, "Abonnements", "abonnement", "B9-01", { monthly: 29.99 }, { matchPattern: "basic fit", ownerUserId: uc.id }),
    c("Canal+", "Abonnements", "abonnement", "B9-02", { monthly: 24.99 }, { status: "resilie", matchPattern: "canal", provider: "Canal+", endDate: s.canalEnd }),
    c("Impôt sur le revenu (acomptes)", "Impôts", "taxe", "B7", { monthly: model.acompteAt(s.TY, s.TM) }, { matchPattern: "dgfip impot acompte", ownerUserId: ua.id, notes: "Acomptes sur les loyers du studio ; les salaires sont prélevés à la source" }),
    c("Taxe foncière — résidence principale", "Impôts", "taxe", "B7", { annual: model.tf("rp", s.TY).total }, { matchPattern: "taxe fonciere nantes", propertyId: PROPERTY_IDS.rp }),
    c("Taxe foncière — studio", "Impôts", "taxe", "B7", { annual: model.tf("studio", s.TY).total }, { matchPattern: "taxe fonciere angers", propertyId: PROPERTY_IDS.studio, ownerUserId: ua.id }),
    c(STUDIO_LOAN_LABEL, "Studio Angers", "credit", "B1-01", { monthly: next(loans.studio).payment }, { matchPattern: "caisse d epargne", provider: LOANS.studio.bank, propertyId: PROPERTY_IDS.studio, ownerUserId: ua.id, startDate: s.studioFirst, endDate: loans.studio[loans.studio.length - 1].date }),
    c("Charges de copropriété du studio", "Studio Angers", "abonnement", "B1-02", { annual: 832 }, { matchPattern: "cabinet gerance anjou", propertyId: PROPERTY_IDS.studio, ownerUserId: ua.id }),
    c("Assurance propriétaire non occupant", "Studio Angers", "assurance", "B1-04", { monthly: 8.9 }, { matchPattern: "axa", provider: "AXA", propertyId: PROPERTY_IDS.studio, ownerUserId: ua.id }),
    c("Courses du quotidien", "Budgets courants", "budget", "B3-01", { monthly: 1100 }, { notes: "Enveloppe indicative, sans prélèvement" }),
  ];
  commitments.forEach((x, i) => (x.sortOrder = i));

  const regular = model.payslip("a", s.TY, s.TM === 3 ? 4 : s.TM);
  const regularC = model.payslip("c", s.TY, s.TM);
  const person = (u: DemoUser) => u.name.slice(0, 16);
  const incomeSources: Insert<typeof schema.incomeSources>[] = [
    { person: person(ua), label: "Salaire Nexalia Conseil", kind: "salaire", monthly: Math.round(regular.netPaid), annualGross: Math.round(regular.gross * 12), validFrom: ymd(s.TY - 5, 9, 1), notes: "Net versé, après prélèvement à la source", sortOrder: 0 },
    { person: person(ua), label: "Prime annuelle", kind: "bonus", annualGross: model.payslip("a", s.TY, 3).bonus, notes: "Versée avec le salaire de mars", sortOrder: 1 },
    { person: person(uc), label: "Salaire Clinique de l'Estuaire", kind: "salaire", monthly: Math.round(regularC.netPaid), annualGross: Math.round(regularC.gross * 12), validFrom: ymd(s.TY - 7, 3, 1), notes: "Net versé, après prélèvement à la source", sortOrder: 2 },
    { ownerUserId: ua.id, person: person(ua), label: "Loyer du studio d'Angers", kind: "loyer", monthly: rentAt(s, s.T), validFrom: s.leaseStart, notes: "Charges comprises, bail meublé", sortOrder: 3 },
  ];

  // Bulletins d'Alex : les 12 derniers déjà versés.
  const payslips: Insert<typeof schema.payslips>[] = [];
  for (let k = 0; payslips.length < 12 && k < 14; k++) {
    const first = addMonths(`${s.T.slice(0, 7)}-01`, -k, 1);
    const y = yearOf(first);
    const m = monthOf(first);
    const payDate = workdayBefore(ymd(y, m, 27));
    if (payDate > s.T) continue;
    const p = model.payslip("a", y, m);
    let ytd = 0;
    for (let j = 1; j <= m; j++) ytd += model.payslip("a", y, j).netTaxable;
    payslips.push({ ownerUserId: ua.id, employer: "Nexalia Conseil", period: `${y}-${pad(m)}`, payDate, gross: p.gross, netBeforeTax: p.netBefore, netTaxable: p.netTaxable, incomeTax: p.pas, taxRate: p.rate, netPaid: p.netPaid, bonus: p.bonus || null, employerCost: p.employerCost, ytdNetTaxable: r2(ytd), notes: p.bonus ? "Prime annuelle sur objectifs" : null });
  }

  const taxReturns: Insert<typeof schema.taxReturns>[] = taxYears(s).map((iy) => {
    const t = model.tax(iy);
    return {
      incomeYear: iy,
      noticeYear: iy + 1,
      parts: PARTS,
      situation: "Pacsés, 1 enfant à charge",
      otherIncome: t.bic,
      taxableIncome: t.taxable,
      rfr: t.taxable,
      netTax: t.netTax,
      socialLevies: t.ps,
      total: t.total,
      decote: 0,
      credits: t.credits,
      balance: t.balance,
      tmi: tmiOf(t.taxable),
      avgRate: r2((100 * t.total) / t.taxable),
      creditsDetail: `Dons aux associations : ${DONS} € (réduction de ${t.credits} €)`,
      notes: "Loyers du studio au régime micro-BIC (abattement de 50 %)",
      documentId: docs.avis.get(iy) ?? null,
    };
  });

  const lastTf = tfYears(s).at(-1);
  const propertyTaxes: Insert<typeof schema.propertyTaxes>[] = tfYears(s).flatMap((y) =>
    (["rp", "studio"] as const).map((k) => {
      const t = model.tf(k, y);
      return { year: y, propertyId: PROPERTY_IDS[k], base: t.base, contributions: t.contributions, teom: t.teom, fees: t.fees, total: t.total, notes: k === "rp" ? "Payée en une fois à l'échéance du 15 octobre" : null, documentId: k === "rp" && y === lastTf ? docs.tfRp : null };
    }),
  );

  // Salaires déclarés par chacun des deux membres.
  const taxReturnSalaries: Insert<typeof schema.taxReturnSalaries>[] = taxYears(s).flatMap((iy) => {
    const t = model.tax(iy);
    return [
      { incomeYear: iy, userId: ua.id, amount: t.salA },
      { incomeYear: iy, userId: uc.id, amount: t.salC },
    ];
  });

  return { properties, commitments, incomeSources, payslips, taxReturns, taxReturnSalaries, propertyTaxes };
}
