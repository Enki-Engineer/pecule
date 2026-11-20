import { z } from "zod";
import { exec, one, q } from "../db.ts";
import { updateAsset } from "../actions.ts";
import { applyFactPlan, entityFacts, saveCommitment } from "../situation.ts";
import { today } from "../region.ts";
import { factText, planFacts } from "../../lib/facts.ts";
import { EDITED_COLUMNS } from "./edition-columns.ts";
import { ToolError, change as changeLine, day, money, field, writeTool, type Tool } from "./registry.ts";
import { t as tr, td, tk, tn } from "../../lib/i18n.ts";

/*
 * Modifications courantes demandées à l'assistant : valeur, bail et faits clés d'un bien, revenus du foyer
 * (salaire, bonus, loyers), nouvel engagement du budget, référentiel des catégories (renommer,
 * déplacer, créer, renommer un poste). Toutes soumises à confirmation et tracées dans le journal.
 */

const own = (alias = "") => `(${alias}owner_user_id IS NULL OR ${alias}owner_user_id = ?)`;
const fmt = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "number" ? money(v) : String(v));
const change = (label: string, before: unknown, after: unknown) => changeLine(label, fmt(before), fmt(after));

/* ---------- Biens immobiliers ---------- */

type PropertyRow = { id: string; owner_user_id: number | null; name: string; asset_id: number | null; rent_monthly: number | null; charges_monthly: number | null; deposit: number | null; lease_kind: string | null; lease_start: string | null; next_rent_revision: string | null; tax_regime: string | null };

/** Un bien n'a pas de notes : ce qu'on veut retenir de lui s'écrit dans ses faits clés, que sa fiche affiche. */
const factInput = z.object({
  key: z.string().trim().min(1).max(60).describe("Identifiant du fait : le fact_key donné par get_property pour un fait existant, un identifiant court sans espace pour un nouveau (« dpe », « assurancePno »)"),
  label: z.string().trim().min(1).max(160).optional().describe("Libellé affiché sur la fiche ; obligatoire pour un nouveau fait, facultatif pour renommer un fait existant"),
  value: z.union([z.string().max(500), z.number()]).nullable().describe("Nouvelle valeur ; null retire le fait de la fiche"),
  unit: z.string().max(24).nullable().optional().describe("Unité (« m² », « par an ») ; sans elle, celle du fait existant est gardée"),
  as_of: day.optional().describe("Date à laquelle la valeur a été relevée (défaut : aujourd'hui)"),
});

