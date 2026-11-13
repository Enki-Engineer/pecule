import { z } from "zod";
import { ActionError } from "../../actions.ts";
import { one, q } from "../../db.ts";
import { listMembers } from "../../members.ts";
import { near } from "../../../lib/imports.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { diffs, money, num, str, type Extractor } from "../registry.ts";

/* Avis d'impôt sur le revenu → `tax_returns` (+ salaires par déclarant) ; avis de taxe foncière → `property_taxes`. */

const first = (name: string) => name.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

const avisParse = z.object({
  is_income_tax_notice: z.boolean(),
  income_year: z.number().int().min(1990).max(2100),
  notice_year: z.number().int().nullable(),
  situation: z.string().nullable(),
  parts: z.number().nullable(),
  salaries: z.array(z.object({ first_name: z.string(), amount: z.number() })),
  other_income: z.number().nullable(),
  taxable_income: z.number().nullable(),
  rfr: z.number().nullable(),
  net_tax: z.number().nullable(),
  social_levies: z.number().nullable(),
  total: z.number().nullable(),
  decote: z.number().nullable(),
  credits: z.number().nullable(),
  balance: z.number().nullable(),
  avg_rate: z.number().nullable(),
  notes: z.string().nullable(),
});
type Avis = z.infer<typeof avisParse>;

const AVIS_LABELS = {
  notice_year: tk("Année de l'avis"),
  situation: tk("Situation de famille"),
  parts: tk("Nombre de parts"),
  other_income: tk("Autres revenus"),
  taxable_income: tk("Revenu imposable"),
  rfr: tk("Revenu fiscal de référence"),
  net_tax: tk("Impôt sur le revenu net"),
  social_levies: tk("Prélèvements sociaux"),
  total: tk("Total de l'impôt"),
  decote: tk("Décote"),
  credits: tk("Réductions et crédits d'impôt"),
  balance: tk("Solde à payer ou restitué"),
  avg_rate: tk("Taux moyen d'imposition"),
};

