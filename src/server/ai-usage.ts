import { aiEnabled, aiModel, usdToEur } from "./ai.ts";
import { aiBudget, customPrices, type AiBudget } from "./ai-cost.ts";
import { one, q } from "./db.ts";
import { isDemo } from "./demo-context.ts";
import { listMembers } from "./members.ts";
import { today } from "./region.ts";
import {
  KIND_GROUP,
  USAGE_GROUPS,
  USAGE_KINDS,
  budgetState,
  cacheSavingUsd,
  daysInMonth,
  priceOf,
  projectMonth,
  shiftMonth,
  usageKind,
  type CustomPrices,
  type UsageKind,
  type UsageReport,
} from "../lib/ai-usage.ts";
import { threadTitle } from "../lib/chat-history.ts";

/*
 * Coût de l'IA : ce que lisent l'écran Réglages → Coût de l'IA et l'outil `get_ai_usage` de l'assistant. Une seule
 * définition pour les deux — la table `ai_usage`, une ligne par appel, en euros au taux du jour de l'appel.
 * Tout le foyer est compté (c'est une seule facture) ; seuls les titres des conversations et des imports sont ceux
 * du membre. En démo, la base de démo fournit un historique fictif : ni plafond ni tarifs du vrai foyer.
 */

/** Ce qu'une unité d'un usage représente, pour un coût moyen parlant (« par conversation », « par facture lue »). */
const UNIT: Partial<Record<UsageKind, "conversation" | "appel">> = { assistant: "conversation", import: "appel", facture: "appel", classement: "appel", document: "appel", bulletin: "appel", traduction: "appel" };

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const MONTHS = 12;
const NO_BUDGET: AiBudget = { monthly: null, pauseBackground: false };

type MonthRow = { month: string; feature: string; eur: number; calls: number };
type DetailRow = { feature: string; model: string; user_id: number | null; eur: number; usd: number; calls: number; input: number; cache_read: number; cache_write: number; output: number };

