import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { exec, one, q } from "./db.ts";
import { aiClient, aiEnabled, aiModel, recordUsage } from "./ai.ts";
import { ActionError } from "./actions.ts";
import { canonicalEmployer } from "../lib/payslips.ts";

/*
 * Bulletins de paie : chaque fiche rangée au coffre (domaine revenus, privée) est lue par Claude
 * (sortie structurée) ; les montants clés alimentent l'historique des revenus. Le bulletin lui-même
 * reste le document de référence.
 */

const payslip = z.object({
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

const num = (d: string) => ({ type: ["number", "null"], description: d });
const SCHEMA = {
  type: "object",
  properties: {
    is_payslip: { type: "boolean", description: "true seulement si c'est un bulletin de paie avec les montants d'un mois (pas une page annexe, un reçu, une attestation ou un courrier)" },
    employer: { type: "string", description: "Employeur, nom court et usuel (sans forme juridique ni ville)" },
    period: { type: "string", description: "Mois de paie AAAA-MM" },
    pay_date: { type: ["string", "null"], description: "Date de paiement AAAA-MM-JJ" },
    gross: num("Salaire brut du mois"),
    net_before_tax: num("Net à payer avant impôt sur le revenu"),
    net_taxable: num("Net imposable du mois"),
    income_tax: num("Impôt sur le revenu prélevé à la source (montant positif)"),
    tax_rate: num("Taux du prélèvement à la source en %"),
    net_paid: num("Net payé (versé sur le compte)"),
    bonus: num("Primes, variable ou intéressement versés ce mois (brut), sinon null"),
    employer_cost: num("Coût total employeur si indiqué"),
    ytd_net_taxable: num("Cumul annuel du net imposable si indiqué"),
    notes: { type: ["string", "null"], description: "Remarque utile en une phrase (prime, absence, régularisation, changement de salaire), sinon null" },
  },
  required: ["is_payslip", "employer", "period", "pay_date", "gross", "net_before_tax", "net_taxable", "income_tax", "tax_rate", "net_paid", "bonus", "employer_cost", "ytd_net_taxable", "notes"],
  additionalProperties: false,
};

/** Lit un bulletin rangé au coffre et enregistre ses montants. */
export async function extractPayslip(documentId: number): Promise<{ period: string; employer: string } | null> {
  if (!aiEnabled()) throw new ActionError(503, "IA non configurée");
  const doc = await one<{ id: number; owner_user_id: number | null; content_text: string | null; file_mime: string | null; title: string }>(
    "SELECT id, owner_user_id, content_text, file_mime, title FROM documents WHERE id = ?",
    [documentId],
  );
  if (!doc) throw new ActionError(404, "Document introuvable");
  if (!doc.owner_user_id) throw new ActionError(400, "Un bulletin de paie doit être privé");
  let block: Anthropic.ContentBlockParam;
  if (doc.content_text && doc.content_text.trim().length > 300) {
    block = { type: "text", text: `Bulletin de paie (texte extrait) :\n\n${doc.content_text.slice(0, 20_000)}` };
  } else {
    // Bulletin scanné : Claude lit le PDF ou l'image.
    const f = await one<{ content: Buffer }>("SELECT content FROM document_files WHERE document_id = ?", [documentId]);
    if (!f || !doc.file_mime) return null;
    block =
      doc.file_mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.content.toString("base64") } }
        : { type: "image", source: { type: "base64", media_type: doc.file_mime as "image/jpeg", data: f.content.toString("base64") } };
  }
  const response = await aiClient().messages.create({
    model: aiModel(),
    max_tokens: 3000,
    system:
      "Tu lis des bulletins de paie français. Recopie fidèlement les montants (en euros, nombres positifs), n'invente rien : null si absent. Le mois de paie est la période travaillée, pas la date d'édition. Ne recopie jamais de numéro de Sécurité sociale.",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: [block, { type: "text", text: `Lis ce bulletin (titre : ${doc.title}).` }] }],
  });
  await recordUsage("fiche de paie", aiModel(), response.usage);
  const out = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  const parsed = out ? payslip.safeParse(JSON.parse(out)) : null;
  if (!parsed?.success) return null;
  const p = parsed.data;
  if (!p.is_payslip) {
    // Page annexe ou autre document RH rangé par erreur avec les bulletins : il reste au coffre, sans montants.
    await exec("UPDATE documents SET kind = 'autre', title = ? WHERE id = ? AND kind = 'bulletin'", [`Document RH ${p.employer} (${p.period}) — ${(p.notes ?? "pas un bulletin").slice(0, 120)}`.slice(0, 255), doc.id]);
    await exec("DELETE FROM payslips WHERE document_id = ?", [doc.id]);
    return null;
  }
  // Même employeur écrit autrement : on reprend le nom déjà enregistré pour ce membre.
  const known = await q<{ employer: string }>("SELECT DISTINCT employer FROM payslips WHERE owner_user_id = ? ORDER BY employer", [doc.owner_user_id]);
  const employer = canonicalEmployer(
    p.employer,
    known.map((k) => k.employer),
  );
  // Bulletin en double (même mois, même employeur) : on garde la lecture la plus complète.
  const filled = (r: { gross: number | null; net_taxable: number | null; net_paid: number | null }) => [r.gross, r.net_taxable, r.net_paid].filter((v) => v != null).length;
  const existing = await one<{ document_id: number | null; gross: number | null; net_taxable: number | null; net_paid: number | null }>(
    "SELECT document_id, gross, net_taxable, net_paid FROM payslips WHERE owner_user_id = ? AND employer = ? AND period = ?",
    [doc.owner_user_id, employer, p.period],
  );
  if (existing && existing.document_id !== doc.id && filled(existing) >= filled(p)) return { period: p.period, employer };
  await exec(
    `INSERT INTO payslips (owner_user_id, employer, period, pay_date, gross, net_before_tax, net_taxable, income_tax, tax_rate, net_paid, bonus, employer_cost, ytd_net_taxable, notes, document_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE pay_date = VALUES(pay_date), gross = VALUES(gross), net_before_tax = VALUES(net_before_tax), net_taxable = VALUES(net_taxable),
       income_tax = VALUES(income_tax), tax_rate = VALUES(tax_rate), net_paid = VALUES(net_paid), bonus = VALUES(bonus), employer_cost = VALUES(employer_cost),
       ytd_net_taxable = VALUES(ytd_net_taxable), notes = VALUES(notes), document_id = VALUES(document_id)`,
    [doc.owner_user_id, employer, p.period, p.pay_date, p.gross, p.net_before_tax, p.net_taxable, p.income_tax, p.tax_rate, p.net_paid, p.bonus, p.employer_cost, p.ytd_net_taxable, p.notes, doc.id],
  );
  // Le bulletin porte la date de sa période (tri du coffre).
  await exec("UPDATE documents SET doc_date = COALESCE(doc_date, ?) WHERE id = ?", [`${p.period}-01`, doc.id]);
  return { period: p.period, employer };
}

