import { z } from "zod";
import { one } from "../db.ts";
import { userAccountsSql } from "../actions.ts";
import { listEnvelopes, listGoals, saveEnvelope, saveGoal } from "../planning.ts";
import { ToolError, day, money, field, readTool, writeTool, type Tool } from "./registry.ts";
import { t as tr, td, tk } from "../../lib/i18n.ts";

/* Piloter : enveloppes mensuelles par poste et objectifs d'épargne (lecture, création, modification). */

const getPlans = readTool({
  name: "get_envelopes_and_goals",
  progress: tk("Lecture des enveloppes et objectifs…"),
  description:
    "Enveloppes mensuelles (plafond par poste ou catégorie, dépensé ce mois, reste, projection de fin de mois, moyenne des 3 derniers mois, état ok / alerte / dépassé) et objectifs d'épargne (montant visé, avancement, échéance, versement mensuel conseillé).",
  input: z.object({}),
  async run({ userId }) {
    const [envelopes, goals] = await Promise.all([listEnvelopes(userId, userAccountsSql(userId)), listGoals(userId)]);
    return { envelopes, goals };
  },
});

const setEnvelope = writeTool({
  name: "set_envelope",
  description:
    "Crée ou modifie une enveloppe mensuelle : plafond de dépenses pour un poste (ex. « Alimentation ») ou une catégorie (code), seuil d'alerte en %. Sans envelope_id : création. Proposer un plafond proche de la moyenne des 3 derniers mois si l'utilisateur n'en donne pas.",
  input: z.object({
    envelope_id: z.number().int().optional(),
    scope: z.enum(["poste", "categorie"]).optional(),
    ref: z.string().max(120).optional().describe("Nom du poste, ou code de catégorie si scope = categorie"),
    monthly: z.number().min(0).optional(),
    alert_pct: z.number().int().min(10).max(100).optional(),
  }),
  async describe(_ctx, i) {
    if (!i.envelope_id && (!i.ref || i.monthly == null)) throw new ToolError("Pour créer : ref (poste ou catégorie) et monthly");
    if (!i.envelope_id && i.scope === "categorie" && !(await one("SELECT id FROM categories WHERE id = ?", [i.ref]))) throw new ToolError(`Catégorie inconnue : ${i.ref}`);
    if (!i.envelope_id && (i.scope ?? "poste") === "poste" && !(await one("SELECT id FROM categories WHERE poste = ? LIMIT 1", [i.ref]))) throw new ToolError(`Poste inconnu : ${i.ref}`);
    return {
      // Le nom d'un poste se lit dans la langue du membre (un code de catégorie reste tel quel).
      label: i.envelope_id ? tr("Modifier l'enveloppe n° {id}", { id: i.envelope_id }) : tr("Créer l'enveloppe « {nom} »", { nom: td(i.ref) ?? "" }),
      details: [i.monthly != null ? tr("Plafond : {montant} par mois", { montant: money(i.monthly) }) : null, i.alert_pct ? tr("Alerte à {pct} %", { pct: i.alert_pct }) : null].filter((x): x is string => !!x),
    };
  },
  async run({ userId }, i) {
    await saveEnvelope(userId, i.envelope_id ?? null, { scope: i.scope, ref: i.ref, monthly: i.monthly, alertPct: i.alert_pct });
    return "Fait : enveloppe enregistrée.";
  },
});

const setGoal = writeTool({
  name: "set_goal",
  description:
    "Crée ou modifie un objectif d'épargne : nom, emoji, montant visé, date visée, placement ou livret lié (asset_id de get_wealth : l'avancement suit sa valeur) ou montant déjà mis de côté. Sans goal_id : création.",
  input: z.object({
    goal_id: z.number().int().optional(),
    name: z.string().max(120).optional(),
    emoji: z.string().max(16).nullable().optional(),
    target: z.number().min(1).optional(),
    target_date: day.nullable().optional(),
    asset_id: z.number().int().nullable().optional(),
    current_manual: z.number().min(0).nullable().optional(),
    status: z.enum(["actif", "atteint", "archive"]).optional(),
  }),
  async describe(_ctx, i) {
    if (!i.goal_id && (!i.name || i.target == null)) throw new ToolError("Pour créer : name et target");
    return {
      label: i.goal_id ? tr("Modifier l'objectif n° {id}", { id: i.goal_id }) : tr("Créer l'objectif « {nom} »", { nom: i.name ?? "" }),
      details: [i.target != null ? field(tr("Montant visé"), money(i.target)) : null, i.target_date ? tr("Pour le {date}", { date: i.target_date }) : null, i.current_manual != null ? field(tr("Déjà de côté"), money(i.current_manual)) : null].filter(
        (x): x is string => !!x,
      ),
    };
  },
  async run({ userId }, i) {
    await saveGoal(userId, i.goal_id ?? null, {
      name: i.name,
      emoji: i.emoji,
      target: i.target,
      targetDate: i.target_date,
      assetId: i.asset_id,
      currentManual: i.current_manual,
      status: i.status,
    });
    return "Fait : objectif enregistré.";
  },
});

export const pilotageTools: Tool[] = [getPlans, setEnvelope, setGoal];
