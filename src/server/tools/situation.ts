import { z } from "zod";
import { payslipHistory } from "../payslips.ts";
import {
  budget,
  cryptoEvents,
  deleteProjectionPocket,
  listProperties,
  projectionPocket,
  projectionsFor,
  propertyDetail,
  retirement,
  saveCommitment,
  saveProjections,
  saveRetirement,
  taxes,
  visibleCommitment,
} from "../situation.ts";
import { ToolError, change, day, money, field, longDate, readTool, today, writeTool } from "./registry.ts";
import { t as tr, tk, tn } from "../../lib/i18n.ts";

/* Domaines repris de Notion : immobilier, budget, impôts, retraite, projections, mouvements crypto. */

const getProperty = readTool({
  name: "get_property",
  progress: tk("Lecture de la fiche du bien…"),
  description:
    "Biens immobiliers du foyer (résidence principale, biens loués, parts de SCI) : sans property_id, la liste avec valeur, capital restant dû, équité, loyer, rendement brut et cash-flow ; avec property_id, la fiche complète (faits clés, bail, crédits, documents, taxes foncières, engagements, tâches).",
  input: z.object({ property_id: z.string().max(32).optional() }),
  async run({ userId }, { property_id }) {
    if (!property_id) return { properties: await listProperties(userId) };
    const d = await propertyDetail(userId, property_id);
    if (!d) throw new ToolError("Bien introuvable");
    return d;
  },
});

const getBudget = readTool({
  name: "get_budget",
  progress: tk("Calcul du budget…"),
  description:
    "Budget du foyer : engagements récurrents (frais fixes, crédits, assurances, abonnements, taxes, garde, budgets courants) avec statut, montant mensuel et dernier prélèvement retrouvé ; revenus du foyer ; totaux recalculés (charges fixes, revenus, reste à vivre) et dépenses réelles moyennes des 3 derniers mois par poste.",
  input: z.object({}),
  run: ({ userId }) => budget(userId),
});

/** Statut d'un engagement dans un texte de confirmation : l'identifiant reste la valeur, on ne traduit qu'à l'affichage. */
const STATUS_LABELS: Record<string, string> = { actif: tk("actif##statut"), a_verifier: tk("a_verifier"), a_completer: tk("a_completer"), resilie: tk("resilie"), non_compte: tk("non_compte") };
const statusLabel = (s: string) => tr(STATUS_LABELS[s] ?? s);

const updateCommitment = writeTool({
  name: "update_commitment",
  description:
    "Met à jour un engagement récurrent du budget (id = champ id de get_budget) : statut (actif, a_verifier, a_completer, resilie, non_compte), montant mensuel ou annuel, date de fin, date de renouvellement, préavis en jours, motif de libellé bancaire (minuscules sans chiffres), notes.",
  input: z.object({
    commitment_id: z.number().int(),
    status: z.enum(["actif", "a_verifier", "a_completer", "resilie", "non_compte"]).optional(),
    monthly: z.number().nullable().optional(),
    annual: z.number().nullable().optional(),
    end_date: day.nullable().optional(),
    renewal_date: day.nullable().optional(),
    notice_days: z.number().int().min(0).max(3650).nullable().optional(),
    match_pattern: z.string().max(120).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  }),
  async describe({ userId }, i) {
    const c = await visibleCommitment(userId, i.commitment_id).catch(() => null);
    if (!c) throw new ToolError("Engagement introuvable");
    const d: string[] = [];
    if (i.status !== undefined) d.push(change(tr("Statut"), statusLabel(c.status), statusLabel(i.status)));
    if (i.monthly !== undefined) d.push(change(tr("Mensuel"), c.monthly != null ? money(Number(c.monthly)) : "—", i.monthly != null ? money(i.monthly) : "—"));
    if (i.annual !== undefined) d.push(change(tr("Annuel"), c.annual != null ? money(Number(c.annual)) : "—", i.annual != null ? money(i.annual) : "—"));
    if (i.end_date !== undefined) d.push(change(tr("Fin"), c.end_date ?? "—", i.end_date ?? "—"));
    if (i.renewal_date !== undefined) d.push(change(tr("Renouvellement"), c.renewal_date ?? "—", i.renewal_date ?? "—"));
    if (i.notice_days !== undefined) d.push(tr("Préavis : {avant} → {apres} jours", { avant: c.notice_days ?? "—", apres: i.notice_days ?? "—" }));
    if (i.match_pattern !== undefined) d.push(change(tr("Motif de libellé"), c.match_pattern ?? "—", i.match_pattern ?? "—"));
    if (i.notes !== undefined) d.push(tr("Notes réécrites"));
    if (!d.length) throw new ToolError("Aucune modification demandée");
    return { label: tr("Modifier l'engagement « {nom} »", { nom: c.label }), details: d };
  },
  async run({ userId }, i) {
    await saveCommitment(userId, i.commitment_id, {
      status: i.status,
      monthly: i.monthly,
      annual: i.annual,
      endDate: i.end_date,
      renewalDate: i.renewal_date,
      noticeDays: i.notice_days,
      matchPattern: i.match_pattern,
      notes: i.notes,
    });
    return "Fait : engagement mis à jour.";
  },
});

