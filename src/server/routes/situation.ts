import { Router } from "express";
import { z } from "zod";
import { exec, one } from "../db.ts";
import { memberIdByName } from "../members.ts";
import { ActionError } from "../actions.ts";
import {
  budget,
  cryptoEvents,
  deleteCommitment,
  listProperties,
  projectionsFor,
  propertyDetail,
  retirement,
  saveCommitment,
  saveProjections,
  saveRetirement,
  taxes,
  updateProperty,
  upsertFacts,
} from "../situation.ts";
import { extractPayslip, normalizePayslips, payslipHistory, payslipsToReread } from "../payslips.ts";
import { t as tr } from "../../lib/i18n.ts";

/** Domaines repris de Notion (biens, budget, impôts, retraite, projections, mouvements crypto) : sous /api. */
export const situationApi = Router();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().nullable().optional();

situationApi.get("/properties", async (req, res) => {
  res.json({ properties: await listProperties(req.user!.id) });
});

situationApi.get("/properties/:id", async (req, res) => {
  const d = await propertyDetail(req.user!.id, z.string().max(32).parse(req.params.id));
  if (!d) throw new ActionError(404, tr("Bien introuvable"));
  res.json(d);
});

situationApi.patch("/properties/:id", async (req, res) => {
  const b = z
    .object({ rentMonthly: money, chargesMonthly: money, deposit: money, nextRentRevision: day.nullable().optional(), leaseStart: day.nullable().optional(), taxRegime: z.string().max(40).nullable().optional() })
    .parse(req.body);
  await updateProperty(req.user!.id, z.string().max(32).parse(req.params.id), {
    rent_monthly: b.rentMonthly,
    charges_monthly: b.chargesMonthly,
    deposit: b.deposit,
    next_rent_revision: b.nextRentRevision,
    lease_start: b.leaseStart,
    tax_regime: b.taxRegime,
  });
  res.json({ ok: true });
});

situationApi.get("/budget", async (req, res) => {
  res.json(await budget(req.user!.id));
});

export const commitmentBody = z.object({
  label: z.string().min(1).max(160).optional(),
  groupName: z.string().max(60).nullable().optional(),
  type: z.enum(["credit", "assurance", "abonnement", "taxe", "garde", "budget"]).optional(),
  status: z.enum(["actif", "a_verifier", "a_completer", "resilie", "non_compte"]).optional(),
  monthly: money,
  annual: money,
  categoryId: z.string().max(16).nullable().optional(),
  matchPattern: z.string().max(120).nullable().optional(),
  /** Expression régulière sur le libellé bancaire brut (codes de prélèvement compris). */
  labelRegex: z
    .string()
    .max(191)
    .refine((r) => {
      try {
        new RegExp(r);
        return true;
      } catch {
        return false;
      }
    }, "Expression invalide")
    .nullable()
    .optional(),
  propertyId: z.string().max(32).nullable().optional(),
  provider: z.string().max(120).nullable().optional(),
  startDate: day.nullable().optional(),
  endDate: day.nullable().optional(),
  renewalDate: day.nullable().optional(),
  noticeDays: z.number().int().min(0).max(3650).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  private: z.boolean().optional(),
});

situationApi.post("/commitments", async (req, res) => {
  res.json({ id: await saveCommitment(req.user!.id, null, commitmentBody.parse(req.body)) });
});

situationApi.patch("/commitments/:id", async (req, res) => {
  await saveCommitment(req.user!.id, z.coerce.number().int().parse(req.params.id), commitmentBody.parse(req.body));
  res.json({ ok: true });
});

situationApi.delete("/commitments/:id", async (req, res) => {
  await deleteCommitment(req.user!.id, z.coerce.number().int().parse(req.params.id));
  res.json({ ok: true });
});

situationApi.get("/taxes", async (req, res) => {
  res.json(await taxes(req.user!.id));
});

situationApi.get("/retirement", async (req, res) => {
  res.json(await retirement(req.user!.id));
});

situationApi.get("/projections", async (req, res) => {
  res.json(await projectionsFor(req.user!.id));
});

situationApi.get("/payslips", async (req, res) => {
  res.json(await payslipHistory(req.user!.id));
});

situationApi.get("/crypto/events", async (req, res) => {
  res.json({ events: await cryptoEvents(req.user!.id) });
});

/* ---------- Administration (jeton d'API) : reprise Notion, idempotente ---------- */

