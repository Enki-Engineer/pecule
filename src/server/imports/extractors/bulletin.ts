import { z } from "zod";
import { exec, one, q } from "../../db.ts";
import { near } from "../../../lib/imports.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { canonicalEmployer } from "../../../lib/payslips.ts";
import { day, diffs, money, num, str, type Extractor } from "../registry.ts";

/* Bulletin de paie → table `payslips` (écran Revenus). Clé : membre, employeur, mois de paie. */

const parse = z.object({
  is_payslip: z.boolean(),
  employer: z.string().min(1),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  pay_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  gross: z.number().nullable(),
  net_before_tax: z.number().nullable(),
  net_taxable: z.number().nullable(),
  income_tax: z.number().nullable(),
  tax_rate: z.number().nullable(),
  net_paid: z.number().nullable(),
  bonus: z.number().nullable(),
  employer_cost: z.number().nullable(),
  ytd_net_taxable: z.number().nullable(),
  notes: z.string().nullable(),
});
type Payslip = z.infer<typeof parse>;

const LABELS = {
  pay_date: tk("Date de paiement"),
  gross: tk("Brut"),
  net_before_tax: tk("Net avant impôt"),
  net_taxable: tk("Net imposable"),
  income_tax: tk("Impôt prélevé à la source"),
  tax_rate: tk("Taux du prélèvement"),
  net_paid: tk("Net payé"),
  bonus: tk("Primes"),
  employer_cost: tk("Coût employeur"),
  ytd_net_taxable: tk("Cumul net imposable"),
};

async function employerOf(userId: number, name: string) {
  const known = await q<{ employer: string }>("SELECT DISTINCT employer FROM payslips WHERE owner_user_id = ? ORDER BY employer", [userId]);
  return canonicalEmployer(name, known.map((k) => k.employer));
}

export const bulletin: Extractor<Payslip> = {
  id: "bulletin",
  label: tk("Bulletin de paie"),
  matches: (c) => c.kind === "bulletin",
  private: true,
  instructions:
    "Document attendu : un bulletin de paie français. Le mois de paie est la période travaillée, pas la date d'édition. Les montants sont des nombres positifs. « is_payslip » est faux pour une page annexe, une attestation, un reçu ou un courrier sans les montants d'un mois.",
  schema: {
    properties: {
      is_payslip: { type: "boolean" },
      employer: { type: "string", description: "Employeur, nom court et usuel (sans forme juridique ni ville)" },
      period: { type: "string", description: "Mois de paie AAAA-MM" },
      pay_date: day("Date de paiement"),
      gross: num("Salaire brut du mois"),
      net_before_tax: num("Net à payer avant impôt sur le revenu"),
      net_taxable: num("Net imposable du mois"),
      income_tax: num("Impôt sur le revenu prélevé à la source (montant positif)"),
      tax_rate: num("Taux du prélèvement à la source en %"),
      net_paid: num("Net payé (versé sur le compte)"),
      bonus: num("Primes, variable ou intéressement versés ce mois (brut), sinon null"),
      employer_cost: num("Coût total employeur si indiqué"),
      ytd_net_taxable: num("Cumul annuel du net imposable si indiqué"),
      notes: str("Remarque utile en une phrase (prime, absence, régularisation, changement de salaire), sinon null"),
    },
    required: ["is_payslip", "employer", "period", "pay_date", "gross", "net_before_tax", "net_taxable", "income_tax", "tax_rate", "net_paid", "bonus", "employer_cost", "ytd_net_taxable", "notes"],
  },
  parse,
  rejected: (d) => !d.is_payslip,
  title: (d) => t("Bulletin de paie {employeur} — {mois}", { employeur: d.employer, mois: d.period }),
  fields: (d) => [
    { key: "employer", label: tk("Employeur"), type: "texte", value: d.employer, required: true },
    { key: "period", label: tk("Mois de paie"), type: "mois", value: d.period, required: true },
    ...(Object.keys(LABELS) as (keyof typeof LABELS)[]).map((k) => ({ key: k, label: LABELS[k], type: k === "pay_date" ? ("date" as const) : k === "tax_rate" ? ("pourcent" as const) : ("montant" as const), value: d[k] })),
    { key: "notes", label: tk("Remarque"), type: "texte", value: d.notes },
  ],
  checks(d) {
    const out = [{ ok: d.gross != null && d.net_paid != null, label: t("Brut et net payé lus") }];
    if (d.gross != null && d.net_paid != null) out.push({ ok: d.net_paid <= d.gross, label: t("Net payé inférieur au brut") });
    if (d.net_before_tax != null && d.income_tax != null && d.net_paid != null)
      out.push({ ok: near(d.net_before_tax - d.income_tax, d.net_paid, 0.02), label: t("Net avant impôt − impôt = net payé ({a} − {b} = {c})", { a: money(d.net_before_tax), b: money(d.income_tax), c: money(d.net_paid) }) });
    if (d.net_taxable != null && d.tax_rate != null && d.income_tax != null)
      out.push({ ok: near((d.net_taxable * d.tax_rate) / 100, d.income_tax, 1, 0.03), label: t("Impôt = net imposable × taux ({a} × {b} %)", { a: money(d.net_taxable), b: d.tax_rate }) });
    return out;
  },
  async existing(d, ctx) {
    const employer = await employerOf(ctx.userId, d.employer);
    const row = await one<Record<string, unknown>>("SELECT * FROM payslips WHERE owner_user_id = ? AND employer = ? AND period = ?", [ctx.userId, employer, d.period]);
    if (!row) return null;
    return { summary: t("Ce mois est déjà enregistré pour {employeur}.", { employeur: employer }), diffs: diffs(row, d, LABELS) };
  },
  async apply(d, ctx, track) {
    const employer = await employerOf(ctx.userId, d.employer);
    const { is_payslip: _, employer: __, period, ...values } = d;
    const done = await track.upsert("payslips", { owner_user_id: ctx.userId, employer, period }, { ...values, document_id: ctx.documentId });
    if (ctx.documentId) await exec("UPDATE documents SET doc_date = COALESCE(doc_date, ?) WHERE id = ?", [`${period}-01`, ctx.documentId]);
    return done === "cree" ? t("Bulletin ajouté aux revenus ({mois}).", { mois: period }) : done === "modifie" ? t("Bulletin mis à jour ({mois}).", { mois: period }) : t("Bulletin déjà à jour ({mois}).", { mois: period });
  },
};
