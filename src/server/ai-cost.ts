import { exec, one } from "./db.ts";
import { isDemo, runReal } from "./demo-context.ts";
import { today } from "./region.ts";
import { type CustomPrices, budgetState, budgetStops, fullPrice, knownModel } from "../lib/ai-usage.ts";
import { t, tk } from "../lib/i18n.ts";

/*
 * Réglages du coût de l'IA, gardés dans `app_kv` : les tarifs saisis pour un modèle que Pécule ne connaît pas
 * (« ai:prices ») et le plafond du mois (« ai:budget »). Toujours lus et écrits dans la vraie base, comme le
 * fournisseur d'IA : le coût d'une démo est un vrai coût, compté avec celui du foyer.
 *
 * Tarifs et dépense du mois sont gardés en mémoire une minute : `recordUsage` les lit à chaque appel à l'IA.
 */

const PRICES_KEY = "ai:prices";
const BUDGET_KEY = "ai:budget";
const REFRESH_MS = 60_000;

async function readKv<T>(key: string): Promise<T | null> {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key]));
  try {
    return row ? (JSON.parse(row.value) as T) : null;
  } catch {
    return null;
  }
}
const writeKv = (key: string, value: unknown) => runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key, JSON.stringify(value)]));

/* ---------- Tarifs saisis ---------- */

/** Tarif le plus haut accepté (dollars par million de jetons) : au-delà, c'est une faute de frappe. */
export const MAX_PRICE = 1000;

const rate = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_PRICE ? v : null);
function cleanPrices(raw: unknown): CustomPrices {
  const out: CustomPrices = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [model, p] of Object.entries(raw as Record<string, { input?: unknown; output?: unknown } | null>)) {
    const input = rate(p?.input);
    const output = rate(p?.output);
    if (model.trim() && input !== null && output !== null) out[model] = { input, output };
  }
  return out;
}

let prices: { value: CustomPrices; at: number } | null = null;

/** Tarifs saisis dans les réglages, par nom de modèle. */
export async function customPrices(): Promise<CustomPrices> {
  if (prices && Date.now() - prices.at < REFRESH_MS) return prices.value;
  prices = { value: cleanPrices(await readKv(PRICES_KEY)), at: Date.now() };
  return prices.value;
}

/**
 * Enregistre (ou retire, avec null) le tarif d'un modèle. Le premier tarif donné à un modèle que Pécule ne
 * connaît pas corrige aussi ses appels passés : ils avaient été comptés au tarif du modèle de référence, faute
 * de mieux. Un tarif changé ensuite ne vaut que pour la suite. Renvoie le nombre d'appels recalculés.
 */
export async function setModelPrice(model: string, price: { input: number; output: number } | null): Promise<number> {
  const current = cleanPrices(await readKv(PRICES_KEY));
  const first = !!price && !current[model] && !knownModel(model);
  if (price) current[model] = price;
  else delete current[model];
  await writeKv(PRICES_KEY, current);
  prices = { value: cleanPrices(current), at: Date.now() };
  if (!first || !price) return 0;
  const p = fullPrice(price);
  const usd = "(input_tokens * ? + cache_write_tokens * ? + cache_read_tokens * ? + output_tokens * ?) / 1000000";
  const rates = [p.input, p.cacheWrite, p.cacheRead, p.output];
  // Le coût en euros garde le taux du jour de l'appel (lu avant que le coût en dollars ne change).
  const done = await runReal(() =>
    exec(`UPDATE ai_usage SET cost_eur = ${usd} * (CASE WHEN cost_usd > 0 THEN cost_eur / cost_usd ELSE 0.86 END), cost_usd = ${usd} WHERE model = ? AND feature NOT LIKE 'voix%'`, [...rates, ...rates, model]),
  );
  spent = null;
  return done.affectedRows;
}

/* ---------- Plafond du mois ---------- */

/**
 * Plafond de dépense du mois, en euros (null : aucun), et ce qu'il arrête une fois atteint : rien (l'administrateur
 * est seulement prévenu), les lectures de fond (`pauseBackground`), ou tout appel à l'IA, assistant compris
 * (`pauseAll`, qui emporte les lectures de fond).
 */
export type AiBudget = { monthly: number | null; pauseBackground: boolean; pauseAll: boolean };
/** Plafond le plus haut accepté, en euros. */
export const MAX_BUDGET = 10_000;

