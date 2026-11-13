import { z } from "zod";
import { ActionError } from "../../actions.ts";
import { one, q } from "../../db.ts";
import { near, sum } from "../../../lib/imports.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { day, diffs, money, str, type Extractor } from "../registry.ts";

/* Tableau d'amortissement ou offre de prêt → `loans` et `loan_schedule` (écran Crédit). Clé : le crédit. */

const NEW = "__nouveau__";
const line = z.object({ rang: z.number().int(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), payment: z.number(), principal: z.number(), interest: z.number(), insurance: z.number(), deferred: z.number(), remaining: z.number() });
const parse = z.object({
  is_loan_document: z.boolean(),
  loan_id: z.string().nullable(),
  name: z.string().min(1),
  bank: z.string().min(1),
  reference: z.string().nullable(),
  type: z.string().min(1),
  property_id: z.string().nullable(),
  principal: z.number(),
  rate: z.number(),
  duration_months: z.number().int(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  schedule: z.array(line),
});
type Loan = z.infer<typeof parse>;

const LABELS = { name: tk("Nom du crédit"), bank: tk("Banque"), type: tk("Type de prêt"), principal: tk("Capital emprunté"), rate: tk("Taux"), duration_months: tk("Durée en mois"), start_date: tk("Première échéance"), end_date: tk("Dernière échéance") };

// Crédits visibles du membre : communs ou à lui (jamais ceux, privés, d'un autre membre).
const loans = (userId: number) => q<{ id: string; name: string; bank: string; principal: number }>("SELECT id, name, bank, principal FROM loans WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY sort_order, id", [userId]);
const properties = (userId: number) => q<{ id: string; name: string }>("SELECT id, name FROM properties WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY sort_order, id", [userId]);
const slug = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
/** Date d'une échéance : celle du tableau, sinon la première échéance décalée d'autant de mois que son rang (tableau prévisionnel, sans dates). */
function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}
function dated(d: Loan): (Loan["schedule"][number] & { due: string | null })[] {
  const start = d.start_date ?? d.schedule.find((s) => s.date)?.date ?? null;
  const first = d.schedule[0]?.rang ?? 1;
  return d.schedule.map((s) => ({ ...s, due: s.date ?? (start ? addMonths(start, s.rang - first) : null) }));
}
const bounds = (d: Loan) => {
  const lines = dated(d);
  return { start: d.start_date ?? lines[0]?.due ?? null, end: lines.at(-1)?.due ?? d.end_date ?? null };
};