export const avisImpot: Extractor<Avis> = {
  id: "avis_impot",
  label: tk("Avis d'impôt sur le revenu"),
  matches: (c) => c.kind === "avis_impot",
  instructions:
    "Document attendu : un avis d'impôt sur le revenu français (ou avis de situation déclarative). « income_year » est l'année des revenus, « notice_year » celle de l'avis (en général l'année suivante). « salaries » : les salaires et assimilés déclarés par chaque déclarant, avec son prénom. « balance » : montant restant à payer (positif) ou restitué (négatif). « is_income_tax_notice » est faux pour tout autre document (taxe foncière, échéancier, courrier).",
  schema: {
    properties: {
      is_income_tax_notice: { type: "boolean" },
      income_year: { type: "integer", description: "Année des revenus" },
      notice_year: { type: ["integer", "null"], description: "Année de l'avis" },
      situation: str("Situation de famille (marié, pacsé, célibataire, divorcé, veuf)"),
      parts: num("Nombre de parts"),
      salaries: { type: "array", items: { type: "object", properties: { first_name: { type: "string" }, amount: { type: "number" } }, required: ["first_name", "amount"], additionalProperties: false }, description: "Salaires et assimilés par déclarant" },
      other_income: num("Autres revenus déclarés (fonciers, capitaux, indépendants), total"),
      taxable_income: num("Revenu imposable"),
      rfr: num("Revenu fiscal de référence"),
      net_tax: num("Impôt sur le revenu net (avant prélèvements sociaux)"),
      social_levies: num("Prélèvements sociaux"),
      total: num("Total de l'impôt sur le revenu et des prélèvements sociaux"),
      decote: num("Décote"),
      credits: num("Total des réductions et crédits d'impôt"),
      balance: num("Solde : reste à payer (positif) ou restitution (négatif)"),
      avg_rate: num("Taux moyen d'imposition en %"),
      notes: str("Remarque utile en une phrase, sinon null"),
    },
    required: ["is_income_tax_notice", "income_year", "notice_year", "situation", "parts", "salaries", "other_income", "taxable_income", "rfr", "net_tax", "social_levies", "total", "decote", "credits", "balance", "avg_rate", "notes"],
  },
  parse: avisParse,
  rejected: (d) => !d.is_income_tax_notice,
  title: (d) => t("Avis d'impôt — revenus {annee}", { annee: d.income_year }),
  fields: (d) => [
    { key: "income_year", label: tk("Année des revenus"), type: "annee", value: d.income_year, required: true },
    ...(Object.keys(AVIS_LABELS) as (keyof typeof AVIS_LABELS)[]).map((k) => ({
      key: k,
      label: AVIS_LABELS[k],
      type: k === "notice_year" ? ("annee" as const) : k === "situation" ? ("texte" as const) : k === "parts" ? ("nombre" as const) : k === "avg_rate" ? ("pourcent" as const) : ("montant" as const),
      value: d[k],
    })),
  ],
  table: (d) => (d.salaries.length ? { title: t("Salaires déclarés"), columns: [t("Déclarant"), t("Montant")], lines: d.salaries.map((s) => [s.first_name, s.amount]), total: d.salaries.length } : null),
  checks(d) {
    const out = [{ ok: d.rfr != null && d.taxable_income != null, label: t("Revenu imposable et revenu fiscal de référence lus") }];
    if (d.notice_year != null) out.push({ ok: d.notice_year === d.income_year + 1, label: t("Avis de l'année qui suit les revenus ({a} pour {b})", { a: d.notice_year, b: d.income_year }) });
    if (d.net_tax != null && d.social_levies != null && d.total != null)
      out.push({ ok: near(d.net_tax + d.social_levies, d.total, 1), label: t("Impôt + prélèvements sociaux = total ({a} + {b} = {c})", { a: money(d.net_tax), b: money(d.social_levies), c: money(d.total) }) });
    if (d.taxable_income != null && d.rfr != null) out.push({ ok: d.rfr >= d.taxable_income - 1, label: t("Revenu fiscal de référence au moins égal au revenu imposable") });
    return out;
  },
  async existing(d) {
    const row = await one<Record<string, unknown>>("SELECT * FROM tax_returns WHERE income_year = ?", [d.income_year]);
    if (!row) return null;
    const out = diffs(row, d, AVIS_LABELS);
    // Un avis personnel d'avant la vie commune ne doit pas remplacer la ligne du foyer pour la même année : si les
    // déclarants ne sont pas ceux de la ligne enregistrée, l'écart est montré (et la proposition n'est jamais « sûre »).
    const recorded = (await q<{ name: string }>("SELECT u.name FROM tax_return_salaries s JOIN users u ON u.id = s.user_id WHERE s.income_year = ? ORDER BY u.id", [d.income_year])).map((r) => r.name);
    const members = await listMembers();
    const declared = d.salaries.map((x) => members.find((m) => first(m.name) === first(x.first_name))?.name ?? x.first_name);
    if (recorded.length && declared.length && [...recorded].sort().join("|") !== [...new Set(declared)].sort().join("|")) out.push({ label: t("Déclarants"), before: recorded.join(", "), after: [...new Set(declared)].join(", ") });
    return { summary: t("Les revenus {annee} sont déjà enregistrés.", { annee: d.income_year }), diffs: out };
  },
  async apply(d, ctx, track) {
    const { is_income_tax_notice: _, income_year, salaries, ...values } = d;
    const done = await track.upsert("tax_returns", { income_year }, { ...values, document_id: ctx.documentId });
    // Salaires : rattachés aux membres du foyer par leur prénom ; un déclarant inconnu n'est pas inventé.
    const members = await listMembers();
    for (const s of salaries) {
      const member = members.find((m) => first(m.name) === first(s.first_name));
      if (member) await track.upsert("tax_return_salaries", { income_year, user_id: member.id }, { amount: s.amount });
    }
    return done === "cree" ? t("Revenus {annee} ajoutés aux impôts.", { annee: income_year }) : t("Revenus {annee} mis à jour.", { annee: income_year });
  },
};

/* ---------- Taxe foncière ---------- */

const fonciereParse = z.object({
  is_property_tax_notice: z.boolean(),
  year: z.number().int().min(1990).max(2100),
  property_id: z.string().nullable(),
  city: z.string().nullable(),
  base: z.number().nullable(),
  contributions: z.number().nullable(),
  teom: z.number().nullable(),
  fees: z.number().nullable(),
  total: z.number().nullable(),
  notes: z.string().nullable(),
});
type Fonciere = z.infer<typeof fonciereParse>;

const FONCIERE_LABELS = { base: tk("Base d'imposition"), contributions: tk("Cotisations"), teom: tk("Ordures ménagères"), fees: tk("Frais de gestion"), total: tk("Montant de l'avis") };

