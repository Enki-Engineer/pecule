import { z } from "zod";
import { one } from "../db.ts";
import { userAccountsSql } from "../actions.ts";
import { listEnvelopes, listGoals, saveEnvelope, saveGoal } from "../planning.ts";
import { ToolError, change, day, money, field, readTool, writeTool, type Tool } from "./registry.ts";
import { balanceForecast, saveBalanceRule } from "../balance.ts";
import { MAX_BALANCE_DAYS } from "../../lib/balance.ts";
import { t as tr, td, tk } from "../../lib/i18n.ts";

/* Piloter : enveloppes mensuelles par poste, objectifs d'épargne et alerte de solde bas (lecture, création, modification). */

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
  async describe({ userId }, i) {
    if (!i.goal_id && (!i.name || i.target == null)) throw new ToolError("Pour créer : name et target");
    // Objectif modifié : nommé (pas un simple numéro), et chaque champ fourni est montré — statut et placement lié compris.
    const goal = i.goal_id ? await one<{ name: string }>("SELECT name FROM goals WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [i.goal_id, userId]) : null;
    if (i.goal_id && !goal) throw new ToolError(`Objectif n° ${i.goal_id} introuvable`);
    const status = { actif: tr("En cours##objectif"), atteint: tr("Atteint"), archive: tr("Archivé") };
    return {
      label: goal ? tr("Modifier l'objectif « {nom} »", { nom: goal.name }) : tr("Créer l'objectif « {nom} »", { nom: i.name ?? "" }),
      details: [
        goal && i.name !== undefined ? change(tr("Nom"), goal.name, i.name) : null,
        i.emoji !== undefined ? field(tr("Emoji"), i.emoji ?? "—") : null,
        i.target != null ? field(tr("Montant visé"), money(i.target)) : null,
        i.target_date !== undefined ? (i.target_date ? tr("Pour le {date}", { date: i.target_date }) : field(tr("Date visée"), "—")) : null,
        i.asset_id !== undefined ? field(tr("Placement lié"), i.asset_id == null ? "—" : `n° ${i.asset_id}`) : null,
        i.current_manual !== undefined ? field(tr("Déjà de côté"), i.current_manual == null ? "—" : money(i.current_manual)) : null,
        i.status !== undefined ? field(tr("Statut"), status[i.status]) : null,
      ].filter((x): x is string => !!x),
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

const getBalanceAlert = readTool({
  name: "get_balance_alert",
  progress: tk("Lecture des soldes prévus…"),
  description:
    "Alerte de solde bas du membre et prévision de ses comptes. Règle : active ou non, seuil (devise du foyer), nombre de jours de prévenance, réglages propres à un compte (non surveillé, seuil à lui). Par compte (hors cartes) : solde du jour, s'il est surveillé et à quel seuil, `low` = premier jour où le solde prévu passerait sous le seuil dans le délai de prévenance (avec le mouvement en cause), `min` = point le plus bas des 31 jours à venir, et `movements` = ce qui est attendu sur ce compte (récurrences reconnues dans ses cinq derniers mois, mouvements entre comptes compris ; relevé des cartes à débit différé). Les achats du quotidien ne sont pas devinés : c'est une estimation des engagements connus. Pour répondre à « est-ce que je vais être à découvert ? », « quel compte faut-il alimenter ? ».",
  input: z.object({}),
  async run({ userId }) {
    const f = await balanceForecast(userId);
    // Le jour par jour (`points`) ne sert pas à l'assistant : la règle, les points marquants et les mouvements suffisent.
    return { rule: f.rule, today: f.today, horizon_days: f.horizon, accounts: f.accounts.map(({ points: _points, ...a }) => a) };
  },
});

const setBalanceAlert = writeTool({
  name: "set_balance_alert",
  description:
    "Règle l'alerte de solde bas du membre : `enabled` (surveiller ou non), `threshold` (seuil en dessous duquel un compte est signalé, devise du foyer ; négatif possible pour prévenir avant la limite d'un découvert autorisé), `days` (prévenir quand le seuil serait franchi dans ce nombre de jours, 1 à 31). Pour un seul compte : `account_id` (de get_balance_alert ou list_accounts) avec `account_watch` (false : ne plus le surveiller) et/ou `account_threshold` (seuil propre ; null : reprendre celui de la règle). Ne donner que ce qui change. L'alerte arrive en notification (type « Solde bas » activé sur l'appareil) et se lit sur le calendrier du mois.",
  input: z.object({
    enabled: z.boolean().optional(),
    threshold: z.number().min(-10_000_000).max(10_000_000).optional(),
    days: z.number().int().min(1).max(MAX_BALANCE_DAYS).optional(),
    account_id: z.string().max(64).optional(),
    account_watch: z.boolean().optional(),
    account_threshold: z.number().min(-10_000_000).max(10_000_000).nullable().optional(),
  }),
  async describe({ userId }, i) {
    const f = await balanceForecast(userId, 0);
    const account = i.account_id ? f.accounts.find((a) => a.id === i.account_id) : null;
    if (i.account_id && !account) throw new ToolError(`Compte inconnu ou non suivi : ${i.account_id}`);
    if (!i.account_id && (i.account_watch !== undefined || i.account_threshold !== undefined)) throw new ToolError("account_watch et account_threshold demandent account_id");
    const details = [
      i.enabled !== undefined ? (i.enabled ? tr("Surveiller mes soldes") : tr("Ne plus surveiller mes soldes")) : null,
      i.threshold !== undefined ? change(tr("Seuil"), money(f.rule.threshold), money(i.threshold)) : null,
      i.days !== undefined ? change(tr("Prévenir"), tr("{n} jours avant", { n: f.rule.days }), tr("{n} jours avant", { n: i.days })) : null,
      account && i.account_watch !== undefined ? field(account.name, i.account_watch ? tr("surveillé") : tr("non surveillé")) : null,
      account && i.account_threshold !== undefined ? field(account.name, i.account_threshold == null ? tr("seuil de la règle") : tr("seuil à {montant}", { montant: money(i.account_threshold) })) : null,
    ].filter((x): x is string => !!x);
    if (!details.length) throw new ToolError("Rien à changer : donner enabled, threshold, days ou un réglage de compte");
    return { label: tr("Régler l'alerte de solde bas"), details };
  },
  async run({ userId }, i) {
    await saveBalanceRule(userId, {
      enabled: i.enabled,
      threshold: i.threshold,
      days: i.days,
      accounts: i.account_id ? { [i.account_id]: { ...(i.account_watch !== undefined ? { watch: i.account_watch } : {}), ...(i.account_threshold !== undefined ? { threshold: i.account_threshold } : {}) } } : undefined,
    });
    return "Fait : alerte de solde bas réglée.";
  },
});

export const pilotageTools: Tool[] = [getPlans, setEnvelope, setGoal, getBalanceAlert, setBalanceAlert];