export const pret: Extractor<Loan> = {
  id: "pret",
  label: tk("Tableau d'amortissement"),
  matches: (c) => c.kind === "pret",
  maxTokens: 32_000,
  pdfUpTo: 30,
  instructions:
    "Document attendu : un tableau d'amortissement ou une offre de prêt avec son échéancier. Recopie TOUTES les lignes de l'échéancier, dans l'ordre, sans en résumer ni en sauter, période de différé comprise : rang (numéro d'échéance, à partir de 1), date, échéance payée (assurance comprise si elle figure dans la même ligne), part de capital, part d'intérêts, assurance (0 si absente), intérêts reportés (0 si absents), capital restant dû après l'échéance. Ne tronque jamais l'échéancier, même long de plusieurs centaines de lignes : une liste abrégée est inutilisable. Si le document lui-même est incomplet (pages manquantes), recopie toutes les lignes présentes et signale-le dans les doutes. Un tableau prévisionnel ne porte souvent que des rangs, sans dates : mets alors null pour la date de chaque ligne et recopie quand même toutes les lignes ; « start_date » reste null si la date de la première échéance n'est écrite nulle part. Le taux est le taux nominal annuel en %. « type » : amortissable, taux zéro, in fine, relais, travaux, consommation… « loan_id » : l'identifiant du crédit déjà connu s'il s'agit du même prêt (même banque, même capital) dans la liste fournie, sinon null. « property_id » : le bien financé, choisi dans la liste fournie, sinon null. « is_loan_document » est faux si le document n'a pas d'échéancier.",
  schema: {
    properties: {
      is_loan_document: { type: "boolean" },
      loan_id: str("Identifiant d'un crédit déjà connu, sinon null"),
      name: { type: "string", description: "Nom court du prêt (« Prêt immobilier », « Prêt à taux zéro », « Prêt travaux »)" },
      bank: { type: "string", description: "Banque prêteuse, nom usuel" },
      reference: str("Numéro ou référence du prêt"),
      type: { type: "string" },
      property_id: str("Identifiant du bien financé dans la liste fournie, sinon null"),
      principal: { type: "number", description: "Capital emprunté" },
      rate: { type: "number", description: "Taux nominal annuel en %" },
      duration_months: { type: "integer", description: "Durée totale en mois" },
      start_date: day("Date de la première échéance"),
      end_date: day("Date de la dernière échéance"),
      schedule: {
        type: "array",
        items: {
          type: "object",
          properties: { rang: { type: "integer" }, date: { type: ["string", "null"] }, payment: { type: "number" }, principal: { type: "number" }, interest: { type: "number" }, insurance: { type: "number" }, deferred: { type: "number" }, remaining: { type: "number" } },
          required: ["rang", "date", "payment", "principal", "interest", "insurance", "deferred", "remaining"],
          additionalProperties: false,
        },
      },
    },
    required: ["is_loan_document", "loan_id", "name", "bank", "reference", "type", "property_id", "principal", "rate", "duration_months", "start_date", "end_date", "schedule"],
  },
  parse,
  context: async (ctx) =>
    `Crédits déjà connus : ${(await loans(ctx.userId)).map((l) => `${l.id} = ${l.name}, ${l.bank}, ${l.principal}`).join(" ; ") || "aucun"}.\nBiens du foyer : ${(await properties(ctx.userId)).map((p) => `${p.id} = ${p.name}`).join(" ; ") || "aucun"}.`,
  rejected: (d) => !d.is_loan_document || !d.schedule.length,
  title: (d) => t("{nom} — {banque}, {capital}", { nom: d.name, banque: d.bank, capital: money(d.principal) }),
  async fields(d, ctx) {
    const [known, props] = await Promise.all([loans(ctx.userId), properties(ctx.userId)]);
    const b = bounds(d);
    return [
      { key: "loan_id", label: tk("Crédit"), type: "choix", value: known.some((l) => l.id === d.loan_id) || d.loan_id === NEW ? d.loan_id : null, options: [{ value: NEW, label: tk("Nouveau crédit") }, ...known.map((l) => ({ value: l.id, label: `${l.name} · ${l.bank}` }))], required: true },
      { key: "property_id", label: tk("Bien financé"), type: "choix", value: props.some((p) => p.id === d.property_id) ? d.property_id : null, options: props.map((p) => ({ value: p.id, label: p.name })) },
      { key: "name", label: LABELS.name, type: "texte", value: d.name, required: true },
      { key: "bank", label: LABELS.bank, type: "texte", value: d.bank, required: true },
      { key: "type", label: LABELS.type, type: "texte", value: d.type },
      { key: "principal", label: LABELS.principal, type: "montant", value: d.principal, required: true },
      { key: "rate", label: LABELS.rate, type: "pourcent", value: d.rate, required: true },
      { key: "duration_months", label: LABELS.duration_months, type: "nombre", value: d.duration_months },
      { key: "start_date", label: LABELS.start_date, type: "date", value: b.start, required: true },
      { key: "end_date", label: LABELS.end_date, type: "date", value: b.end },
    ];
  },
  table: (d) => ({
    title: t("Échéancier"),
    columns: [t("Rang"), t("Date"), t("Échéance"), t("Capital"), t("Intérêts"), t("Assurance"), t("Restant dû")],
    lines: ((all) => [...all.slice(0, 6), ...(all.length > 9 ? all.slice(-3) : all.slice(6))])(dated(d)).map((s) => [s.rang, s.due, s.payment, s.principal, s.interest, s.insurance, s.remaining]),
    total: d.schedule.length,
  }),
  checks(d) {
    const s = d.schedule;
    const repaid = sum(s.map((x) => x.principal));
    const decreasing = s.every((x, i) => i === 0 || x.remaining <= s[i - 1].remaining + 0.01);
    const unbalanced = s.filter((x) => !near(x.principal + x.interest + x.insurance, x.payment, 0.02) && !near(x.principal + x.interest, x.payment, 0.02)).length;
    const ordered = s.every((x, i) => i === 0 || (x.rang === s[i - 1].rang + 1 && (!x.date || !s[i - 1].date || x.date >= s[i - 1].date!)));
    return [
      { ok: near(repaid, d.principal, 1), label: t("Capital remboursé = capital emprunté ({a} pour {b})", { a: money(repaid), b: money(d.principal) }) },
      { ok: decreasing, label: t("Capital restant dû toujours décroissant") },
      { ok: near(s.at(-1)?.remaining ?? null, 0, 1), label: t("Capital restant dû nul à la dernière échéance") },
      { ok: unbalanced === 0, label: unbalanced ? t("Échéance = capital + intérêts (+ assurance) : {n} lignes ne tombent pas juste", { n: unbalanced }) : t("Échéance = capital + intérêts (+ assurance) sur chaque ligne") },
      { ok: ordered, label: t("Échéances numérotées et datées dans l'ordre ({n} lignes)", { n: s.length }) },
      { ok: !!bounds(d).start, label: t("Date de la première échéance connue") },
      // Jamais de crédit créé sans qu'on l'ait demandé : un crédit existant, ou « Nouveau crédit » choisi exprès.
      { ok: !!d.loan_id, label: t("Rattachement choisi : un élément existant, ou « nouveau » demandé exprès") },
      ...(d.duration_months ? [{ ok: Math.abs(s.length - d.duration_months) <= 1, label: t("Autant d'échéances que de mois de durée ({a} pour {b})", { a: s.length, b: d.duration_months }) }] : []),
    ];
  },
  async existing(d, ctx) {
    if (!d.loan_id || d.loan_id === NEW) return null;
    const row = await one<Record<string, unknown>>("SELECT * FROM loans WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [d.loan_id, ctx.userId]);
    if (!row) return null;
    const count = await one<{ n: number }>("SELECT COUNT(*) AS n FROM loan_schedule WHERE loan_id = ?", [d.loan_id]);
    const b = bounds(d);
    const out = diffs(row, { ...d, start_date: b.start, end_date: b.end }, LABELS);
    // Remplacer un échéancier en place demande toujours un regard, même à nombre de lignes égal.
    out.push({ label: t("Échéancier"), before: t("{n} lignes", { n: Number(count?.n ?? 0) }), after: t("{n} lignes", { n: d.schedule.length }) });
    return { summary: t("Ce crédit est déjà enregistré : son échéancier serait remplacé."), diffs: out };
  },
  async apply(d, ctx, track) {
    const b = bounds(d);
    if (!b.start || !b.end) throw new ActionError(400, t("Il manque la date de la première échéance : ce tableau ne porte pas de dates."));
    const known = d.loan_id && d.loan_id !== NEW ? await one<{ id: string }>("SELECT id FROM loans WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [d.loan_id, ctx.userId]) : null;
    let id = known?.id;
    if (!id) {
      // Identifiant lisible et stable : banque et référence (ou capital), sans collision avec un crédit existant.
      const base = `${slug(d.bank).slice(0, 14)}-${slug(d.reference ?? String(Math.round(d.principal))).slice(-9)}`.replace(/^-|-$/g, "") || "pret";
      id = base;
      for (let i = 2; await one("SELECT id FROM loans WHERE id = ?", [id]); i++) id = `${base.slice(0, 28)}-${i}`;
    }
    const order = known ? {} : { sort_order: Number((await one<{ n: number }>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM loans"))?.n ?? 1) };
    await track.upsert("loans", { id }, { name: d.name, property: d.property_id ?? "", bank: d.bank, reference: d.reference, type: d.type, principal: d.principal, rate: d.rate, duration_months: d.duration_months, start_date: b.start, end_date: b.end, ...order });
    await track.replace("loan_schedule", { loan_id: id }, dated(d).map((s) => ({ rang: s.rang, date: s.due, payment: s.payment, principal: s.principal, interest: s.interest, insurance: s.insurance, deferred_interest: s.deferred, remaining: s.remaining })));
    return known ? t("Crédit mis à jour : {n} échéances.", { n: d.schedule.length }) : t("Crédit ajouté : {n} échéances.", { n: d.schedule.length });
  },
};