const getTaxes = readTool({
  name: "get_taxes",
  progress: tk("Lecture des impôts…"),
  description:
    "Impôts du foyer : impôt sur le revenu par année de revenus (revenu imposable, RFR, impôt net, prélèvements sociaux, TMI, taux moyen, parts, crédits), taxes foncières par année et par bien, et documents fiscaux du coffre (avis, fiches d'analyse).",
  input: z.object({}),
  run: ({ userId }) => taxes(userId),
});

const getRetirement = readTool({
  name: "get_retirement",
  progress: tk("Lecture de la retraite…"),
  description:
    "Retraite de l'utilisateur connecté (privée) : faits officiels (trimestres validés et requis, points…), simulations par âge de départ (pension brute et nette mensuelle, décote/surcote), carrière enregistrée, documents.",
  input: z.object({}),
  run: ({ userId }) => retirement(userId),
});

const getProjections = readTool({
  name: "get_projections",
  progress: tk("Lecture des projections…"),
  description: "Projections du patrimoine (hors résidence principale) : valeur par poche selon 3 scénarios (prudent, central, favorable) et leurs hypothèses, avec les totaux.",
  input: z.object({}),
  run: ({ userId }) => projectionsFor(userId),
});

const getCryptoEvents = readTool({
  name: "get_crypto_events",
  progress: tk("Lecture des mouvements crypto…"),
  description: "Journal des mouvements crypto (dépôts, achats, ventes, transferts, staking, mining…) depuis 2018, du plus récent au plus ancien.",
  input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
  run: ({ userId }, { limit }) => cryptoEvents(userId, limit ?? 60),
});

const getPayslips = readTool({
  name: "get_payslips",
  progress: tk("Lecture des fiches de paie…"),
  description:
    "Revenus salariaux de l'utilisateur connecté (privé), lus dans ses bulletins de paie : par mois (brut, net imposable, impôt prélevé à la source, net payé, primes, employeur) et totaux par année.",
  input: z.object({ months: z.number().int().min(1).max(240).optional().describe("Nombre de bulletins détaillés, défaut 24") }),
  async run({ userId }, { months }) {
    const h = await payslipHistory(userId);
    return { years: h.years, payslips: h.payslips.slice(0, months ?? 24) };
  },
});

/* ---------- Écriture des projections ---------- */

const SCENARIOS = ["prudent", "central", "favorable"] as const;
/** Scénario et portée d'une poche dans un texte de confirmation : les identifiants restent les valeurs, on ne traduit qu'à l'affichage. */
const SCENARIO_LABELS: Record<string, string> = { prudent: tk("prudent"), central: tk("central"), favorable: tk("favorable") };
const scenarioLabel = (sc: string) => tr(SCENARIO_LABELS[sc] ?? sc);
const scopeLabel = (shared: boolean | undefined) => (shared ? tr("commune##poche") : tr("privée##poche"));
const pocketInput = {
  poche: z.string().min(1).max(60).describe("Nom de la poche (ex. « Crypto », « Résidence principale (part 50 %) »)"),
  horizon_year: z.number().int().min(2025).max(2100),
  shared: z.boolean().optional().describe("true = poche commune, visible de tout le foyer (ex. la résidence principale) ; défaut : privée à l'utilisateur"),
};