const updateProperty = writeTool({
  name: "update_property",
  description:
    "Met à jour un bien immobilier (property_id = id donné par get_property) : valeur estimée (après une estimation ou une simulation ; met à jour le placement lié et le patrimoine), loyer et charges mensuels, dépôt de garantie, type et début du bail, prochaine révision du loyer, régime fiscal, et ses faits clés (facts : ce que la fiche retient du bien — diagnostic, assurance, copropriété, travaux… ; un fait se corrige, s'ajoute ou se retire).",
  input: z.object({
    property_id: z.string().max(40),
    value: z.number().positive().optional().describe("Nouvelle valeur estimée du bien entier (pas la part)"),
    rent_monthly: z.number().min(0).nullable().optional(),
    charges_monthly: z.number().min(0).nullable().optional(),
    deposit: z.number().min(0).nullable().optional(),
    lease_kind: z.string().max(60).nullable().optional(),
    lease_start: day.nullable().optional(),
    next_rent_revision: day.nullable().optional(),
    tax_regime: z.string().max(40).nullable().optional(),
    facts: z.array(factInput).min(1).max(30).optional(),
  }),
  async describe({ userId }, i) {
    const p = await one<PropertyRow>(`SELECT * FROM properties WHERE id = ? AND ${own()}`, [i.property_id, userId]);
    if (!p) throw new ToolError("Bien introuvable");
    const d: string[] = [];
    if (i.value !== undefined) {
      if (!p.asset_id) throw new ToolError("Ce bien n'est relié à aucun placement : sa valeur ne peut pas être modifiée ici");
      const a = await one<{ value: number | null; share: number }>("SELECT value, share FROM assets WHERE id = ?", [p.asset_id]);
      d.push(change(tr("Valeur estimée"), a?.value != null ? Number(a.value) : null, i.value));
      if (a && Number(a.share) < 1) d.push(tr("Votre part ({pct} %) : {montant}", { pct: Math.round(Number(a.share) * 100), montant: money(i.value * Number(a.share)) }));
    }
    if (i.rent_monthly !== undefined) d.push(change(tr("Loyer mensuel"), p.rent_monthly != null ? Number(p.rent_monthly) : null, i.rent_monthly));
    if (i.charges_monthly !== undefined) d.push(change(tr("Charges mensuelles"), p.charges_monthly != null ? Number(p.charges_monthly) : null, i.charges_monthly));
    if (i.deposit !== undefined) d.push(change(tr("Dépôt de garantie"), p.deposit != null ? Number(p.deposit) : null, i.deposit));
    if (i.lease_kind !== undefined) d.push(change(tr("Bail"), p.lease_kind, i.lease_kind));
    if (i.lease_start !== undefined) d.push(change(tr("Début du bail"), p.lease_start, i.lease_start));
    if (i.next_rent_revision !== undefined) d.push(change(tr("Révision du loyer"), p.next_rent_revision, i.next_rent_revision));
    if (i.tax_regime !== undefined) d.push(change(tr("Régime fiscal"), p.tax_regime, i.tax_regime));
    if (i.facts) {
      const plan = planFacts(await entityFacts(userId, "property", p.id), i.facts, today());
      if (plan.unknown.length) throw new ToolError(`Fait clé inconnu : ${plan.unknown.join(", ")} — pour l'ajouter, donne son libellé (label) ; les faits existants et leur fact_key sont dans get_property`);
      for (const f of plan.set) d.push(changeLine(f.label, f.before ?? "—", factText(f.value, f.unit)));
      for (const f of plan.remove) d.push(tr("Fait clé retiré : {nom}", { nom: f.label }));
    }
    if (!d.length) throw new ToolError("Aucune modification demandée");
    return { label: tr("Modifier le bien « {nom} »", { nom: p.name.replace(/^\p{Extended_Pictographic}\s*/u, "") }), details: d };
  },
  async run({ userId }, i) {
    const p = await one<PropertyRow>(`SELECT * FROM properties WHERE id = ? AND ${own()}`, [i.property_id, userId]);
    if (!p) throw new ToolError("Bien introuvable");
    if (i.value !== undefined && p.asset_id) await updateAsset(userId, p.asset_id, { value: i.value });
    const cols = EDITED_COLUMNS.properties.filter((c) => i[c] !== undefined);
    if (cols.length) await exec(`UPDATE properties SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => i[c]), p.id]);
    if (i.facts) {
      const plan = planFacts(await entityFacts(userId, "property", p.id), i.facts, today());
      if (plan.unknown.length) throw new ToolError(`Fait clé inconnu : ${plan.unknown.join(", ")}`);
      // Un fait suit le bien : commun si le bien l'est, privé sinon.
      await applyFactPlan(p.owner_user_id, "property", p.id, plan);
    }
    return "Fait : bien mis à jour (valeur, patrimoine et indicateurs recalculés).";
  },
});

/* ---------- Revenus du foyer ---------- */

type IncomeRow = { id: number; person: string; label: string; kind: string; monthly: number | null; annual_gross: number | null; valid_from: string | null; valid_to: string | null; notes: string | null };

const incomeInput = {
  label: z.string().max(160).optional(),
  monthly: z.number().min(0).nullable().optional().describe("Net mensuel compté dans le budget (null pour un versement annuel comme un bonus)"),
  annual_gross: z.number().min(0).nullable().optional().describe("Brut annuel (bonus, salaire annuel brut)"),
  valid_from: day.nullable().optional(),
  valid_to: day.nullable().optional().describe("Fin (revenu arrêté)"),
  notes: z.string().max(4000).nullable().optional(),
};

const updateIncome = writeTool({
  name: "update_income_source",
  description:
    "Met à jour un revenu du foyer (id = champ id des revenus de get_budget) : salaire net mensuel, brut annuel, bonus de l'année, loyer perçu, coupons… ; intitulé, dates, notes. Le reste à vivre et le budget sont recalculés.",
  input: z.object({ income_id: z.number().int(), ...incomeInput }),
  async describe({ userId }, i) {
    const r = await one<IncomeRow>(`SELECT * FROM income_sources WHERE id = ? AND ${own()}`, [i.income_id, userId]);
    if (!r) throw new ToolError("Revenu introuvable");
    const d: string[] = [];
    if (i.label !== undefined) d.push(change(tr("Intitulé"), r.label, i.label));
    if (i.monthly !== undefined) d.push(change(tr("Mensuel net"), r.monthly != null ? Number(r.monthly) : null, i.monthly));
    if (i.annual_gross !== undefined) d.push(change(tr("Brut annuel"), r.annual_gross != null ? Number(r.annual_gross) : null, i.annual_gross));
    if (i.valid_from !== undefined) d.push(change(tr("Depuis"), r.valid_from, i.valid_from));
    if (i.valid_to !== undefined) d.push(change(tr("Jusqu'au"), r.valid_to, i.valid_to));
    if (i.notes !== undefined) d.push(tr("Notes réécrites"));
    if (!d.length) throw new ToolError("Aucune modification demandée");
    return { label: tr("Modifier le revenu « {nom} » ({personne})", { nom: r.label, personne: r.person }), details: d };
  },
  async run({ userId }, i) {
    const r = await one<IncomeRow>(`SELECT * FROM income_sources WHERE id = ? AND ${own()}`, [i.income_id, userId]);
    if (!r) throw new ToolError("Revenu introuvable");
    const cols = EDITED_COLUMNS.income_sources.filter((k) => i[k] !== undefined);
    if (cols.length) await exec(`UPDATE income_sources SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => i[c]), r.id]);
    return "Fait : revenu mis à jour.";
  },
});

