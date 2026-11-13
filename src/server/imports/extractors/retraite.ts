import { z } from "zod";
import { one, q } from "../../db.ts";
import { sum } from "../../../lib/imports.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { day, num, str, type Extractor } from "../registry.ts";

/* Relevé de carrière et estimation de retraite → `career_periods`, `retirement_simulations`, faits clés (écran Retraite). Privé. */

const parse = z.object({
  is_retirement_document: z.boolean(),
  document_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  quarters_recorded: z.number().int().nullable(),
  quarters_required: z.number().int().nullable(),
  legal_age: z.string().nullable(),
  full_rate_age: z.string().nullable(),
  simulations: z.array(z.object({ label: z.string().min(1), age: z.number().nullable(), quarters: z.number().int().nullable(), base_pension: z.number().nullable(), complementary: z.number().nullable(), gross_monthly: z.number().nullable(), net_monthly: z.number().nullable(), adjustment: z.string().nullable() })),
  career: z.array(z.object({ year: z.number().int(), employer: z.string().nullable(), income: z.number().nullable(), quarters: z.number().int().nullable(), points: z.number().nullable() })),
});
type Retirement = z.infer<typeof parse>;

export const retraite: Extractor<Retirement> = {
  id: "retraite",
  label: tk("Relevé de carrière ou estimation de retraite"),
  matches: (c) => c.domain === "retraite" && ["releve", "fiche", "autre", "export", "note"].includes(c.kind),
  private: true,
  maxTokens: 16_000,
  instructions:
    "Document attendu : un relevé de carrière (relevé de situation individuelle) ou une estimation de retraite français. « career » : une ligne par année civile — employeur ou régime principal, revenu d'activité retenu, trimestres validés cette année-là, points de retraite complémentaire acquis ; additionne les lignes d'une même année. « simulations » : une ligne par âge de départ estimé, avec les montants MENSUELS (divise un montant annuel par 12) : retraite de base, complémentaire, total brut, total net ; « adjustment » : décote, surcote ou taux plein. « quarters_recorded » : trimestres enregistrés à la date du document ; « quarters_required » : trimestres requis pour le taux plein. « is_retirement_document » est faux pour tout autre document.",
  schema: {
    properties: {
      is_retirement_document: { type: "boolean" },
      document_date: day("Date du document ou de l'estimation"),
      quarters_recorded: { type: ["integer", "null"] },
      quarters_required: { type: ["integer", "null"] },
      legal_age: str("Âge légal de départ, tel qu'écrit (« 64 ans »)"),
      full_rate_age: str("Âge du taux plein automatique ou estimé, tel qu'écrit"),
      simulations: {
        type: "array",
        items: {
          type: "object",
          properties: { label: { type: "string", description: "« Départ à 64 ans », « Taux plein à 67 ans »…" }, age: num("Âge de départ"), quarters: { type: ["integer", "null"] }, base_pension: num("Retraite de base mensuelle brute"), complementary: num("Retraite complémentaire mensuelle brute"), gross_monthly: num("Total mensuel brut"), net_monthly: num("Total mensuel net"), adjustment: str("Décote, surcote ou taux plein") },
          required: ["label", "age", "quarters", "base_pension", "complementary", "gross_monthly", "net_monthly", "adjustment"],
          additionalProperties: false,
        },
      },
      career: {
        type: "array",
        items: {
          type: "object",
          properties: { year: { type: "integer" }, employer: str("Employeur ou régime principal de l'année"), income: num("Revenu d'activité de l'année"), quarters: { type: ["integer", "null"] }, points: num("Points de retraite complémentaire acquis") },
          required: ["year", "employer", "income", "quarters", "points"],
          additionalProperties: false,
        },
      },
    },
    required: ["is_retirement_document", "document_date", "quarters_recorded", "quarters_required", "legal_age", "full_rate_age", "simulations", "career"],
  },
  parse,
  rejected: (d) => !d.is_retirement_document || (!d.career.length && !d.simulations.length),
  title: (d) => (d.simulations.length ? t("Estimation de retraite — {n} scénarios", { n: d.simulations.length }) : t("Relevé de carrière — {n} années", { n: d.career.length })),
  fields: (d) => [
    { key: "document_date", label: tk("Date du document"), type: "date", value: d.document_date, required: true },
    { key: "quarters_recorded", label: tk("Trimestres enregistrés"), type: "nombre", value: d.quarters_recorded },
    { key: "quarters_required", label: tk("Trimestres requis"), type: "nombre", value: d.quarters_required },
    { key: "legal_age", label: tk("Âge légal"), type: "texte", value: d.legal_age },
    { key: "full_rate_age", label: tk("Âge du taux plein"), type: "texte", value: d.full_rate_age },
  ],
  table: (d) =>
    d.simulations.length
      ? { title: t("Estimations"), columns: [t("Départ"), t("Âge"), t("Brut mensuel"), t("Net mensuel")], lines: d.simulations.map((s) => [s.label, s.age, s.gross_monthly, s.net_monthly]), total: d.simulations.length }
      : { title: t("Carrière"), columns: [t("Année"), t("Employeur"), t("Revenu"), t("Trimestres")], lines: [...d.career.slice(0, 5), ...(d.career.length > 8 ? d.career.slice(-3) : d.career.slice(5))].map((c) => [c.year, c.employer, c.income, c.quarters]), total: d.career.length },
  checks(d) {
    const out = [{ ok: !!d.document_date, label: t("Date du document lue") }];
    if (d.career.length) {
      const years = d.career.map((c) => c.year);
      out.push({ ok: d.career.every((c) => (c.quarters ?? 0) <= 4), label: t("Au plus 4 trimestres par année") });
      out.push({ ok: new Set(years).size === years.length, label: t("Une seule ligne par année ({n} années)", { n: years.length }) });
      const total = sum(d.career.map((c) => c.quarters));
      if (d.quarters_recorded != null) out.push({ ok: Math.abs(total - d.quarters_recorded) <= 4, label: t("Trimestres de la carrière proches du total enregistré ({a} pour {b})", { a: total, b: d.quarters_recorded }) });
    }
    for (const s of d.simulations)
      if (s.gross_monthly != null && s.net_monthly != null) out.push({ ok: s.net_monthly <= s.gross_monthly && s.net_monthly >= s.gross_monthly * 0.7, label: t("{scenario} : net cohérent avec le brut", { scenario: s.label }) });
    return out;
  },
  async existing(d, ctx) {
    const career = await one<{ n: number }>("SELECT COUNT(*) AS n FROM career_periods WHERE owner_user_id = ?", [ctx.userId]);
    const sims = d.document_date ? await one<{ n: number }>("SELECT COUNT(*) AS n FROM retirement_simulations WHERE owner_user_id = ? AND simulated_on = ?", [ctx.userId, d.document_date]) : null;
    const n = Number(career?.n ?? 0);
    if (!n && !Number(sims?.n ?? 0)) return null;
    // La carrière se complète année par année : seules les années qui changeraient comptent comme écarts.
    const out: { label: string; before: string; after: string }[] = [];
    for (const c of d.career) {
      const row = await one<{ quarters: number | null; income: number | null }>("SELECT quarters, income FROM career_periods WHERE owner_user_id = ? AND period = ?", [ctx.userId, String(c.year)]);
      if (row && c.quarters != null && row.quarters != null && Number(row.quarters) !== c.quarters) out.push({ label: t("Trimestres {annee}", { annee: c.year }), before: String(row.quarters), after: String(c.quarters) });
    }
    return { summary: t("Une carrière de {n} années est déjà enregistrée : ce document la complète.", { n }), diffs: out };
  },
  async apply(d, ctx, track) {
    const on = d.document_date ?? new Date().toISOString().slice(0, 10);
    for (const c of d.career) await track.upsert("career_periods", { owner_user_id: ctx.userId, period: String(c.year) }, { start_year: c.year, end_year: c.year, employer: c.employer?.slice(0, 160) ?? null, income: c.income, quarters: c.quarters, points: c.points });
    for (const s of d.simulations)
      await track.upsert("retirement_simulations", { owner_user_id: ctx.userId, simulated_on: on, label: s.label.slice(0, 160) }, { age: s.age, quarters: s.quarters, base_pension: s.base_pension, complementary: s.complementary, gross_monthly: s.gross_monthly, net_monthly: s.net_monthly, adjustment: s.adjustment?.slice(0, 120) ?? null, source: "import" });
    // Faits clés lus par l'écran Retraite (mêmes libellés que la collecte Info Retraite).
    const facts: [string, string, string | number | null][] = [
      ["trimestres_enregistres", `Trimestres enregistrés au ${on.split("-").reverse().join("/")}`, d.quarters_recorded],
      ["trimestres_requis", "Trimestres requis pour le taux plein", d.quarters_required],
      ["age_legal", "Âge légal de départ", d.legal_age],
      ["age_taux_plein", "Âge du taux plein automatique", d.full_rate_age],
    ];
    // Un fait déjà là sous une autre clé (collecte précédente) est mis à jour plutôt que doublé : on le retrouve par le début de son libellé.
    const known = await q<{ fact_key: string; label: string }>("SELECT fact_key, label FROM facts WHERE entity_type = 'retirement' AND entity_id = ?", [String(ctx.userId)]);
    for (const [key, label, value] of facts) {
      if (value == null) continue;
      const prefix = label.split(" ").slice(0, 2).join(" ").toLowerCase();
      const factKey = known.find((k) => k.label.toLowerCase().startsWith(prefix))?.fact_key ?? key;
      await track.upsert("facts", { entity_type: "retirement", entity_id: String(ctx.userId), fact_key: factKey }, { owner_user_id: ctx.userId, label, value: String(value), as_of: on });
    }
    return t("Retraite mise à jour : {a} années de carrière, {b} estimations.", { a: d.career.length, b: d.simulations.length });
  },
};