const properties = (userId: number) => q<{ id: string; name: string; city: string | null }>("SELECT id, name, city FROM properties WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY sort_order, id", [userId]);

export const taxeFonciere: Extractor<Fonciere> = {
  id: "taxe_fonciere",
  label: tk("Avis de taxe foncière"),
  matches: (c) => c.kind === "taxe_fonciere",
  instructions:
    "Document attendu : un avis de taxe foncière français. « contributions » : total des cotisations (commune, intercommunalité, taxes spéciales, GEMAPI…) hors ordures ménagères et hors frais ; « teom » : taxe d'enlèvement des ordures ménagères ; « fees » : frais de gestion ; « total » : montant de l'avis. « property_id » : l'identifiant du bien du foyer concerné, choisi dans la liste fournie d'après la commune et l'adresse, sinon null (ne devine pas). « is_property_tax_notice » est faux pour tout autre document.",
  schema: {
    properties: {
      is_property_tax_notice: { type: "boolean" },
      year: { type: "integer", description: "Année d'imposition" },
      property_id: str("Identifiant du bien dans la liste fournie, sinon null"),
      city: str("Commune du bien"),
      base: num("Base d'imposition"),
      contributions: num("Total des cotisations, hors ordures ménagères et frais"),
      teom: num("Taxe d'enlèvement des ordures ménagères"),
      fees: num("Frais de gestion de la fiscalité directe locale"),
      total: num("Montant total de l'avis"),
      notes: str("Remarque utile en une phrase, sinon null"),
    },
    required: ["is_property_tax_notice", "year", "property_id", "city", "base", "contributions", "teom", "fees", "total", "notes"],
  },
  parse: fonciereParse,
  context: async (ctx) => `Biens du foyer : ${(await properties(ctx.userId)).map((p) => `${p.id} = ${p.name}${p.city ? ` (${p.city})` : ""}`).join(" ; ") || "aucun enregistré"}.`,
  rejected: (d) => !d.is_property_tax_notice,
  title: (d) => t("Taxe foncière {annee}{lieu}", { annee: d.year, lieu: d.city ? ` — ${d.city}` : "" }),
  async fields(d, ctx) {
    const list = await properties(ctx.userId);
    return [
      { key: "property_id", label: tk("Bien"), type: "choix", value: list.some((p) => p.id === d.property_id) ? d.property_id : null, options: list.map((p) => ({ value: p.id, label: p.name })), required: true },
      { key: "year", label: tk("Année"), type: "annee", value: d.year, required: true },
      ...(Object.keys(FONCIERE_LABELS) as (keyof typeof FONCIERE_LABELS)[]).map((k) => ({ key: k, label: FONCIERE_LABELS[k], type: "montant" as const, value: d[k] })),
    ];
  },
  checks(d) {
    const out = [
      { ok: d.total != null, label: t("Montant de l'avis lu") },
      { ok: !!d.property_id, label: t("Bien du foyer reconnu") },
    ];
    if (d.total != null && d.contributions != null)
      out.push({ ok: near(d.contributions + (d.teom ?? 0) + (d.fees ?? 0), d.total, 1), label: t("Cotisations + ordures ménagères + frais = montant de l'avis ({a})", { a: money(d.total) }) });
    return out;
  },
  async existing(d, ctx) {
    if (!d.property_id || !(await properties(ctx.userId)).some((p) => p.id === d.property_id)) return null;
    const row = await one<Record<string, unknown>>("SELECT * FROM property_taxes WHERE year = ? AND property_id = ?", [d.year, d.property_id]);
    if (!row) return null;
    return { summary: t("La taxe foncière {annee} de ce bien est déjà enregistrée.", { annee: d.year }), diffs: diffs(row, d, FONCIERE_LABELS) };
  },
  async apply(d, ctx, track) {
    if (!d.property_id || !(await properties(ctx.userId)).some((p) => p.id === d.property_id)) throw new ActionError(400, t("Choisis le bien concerné par cet avis."));
    const done = await track.upsert("property_taxes", { year: d.year, property_id: d.property_id }, { base: d.base, contributions: d.contributions, teom: d.teom, fees: d.fees, total: d.total, notes: d.notes, document_id: ctx.documentId });
    return done === "cree" ? t("Taxe foncière {annee} ajoutée.", { annee: d.year }) : t("Taxe foncière {annee} mise à jour.", { annee: d.year });
  },
};