export const situationAdmin = Router();

const ownerId = memberIdByName;
const factList = z.array(z.object({ key: z.string().min(1).max(60), label: z.string().min(1).max(160), value: z.union([z.string(), z.number()]).transform(String), unit: z.string().max(24).nullable().optional(), asOf: day.nullable().optional() })).max(60);

situationAdmin.post("/import/properties", async (req, res) => {
  const list = z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        owner: z.string().min(1).max(80).nullable().optional(),
        name: z.string().min(1).max(160),
        kind: z.string().max(24),
        city: z.string().max(120).nullable().optional(),
        surface: money,
        rooms: z.number().int().nullable().optional(),
        acquisitionDate: day.nullable().optional(),
        acquisitionPrice: money,
        acquisitionCosts: money,
        rentMonthly: money,
        chargesMonthly: money,
        deposit: money,
        leaseKind: z.string().max(24).nullable().optional(),
        leaseStart: day.nullable().optional(),
        nextRentRevision: day.nullable().optional(),
        taxRegime: z.string().max(40).nullable().optional(),
        assetId: z.number().int().nullable().optional(),
        loanIds: z.array(z.string().max(32)).optional(),
        facts: factList.optional(),
      }),
    )
    .max(20)
    .parse(req.body);
  let i = 0;
  for (const p of list) {
    const owner = await ownerId(p.owner);
    const vals = [
      p.id,
      owner,
      p.name,
      p.kind,
      p.city ?? null,
      p.surface ?? null,
      p.rooms ?? null,
      p.acquisitionDate ?? null,
      p.acquisitionPrice ?? null,
      p.acquisitionCosts ?? null,
      p.rentMonthly ?? null,
      p.chargesMonthly ?? null,
      p.deposit ?? null,
      p.leaseKind ?? null,
      p.leaseStart ?? null,
      p.nextRentRevision ?? null,
      p.taxRegime ?? null,
      p.assetId ?? null,
      p.loanIds?.join(",") ?? null,
      i++,
    ];
    await exec(
      `INSERT INTO properties (id, owner_user_id, name, kind, city, surface, rooms, acquisition_date, acquisition_price, acquisition_costs, rent_monthly,
         charges_monthly, deposit, lease_kind, lease_start, next_rent_revision, tax_regime, asset_id, loan_ids, sort_order)
       VALUES (${vals.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE name = VALUES(name), kind = VALUES(kind), city = VALUES(city), surface = VALUES(surface), rooms = VALUES(rooms),
         acquisition_date = VALUES(acquisition_date), acquisition_price = VALUES(acquisition_price), acquisition_costs = VALUES(acquisition_costs),
         rent_monthly = VALUES(rent_monthly), charges_monthly = VALUES(charges_monthly), deposit = VALUES(deposit), lease_kind = VALUES(lease_kind),
         lease_start = VALUES(lease_start), next_rent_revision = VALUES(next_rent_revision), tax_regime = VALUES(tax_regime), asset_id = VALUES(asset_id),
         loan_ids = VALUES(loan_ids), sort_order = VALUES(sort_order)`,
      vals,
    );
    if (p.facts?.length) await upsertFacts(owner, "property", p.id, p.facts);
  }
  res.json({ imported: list.length });
});

situationAdmin.post("/import/commitments", async (req, res) => {
  const list = z.array(commitmentBody.extend({ label: z.string().min(1).max(160), sourceRef: z.string().max(191), owner: z.string().min(1).max(80).nullable().optional() })).max(300).parse(req.body);
  for (const [i, c] of list.entries()) {
    const owner = await ownerId(c.owner);
    const id = await saveCommitment(owner ?? req.user!.id, null, { ...c, private: !!owner, source: "notion", sourceRef: c.sourceRef });
    await exec("UPDATE commitments SET sort_order = ? WHERE source_ref = ? OR id = ?", [i, c.sourceRef, id]);
  }
  res.json({ imported: list.length });
});