const addIncome = writeTool({
  name: "add_income_source",
  description: "Ajoute un revenu du foyer (nouveau salaire, prime ponctuelle, loyer, pension…).",
  input: z.object({
    person: z.string().min(2).max(16).describe("Prénom du membre concerné, ou « Foyer »"),
    kind: z.enum(["salaire", "bonus", "loyer", "autre"]),
    ...incomeInput,
    label: z.string().min(2).max(160),
    private: z.boolean().optional().describe("Visible seulement par l'utilisateur connecté"),
  }),
  async describe(_ctx, i) {
    return {
      label: tr("Ajouter le revenu « {nom} » ({personne})", { nom: i.label, personne: i.person }),
      details: [i.monthly != null ? field(tr("Mensuel net"), money(i.monthly)) : null, i.annual_gross != null ? field(tr("Brut annuel"), money(i.annual_gross)) : null, i.valid_from ? tr("Depuis le {date}", { date: i.valid_from }) : null].filter(
        (x): x is string => !!x,
      ),
    };
  },
  async run({ userId }, i) {
    const max = await one<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM income_sources");
    await exec(
      "INSERT INTO income_sources (owner_user_id, person, label, kind, monthly, annual_gross, valid_from, valid_to, notes, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [i.private ? userId : null, i.person, i.label, i.kind, i.monthly ?? null, i.annual_gross ?? null, i.valid_from ?? null, i.valid_to ?? null, i.notes ?? null, (max?.m ?? 0) + 1],
    );
    return "Fait : revenu ajouté.";
  },
});

/* ---------- Engagements du budget ---------- */

const addCommitment = writeTool({
  name: "add_commitment",
  description:
    "Ajoute un engagement récurrent au budget (abonnement, assurance, crédit, taxe, garde, budget courant) : intitulé, type, montant mensuel ou annuel, catégorie, fournisseur, dates.",
  input: z.object({
    label: z.string().min(2).max(160),
    type: z.enum(["credit", "assurance", "abonnement", "taxe", "garde", "budget"]),
    group_name: z.string().max(80).nullable().optional().describe("Groupe d'affichage (ex. « Logement », « Abonnements »)"),
    monthly: z.number().min(0).nullable().optional(),
    annual: z.number().min(0).nullable().optional(),
    category_id: z.string().max(16).nullable().optional(),
    provider: z.string().max(120).nullable().optional(),
    property_id: z.string().max(40).nullable().optional(),
    start_date: day.nullable().optional(),
    renewal_date: day.nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
    private: z.boolean().optional(),
  }),
  async describe(_ctx, i) {
    if (i.monthly == null && i.annual == null) throw new ToolError("Indiquer un montant mensuel ou annuel");
    if (i.category_id && !(await one("SELECT id FROM categories WHERE id = ?", [i.category_id]))) throw new ToolError(`Catégorie inconnue : ${i.category_id}`);
    return {
      label: tr("Ajouter l'engagement « {nom} »", { nom: i.label }),
      details: [
        i.monthly != null ? tr("{montant} par mois", { montant: money(i.monthly) }) : tr("{montant} par an", { montant: money(i.annual!) }),
        i.provider ? field(tr("Fournisseur"), i.provider) : null,
        i.group_name ? field(tr("Groupe"), td(i.group_name)) : null,
      ].filter((x): x is string => !!x),
    };
  },
  async run({ userId }, i) {
    await saveCommitment(userId, null, {
      label: i.label,
      type: i.type,
      groupName: i.group_name,
      status: "actif",
      monthly: i.monthly,
      annual: i.annual,
      categoryId: i.category_id,
      provider: i.provider,
      propertyId: i.property_id,
      startDate: i.start_date,
      renewalDate: i.renewal_date,
      notes: i.notes,
      private: i.private,
    });
    return "Fait : engagement ajouté au budget.";
  },
});

