/*
 * Coût de l'IA : tarifs, usages et calculs, purs, partagés par le serveur et l'écran (Réglages → Coût de l'IA).
 *
 * Le coût est une estimation : ce que le fournisseur compte (jetons, caractères lus, audio transcrit) multiplié par
 * son tarif public, en dollars. Un modèle absent de la table prend le tarif saisi dans les réglages, à défaut celui
 * du modèle de référence — il est alors signalé « estimé ».
 */

/** Dollars par million de jetons. */
export type TokenPrice = { input: number; output: number; cacheRead: number; cacheWrite: number };

/** Tarifs publics des modèles Claude (écriture en cache 5 min = 1,25 × l'entrée) et des modèles d'OpenAI. */
export const MODEL_PRICES: Record<string, TokenPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  // Lecture du cache de Haiku 5.5 : estimée au dixième de l'entrée (tarif non publié à part).
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // OpenAI, tarif standard jusqu'à 272 000 jetons d'entrée, relevé sur sa page des tarifs le 28/11/2026. Écriture en
  // cache (30 minutes) : 1,25 × l'entrée depuis la famille GPT-5.6, sans surcoût avant. Sans tarif de cache publié
  // (modèles « pro ») : celui de l'entrée.
  "gpt-6.2-astra": { input: 8, output: 40, cacheRead: 0.4, cacheWrite: 10 },
  "gpt-6.2-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "gpt-6.1-terra": { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
  "gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "gpt-6-astra": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "gpt-6-sol": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "gpt-5.6-sol": { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  "gpt-5.6-terra": { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
  "gpt-5.5-pro": { input: 30, output: 180, cacheRead: 30, cacheWrite: 30 },
  "gpt-5.5": { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 5 },
  "gpt-5.4-pro": { input: 30, output: 180, cacheRead: 30, cacheWrite: 30 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: 0.75 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: 0.2 },
  "gpt-5.4": { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 2.5 },
};

/**
 * Le modèle tel qu'il est compté. Deux fournisseurs y laissent leur nom, parce que leur coût ne se calcule pas d'après
 * un tarif : Ollama (« ollama/… » : rien n'est facturé à l'appel) et OpenRouter (« openrouter/… » : il rend lui-même
 * le coût exact de chaque appel).
 */
export function usageModel(provider: string, model: string): string {
  if (provider === "ollama" || provider === "openrouter") return `${provider}/${model}`;
  // Chez un autre fournisseur, un modèle dont le nom commence de même (une passerelle qui nomme ses modèles « ollama/… »)
  // garde un tarif à lui : il ne doit pas être compté pour rien.
  return FREE.test(model) || BILLED.test(model) ? `${provider}:${model}` : model;
}
const FREE = /^ollama\//;
const BILLED = /^openrouter\//;
const NO_PRICE: TokenPrice = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
/** Modèle dont le tarif sert d'estimation à un modèle inconnu. */
export const REFERENCE_MODEL = "claude-opus-5-5";

// Les noms les plus longs d'abord : « claude-opus-5-5 » ne doit pas être pris pour « claude-opus-5 ».
const KNOWN = Object.keys(MODEL_PRICES).sort((a, b) => b.length - a.length);

/**
 * Modèle de la table que désigne un nom de modèle ou de déploiement (« claude-sonnet-5-5-20260901 »,
 * « mon-claude-haiku-5-5 ») ; null s'il n'en désigne aucun.
 */
export function knownModel(model: string): string | null {
  const m = model.trim().toLowerCase();
  if (FREE.test(m) || BILLED.test(m)) return null;
  return KNOWN.find((k) => m.includes(k)) ?? null;
}

/** Tarifs saisis dans les réglages, par nom de modèle : entrée et sortie (le cache s'en déduit). */
export type CustomPrices = Record<string, { input: number; output: number }>;

/** Tarif complet d'un tarif saisi : lecture du cache au dixième de l'entrée, écriture à 1,25 fois. */
export const fullPrice = (p: { input: number; output: number }): TokenPrice => ({ input: p.input, output: p.output, cacheRead: p.input * 0.1, cacheWrite: p.input * 1.25 });

/**
 * D'où vient un tarif : saisi dans les réglages, tarif public du modèle, estimé au tarif du modèle de référence — ou
 * sans objet : « local » (un modèle servi par Ollama, que personne ne facture à l'appel), « fournisseur » (le
 * fournisseur rend le coût de chaque appel, Pécule n'a rien à calculer).
 */
export type PriceSource = "saisi" | "public" | "estime" | "local" | "fournisseur";

export function priceOf(model: string, custom: CustomPrices = {}): { price: TokenPrice; source: PriceSource } {
  const own = custom[model];
  if (own) return { price: fullPrice(own), source: "saisi" };
  if (FREE.test(model)) return { price: NO_PRICE, source: "local" };
  if (BILLED.test(model)) return { price: NO_PRICE, source: "fournisseur" };
  const known = knownModel(model);
  if (known) return { price: MODEL_PRICES[known], source: "public" };
  return { price: MODEL_PRICES[REFERENCE_MODEL], source: "estime" };
}

