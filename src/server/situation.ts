import { today } from "./region.ts";
import { exec, one, q } from "./db.ts";
import { ActionError, userAccountsSql } from "./actions.ts";
import { IS_EXPENSE, STAT_SCOPE } from "./stats.ts";
import { summarizeLoan, type ScheduleRow } from "../lib/loans.ts";
import type { FactPlan } from "../lib/facts.ts";
import { documentVisible } from "./documents.ts";
import { nameDebits } from "./debits.ts";
import { tk, t as tr } from "../lib/i18n.ts";
import { JOINT, salaryReturn, type ReturnFigures } from "../lib/taxes.ts";
import { audience, type Scope } from "./sharing.ts";

/*
 * Situation du foyer : biens immobiliers, budget (engagements + revenus), impôts, retraite,
 * projections, mouvements crypto. Les écrans, l'assistant et le serveur MCP lisent ces fonctions.
 * Les indicateurs (reste à vivre, équité, rendement…) sont recalculés ici, jamais saisis.
 */

const visible = (userId: number, alias: string) => `(${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ${Number(userId)})`;
const n = (v: unknown) => (v == null ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/* ---------- Faits clés ---------- */

export async function entityFacts(userId: number, entityType: string, entityId: string) {
  return q<{ fact_key: string; label: string; value: string; unit: string | null; as_of: string | null }>(
    `SELECT f.fact_key, f.label, f.value, f.unit, f.as_of FROM facts f WHERE f.entity_type = ? AND f.entity_id = ? AND ${visible(userId, "f")} ORDER BY f.sort_order, f.id`,
    [entityType, entityId],
  );
}

export async function upsertFacts(ownerUserId: number | null, entityType: string, entityId: string, list: { key: string; label: string; value: string; unit?: string | null; asOf?: string | null }[]) {
  let i = 0;
  for (const f of list)
    await exec(
      `INSERT INTO facts (owner_user_id, entity_type, entity_id, fact_key, label, value, unit, as_of, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), value = VALUES(value), unit = VALUES(unit), as_of = VALUES(as_of), sort_order = VALUES(sort_order), owner_user_id = VALUES(owner_user_id)`,
      [ownerUserId, entityType, entityId, f.key.slice(0, 60), f.label.slice(0, 160), String(f.value).slice(0, 500), f.unit ?? null, f.asOf ?? null, i++],
    );
}

/**
 * Écrit les faits clés d'une entité un à un (voir `planFacts`, src/lib/facts.ts) : un fait connu garde sa place dans
 * la fiche, un fait nouveau va à la fin. À la différence de `upsertFacts`, qui réécrit une fiche entière dans l'ordre donné.
 */
export async function applyFactPlan(ownerUserId: number | null, entityType: string, entityId: string, plan: FactPlan) {
  for (const f of plan.remove) await exec("DELETE FROM facts WHERE entity_type = ? AND entity_id = ? AND fact_key = ?", [entityType, entityId, f.key]);
  if (!plan.set.length) return;
  const last = await one<{ n: number | null }>("SELECT MAX(sort_order) AS n FROM facts WHERE entity_type = ? AND entity_id = ?", [entityType, entityId]);
  let next = (last?.n ?? -1) + 1;
  for (const f of plan.set)
    await exec(
      `INSERT INTO facts (owner_user_id, entity_type, entity_id, fact_key, label, value, unit, as_of, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), value = VALUES(value), unit = VALUES(unit), as_of = VALUES(as_of)`,
      [ownerUserId, entityType, entityId, f.key.slice(0, 60), f.label.slice(0, 160), f.value.slice(0, 500), f.unit, f.as_of, f.before === null ? next++ : 0],
    );
}

/* ---------- Biens immobiliers ---------- */

type PropertyRow = {
  id: string;
  owner_user_id: number | null;
  name: string;
  kind: string;
  city: string | null;
  surface: number | null;
  rooms: number | null;
  acquisition_date: string | null;
  acquisition_price: number | null;
  acquisition_costs: number | null;
  rent_monthly: number | null;
  charges_monthly: number | null;
  deposit: number | null;
  lease_kind: string | null;
  lease_start: string | null;
  next_rent_revision: string | null;
  tax_regime: string | null;
  asset_id: number | null;
  loan_ids: string | null;
};

async function loanSummaries(userId: number, ids: string[]) {
  const out = [];
  for (const id of ids) {
    // Crédits communs ou à ce membre : le crédit privé d'un autre, rattaché à un bien commun, ne lui est pas montré.
    const loan = await one<{ id: string; name: string; principal: number; disbursed: number | null; share: number; end_date: string; rate: number }>(
      "SELECT id, name, principal, disbursed, share, end_date, rate FROM loans WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)",
      [id, userId],
    );
    if (!loan) continue;
    const schedule = await q<ScheduleRow>(
      "SELECT rang, date, payment, principal, interest, insurance, deferred_interest, remaining FROM loan_schedule WHERE loan_id = ? ORDER BY rang",
      [id],
    );
    const s = summarizeLoan(schedule, Number(loan.disbursed ?? loan.principal), today());
    out.push({ id: loan.id, name: loan.name, rate: n(loan.rate), endDate: loan.end_date, remaining: s.remaining, monthly: s.currentMonthly, progress: s.progress });
  }
  return out;
}

/** Indicateurs d'un bien : valeur (placement lié), capital restant dû, équité, rendement brut (locatif). */
async function propertyFigures(userId: number, p: PropertyRow) {
  // Placement commun ou à ce membre : la valeur du placement privé d'un autre, rattaché à un bien commun, ne lui est pas montrée.
  const asset = p.asset_id ? await one<{ value: number | null; share: number; value_date: string | null }>("SELECT value, share, value_date FROM assets WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [p.asset_id, userId]) : undefined;
  const loans = await loanSummaries(userId, (p.loan_ids ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const value = n(asset?.value);
  const debt = r2(loans.reduce((s, l) => s + l.remaining, 0));
  const monthlyLoans = r2(loans.reduce((s, l) => s + (l.monthly ?? 0), 0));
  // Coût d'acquisition = prix + frais (notaire, agence, garantie).
  const cost = p.acquisition_price != null ? Number(p.acquisition_price) + (n(p.acquisition_costs) ?? 0) : null;
  const rent = n(p.rent_monthly);
  return {
    value,
    valueDate: asset?.value_date ?? null,
    share: asset ? Number(asset.share) : 1,
    debt,
    equity: value == null ? null : r2(value - debt),
    monthlyLoans,
    acquisitionTotal: cost,
    grossYield: rent && cost ? r2(((rent * 12) / cost) * 100) : null,
    monthlyCashflow: rent != null ? r2(rent - monthlyLoans - (n(p.charges_monthly) ?? 0)) : null,
    loans,
  };
}

export async function listProperties(userId: number) {
  const rows = await q<PropertyRow>(`SELECT p.* FROM properties p WHERE ${visible(userId, "p")} ORDER BY p.sort_order, p.name`);
  return Promise.all(rows.map(async (p) => ({ ...p, figures: await propertyFigures(userId, p) })));
}

export async function propertyDetail(userId: number, id: string) {
  const p = await one<PropertyRow>(`SELECT p.* FROM properties p WHERE p.id = ? AND ${visible(userId, "p")}`, [id]);
  if (!p) return null;
  const [figures, facts, documents, taxes, commitments, tasks] = await Promise.all([
    propertyFigures(userId, p),
    entityFacts(userId, "property", id),
    q(
      `SELECT d.id, d.title, d.kind, d.doc_date, d.expires_at, d.file_mime FROM documents d WHERE d.entity_type = 'property' AND d.entity_id = ? AND ${documentVisible(userId)}
       ORDER BY d.kind = 'fiche' DESC, d.doc_date DESC`,
      [id],
    ),
    q("SELECT year, total, teom, notes FROM property_taxes WHERE property_id = ? ORDER BY year DESC", [id]),
    q(`SELECT c.id, c.label, c.type, c.status, c.monthly, c.annual FROM commitments c WHERE c.property_id = ? AND ${visible(userId, "c")} ORDER BY c.status, c.sort_order`, [id]),
    q(
      `SELECT a.id, a.kind, a.title, a.due_date, a.status FROM agenda_items a WHERE a.entity_type = 'property' AND a.entity_id = ? AND ${visible(userId, "a")}
       ORDER BY a.status, a.due_date IS NULL, a.due_date`,
      [id],
    ),
  ]);
  return { property: p, figures, facts, documents, taxes, commitments, tasks };
}

export async function updateProperty(userId: number, id: string, b: Partial<Record<"rent_monthly" | "charges_monthly" | "deposit" | "next_rent_revision" | "lease_start" | "tax_regime", unknown>>) {
  const p = await one(`SELECT p.id FROM properties p WHERE p.id = ? AND ${visible(userId, "p")}`, [id]);
  if (!p) throw new ActionError(404, tr("Bien introuvable"));
  const sets = Object.entries(b).filter(([, v]) => v !== undefined);
  if (sets.length) await exec(`UPDATE properties SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...sets.map(([, v]) => v), id]);
}

/* ---------- Budget ---------- */

export type CommitmentRow = {
  id: number;
  owner_user_id: number | null;
  label: string;
  group_name: string | null;
  type: string;
  status: string;
  monthly: number | null;
  annual: number | null;
  category_id: string | null;
  match_pattern: string | null;
  label_regex: string | null;
  property_id: string | null;
  provider: string | null;
  start_date: string | null;
  end_date: string | null;
  renewal_date: string | null;
  notice_days: number | null;
  notes: string | null;
};

/** Montant mensuel d'un engagement : le mensuel saisi, sinon l'annuel / 12. */
export const monthlyOf = (c: { monthly: number | null; annual: number | null }) => (c.monthly != null ? Number(c.monthly) : c.annual != null ? Number(c.annual) / 12 : 0);
const COUNTED = new Set(["actif", "a_verifier", "a_completer"]);

/**
 * Budget du foyer : engagements récurrents (frais fixes, contrats, abonnements) et revenus,
 * reste à vivre recalculé, dépenses réelles des 3 derniers mois complets par poste pour comparer,
 * et dernier prélèvement retrouvé pour chaque engagement qui a un motif de libellé.
 */
export async function budget(userId: number) {
  const commitments = await q<CommitmentRow>(`SELECT c.* FROM commitments c WHERE ${visible(userId, "c")} ORDER BY c.sort_order, c.group_name, c.label`);
  const income = await q<{ id: number; person: string; label: string; kind: string; monthly: number | null; annual_gross: number | null; notes: string | null; valid_to: string | null }>(
    `SELECT i.id, i.person, i.label, i.kind, i.monthly, i.annual_gross, i.notes, i.valid_to FROM income_sources i WHERE ${visible(userId, "i")}
     AND (i.valid_to IS NULL OR i.valid_to >= CURDATE()) ORDER BY i.sort_order, i.id`,
  );
  const A = userAccountsSql(userId);
  // Dernier débit correspondant au motif de chaque engagement actif (90 derniers jours).
  const seen = new Map<number, { date: string; amount: number }>();
  for (const c of commitments.filter((c) => (c.match_pattern || c.label_regex) && COUNTED.has(c.status))) {
    // Prélèvement nommé d'après l'engagement (motif sur le libellé brut), sinon motif sur la clé de libellé.
    const t = await one<{ date: string; amount: number }>(
      c.label_regex
        ? `SELECT t.date, t.amount FROM transactions t JOIN ${A} a ON a.id = t.account_id
           WHERE t.status IN ('posted', 'pending') AND t.amount < 0 AND t.merchant = ? AND t.date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           ORDER BY t.date DESC LIMIT 1`
        : `SELECT t.date, t.amount FROM transactions t JOIN ${A} a ON a.id = t.account_id
           WHERE t.status IN ('posted', 'pending') AND t.amount < 0 AND t.label_key LIKE ? AND t.date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
           ORDER BY t.date DESC LIMIT 1`,
      [c.label_regex ? c.label : `%${c.match_pattern}%`],
    );
    if (t) seen.set(c.id, { date: t.date, amount: Number(t.amount) });
  }
  // Dépenses réelles : moyenne mensuelle des 3 derniers mois complets, par poste.
  const actual = await q<{ poste: string | null; total: number }>(
    `SELECT c.poste, ROUND(-SUM(t.amount) / 3, 2) AS total FROM tx_lines t JOIN ${A} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND ${IS_EXPENSE} AND t.date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 3 MONTH) AND t.date < DATE_FORMAT(CURDATE(), '%Y-%m-01')
     GROUP BY c.poste ORDER BY total DESC`,
  );
  const counted = commitments.filter((c) => COUNTED.has(c.status));
  const fixedMonthly = r2(counted.reduce((s, c) => s + monthlyOf(c), 0));
  const incomeMonthly = r2(income.reduce((s, i) => s + (i.monthly != null ? Number(i.monthly) : 0), 0));
  const actualMonthly = r2(actual.reduce((s, a) => s + Number(a.total), 0));
  return {
    commitments: commitments.map((c) => ({ ...c, monthly_equiv: r2(monthlyOf(c)), last_seen: seen.get(c.id) ?? null })),
    income,
    actualByPoste: actual.map((a) => ({ poste: a.poste ?? tk("À classer"), monthly: Number(a.total) })),
    totals: {
      fixedMonthly,
      incomeMonthly,
      remainingAfterFixed: r2(incomeMonthly - fixedMonthly),
      actualMonthly,
      remainingAfterActual: r2(incomeMonthly - actualMonthly),
    },
  };
}

export type CommitmentPatch = Partial<{
  label: string;
  groupName: string | null;
  type: string;
  status: string;
  monthly: number | null;
  annual: number | null;
  categoryId: string | null;
  matchPattern: string | null;
  labelRegex: string | null;
  propertyId: string | null;
  provider: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  noticeDays: number | null;
  notes: string | null;
  private: boolean;
}>;

const COMMITMENT_COLS: Record<string, string> = {
  label: "label",
  groupName: "group_name",
  type: "type",
  status: "status",
  monthly: "monthly",
  annual: "annual",
  categoryId: "category_id",
  matchPattern: "match_pattern",
  labelRegex: "label_regex",
  propertyId: "property_id",
  provider: "provider",
  startDate: "start_date",
  endDate: "end_date",
  renewalDate: "renewal_date",
  noticeDays: "notice_days",
  notes: "notes",
};

export async function visibleCommitment(userId: number, id: number) {
  const c = await one<CommitmentRow>(`SELECT c.* FROM commitments c WHERE c.id = ? AND ${visible(userId, "c")}`, [id]);
  if (!c) throw new ActionError(404, tr("Engagement introuvable"));
  return c;
}

export async function saveCommitment(userId: number, id: number | null, b: CommitmentPatch & { source?: string; sourceRef?: string | null }) {
  const cols = Object.entries(COMMITMENT_COLS)
    .filter(([k]) => (b as Record<string, unknown>)[k] !== undefined)
    .map(([k, col]) => [col, (b as Record<string, unknown>)[k]] as const);
  if (b.private !== undefined) cols.push(["owner_user_id", b.private ? userId : null] as const);
  // Le motif est exécuté par la base, dont les expressions ne sont pas celles de JavaScript : il lui est soumis avant
  // d'être écrit (un motif qu'elle refuse ferait échouer chaque enregistrement suivant).
  if (b.labelRegex) {
    const accepted = await one("SELECT '' REGEXP ? AS ok", [b.labelRegex]).then(
      () => true,
      () => false,
    );
    if (!accepted) throw new ActionError(400, tr("Ce motif de libellé n'est pas une expression valide."));
  }
  if (id == null) {
    if (!b.label) throw new ActionError(400, tr("Intitulé requis"));
    const all = [...cols, ["source", b.source ?? "manuel"] as const, ["source_ref", b.sourceRef ?? null] as const];
    const r = await exec(
      `INSERT INTO commitments (${all.map(([c]) => c).join(", ")}) VALUES (${all.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${cols.map(([c]) => `${c} = VALUES(${c})`).join(", ")}`,
      all.map(([, v]) => v),
    );
    return r.insertId;
  }
  await visibleCommitment(userId, id);
  if (cols.length) await exec(`UPDATE commitments SET ${cols.map(([c]) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map(([, v]) => v), id]);
  // Nouveau motif de libellé ou nouveau nom : les prélèvements concernés sont renommés.
  if (b.labelRegex !== undefined || b.label !== undefined) await nameDebits();
  return id;
}

export async function deleteCommitment(userId: number, id: number) {
  await visibleCommitment(userId, id);
  await exec("DELETE FROM commitments WHERE id = ?", [id]);
}

/* ---------- Impôts ---------- */

export type TaxReturnRow = ReturnFigures & {
  notice_year: number | null;
  parts: number | null;
  situation: string | null;
  other_income: number | null;
  decote: number | null;
  credits: number | null;
  credits_detail: string | null;
  notes: string | null;
  document_id: number | null;
};

/**
 * Impôts lus par un membre. Vue « foyer » : la déclaration commune de chaque année, ses déclarations personnelles
 * et celles des membres qui partagent leurs revenus (src/server/sharing.ts). Vue « moi » : la commune et les
 * siennes. Les taxes foncières et les documents ne dépendent pas du périmètre.
 */
export async function taxes(userId: number, scope: Scope = "foyer") {
  const who = await audience(userId, scope);
  const owners = [JOINT, ...who.shown.map((m) => m.id)];
  const [rows, keys, salaries, propertyTaxes, documents] = await Promise.all([
    // L'avis n'est donné à ouvrir que si le membre peut le lire au coffre.
    q<TaxReturnRow & { doc_visible: number }>(
      `SELECT r.*, (d.id IS NOT NULL AND ${documentVisible(userId)}) AS doc_visible FROM tax_returns r LEFT JOIN documents d ON d.id = r.document_id
       WHERE r.owner_user_id IN (${owners.map(() => "?").join(", ")}) ORDER BY r.income_year DESC, r.owner_user_id`,
      owners,
    ),
    // Toutes les déclarations, même celles qu'il ne voit pas : elles disent sur laquelle figure le salaire d'un membre.
    q<{ income_year: number; owner_user_id: number }>("SELECT income_year, owner_user_id FROM tax_returns"),
    q<{ income_year: number; user_id: number; name: string; amount: number }>(
      "SELECT s.income_year, s.user_id, u.name, s.amount FROM tax_return_salaries s JOIN users u ON u.id = s.user_id ORDER BY s.user_id",
    ),
    q(
      `SELECT t.year, t.property_id, p.name AS property_name, t.base, t.contributions, t.teom, t.fees, t.total, t.notes, t.document_id
       FROM property_taxes t JOIN properties p ON p.id = t.property_id WHERE p.owner_user_id IS NULL OR p.owner_user_id = ? ORDER BY t.year DESC, t.property_id`,
      [userId],
    ),
    q(
      `SELECT d.id, d.title, d.kind, d.doc_date FROM documents d WHERE d.domain = 'impots' AND ${documentVisible(userId)} ORDER BY d.kind = 'fiche' DESC, d.doc_date DESC LIMIT 60`,
    ),
  ]);
  const ownersOf = (year: number) => keys.filter((k) => k.income_year === year).map((k) => k.owner_user_id);
  const returns = rows.map(({ doc_visible, ...r }) => {
    const owner = r.owner_user_id === JOINT ? null : (who.shown.find((m) => m.id === r.owner_user_id) ?? null);
    return {
      ...r,
      document_id: doc_visible ? r.document_id : null,
      /** Déclarant : null pour la déclaration commune du foyer. */
      owner: owner && { id: owner.id, name: owner.name },
      /** Le membre peut dire si c'est la déclaration commune ou la sienne. */
      editable: who.several && (r.owner_user_id === JOINT || r.owner_user_id === userId),
      // Salaires déclarés sur cette déclaration, dans l'ordre des membres.
      salaries: salaries.filter((s) => s.income_year === r.income_year && salaryReturn(s.user_id, ownersOf(r.income_year)) === r.owner_user_id).map(({ user_id, name, amount }) => ({ user_id, name, amount })),
    };
  });
  return { scope, several: who.several, sharing: who.sharing, withheld: scope === "foyer" ? who.withheld.map((m) => m.name) : [], returns, propertyTaxes, documents };
}

/**
 * Dit d'une déclaration qu'elle est celle du membre (`personal`) ou celle du foyer. Refusé si la place est prise
 * (une déclaration commune et une par membre au plus par année), ou si la déclaration porte le salaire d'un autre
 * membre : c'est alors une imposition commune.
 */
export async function setReturnOwner(userId: number, incomeYear: number, personal: boolean) {
  const [from, to] = personal ? [JOINT, userId] : [userId, JOINT];
  if (!(await one("SELECT 1 FROM tax_returns WHERE income_year = ? AND owner_user_id = ?", [incomeYear, from]))) throw new ActionError(404, tr("Déclaration introuvable"));
  if (await one("SELECT 1 FROM tax_returns WHERE income_year = ? AND owner_user_id = ?", [incomeYear, to]))
    throw new ActionError(409, personal ? tr("Tu as déjà une déclaration personnelle pour les revenus {annee}.", { annee: incomeYear }) : tr("Le foyer a déjà une déclaration commune pour les revenus {annee}.", { annee: incomeYear }));
  if (personal) {
    const owners = (await q<{ owner_user_id: number }>("SELECT owner_user_id FROM tax_returns WHERE income_year = ?", [incomeYear])).map((r) => r.owner_user_id);
    const others = (await q<{ user_id: number; name: string }>("SELECT s.user_id, u.name FROM tax_return_salaries s JOIN users u ON u.id = s.user_id WHERE s.income_year = ? AND s.user_id <> ? ORDER BY s.user_id", [incomeYear, userId])).filter(
      (s) => salaryReturn(s.user_id, owners) === JOINT,
    );
    if (others.length) throw new ActionError(409, tr("Cette déclaration porte aussi les salaires de {noms} : c'est une déclaration commune.", { noms: others.map((o) => o.name).join(", ") }));
  }
  await exec("UPDATE tax_returns SET owner_user_id = ? WHERE income_year = ? AND owner_user_id = ?", [to, incomeYear, from]);
}

/* ---------- Retraite ---------- */

export async function retirement(userId: number) {
  const [simulations, career, facts, documents] = await Promise.all([
    q("SELECT * FROM retirement_simulations WHERE owner_user_id = ? ORDER BY simulated_on DESC, age", [userId]),
    q("SELECT * FROM career_periods WHERE owner_user_id = ? ORDER BY start_year, id", [userId]),
    entityFacts(userId, "retirement", String(userId)),
    q(`SELECT d.id, d.title, d.kind, d.doc_date FROM documents d WHERE d.domain = 'retraite' AND ${documentVisible(userId)} ORDER BY d.kind = 'fiche' DESC, d.doc_date DESC`),
  ]);
  return { simulations, career, facts, documents };
}

/* ---------- Projections ---------- */

export async function projectionsFor(userId: number) {
  const rows = await q<{ scenario: string; horizon_year: number; poche: string; value: number | null; hypothesis: string | null; as_of: string | null }>(
    `SELECT p.scenario, p.horizon_year, p.poche, p.value, p.hypothesis, p.as_of FROM projections p WHERE ${visible(userId, "p")} ORDER BY p.horizon_year, p.poche, FIELD(p.scenario, 'prudent', 'central', 'favorable')`,
  );
  const totals: Record<string, number> = {};
  for (const r of rows) totals[r.scenario] = r2((totals[r.scenario] ?? 0) + Number(r.value ?? 0));
  const documents = await q(`SELECT d.id, d.title FROM documents d WHERE d.entity_type = 'projections' AND ${documentVisible(userId)}`);
  return { rows, totals, documents };
}

export type ProjectionRow = { scenario: string; poche: string; value: number | null; /** undefined = garder l'hypothèse en place */ hypothesis?: string | null };

/**
 * Enregistre des lignes de projection d'un membre (null = poche commune). Une ligne par membre, scénario, horizon et poche :
 * recherche explicite, car l'index unique ne dédoublonne pas les lignes communes (membre NULL), et une poche du même nom
 * chez un autre membre ne doit jamais être écrasée.
 */
export async function saveProjections(ownerUserId: number | null, horizonYear: number, asOf: string | null, rows: ProjectionRow[]) {
  for (const r of rows) {
    const existing = await one<{ id: number }>("SELECT id FROM projections WHERE owner_user_id <=> ? AND scenario = ? AND horizon_year = ? AND poche = ?", [ownerUserId, r.scenario, horizonYear, r.poche]);
    if (!existing)
      await exec("INSERT INTO projections (owner_user_id, scenario, horizon_year, poche, value, hypothesis, as_of) VALUES (?, ?, ?, ?, ?, ?, ?)", [ownerUserId, r.scenario, horizonYear, r.poche, r.value, r.hypothesis ?? null, asOf]);
    else if (r.hypothesis === undefined) await exec("UPDATE projections SET value = ?, as_of = ? WHERE id = ?", [r.value, asOf, existing.id]);
    else await exec("UPDATE projections SET value = ?, hypothesis = ?, as_of = ? WHERE id = ?", [r.value, r.hypothesis, asOf, existing.id]);
  }
}

/** Lignes d'une poche d'un membre (null = commune) à un horizon donné. */
export const projectionPocket = (ownerUserId: number | null, horizonYear: number, poche: string) =>
  q<{ scenario: string; value: number | null }>("SELECT scenario, value FROM projections WHERE owner_user_id <=> ? AND horizon_year = ? AND poche = ?", [ownerUserId, horizonYear, poche]);

export async function deleteProjectionPocket(ownerUserId: number | null, horizonYear: number, poche: string) {
  return (await exec("DELETE FROM projections WHERE owner_user_id <=> ? AND horizon_year = ? AND poche = ?", [ownerUserId, horizonYear, poche])).affectedRows;
}

/* ---------- Écriture de la retraite ---------- */

export type RetirementInput = {
  simulatedOn: string;
  facts?: { key: string; label: string; value: string; unit?: string | null; asOf?: string | null }[];
  simulations: {
    label: string;
    age?: number | null;
    quarters?: number | null;
    basePension?: number | null;
    complementary?: number | null;
    grossMonthly?: number | null;
    netMonthly?: number | null;
    adjustment?: string | null;
    source?: string;
    notes?: string | null;
  }[];
  career: { period: string; startYear?: number | null; endYear?: number | null; employer?: string | null; income?: number | null; quarters?: number | null; points?: number | null; notes?: string | null }[];
};

/** Retraite d'un membre (privée) : simulations à une date, carrière année par année, faits clés. Rejouable (mêmes clés = mise à jour). */
export async function saveRetirement(ownerUserId: number, b: RetirementInput) {
  for (const s of b.simulations)
    await exec(
      `INSERT INTO retirement_simulations (owner_user_id, simulated_on, label, age, quarters, base_pension, complementary, gross_monthly, net_monthly, adjustment, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE age = VALUES(age), quarters = VALUES(quarters), base_pension = VALUES(base_pension), complementary = VALUES(complementary),
         gross_monthly = VALUES(gross_monthly), net_monthly = VALUES(net_monthly), adjustment = VALUES(adjustment), source = VALUES(source), notes = VALUES(notes)`,
      [ownerUserId, b.simulatedOn, s.label, s.age ?? null, s.quarters ?? null, s.basePension ?? null, s.complementary ?? null, s.grossMonthly ?? null, s.netMonthly ?? null, s.adjustment ?? null, s.source ?? "info-retraite", s.notes ?? null],
    );
  for (const c of b.career)
    await exec(
      `INSERT INTO career_periods (owner_user_id, period, start_year, end_year, employer, income, quarters, points, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE start_year = VALUES(start_year), end_year = VALUES(end_year), employer = VALUES(employer), income = VALUES(income),
         quarters = VALUES(quarters), points = VALUES(points), notes = VALUES(notes)`,
      [ownerUserId, c.period, c.startYear ?? null, c.endYear ?? null, c.employer ?? null, c.income ?? null, c.quarters ?? null, c.points ?? null, c.notes ?? null],
    );
  if (b.facts?.length) await upsertFacts(ownerUserId, "retirement", String(ownerUserId), b.facts.map((f) => ({ ...f, asOf: f.asOf ?? b.simulatedOn })));
  return { simulations: b.simulations.length, career: b.career.length };
}

/* ---------- Mouvements crypto ---------- */

export async function cryptoEvents(userId: number, limit = 200) {
  return q("SELECT id, date, title, asset, type, platform, quantity, value, note FROM crypto_events WHERE owner_user_id = ? ORDER BY date DESC, id DESC LIMIT ?", [userId, limit]);
}