const setProjection = writeTool({
  name: "set_projection",
  description:
    "Crée ou met à jour une poche des projections de patrimoine : valeur attendue à l'horizon par scénario (prudent, central, favorable) et hypothèses. " +
    "Hypothèse = segments séparés par « · » ou « — », en commençant par « Net au JJ/MM/AAAA : montant » suivi du signe de la devise du foyer (« Net au 01/09/2026 : 100 000 € ») ; les segments identiques d'un scénario à l'autre sont affichés une seule fois. " +
    "Un scénario non fourni n'est pas modifié ; une hypothèse non fournie est gardée.",
  input: z.object({
    ...pocketInput,
    prudent: z.number().optional(),
    central: z.number().optional(),
    favorable: z.number().optional(),
    hypothesis_prudent: z.string().max(2000).optional(),
    hypothesis_central: z.string().max(2000).optional(),
    hypothesis_favorable: z.string().max(2000).optional(),
    as_of: day.optional().describe("Date du point de départ, défaut aujourd'hui"),
  }),
  async describe({ userId }, i) {
    const given = SCENARIOS.filter((sc) => i[sc] !== undefined);
    if (!given.length) throw new ToolError("Indique la valeur d'au moins un scénario (prudent, central, favorable)");
    const orphan = SCENARIOS.find((sc) => i[`hypothesis_${sc}`] !== undefined && i[sc] === undefined);
    if (orphan) throw new ToolError(`Hypothèse fournie sans valeur pour le scénario ${orphan} : donne aussi sa valeur`);
    const before = new Map((await projectionPocket(i.shared ? null : userId, i.horizon_year, i.poche)).map((r) => [r.scenario, r.value]));
    return {
      label: before.size
        ? tr("Mettre à jour la poche « {poche} » des projections {annee} ({portee})", { poche: i.poche, annee: i.horizon_year, portee: scopeLabel(i.shared) })
        : tr("Créer la poche « {poche} » des projections {annee} ({portee})", { poche: i.poche, annee: i.horizon_year, portee: scopeLabel(i.shared) }),
      details: given.map((sc) => {
        const line = before.get(sc) != null ? change(scenarioLabel(sc), money(Number(before.get(sc))), money(i[sc]!)) : field(scenarioLabel(sc), money(i[sc]!));
        return i[`hypothesis_${sc}`] ? `${line} ${tr("(hypothèses mises à jour)")}` : line;
      }),
    };
  },
  async run({ userId }, i) {
    const rows = SCENARIOS.filter((sc) => i[sc] !== undefined).map((sc) => ({ scenario: sc, poche: i.poche, value: i[sc]!, hypothesis: i[`hypothesis_${sc}`] }));
    await saveProjections(i.shared ? null : userId, i.horizon_year, i.as_of ?? today(), rows);
    return `Fait : poche « ${i.poche} » enregistrée (${rows.length} scénario${rows.length > 1 ? "s" : ""}).`;
  },
});

const deleteProjection = writeTool({
  name: "delete_projection",
  description: "Supprime une poche des projections de patrimoine (tous ses scénarios) à un horizon donné.",
  input: z.object(pocketInput),
  async describe({ userId }, i) {
    const rows = await projectionPocket(i.shared ? null : userId, i.horizon_year, i.poche);
    if (!rows.length) throw new ToolError(`Aucune poche ${i.shared ? "commune" : "privée"} « ${i.poche} » à l'horizon ${i.horizon_year}`);
    return {
      label: tr("Supprimer la poche « {poche} » des projections {annee} ({portee})", { poche: i.poche, annee: i.horizon_year, portee: scopeLabel(i.shared) }),
      details: rows.map((r) => field(scenarioLabel(r.scenario), r.value == null ? "—" : money(Number(r.value)))),
    };
  },
  async run({ userId }, i) {
    const n = await deleteProjectionPocket(i.shared ? null : userId, i.horizon_year, i.poche);
    return `Fait : ${n} ligne${n > 1 ? "s" : ""} supprimée${n > 1 ? "s" : ""}.`;
  },
});

