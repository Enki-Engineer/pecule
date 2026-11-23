import { describe, expect, it } from "vitest";
import { AI_MODELS, DEFAULT_AI_MODEL } from "./ai-providers.ts";
import { budgetState, budgetStops, cacheSavingUsd, daysInMonth, KIND_GROUP, knownModel, partialUsage, priceOf, projectMonth, REFERENCE_MODEL, shiftMonth, speechCostUsd, transcriptionCost, USAGE_GROUPS, USAGE_KINDS, usageCostUsd, usageKind } from "./ai-usage.ts";

describe("tarif d'un modèle", () => {
  it("reconnaît un modèle daté ou un déploiement qui porte son nom", () => {
    expect(knownModel("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(knownModel("claude-sonnet-5-5-20260901")).toBe("claude-sonnet-5-5");
    expect(knownModel("Mon-Claude-Haiku-5-5")).toBe("claude-haiku-5-5");
    expect(knownModel("claude-opus-5")).toBe("claude-opus-5");
    expect(knownModel("assistant-du-foyer")).toBeNull();
  });
  it("préfère le tarif saisi, puis le tarif public, et signale une estimation", () => {
    expect(priceOf("claude-sonnet-5-5").source).toBe("public");
    expect(priceOf("assistant-du-foyer").source).toBe("estime");
    expect(priceOf("assistant-du-foyer").price.input).toBe(4);
    const own = priceOf("assistant-du-foyer", { "assistant-du-foyer": { input: 2, output: 8 } });
    expect(own.source).toBe("saisi");
    expect(own.price).toEqual({ input: 2, output: 8, cacheRead: 0.2, cacheWrite: 2.5 });
    expect(priceOf("claude-opus-5-5", { "claude-opus-5-5": { input: 3, output: 15 } }).source).toBe("saisi");
  });
  it("connaît le tarif de chaque modèle proposé dans les réglages", () => {
    for (const m of [...AI_MODELS, DEFAULT_AI_MODEL]) expect(priceOf(m).source, m).toBe("public");
    expect(knownModel(REFERENCE_MODEL)).toBe(REFERENCE_MODEL);
  });
  it("compte l'entrée, la sortie et le cache", () => {
    const u = { input_tokens: 1_000_000, output_tokens: 100_000, cache_creation_input_tokens: 200_000, cache_read_input_tokens: 2_000_000 };
    // 4 + 2 + 1 + 0,4
    expect(usageCostUsd("claude-opus-5-5", u)).toBeCloseTo(7.4, 6);
    expect(usageCostUsd("claude-opus-5-5", { input_tokens: 0, output_tokens: 0 })).toBe(0);
  });
  it("estime la sortie d'une réponse coupée d'après ce qui était écrit, sans descendre sous le décompte annoncé", () => {
    const started = { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 800 };
    expect(partialUsage(started, 900)).toEqual({ input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800 });
    expect(partialUsage(started, 10).output_tokens).toBe(4);
    expect(partialUsage(started, 0).output_tokens).toBe(1);
    expect(partialUsage({ input_tokens: 5, output_tokens: 250 }, 300).output_tokens).toBe(250);
    // Une réponse coupée coûte sa sortie, pas seulement son entrée.
    expect(usageCostUsd("claude-opus-5-5", partialUsage(started, 3000))).toBeGreaterThan(usageCostUsd("claude-opus-5-5", started));
  });
  it("mesure ce que le cache a fait économiser", () => {
    // 1 M relus : 4 − 0,2 = 3,8 ; 1 M écrits : surcoût de 1.
    expect(cacheSavingUsd("claude-opus-5-5", 1_000_000, 1_000_000)).toBeCloseTo(2.8, 6);
    expect(cacheSavingUsd("claude-opus-5-5", 0, 1_000_000)).toBeCloseTo(-1, 6);
  });
});

describe("mode vocal", () => {
  it("compte la lecture au caractère, plus cher pour une voix HD", () => {
    expect(speechCostUsd("fr-FR-Vivienne:DragonHDLatestNeural", 1_000_000)).toBe(22);
    expect(speechCostUsd("fr-FR-DeniseNeural", 1_000_000)).toBe(15);
  });
  it("compte la transcription d'après le décompte du service", () => {
    const c = transcriptionCost({ input_tokens: 1000, output_tokens: 100, input_token_details: { audio_tokens: 900, text_tokens: 100 } }, "peu importe");
    expect(c.usd).toBeCloseTo((900 * 6 + 100 * 2.5 + 100 * 10) / 1_000_000, 9);
    expect(c.inputTokens).toBe(1000);
  });
  it("estime la durée d'après le texte quand le service ne compte rien", () => {
    const words = Array.from({ length: 150 }, () => "mot").join(" ");
    expect(transcriptionCost(null, words).usd).toBeCloseTo(0.006, 9);
    // Trois secondes au moins, même pour un silence.
    expect(transcriptionCost(undefined, "").usd).toBeCloseTo(0.0003, 9);
    expect(transcriptionCost({}, "oui").inputTokens).toBe(0);
  });
});

describe("usages", () => {
  it("range chaque appel dans son usage", () => {
    expect(usageKind("assistant")).toBe("assistant");
    expect(usageKind("import : bulletin")).toBe("import");
    expect(usageKind("fiche de paie")).toBe("bulletin");
    expect(usageKind("voix : lecture")).toBe("voix");
    expect(usageKind("assistant (démo)")).toBe("demo");
    expect(usageKind("voix : lecture (démo)")).toBe("demo");
    expect(usageKind("autre chose")).toBe("autre");
  });
  it("donne à chaque usage une série du graphique", () => {
    for (const k of USAGE_KINDS) expect(USAGE_GROUPS).toContain(KIND_GROUP[k]);
    // Huit couleurs de série au plus.
    expect(USAGE_GROUPS.length).toBeLessThanOrEqual(8);
  });
});

describe("mois en cours", () => {
  it("connaît la longueur des mois et les décale", () => {
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-11")).toBe(30);
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-11", -11)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });
  it("prolonge la dépense au rythme constaté", () => {
    expect(projectMonth(3, "2026-11-15")).toBeCloseTo(6, 6);
    expect(projectMonth(3, "2026-11-30")).toBeCloseTo(3, 6);
    expect(projectMonth(1, "2026-11-01")).toBeCloseTo(30, 6);
  });
  it("situe la dépense par rapport au plafond", () => {
    expect(budgetState(7.9, 10)).toBe("ok");
    expect(budgetState(8, 10)).toBe("alerte");
    expect(budgetState(10, 10)).toBe("depasse");
    expect(budgetState(50, null)).toBe("ok");
    expect(budgetState(50, 0)).toBe("ok");
  });
  it("dit ce que le plafond arrête une fois atteint", () => {
    const none = { pauseBackground: false, pauseAll: false };
    const background = { pauseBackground: true, pauseAll: false };
    const all = { pauseBackground: true, pauseAll: true };
    // Tant que le plafond n'est pas atteint, rien ne s'arrête, quel que soit le réglage.
    for (const b of [none, background, all]) for (const state of ["ok", "alerte"] as const) expect(budgetStops(b, state, true)).toEqual({ background: false, all: false });
    expect(budgetStops(none, "depasse")).toEqual({ background: false, all: false });
    expect(budgetStops(background, "depasse")).toEqual({ background: true, all: false });
    expect(budgetStops(all, "depasse")).toEqual({ background: true, all: true });
    // Tout arrêter emporte les lectures de fond, même si la première case a été écrite décochée.
    expect(budgetStops({ pauseBackground: false, pauseAll: true }, "depasse")).toEqual({ background: true, all: true });
    // Une session de démo s'arrête au plafond, quel que soit le réglage du foyer.
    expect(budgetStops(none, "depasse", true)).toEqual({ background: false, all: true });
  });
});