/** Remet les noms d'employeurs au propre ; en cas de doublon de mois, garde la ligne la plus complète. */
export async function normalizePayslips() {
  const rows = await q<{ id: number; owner_user_id: number; employer: string; period: string; gross: number | null; net_taxable: number | null; net_paid: number | null }>(
    "SELECT id, owner_user_id, employer, period, gross, net_taxable, net_paid FROM payslips",
  );
  const filled = (r: (typeof rows)[number]) => [r.gross, r.net_taxable, r.net_paid].filter((v) => v != null).length;
  // Nom retenu par membre : la première écriture rencontrée (la plus courte d'abord) sert de référence aux suivantes.
  const names = new Map<number, string[]>();
  const canonical = new Map<number, string>();
  for (const r of [...rows].sort((a, b) => a.employer.length - b.employer.length || a.id - b.id)) {
    const known = names.get(r.owner_user_id) ?? [];
    const c = canonicalEmployer(r.employer, known);
    if (!known.includes(c)) names.set(r.owner_user_id, [...known, c]);
    canonical.set(r.id, c);
  }
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.owner_user_id}|${canonical.get(r.id)}|${r.period}`;
    const b = best.get(k);
    if (!b || filled(r) > filled(b)) best.set(k, r);
  }
  const keep = new Set([...best.values()].map((r) => r.id));
  let removed = 0;
  let renamed = 0;
  for (const r of rows)
    if (!keep.has(r.id)) {
      await exec("DELETE FROM payslips WHERE id = ?", [r.id]);
      removed++;
    }
  for (const r of best.values()) {
    const c = canonical.get(r.id)!;
    if (c !== r.employer) {
      await exec("UPDATE payslips SET employer = ? WHERE id = ?", [c, r.id]);
      renamed++;
    }
  }
  return { removed, renamed };
}

/** Bulletins rangés au coffre sans montants exploitables (doublons écartés, lectures incomplètes) : à relire. */
export async function payslipsToReread(): Promise<number[]> {
  const rows = await q<{ id: number }>(
    `SELECT d.id FROM documents d WHERE d.kind = 'bulletin' AND d.owner_user_id IS NOT NULL
       AND (NOT EXISTS (SELECT 1 FROM payslips p WHERE p.document_id = d.id)
            OR EXISTS (SELECT 1 FROM payslips p WHERE p.document_id = d.id AND (p.gross IS NULL OR p.net_paid IS NULL)))
     ORDER BY d.id`,
  );
  return rows.map((r) => r.id);
}

/** Historique des revenus salariaux d'un membre : bulletins et totaux par année. */
export async function payslipHistory(userId: number) {
  const rows = await q<{ period: string; employer: string; gross: number | null; net_taxable: number | null; income_tax: number | null; net_paid: number | null; bonus: number | null; tax_rate: number | null; document_id: number | null; notes: string | null }>(
    "SELECT period, employer, gross, net_taxable, income_tax, net_paid, bonus, tax_rate, document_id, notes FROM payslips WHERE owner_user_id = ? ORDER BY period DESC",
    [userId],
  );
  const years = new Map<string, { year: string; months: number; gross: number; netTaxable: number; incomeTax: number; netPaid: number; bonus: number; employers: Set<string> }>();
  for (const r of rows) {
    const y = r.period.slice(0, 4);
    const t = years.get(y) ?? { year: y, months: 0, gross: 0, netTaxable: 0, incomeTax: 0, netPaid: 0, bonus: 0, employers: new Set<string>() };
    t.months++;
    t.gross += Number(r.gross ?? 0);
    t.netTaxable += Number(r.net_taxable ?? 0);
    t.incomeTax += Number(r.income_tax ?? 0);
    t.netPaid += Number(r.net_paid ?? 0);
    t.bonus += Number(r.bonus ?? 0);
    t.employers.add(r.employer);
    years.set(y, t);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    payslips: rows,
    years: [...years.values()].map((y) => ({ ...y, gross: r2(y.gross), netTaxable: r2(y.netTaxable), incomeTax: r2(y.incomeTax), netPaid: r2(y.netPaid), bonus: r2(y.bonus), employers: [...y.employers] })),
  };
}