situationAdmin.post("/import/income", async (req, res) => {
  const list = z
    .array(
      z.object({
        sourceRef: z.string().max(191),
        owner: z.string().min(1).max(80).nullable().optional(),
        person: z.string().max(16),
        label: z.string().min(1).max(160),
        kind: z.string().max(16).default("autre"),
        monthly: money,
        annualGross: money,
        validFrom: day.nullable().optional(),
        validTo: day.nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
      }),
    )
    .max(50)
    .parse(req.body);
  for (const [i, r] of list.entries())
    await exec(
      `INSERT INTO income_sources (owner_user_id, person, label, kind, monthly, annual_gross, valid_from, valid_to, notes, source_ref, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE person = VALUES(person), label = VALUES(label), kind = VALUES(kind), monthly = VALUES(monthly), annual_gross = VALUES(annual_gross),
         valid_from = VALUES(valid_from), valid_to = VALUES(valid_to), notes = VALUES(notes), sort_order = VALUES(sort_order), owner_user_id = VALUES(owner_user_id)`,
      [await ownerId(r.owner), r.person, r.label, r.kind, r.monthly ?? null, r.annualGross ?? null, r.validFrom ?? null, r.validTo ?? null, r.notes ?? null, r.sourceRef, i],
    );
  res.json({ imported: list.length });
});

const TAX_COLS = [
  ["noticeYear", "notice_year"],
  ["parts", "parts"],
  ["situation", "situation"],
  ["otherIncome", "other_income"],
  ["taxableIncome", "taxable_income"],
  ["rfr", "rfr"],
  ["netTax", "net_tax"],
  ["socialLevies", "social_levies"],
  ["total", "total"],
  ["decote", "decote"],
  ["credits", "credits"],
  ["balance", "balance"],
  ["tmi", "tmi"],
  ["avgRate", "avg_rate"],
  ["creditsDetail", "credits_detail"],
  ["notes", "notes"],
  ["documentId", "document_id"],
] as const;

situationAdmin.post("/import/tax-returns", async (req, res) => {
  // `salaries` : salaires déclarés par membre, { "<prénom>": montant } (un montant nul retire la ligne).
  const list = z
    .array(z.record(z.string(), z.unknown()).and(z.object({ incomeYear: z.number().int(), salaries: z.record(z.string().min(1).max(80), z.number().nullable()).optional() })))
    .max(60)
    .parse(req.body);
  for (const r of list) {
    // Les prénoms sont vérifiés avant d'écrire quoi que ce soit.
    const salaries = await Promise.all(Object.entries(r.salaries ?? {}).map(async ([name, amount]) => ({ member: await memberIdByName(name), amount })));
    const vals = TAX_COLS.map(([k]) => (r[k] === undefined ? null : r[k]));
    await exec(
      `INSERT INTO tax_returns (income_year, ${TAX_COLS.map(([, c]) => c).join(", ")}) VALUES (?, ${TAX_COLS.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${TAX_COLS.map(([, c]) => `${c} = VALUES(${c})`).join(", ")}`,
      [r.incomeYear, ...vals],
    );
    for (const { member, amount } of salaries) {
      if (amount == null) await exec("DELETE FROM tax_return_salaries WHERE income_year = ? AND user_id = ?", [r.incomeYear, member]);
      else await exec("INSERT INTO tax_return_salaries (income_year, user_id, amount) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE amount = VALUES(amount)", [r.incomeYear, member, amount]);
    }
  }
  res.json({ imported: list.length });
});

situationAdmin.post("/import/property-taxes", async (req, res) => {
  const list = z
    .array(z.object({ year: z.number().int(), propertyId: z.string().max(32), base: money, contributions: money, teom: money, fees: money, total: money, notes: z.string().max(4000).nullable().optional(), documentId: z.number().int().nullable().optional() }))
    .max(100)
    .parse(req.body);
  for (const t of list)
    await exec(
      `INSERT INTO property_taxes (year, property_id, base, contributions, teom, fees, total, notes, document_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE base = VALUES(base), contributions = VALUES(contributions), teom = VALUES(teom), fees = VALUES(fees), total = VALUES(total),
         notes = VALUES(notes), document_id = VALUES(document_id)`,
      [t.year, t.propertyId, t.base ?? null, t.contributions ?? null, t.teom ?? null, t.fees ?? null, t.total ?? null, t.notes ?? null, t.documentId ?? null],
    );
  res.json({ imported: list.length });
});