function cleanBudget(raw: Partial<AiBudget> | null): AiBudget {
  const monthly = typeof raw?.monthly === "number" && Number.isFinite(raw.monthly) && raw.monthly > 0 ? Math.min(MAX_BUDGET, Math.round(raw.monthly * 100) / 100) : null;
  const pauseAll = monthly !== null && raw?.pauseAll === true;
  return { monthly, pauseBackground: monthly !== null && (raw?.pauseBackground === true || pauseAll), pauseAll };
}

let budget: { value: AiBudget; at: number } | null = null;

export async function aiBudget(): Promise<AiBudget> {
  if (budget && Date.now() - budget.at < REFRESH_MS) return budget.value;
  budget = { value: cleanBudget(await readKv<Partial<AiBudget>>(BUDGET_KEY)), at: Date.now() };
  return budget.value;
}

export async function saveAiBudget(next: Partial<AiBudget>): Promise<AiBudget> {
  // Les lectures de fond remises en marche : tout ne peut plus être en pause.
  const asked = next.pauseBackground === false && next.pauseAll === undefined ? { ...next, pauseAll: false } : next;
  const value = cleanBudget({ ...(await aiBudget()), ...asked });
  await writeKv(BUDGET_KEY, value);
  budget = { value, at: Date.now() };
  return value;
}

/* ---------- Dépense du mois ---------- */

let spent: { month: string; eur: number; at: number } | null = null;

/** Coût de l'IA depuis le début du mois (du foyer, démo comprise), en euros. */
export async function monthSpent(): Promise<number> {
  const month = today().slice(0, 7);
  if (spent && spent.month === month && Date.now() - spent.at < REFRESH_MS) return spent.eur;
  const row = await runReal(() => one<{ eur: number | null }>("SELECT SUM(cost_eur) AS eur FROM ai_usage WHERE created_at >= ?", [`${month}-01`]));
  spent = { month, eur: Number(row?.eur ?? 0), at: Date.now() };
  return spent.eur;
}

/** Un appel vient d'être compté : la dépense gardée en mémoire le suit sans attendre sa prochaine lecture. */
export function addSpent(eur: number) {
  if (spent && spent.month === today().slice(0, 7)) spent.eur += eur;
}

/** Où en est le mois : dépense, plafond, si les lectures de fond sont en pause (`paused`), et si tout l'est (`blocked`). */
export async function budgetStatus() {
  const [b, eur] = await Promise.all([aiBudget(), monthSpent()]);
  const state = budgetState(eur, b.monthly);
  const stops = budgetStops(b, state);
  return { ...b, spent: eur, state, paused: stops.background, blocked: stops.all };
}

/**
 * L'IA est en pause pour ce que demande un membre : le plafond du mois est atteint et le foyer a choisi de tout
 * arrêter là — ou la requête vient d'une session de démo, qui s'arrête toujours au plafond. C'est ce qui borne la
 * dépense d'une session laissée ouverte ou d'un accès détourné. En cas de doute (base injoignable), rien n'est arrêté.
 */
export const aiPaused = (): Promise<boolean> =>
  Promise.all([aiBudget(), monthSpent()])
    .then(([b, eur]) => budgetStops(b, budgetState(eur, b.monthly), isDemo()).all)
    .catch(() => false);

const AI_PAUSED = tk("Le plafond du mois pour l'IA est atteint : l'assistant et la lecture des documents reprennent le mois prochain, ou dès que l'administrateur relève le plafond (Réglages → Coût de l'IA).");

/** Refus d'un appel à l'IA parce que le plafond du mois est atteint (réponse 429, message dans la langue du membre). */
export class AiPausedError extends Error {
  readonly status = 429;
  constructor() {
    super(t(AI_PAUSED));
  }
}

/** À poser en tête de tout ce qu'un membre demande à l'IA : refuse quand elle est en pause (`aiPaused`). */
export async function assertAiBudget(): Promise<void> {
  if (await aiPaused()) throw new AiPausedError();
}

/**
 * Le plafond du mois est atteint et le foyer a choisi d'arrêter là les lectures de fond (import de dossier,
 * traduction des noms). Ce qu'un membre demande lui-même — assistant, facture ou document déposé — répond toujours,
 * sauf si le foyer a choisi de tout arrêter au plafond (`aiPaused`).
 * En cas de doute (base injoignable), rien n'est mis en pause.
 */
export const backgroundPaused = (): Promise<boolean> =>
  budgetStatus()
    .then((s) => s.paused)
    .catch(() => false);