/* ---------- Référentiel des catégories ---------- */

type Cat = { id: string; name: string; poste: string | null; kind: string; sort_order: number; description: string | null };
const KINDS = ["depense", "revenu", "epargne", "interne"] as const;
/** Type d'une catégorie dans un texte de confirmation : l'identifiant reste la valeur, on ne traduit qu'à l'affichage. */
const KIND_LABELS: Record<string, string> = { depense: tk("depense"), revenu: tk("revenu"), epargne: tk("epargne"), interne: tk("interne") };
const kindLabel = (kind: string) => tr(KIND_LABELS[kind] ?? kind);

/** Code d'une nouvelle catégorie : suite des codes de son poste (B9-05, A7…) ou nouveau poste (B13). */
async function nextCategoryId(poste: string, kind: string): Promise<string> {
  const all = await q<{ id: string; poste: string | null }>("SELECT id, poste FROM categories");
  const siblings = all.filter((c) => c.poste === poste).map((c) => c.id);
  const ids = new Set(all.map((c) => c.id));
  const sub = siblings.map((x) => /^([A-Z]\d+)-(\d+)$/.exec(x)).filter(Boolean) as RegExpExecArray[];
  if (sub.length && sub.every((m) => m[1] === sub[0][1])) {
    let n = Math.max(...sub.map((m) => Number(m[2]))) + 1;
    while (ids.has(`${sub[0][1]}-${String(n).padStart(2, "0")}`)) n++;
    return `${sub[0][1]}-${String(n).padStart(2, "0")}`;
  }
  const single = siblings.map((x) => /^([A-Z])(\d+)$/.exec(x)).filter(Boolean) as RegExpExecArray[];
  if (single.length === 1 && siblings.length === 1) return `${siblings[0]}-02`;
  const letter = single[0]?.[1] ?? (kind === "revenu" ? "A" : kind === "interne" ? "C" : "B");
  const nums = all.map((c) => new RegExp(`^${letter}(\\d+)`).exec(c.id)).filter(Boolean).map((m) => Number(m![1]));
  let n = (nums.length ? Math.max(...nums) : 0) + 1;
  while (ids.has(`${letter}${n}`)) n++;
  return `${letter}${n}`;
}