/* ---------- Écriture de la retraite ---------- */

const amount = z.number().nullable().optional();

const saveRetirementTool = writeTool({
  name: "save_retirement",
  description:
    "Enregistre la retraite de l'utilisateur (privée) telle que relevée sur info-retraite : simulations par âge de départ à une date donnée, carrière année par année, faits clés. " +
    "Rejouable : même date et même libellé de simulation, ou même période de carrière = mise à jour. " +
    "L'écran lit les faits dont le libellé commence par « Trimestres enregistrés », « Trimestres requis », « Âge légal », « Âge du taux plein », ou contient « départ au plus tôt ».",
  input: z.object({
    simulated_on: day.describe("Date du relevé ou de la simulation"),
    facts: z.array(z.object({ key: z.string().min(1).max(60), label: z.string().min(1).max(160), value: z.union([z.string(), z.number()]), unit: z.string().max(24).nullable().optional() })).max(60).optional(),
    simulations: z
      .array(
        z.object({
          label: z.string().min(1).max(160),
          age: amount.describe("Âge de départ en années (63,42 = 63 ans et 5 mois)"),
          quarters: z.number().int().nullable().optional(),
          base_pension: amount.describe("Pension de base brute mensuelle"),
          complementary: amount.describe("Complémentaire brute mensuelle"),
          gross_monthly: amount,
          net_monthly: amount.describe("Net mensuel avant impôt"),
          adjustment: z.string().max(120).nullable().optional().describe("Décote, surcote, taux plein…"),
          source: z.enum(["info-retraite", "scenario"]).optional().describe("info-retraite = estimation officielle (défaut) ; scenario = hypothèse personnelle"),
          notes: z.string().max(2000).nullable().optional(),
        }),
      )
      .max(50)
      .optional(),
    career: z
      .array(
        z.object({
          period: z.string().min(1).max(60).describe("Année ou période (ex. « 2019 »)"),
          start_year: z.number().int().nullable().optional(),
          end_year: z.number().int().nullable().optional(),
          employer: z.string().max(160).nullable().optional(),
          income: amount.describe("Revenu annuel soumis à cotisations"),
          quarters: z.number().int().nullable().optional(),
          points: amount,
          notes: z.string().max(2000).nullable().optional(),
        }),
      )
      .max(80)
      .optional(),
  }),
  async describe(_ctx, i) {
    const n = [
      i.simulations?.length ? tn("{n} simulation", "{n} simulations", i.simulations.length) : null,
      i.career?.length ? tn("{n} période de carrière", "{n} périodes de carrière", i.career.length) : null,
      i.facts?.length ? tn("{n} fait clé", "{n} faits clés", i.facts.length) : null,
    ].filter((x): x is string => !!x);
    if (!n.length) throw new ToolError("Rien à enregistrer : fournis des simulations, des périodes de carrière ou des faits clés");
    return { label: tr("Enregistrer ta retraite au {date}", { date: longDate(i.simulated_on) }), details: n };
  },
  async run({ userId }, i) {
    const r = await saveRetirement(userId, {
      simulatedOn: i.simulated_on,
      facts: i.facts?.map((f) => ({ ...f, value: String(f.value) })),
      simulations: (i.simulations ?? []).map((s) => ({ label: s.label, age: s.age, quarters: s.quarters, basePension: s.base_pension, complementary: s.complementary, grossMonthly: s.gross_monthly, netMonthly: s.net_monthly, adjustment: s.adjustment, source: s.source, notes: s.notes })),
      career: (i.career ?? []).map((c) => ({ period: c.period, startYear: c.start_year, endYear: c.end_year, employer: c.employer, income: c.income, quarters: c.quarters, points: c.points, notes: c.notes })),
    });
    return `Fait : ${r.simulations} simulation(s) et ${r.career} période(s) de carrière enregistrées.`;
  },
});

export const situationTools = [getPayslips, getProperty, getBudget, getTaxes, getRetirement, getProjections, getCryptoEvents, updateCommitment, setProjection, deleteProjection, saveRetirementTool];