/**
 * Décompte d'un appel, au format de l'API Messages. Un fournisseur traduit y ajoute `label` (le modèle tel qu'il est
 * compté, `usageModel`) et, quand il le donne, `cost_usd` : le coût exact de l'appel, en dollars.
 */
export type Usage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null; cost_usd?: number | null; label?: string | null };

export function usageCostUsd(model: string, u: Usage, custom: CustomPrices = {}): number {
  // Le coût rendu par le fournisseur l'emporte sur tout calcul.
  if (typeof u.cost_usd === "number" && Number.isFinite(u.cost_usd) && u.cost_usd >= 0) return u.cost_usd;
  const p = priceOf(model, custom).price;
  return (u.input_tokens * p.input + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite + (u.cache_read_input_tokens ?? 0) * p.cacheRead + u.output_tokens * p.output) / 1_000_000;
}

/**
 * Décompte d'une réponse coupée avant sa fin (le membre l'a arrêtée) : le fournisseur n'annonce la sortie qu'à la fin
 * de la réponse, celle qui était déjà écrite est donc estimée — un jeton pour trois caractères, arrondi au-dessus —,
 * sans jamais descendre sous ce qu'il avait annoncé. Une estimation : la facture du fournisseur fait foi.
 */
export function partialUsage(u: Usage, writtenChars: number): Usage {
  return { ...u, output_tokens: Math.max(u.output_tokens, Math.ceil(Math.max(0, writtenChars) / 3)) };
}

/**
 * Ce que le cache a fait économiser, en dollars : les jetons relus ont coûté le tarif du cache au lieu de celui de
 * l'entrée, moins le surcoût de leur écriture. Négatif quand le cache a été écrit sans être relu.
 */
export function cacheSavingUsd(model: string, cacheRead: number, cacheWrite: number, custom: CustomPrices = {}): number {
  const p = priceOf(model, custom).price;
  return (cacheRead * (p.input - p.cacheRead) - cacheWrite * (p.cacheWrite - p.input)) / 1_000_000;
}

/* ---------- Mode vocal ---------- */

/** Lecture à voix haute (Azure Speech) : dollars par million de caractères, voix « HD » et voix neuronales simples. */
export const SPEECH_PRICES = { hd: 22, neural: 15 };
export const speechCostUsd = (voiceName: string, chars: number): number => (chars * (/HD/i.test(voiceName) ? SPEECH_PRICES.hd : SPEECH_PRICES.neural)) / 1_000_000;

/** Transcription : dollars par million de jetons (audio et texte en entrée, texte en sortie), ou par minute quand le service ne donne pas son décompte. */
export const TRANSCRIPTION_PRICES = { audioInput: 6, textInput: 2.5, output: 10, minute: 0.006 };

/** Décompte rendu par le service de transcription, quand il en donne un. */
export type TranscriptionUsage = { input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number; text_tokens?: number } };

/**
 * Coût d'une transcription : d'après le décompte du service, sinon d'après la durée — estimée à partir du texte
 * entendu (150 mots par minute, trois secondes au moins : le service facture aussi le silence).
 */
export function transcriptionCost(usage: TranscriptionUsage | null | undefined, text: string): { usd: number; inputTokens: number; outputTokens: number } {
  const input = Number(usage?.input_tokens);
  const output = Number(usage?.output_tokens);
  if (usage && Number.isFinite(input) && Number.isFinite(output) && input + output > 0) {
    const audio = Math.min(input, Math.max(0, Number(usage.input_token_details?.audio_tokens ?? input) || 0));
    return { usd: (audio * TRANSCRIPTION_PRICES.audioInput + (input - audio) * TRANSCRIPTION_PRICES.textInput + output * TRANSCRIPTION_PRICES.output) / 1_000_000, inputTokens: input, outputTokens: output };
  }
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const seconds = Math.max(3, (words / 150) * 60);
  return { usd: (seconds / 60) * TRANSCRIPTION_PRICES.minute, inputTokens: 0, outputTokens: 0 };
}

/* ---------- Usages ---------- */