const updateCategory = writeTool({
  name: "update_category",
  description:
    "Modifie une catégorie du référentiel (category_id = code) : nouveau nom, poste (groupe) de rattachement, description. Changer le type (depense, revenu, epargne, interne) change les totaux : à ne faire que sur demande explicite.",
  input: z.object({
    category_id: z.string().max(16),
    name: z.string().min(2).max(120).optional(),
    poste: z.string().min(2).max(120).optional(),
    kind: z.enum(KINDS).optional(),
    description: z.string().max(2000).nullable().optional(),
  }),
  async describe(_ctx, i) {
    const c = await one<Cat>("SELECT * FROM categories WHERE id = ?", [i.category_id]);
    if (!c) throw new ToolError(`Catégorie inconnue : ${i.category_id}`);
    const n = await one<{ n: number }>("SELECT COUNT(*) AS n FROM transactions WHERE category_id = ?", [c.id]);
    const d: string[] = [];
    // Le nom actuel se lit dans la langue du membre ; le nouveau nom s'écrit tel qu'il sera enregistré.
    if (i.name !== undefined) d.push(change(tr("Nom"), td(c.name), i.name));
    if (i.poste !== undefined) d.push(change(tr("Poste"), td(c.poste), td(i.poste)));
    if (i.kind !== undefined) d.push(change(tr("Type"), kindLabel(c.kind), kindLabel(i.kind)), tr("Attention : les totaux (dépenses, revenus, épargne) changent pour toutes ses opérations"));
    if (i.description !== undefined) d.push(tr("Description réécrite"));
    if (!d.length) throw new ToolError("Aucune modification demandée");
    d.push(tn("{n} opération dans cette catégorie, classement inchangé", "{n} opérations dans cette catégorie, classement inchangé", n?.n ?? 0));
    return { label: tr("Modifier la catégorie {code} « {nom} »", { code: c.id, nom: td(c.name) }), details: d };
  },
  async run(_ctx, i) {
    const cols = EDITED_COLUMNS.categories.filter((k) => i[k] !== undefined);
    if (cols.length) await exec(`UPDATE categories SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...cols.map((c) => i[c]), i.category_id]);
    return "Fait : catégorie modifiée.";
  },
});

const createCategory = writeTool({
  name: "create_category",
  description:
    "Crée une catégorie dans le référentiel (ex. « Formation » dans Loisirs ou un nouveau poste) : nom, poste, type. Le code est attribué automatiquement à la suite de son poste. Vérifier d'abord qu'une catégorie proche n'existe pas (list_categories).",
  input: z.object({
    name: z.string().min(2).max(120),
    poste: z.string().min(2).max(120),
    kind: z.enum(KINDS),
    description: z.string().max(2000).optional(),
  }),
  async describe(_ctx, i) {
    const dup = await one<{ id: string }>("SELECT id FROM categories WHERE LOWER(name) = LOWER(?)", [i.name]);
    if (dup) throw new ToolError(`Une catégorie « ${i.name} » existe déjà (${dup.id})`);
    const id = await nextCategoryId(i.poste, i.kind);
    const sameKind = await one<{ kind: string }>("SELECT kind FROM categories WHERE poste = ? LIMIT 1", [i.poste]);
    return {
      label: tr("Créer la catégorie « {nom} » ({code})", { nom: i.name, code: id }),
      details: [
        sameKind ? field(tr("Poste"), td(i.poste)) : tr("Poste : {poste} (nouveau poste)", { poste: i.poste }),
        field(tr("Type"), kindLabel(i.kind)),
        ...(sameKind && sameKind.kind !== i.kind ? [tr("Attention : les autres catégories du poste sont de type {type}", { type: kindLabel(sameKind.kind) })] : []),
      ],
    };
  },
  async run(_ctx, i) {
    const id = await nextCategoryId(i.poste, i.kind);
    const max = await one<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM categories WHERE poste = ?", [i.poste]);
    const any = await one<{ m: number | null }>("SELECT MAX(sort_order) AS m FROM categories");
    await exec("INSERT INTO categories (id, name, poste, kind, sort_order, description) VALUES (?, ?, ?, ?, ?, ?)", [
      id,
      i.name,
      i.poste,
      i.kind,
      (max?.m ?? any?.m ?? 0) + 1,
      i.description ?? null,
    ]);
    return `Fait : catégorie ${id} « ${i.name} » créée.`;
  },
});

const renamePoste = writeTool({
  name: "rename_poste",
  description: "Renomme un poste (groupe de catégories, ex. « Divers & Imprévus ») : toutes ses catégories suivent.",
  input: z.object({ from: z.string().min(2).max(120), to: z.string().min(2).max(120) }),
  async describe(_ctx, i) {
    const cats = await q<{ id: string; name: string }>("SELECT id, name FROM categories WHERE poste = ?", [i.from]);
    if (!cats.length) throw new ToolError(`Poste inconnu : « ${i.from} »`);
    return { label: tr("Renommer le poste « {ancien} » en « {nouveau} »", { ancien: td(i.from), nouveau: i.to }), details: cats.slice(0, 8).map((c) => `${c.id} · ${td(c.name)}`) };
  },
  async run(_ctx, i) {
    const r = await exec("UPDATE categories SET poste = ? WHERE poste = ?", [i.to, i.from]);
    return `Fait : ${r.affectedRows} catégorie(s) rattachée(s) au poste « ${i.to} ».`;
  },
});

export const editionTools: Tool[] = [updateProperty, updateIncome, addIncome, addCommitment, updateCategory, createCategory, renamePoste];
