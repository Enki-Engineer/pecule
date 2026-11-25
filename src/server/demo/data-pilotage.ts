/*
 * Pilotage : retraite d'Alex (simulations et carrière, privées), projections du patrimoine, faits
 * clés des biens, enveloppes mensuelles, objectifs d'épargne et échéancier (une tâche en retard,
 * tâches récurrentes, jalons).
 */
import type * as schema from "../db/schema/index.ts";
import { ASSET_IDS } from "./data-patrimoine.ts";
import { PROPERTY_IDS } from "./data-situation.ts";
import type { Balances } from "./data-simulation.ts";
import type { Scenario } from "./model.ts";
import { type DemoUser, type Insert, addDays, addMonths, dateFr, ymd } from "./rng.ts";

export function buildPilotage(s: Scenario, [ua, uc]: readonly [DemoUser, DemoUser], final: Balances) {
  const simulatedOn = addMonths(s.T, -4, 14);
  const sim = (label: string, age: number, quarters: number, base: number, complementary: number, adjustment: string | null) => ({
    ownerUserId: ua.id,
    simulatedOn,
    label,
    age,
    quarters,
    basePension: base,
    complementary,
    grossMonthly: base + complementary,
    netMonthly: Math.round((base + complementary) * 0.9),
    adjustment,
    source: "info-retraite",
    notes: "Projection à revenus constants",
  });
  const retirementSimulations: Insert<typeof schema.retirementSimulations>[] = [
    sim("Départ à l'âge légal (64 ans)", 64, 168, 1418, 1032, "Décote de 4 trimestres (-5 %)"),
    sim("Départ au taux plein (65 ans)", 65, 172, 1530, 1102, null),
    sim("Départ à 67 ans (taux plein automatique)", 67, 180, 1611, 1205, "Surcote de 8 trimestres (+10 %)"),
  ];

  // Carrière d'Alex (38 ans) : 17 années validées jusqu'à l'an dernier.
  const born = s.TY - 38;
  const period = (from: number, to: number, employer: string, income: number, points: number, notes: string | null = null) => ({
    ownerUserId: ua.id,
    period: `${from}-${to}`,
    startYear: from,
    endYear: to,
    employer,
    income,
    quarters: (to - from) * 4,
    points,
    notes,
  });
  const careerPeriods: Insert<typeof schema.careerPeriods>[] = [
    period(born + 20, born + 22, "Groupe Atlantique Distribution", 14_800, 1_240, "Apprentissage (master en alternance)"),
    period(born + 22, born + 26, "Ouest Audit & Conseil", 34_500, 2_480),
    period(born + 26, born + 32, "Ligérienne de Services Numériques", 46_200, 4_350),
    period(born + 32, s.TY - 1, "Nexalia Conseil", 66_400, 5_100, "Cadre, temps plein"),
  ];

  const asOf = addMonths(s.T, -1, 15);
  const projections: Insert<typeof schema.projections>[] = [];
  const HYP: Record<string, string> = {
    prudent: "Immobilier +0,5 %/an, placements +3 %/an, épargne de 600 €/mois",
    central: "Immobilier +1,5 %/an, placements +5 %/an, épargne de 900 €/mois",
    favorable: "Immobilier +2,5 %/an, placements +7 %/an, épargne de 1 200 €/mois",
  };
  const VALUES: Record<string, [number, number, number][]> = {
    // horizon +5 ans, puis +10 ans : immobilier net, placements financiers, épargne disponible
    prudent: [[300_000, 75_000, 35_000], [420_000, 130_000, 40_000]],
    central: [[330_000, 95_000, 45_000], [470_000, 185_000, 55_000]],
    favorable: [[360_000, 120_000, 55_000], [520_000, 250_000, 70_000]],
  };
  for (const scenario of ["prudent", "central", "favorable"])
    [5, 10].forEach((h, i) =>
      ["Immobilier net", "Placements financiers", "Épargne disponible"].forEach((poche, j) =>
        projections.push({ ownerUserId: null, scenario, horizonYear: s.TY + h, poche, value: VALUES[scenario][i][j], hypothesis: HYP[scenario], asOf }),
      ),
    );

  const fact = (owner: number | null, entityType: string, entityId: string, list: [key: string, label: string, value: string, unit?: string][]) =>
    list.map(([factKey, label, value, unit], sortOrder) => ({ ownerUserId: owner, entityType, entityId, factKey, label, value, unit: unit ?? null, asOf: null, sortOrder }));
  const facts: Insert<typeof schema.facts>[] = [
    ...fact(null, "property", PROPERTY_IDS.rp, [
      ["adresse", "Adresse", "14 allée des Hérons, 44300 Nantes"],
      ["lots", "Lots", "Appartement 4 pièces, cave et place de parking"],
      ["construction", "Année de construction", "2009"],
      ["dpe", "Classe énergie", "C (142 kWh/m²/an)"],
      ["syndic", "Syndic", "Syndic Atlantique Gestion"],
    ]),
    ...fact(ua.id, "property", PROPERTY_IDS.studio, [
      ["adresse", "Adresse", "8 rue des Ardoisiers, 49100 Angers"],
      ["locataire", "Locataire", `Lucie Garnier, depuis le ${dateFr(s.leaseStart)}`],
      ["gestion", "Gestion", "En direct, sans agence"],
      ["dpe", "Classe énergie", "D (198 kWh/m²/an)"],
    ]),
    ...fact(ua.id, "retirement", String(ua.id), [
      ["age_legal", "Âge légal de départ", "64", "ans"],
      ["trimestres_requis", "Trimestres requis pour le taux plein", "172"],
      ["trimestres_valides", "Trimestres validés", "68"],
      ["points_complementaire", "Points Agirc-Arrco", "13170", "points"],
    ]),
  ];

  const envelopes: Insert<typeof schema.envelopes>[] = [
    { ownerUserId: null, scope: "poste", ref: "Alimentation", monthly: 1250, alertPct: 80, sortOrder: 0 },
    { ownerUserId: null, scope: "poste", ref: "Loisirs & Vacances", monthly: 450, alertPct: 80, sortOrder: 1 },
    { ownerUserId: null, scope: "categorie", ref: "B3-04", monthly: 220, alertPct: 85, sortOrder: 2 },
    { ownerUserId: uc.id, scope: "categorie", ref: "B12-04", monthly: 120, alertPct: 80, sortOrder: 3 },
  ];

  const japan = addMonths(s.T, 17, 1);
  const goals: Insert<typeof schema.goals>[] = [
    { ownerUserId: null, name: "Voyage au Japon", emoji: "🗾", target: 7_000, targetDate: japan, currentManual: 2_350, notes: "Deux semaines en famille au printemps : vols, pass ferroviaire, hébergements" },
    { ownerUserId: null, name: "Matelas de sécurité", emoji: "🛟", target: 30_000, currentManual: Math.floor((final.livret + final.ldds) / 10) * 10, notes: "Six mois de dépenses, sur le Livret A et le LDDS" },
    { ownerUserId: null, name: "Études de Léo", emoji: "🎓", target: 30_000, targetDate: ymd(s.TY + 12, 9, 1), assetId: ASSET_IDS.av, notes: `Assurance-vie de ${uc.name} fléchée sur les études` },
  ];

  const nextFirst = addMonths(`${s.T.slice(0, 7)}-01`, 1, 1);
  const declared = s.T >= ymd(s.TY, 5, 28) ? s.TY : s.TY - 1;
  const agendaItems: Insert<typeof schema.agendaItems>[] = [
    { ownerUserId: null, kind: "tache", title: "Envoyer l'attestation d'assurance habitation au syndic", dueDate: addDays(s.T, -12), domain: "immobilier", entityType: "property", entityId: PROPERTY_IDS.rp, notes: "Demandée par Syndic Atlantique Gestion pour le dossier de l'assemblée générale" },
    { ownerUserId: ua.id, kind: "tache", title: "Régulariser les charges du studio avec la locataire", dueDate: addDays(s.T, 18), domain: "immobilier", entityType: "property", entityId: PROPERTY_IDS.studio, amount: 86.4 },
    { ownerUserId: null, kind: "tache", title: "Comparer les offres d'assurance auto avant l'échéance", dueDate: addDays(s.T, 7), domain: "budget", notes: `Échéance du contrat le ${dateFr(s.carInsuranceRenewal)}, préavis d'un mois` },
    { ownerUserId: null, kind: "tache", title: "Passer en revue les opérations à classer", dueDate: nextFirst, domain: "banque", recurrence: "mensuel" },
    { ownerUserId: ua.id, kind: "tache", title: "Réviser le loyer du studio (IRL)", dueDate: addDays(s.nextRevision, -15), domain: "immobilier", entityType: "property", entityId: PROPERTY_IDS.studio, recurrence: "annuel" },
    { ownerUserId: null, kind: "tache", title: "Déclarer les revenus de l'année", dueDate: ymd(declared, 5, 28), domain: "impots", status: "fait", doneAt: `${ymd(declared, 5, 20)} 21:14:00` },
    { ownerUserId: null, kind: "jalon", title: "Léo entre au CE1", dueDate: s.TM >= 9 ? ymd(s.TY + 1, 9, 1) : ymd(s.TY, 9, 1), domain: "autre" },
    { ownerUserId: null, kind: "jalon", title: "Départ au Japon (objectif)", dueDate: japan, domain: "budget" },
  ];

  return { retirementSimulations, careerPeriods, projections, facts, envelopes, goals, agendaItems };
}