situationAdmin.post("/import/retirement", async (req, res) => {
  const b = z
    .object({
      owner: z.string().min(1).max(80),
      simulatedOn: day,
      facts: factList.optional(),
      simulations: z
        .array(
          z.object({
            label: z.string().min(1).max(160),
            age: money,
            quarters: z.number().int().nullable().optional(),
            basePension: money,
            complementary: money,
            grossMonthly: money,
            netMonthly: money,
            adjustment: z.string().max(120).nullable().optional(),
            source: z.string().max(16).default("info-retraite"),
            notes: z.string().max(2000).nullable().optional(),
          }),
        )
        .max(50),
      career: z
        .array(
          z.object({
            period: z.string().min(1).max(60),
            startYear: z.number().int().nullable().optional(),
            endYear: z.number().int().nullable().optional(),
            employer: z.string().max(160).nullable().optional(),
            income: money,
            quarters: z.number().int().nullable().optional(),
            points: money,
            notes: z.string().max(2000).nullable().optional(),
          }),
        )
        .max(80),
    })
    .parse(req.body);
  const owner = await ownerId(b.owner);
  if (!owner) throw new ActionError(404, "Membre inconnu");
  res.json(await saveRetirement(owner, b));
});

situationAdmin.post("/import/projections", async (req, res) => {
  const b = z
    .object({
      owner: z.string().min(1).max(80).nullable().optional(),
      asOf: day.nullable().optional(),
      horizonYear: z.number().int(),
      rows: z.array(z.object({ scenario: z.string().max(16), poche: z.string().min(1).max(60), value: money, hypothesis: z.string().max(2000).nullable().optional() })).max(100),
    })
    .parse(req.body);
  const owner = await ownerId(b.owner);
  await saveProjections(owner, b.horizonYear, b.asOf ?? null, b.rows.map((r) => ({ scenario: r.scenario, poche: r.poche, value: r.value ?? null, hypothesis: r.hypothesis ?? null })));
  res.json({ imported: b.rows.length });
});

situationAdmin.post("/import/crypto-events", async (req, res) => {
  const b = z
    .object({
      owner: z.string().min(1).max(80),
      events: z
        .array(
          z.object({
            sourceRef: z.string().max(191),
            date: day,
            title: z.string().min(1).max(255),
            asset: z.string().max(120).nullable().optional(),
            type: z.string().max(40).nullable().optional(),
            platform: z.string().max(60).nullable().optional(),
            quantity: money,
            value: money,
            // Ancien nom du champ, encore écrit par d'anciens exports : accepté pour ne pas effacer une valeur en silence.
            valueEur: money,
            note: z.string().max(4000).nullable().optional(),
          }),
        )
        .max(1000),
    })
    .parse(req.body);
  const owner = await ownerId(b.owner);
  if (!owner) throw new ActionError(404, "Membre inconnu");
  for (const e of b.events)
    await exec(
      `INSERT INTO crypto_events (owner_user_id, date, title, asset, type, platform, quantity, value, note, source_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE date = VALUES(date), title = VALUES(title), asset = VALUES(asset), type = VALUES(type), platform = VALUES(platform),
         quantity = VALUES(quantity), value = VALUES(value), note = VALUES(note)`,
      [owner, e.date, e.title, e.asset ?? null, e.type ?? null, e.platform ?? null, e.quantity ?? null, e.value ?? e.valueEur ?? null, e.note ?? null, e.sourceRef],
    );
  res.json({ imported: b.events.length });
});

/** Règles marchands reprises de Notion : n'écrase jamais une règle déjà créée dans Pécule. */
situationAdmin.post("/import/notion-rules", async (req, res) => {
  const list = z.array(z.object({ pattern: z.string().min(3).max(255), categoryId: z.string().max(16) })).max(500).parse(req.body);
  let added = 0;
  for (const r of list) {
    const cat = await one("SELECT id FROM categories WHERE id = ?", [r.categoryId]);
    if (!cat) continue;
    const x = await exec("INSERT IGNORE INTO rules (pattern, category_id, priority) VALUES (?, ?, 100)", [r.pattern, r.categoryId]);
    added += x.affectedRows;
  }
  res.json({ received: list.length, added });
});

situationAdmin.post("/payslips/normalize", async (_req, res) => {
  res.json(await normalizePayslips());
});

situationAdmin.get("/payslips/reread", async (_req, res) => {
  res.json({ ids: await payslipsToReread() });
});

/** Lecture d'un bulletin de paie déjà rangé au coffre (privé) : montants dans l'historique des revenus. */
situationAdmin.post("/payslips/:documentId", async (req, res) => {
  res.json({ result: await extractPayslip(z.coerce.number().int().parse(req.params.documentId)) });
});