/** À quoi a servi un appel : ce que l'écran et l'assistant détaillent. */
export const USAGE_KINDS = ["assistant", "import", "facture", "classement", "operations", "document", "bulletin", "voix", "traduction", "test", "demo", "autre"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** Suffixe d'un usage compté pendant une session de démo (le coût, lui, est réel). */
export const DEMO_SUFFIX = " (démo)";

/** Usage d'un appel, d'après ce que le serveur a noté (`ai_usage.feature`). */
export function usageKind(feature: string): UsageKind {
  if (feature.endsWith(DEMO_SUFFIX)) return "demo";
  if (feature === "assistant") return "assistant";
  if (feature.startsWith("import")) return "import";
  if (feature === "facture") return "facture";
  if (feature === "classement") return "classement";
  if (feature === "classement des opérations") return "operations";
  if (feature === "document") return "document";
  if (feature === "fiche de paie") return "bulletin";
  if (feature.startsWith("voix")) return "voix";
  if (feature === "traduction") return "traduction";
  if (feature === "test") return "test";
  return "autre";
}

/** Séries du graphique des douze mois : les usages voisins y sont réunis (huit couleurs au plus). */
export const USAGE_GROUPS = ["assistant", "import", "factures", "documents", "voix", "autres", "demo"] as const;
export type UsageGroup = (typeof USAGE_GROUPS)[number];
export const KIND_GROUP: Record<UsageKind, UsageGroup> = {
  assistant: "assistant",
  import: "import",
  facture: "factures",
  classement: "factures",
  operations: "autres",
  document: "documents",
  bulletin: "documents",
  voix: "voix",
  traduction: "autres",
  test: "autres",
  autre: "autres",
  demo: "demo",
};

/** Usages lancés sans personne devant l'écran : ce que le plafond du mois peut mettre en pause. */
export const BACKGROUND_KINDS: readonly UsageKind[] = ["import", "traduction"];

/* ---------- Mois en cours ---------- */

/** Nombre de jours d'un mois « AAAA-MM ». */
export const daysInMonth = (month: string): number => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Mois « AAAA-MM » décalé de `delta` mois. */
export function shiftMonth(month: string, delta: number): string {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

/** Dépense du mois entier au rythme constaté jusqu'à `day` (« AAAA-MM-JJ », jour en cours compris). */
export function projectMonth(spent: number, day: string): number {
  const elapsed = Math.max(1, Number(day.slice(8, 10)));
  const total = daysInMonth(day.slice(0, 7));
  return (spent / Math.min(elapsed, total)) * total;
}

/** Part du plafond à partir de laquelle on prévient. */
export const BUDGET_ALERT = 0.8;
export type BudgetState = "ok" | "alerte" | "depasse";

/** Où en est la dépense du mois par rapport au plafond (aucun plafond : toujours « ok »). */
export function budgetState(spent: number, monthly: number | null | undefined): BudgetState {
  if (!monthly || monthly <= 0) return "ok";
  if (spent >= monthly) return "depasse";
  return spent >= monthly * BUDGET_ALERT ? "alerte" : "ok";
}

/**
 * Ce que le plafond arrête une fois atteint. `background` : les lectures de fond (import de dossier, traduction des
 * noms). `all` : tout appel à l'IA demandé par un membre aussi — assistant, mode vocal, classement en lot, lecture
 * d'un fichier déposé. Une session de démo s'arrête toujours au plafond : une démonstration ne dépense pas au-delà de
 * ce que le foyer s'est fixé.
 */
export function budgetStops(b: { pauseBackground: boolean; pauseAll: boolean }, state: BudgetState, demo = false): { background: boolean; all: boolean } {
  const reached = state === "depasse";
  return { background: reached && (b.pauseBackground || b.pauseAll), all: reached && (b.pauseAll || demo) };
}

/* ---------- Ce que lit l'écran ---------- */

/** Coût de l'IA du foyer, en euros : réponse de `GET /api/assistant/usage` et de l'outil `get_ai_usage`. */
export type UsageReport = {
  /** Jour et mois en cours, dans le fuseau du foyer. */
  today: string;
  /** Mois en cours : dépense, projection au rythme constaté, mois précédent (entier, et à la même date). */
  current: { month: string; total: number; calls: number; demo: number; projection: number; previous: number; previousToDate: number };
  /** Douze mois, le plus ancien d'abord : total et part de chaque série du graphique. */
  months: { month: string; total: number; calls: number; groups: Partial<Record<UsageGroup, number>> }[];
  /** Mois détaillé (celui demandé, sinon le mois en cours). */
  selected: {
    month: string;
    total: number;
    calls: number;
    kinds: { kind: UsageKind; group: UsageGroup; total: number; calls: number; unit: "conversation" | "appel" | null; units: number; unitCost: number | null }[];
    members: { id: number | null; name: string | null; demo: boolean; total: number; calls: number }[];
    models: { model: string; total: number; calls: number; inputTokens: number; outputTokens: number; voice: boolean; source: PriceSource | null }[];
    /** Jetons d'entrée relus en cache (part de l'entrée) et ce que le cache a fait économiser. */
    cache: { input: number; read: number; write: number; share: number; saved: number };
    threads: { id: string; title: string; total: number; calls: number }[];
    batches: { id: number; name: string; total: number; files: number }[];
  };
  /** `paused` : les lectures de fond attendent ; `blocked` : l'assistant et les lectures demandées par un membre aussi. */
  budget: { monthly: number | null; pauseBackground: boolean; pauseAll: boolean; spent: number; state: BudgetState; paused: boolean; blocked: boolean };
  /** Tarif de chaque modèle rencontré (dollars par million de jetons) et d'où il vient. */
  prices: { model: string; input: number; output: number; source: PriceSource; active: boolean }[];
};