export async function usageReport(userId: number, wanted?: string | null): Promise<UsageReport> {
  const day = today();
  const month = day.slice(0, 7);
  const first = shiftMonth(month, -(MONTHS - 1));
  const selected = wanted && wanted >= first && wanted <= month ? wanted : month;
  const previous = shiftMonth(month, -1);
  const demo = isDemo();
  const range = [`${selected}-01`, `${shiftMonth(selected, 1)}-01`];
  // À la même date le mois précédent (un mois plus court s'arrête à son dernier jour).
  const sameDay = Math.min(Number(day.slice(8, 10)), daysInMonth(previous));

  const [byMonth, detail, conversations, toDate, threads, batches, seen, members, custom, budget, rate] = await Promise.all([
    q<MonthRow>("SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, feature, SUM(cost_eur) AS eur, COUNT(*) AS calls FROM ai_usage WHERE created_at >= ? GROUP BY month, feature", [`${first}-01`]),
    q<DetailRow>(
      `SELECT feature, model, user_id, SUM(cost_eur) AS eur, SUM(cost_usd) AS usd, COUNT(*) AS calls, SUM(input_tokens) AS input,
              SUM(cache_read_tokens) AS cache_read, SUM(cache_write_tokens) AS cache_write, SUM(output_tokens) AS output
       FROM ai_usage WHERE created_at >= ? AND created_at < ? GROUP BY feature, model, user_id`,
      range,
    ),
    one<{ n: number }>("SELECT COUNT(DISTINCT thread_id) AS n FROM ai_usage WHERE feature = 'assistant' AND thread_id IS NOT NULL AND created_at >= ? AND created_at < ?", range),
    one<{ eur: number | null }>("SELECT SUM(cost_eur) AS eur FROM ai_usage WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL ? DAY)", [`${previous}-01`, `${previous}-01`, sameDay]),
    q<{ id: string; title: string | null; display: string; eur: number; calls: number }>(
      `SELECT t.id, t.title, t.display, x.eur, x.calls
       FROM (SELECT thread_id, SUM(cost_eur) AS eur, COUNT(*) AS calls FROM ai_usage WHERE created_at >= ? AND created_at < ? AND thread_id IS NOT NULL GROUP BY thread_id) x
       JOIN assistant_threads t ON t.id = x.thread_id AND t.user_id = ? ORDER BY x.eur DESC LIMIT 5`,
      [...range, userId],
    ),
    q<{ id: number; name: string; eur: number; files: number }>(
      `SELECT b.id, b.name, SUM(i.cost_eur) AS eur, COUNT(i.id) AS files
       FROM import_batches b JOIN import_items i ON i.batch_id = b.id
       WHERE b.user_id = ? AND b.created_at >= ? AND b.created_at < ? GROUP BY b.id, b.name HAVING eur > 0 ORDER BY eur DESC LIMIT 3`,
      [userId, ...range],
    ),
    q<{ model: string }>("SELECT DISTINCT model FROM ai_usage WHERE created_at >= ? AND feature NOT LIKE 'voix%'", [`${first}-01`]),
    listMembers(),
    demo ? ({} as CustomPrices) : customPrices(),
    demo ? NO_BUDGET : aiBudget(),
    usdToEur(),
  ]);

  // Douze mois, même vides.
  const months: UsageReport["months"] = Array.from({ length: MONTHS }, (_, i) => ({ month: shiftMonth(first, i), total: 0, calls: 0, groups: {} }));
  let demoPart = 0;
  for (const r of byMonth) {
    const m = months.find((x) => x.month === r.month);
    if (!m) continue;
    const kind = usageKind(r.feature);
    const group = KIND_GROUP[kind];
    m.total += Number(r.eur);
    m.calls += Number(r.calls);
    m.groups[group] = (m.groups[group] ?? 0) + Number(r.eur);
    if (kind === "demo" && r.month === month) demoPart += Number(r.eur);
  }
  for (const m of months) {
    m.total = r4(m.total);
    for (const g of USAGE_GROUPS) if (m.groups[g] != null) m.groups[g] = r4(m.groups[g]!);
  }
  const now = months[MONTHS - 1];
  const state = budgetState(now.total, budget.monthly);

  // Mois détaillé : par usage, par membre, par modèle.
  const kinds = new Map<UsageKind, { total: number; calls: number }>();
  const people = new Map<string, { id: number | null; demo: boolean; total: number; calls: number }>();
  const models = new Map<string, { total: number; calls: number; input: number; output: number; voice: boolean }>();
  const cache = { input: 0, read: 0, write: 0, savedUsd: 0, eur: 0, usd: 0 };
  for (const r of detail) {
    const kind = usageKind(r.feature);
    const eur = Number(r.eur);
    const calls = Number(r.calls);
    const k = kinds.get(kind) ?? { total: 0, calls: 0 };
    kinds.set(kind, { total: k.total + eur, calls: k.calls + calls });
    // Une session de démo n'est pas la dépense d'un membre : elle a sa propre ligne.
    const who = kind === "demo" ? "demo" : String(r.user_id ?? "");
    const p = people.get(who) ?? { id: kind === "demo" ? null : r.user_id, demo: kind === "demo", total: 0, calls: 0 };
    people.set(who, { ...p, total: p.total + eur, calls: p.calls + calls });
    const voice = r.feature.startsWith("voix");
    const m = models.get(r.model) ?? { total: 0, calls: 0, input: 0, output: 0, voice };
    models.set(r.model, { total: m.total + eur, calls: m.calls + calls, input: m.input + Number(r.input) + Number(r.cache_read) + Number(r.cache_write), output: m.output + Number(r.output), voice: m.voice && voice });
    if (!voice) {
      cache.input += Number(r.input);
      cache.read += Number(r.cache_read);
      cache.write += Number(r.cache_write);
      cache.savedUsd += cacheSavingUsd(r.model, Number(r.cache_read), Number(r.cache_write), custom);
      cache.eur += eur;
      cache.usd += Number(r.usd);
    }
  }
  const total = [...kinds.values()].reduce((s, k) => s + k.total, 0);
  const calls = [...kinds.values()].reduce((s, k) => s + k.calls, 0);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const allInput = cache.input + cache.read + cache.write;
  // Taux moyen des appels du mois (chacun garde celui de son jour) ; à défaut, celui d'aujourd'hui.
  const monthRate = cache.usd > 0 ? cache.eur / cache.usd : rate;

  const active = aiEnabled() ? aiModel() : null;
  const priced = [...new Set([...seen.map((s) => s.model), ...(active ? [active] : [])])];

  return {
    today: day,
    current: {
      month,
      total: now.total,
      calls: now.calls,
      demo: r4(demoPart),
      projection: r4(projectMonth(now.total, day)),
      previous: months[MONTHS - 2].total,
      previousToDate: r4(Number(toDate?.eur ?? 0)),
    },
    months,
    selected: {
      month: selected,
      total: r4(total),
      calls,
      kinds: USAGE_KINDS.filter((k) => kinds.has(k))
        .map((kind) => {
          const k = kinds.get(kind)!;
          const unit = UNIT[kind] ?? null;
          const units = unit === "conversation" ? Number(conversations?.n ?? 0) : unit ? k.calls : 0;
          return { kind, group: KIND_GROUP[kind], total: r4(k.total), calls: k.calls, unit, units, unitCost: unit && units > 0 ? r4(k.total / units) : null };
        })
        .sort((a, b) => b.total - a.total),
      members: [...people.values()]
        .map((p) => ({ id: p.id, name: p.id != null ? (names.get(p.id) ?? null) : null, demo: p.demo, total: r4(p.total), calls: p.calls }))
        .sort((a, b) => b.total - a.total),
      models: [...models.entries()]
        .map(([model, m]) => ({ model, total: r4(m.total), calls: m.calls, inputTokens: m.input, outputTokens: m.output, voice: m.voice, source: m.voice ? null : priceOf(model, custom).source }))
        .sort((a, b) => b.total - a.total),
      cache: { input: allInput, read: cache.read, write: cache.write, share: allInput > 0 ? Math.round((cache.read / allInput) * 1000) / 1000 : 0, saved: r4(cache.savedUsd * monthRate) },
      threads: threads.map((t) => ({ id: t.id, title: threadTitle(t.title, JSON.parse(t.display) as { role: string; text: string }[]), total: r4(Number(t.eur)), calls: Number(t.calls) })),
      batches: batches.map((b) => ({ id: b.id, name: b.name, total: r4(Number(b.eur)), files: Number(b.files) })),
    },
    // La dépense du plafond est celle affichée au-dessus : un seul chiffre pour le mois en cours.
    budget: { monthly: budget.monthly, pauseBackground: budget.pauseBackground, spent: now.total, state, paused: budget.pauseBackground && state === "depasse" },
    prices: priced
      .map((model) => {
        const { price, source } = priceOf(model, custom);
        return { model, input: price.input, output: price.output, source, active: model === active };
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || a.model.localeCompare(b.model)),
  };
}
