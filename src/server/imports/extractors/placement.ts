import { z } from "zod";
import { ActionError } from "../../actions.ts";
import { one, q } from "../../db.ts";
import { snapshotWealth } from "../../wealth.ts";
import { near } from "../../../lib/imports.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { day, diffs, money, num, str, type Extractor } from "../registry.ts";

/*
 * Relevé de placement (PEA, assurance vie, plan d'épargne, livret) → valeur du placement à la date du relevé
 * (`assets`, écran Patrimoine). Contrat d'assurance ou d'abonnement → engagement récurrent (`commitments`, écran Budget).
 */

const NEW = "__nouveau__";
const slug = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------- Relevé de placement ---------- */

const placementParse = z.object({
  is_investment_statement: z.boolean(),
  asset_id: z.string().nullable(),
  name: z.string().nullable(),
  institution: z.string().nullable(),
  category: z.enum(["epargne", "placement"]),
  value_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  value: z.number().nullable(),
  invested: z.number().nullable(),
  /** Cumul des versements et cumul des rachats, quand le relevé les écrit séparément (assurance vie). */
  paid_in: z.number().nullable().optional(),
  withdrawn: z.number().nullable().optional(),
  cash: z.number().nullable(),
  private: z.enum(["oui", "non"]),
});
type Placement = z.infer<typeof placementParse>;
/** Versements nets : ceux du relevé, sinon versé − racheté quand il ne donne que ces deux cumuls. */
const netInvested = (d: Placement): number | null => d.invested ?? (d.paid_in != null ? Math.round((d.paid_in - Math.abs(d.withdrawn ?? 0)) * 100) / 100 : null);

type Asset = { id: number; name: string; institution: string | null; value: number | null; value_date: string | null; invested: number | null; cash: number | null };
const assets = (userId: number) => q<Asset>("SELECT id, name, institution, value, DATE_FORMAT(value_date, '%Y-%m-%d') AS value_date, invested, cash FROM assets WHERE closed = 0 AND category IN ('epargne', 'placement') AND (owner_user_id IS NULL OR owner_user_id = ?) ORDER BY sort_order, id", [userId]);
const chosen = async (d: Placement, userId: number) => (d.asset_id && d.asset_id !== NEW ? (await assets(userId)).find((a) => String(a.id) === d.asset_id) ?? null : null);

export const placement: Extractor<Placement> = {
  id: "placement",
  label: tk("Relevé de placement"),
  matches: (c) => c.kind === "releve" && (c.domain === "patrimoine" || c.domain === "crypto"),
  instructions:
    "Document attendu : un relevé de situation d'un placement ou d'une épargne (PEA, compte-titres, assurance vie, plan d'épargne retraite ou salariale, livret). « value » : valeur totale du placement à la date du relevé (titres et espèces compris) ; « cash » : la part en espèces si elle est indiquée ; « invested » : total des versements nets depuis l'ouverture s'il est indiqué (ne le calcule pas). « paid_in » et « withdrawn » : cumul des versements bruts et cumul des rachats ou retraits depuis l'ouverture, quand le relevé les écrit séparément (sinon null). « category » : « epargne » pour un livret ou un compte sur livret, « placement » sinon. « asset_id » : le placement de Pécule correspondant, choisi dans la liste fournie (même établissement, même type), sinon null. « name » : un nom court (« PEA », « Assurance vie », « Livret A »). « private » : « oui » si le relevé est au nom d'une seule personne, « non » s'il est au nom de plusieurs. « is_investment_statement » est faux pour un relevé de compte courant, un avis d'opéré ou tout autre document.",
  schema: {
    properties: {
      is_investment_statement: { type: "boolean" },
      asset_id: str("Identifiant du placement dans la liste fournie, sinon null"),
      name: str("Nom court du placement"),
      institution: str("Établissement, nom usuel"),
      category: { type: "string", enum: ["epargne", "placement"] },
      value_date: day("Date de valorisation"),
      value: num("Valeur totale à cette date"),
      invested: num("Total des versements nets, si indiqué"),
      paid_in: num("Cumul des versements bruts depuis l'ouverture, si indiqué"),
      withdrawn: num("Cumul des rachats ou retraits depuis l'ouverture (positif), si indiqué"),
      cash: num("Solde espèces, si indiqué"),
      private: { type: "string", enum: ["oui", "non"] },
    },
    required: ["is_investment_statement", "asset_id", "name", "institution", "category", "value_date", "value", "invested", "paid_in", "withdrawn", "cash", "private"],
  },
  parse: placementParse,
  context: async (ctx) => `Placements de Pécule : ${(await assets(ctx.userId)).map((a) => `${a.id} = ${a.name}${a.institution ? ` (${a.institution})` : ""}`).join(" ; ") || "aucun"}.`,
  rejected: (d) => !d.is_investment_statement,
  title: (d) => t("Relevé {placement} — {valeur}", { placement: [d.name, d.institution].filter(Boolean).join(" · "), valeur: money(d.value) }),
  async fields(d, ctx) {
    const list = await assets(ctx.userId);
    return [
      { key: "asset_id", label: tk("Placement"), type: "choix", value: list.some((a) => String(a.id) === d.asset_id) || d.asset_id === NEW ? d.asset_id : null, options: [{ value: NEW, label: tk("Nouveau placement") }, ...list.map((a) => ({ value: String(a.id), label: a.name }))], required: true },
      { key: "name", label: tk("Nom du placement"), type: "texte", value: d.name },
      { key: "institution", label: tk("Établissement"), type: "texte", value: d.institution },
      { key: "private", label: tk("À toi seul"), type: "choix", value: d.private, options: [{ value: "oui", label: tk("Oui") }, { value: "non", label: tk("Non, commun au foyer") }] },
      { key: "value_date", label: tk("Date de valorisation"), type: "date", value: d.value_date, required: true },
      { key: "value", label: tk("Valeur"), type: "montant", value: d.value, required: true },
      { key: "invested", label: tk("Versements nets"), type: "montant", value: netInvested(d) },
      { key: "cash", label: tk("Espèces"), type: "montant", value: d.cash },
    ];
  },
  checks(d) {
    const out = [
      { ok: d.value != null && d.value >= 0, label: t("Valeur lue") },
      { ok: !!d.value_date && d.value_date <= new Date().toISOString().slice(0, 10), label: t("Date de valorisation lue, pas dans le futur") },
      // Jamais de placement créé sans qu'on l'ait demandé : un placement existant, ou « Nouveau placement » choisi exprès.
      { ok: !!d.asset_id, label: t("Rattachement choisi : un élément existant, ou « nouveau » demandé exprès") },
    ];
    if (d.cash != null && d.value != null) out.push({ ok: d.cash <= d.value + 0.01, label: t("Espèces au plus égales à la valeur totale") });
    // Le relevé ne donne que le versé et le racheté : les versements nets en sont la différence, montrée pour être relue.
    if (d.invested == null && d.paid_in != null) out.push({ ok: netInvested(d)! >= 0, label: t("Versements nets = versé − racheté ({a} − {b} = {c})", { a: money(d.paid_in), b: money(Math.abs(d.withdrawn ?? 0)), c: money(netInvested(d)) }) });
    return out;
  },
  async existing(d, ctx) {
    const a = await chosen(d, ctx.userId);
    if (!a) return null;
    // Un relevé plus ancien que la valeur enregistrée ne doit pas la remplacer : il est signalé comme un écart.
    if (a.value_date && d.value_date && d.value_date < a.value_date)
      return { summary: t("« {nom} » a déjà une valeur plus récente (au {date}).", { nom: a.name, date: a.value_date.split("-").reverse().join("/") }), diffs: [{ label: t("Date de valorisation"), before: a.value_date, after: d.value_date }] };
    if (a.value != null && near(Number(a.value), d.value, 0.01) && a.value_date === d.value_date) return { summary: t("« {nom} » porte déjà cette valeur.", { nom: a.name }), diffs: [] };
    return { summary: t("« {nom} » passe de {avant} à {apres}.", { nom: a.name, avant: money(a.value == null ? null : Number(a.value)), apres: money(d.value) }), diffs: diffs(a, { invested: netInvested(d) }, { invested: tk("Versements nets") }) };
  },
  async apply(d, ctx, track) {
    if (d.value == null || !d.value_date) throw new ActionError(400, t("Il manque la valeur ou sa date."));
    const a = await chosen(d, ctx.userId);
    let id = a?.id;
    if (!id) {
      const name = d.name?.trim() || d.institution?.trim();
      if (!name) throw new ActionError(400, t("Donne un nom au nouveau placement."));
      const owner = d.private === "oui" ? ctx.userId : null;
      if (await one("SELECT id FROM assets WHERE owner_user_id <=> ? AND name = ?", [owner, name])) throw new ActionError(400, t("Un placement porte déjà ce nom : choisis-le dans la liste."));
      await track.upsert("assets", { owner_user_id: owner, name: name.slice(0, 160) }, { category: d.category, institution: d.institution?.slice(0, 255) ?? null, valuation: "manuel", sort_order: Number((await one<{ n: number }>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM assets"))?.n ?? 1) });
      id = (await one<{ id: number }>("SELECT id FROM assets WHERE owner_user_id <=> ? AND name = ?", [owner, name.slice(0, 160)]))!.id;
    } else if (a?.value_date && d.value_date < a.value_date) throw new ActionError(400, t("Ce relevé est plus ancien que la valeur enregistrée : il reste au coffre, sans changer le patrimoine."));
    await track.upsert("assets", { id }, { value: d.value, value_date: d.value_date, invested: netInvested(d), cash: d.cash });
    if (ctx.documentId) await track.upsert("documents", { id: ctx.documentId }, { entity_type: "asset", entity_id: String(id) });
    await snapshotWealth(ctx.userId).catch(() => undefined);
    return a ? t("Valeur de « {nom} » mise à jour : {valeur}.", { nom: a.name, valeur: money(d.value) }) : t("Placement ajouté au patrimoine : {valeur}.", { valeur: money(d.value) });
  },
};

/* ---------- Contrat d'assurance ou d'abonnement ---------- */

const contratParse = z.object({
  is_recurring_contract: z.boolean(),
  type: z.enum(["assurance", "abonnement", "credit", "taxe", "garde", "budget"]),
  label: z.string().min(1),
  provider: z.string().nullable(),
  monthly: z.number().nullable(),
  annual: z.number().nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  renewal_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  notice_days: z.number().int().nullable(),
});
type Contrat = z.infer<typeof contratParse>;

const CONTRAT_LABELS = { label: tk("Intitulé"), provider: tk("Prestataire"), monthly: tk("Montant mensuel"), annual: tk("Montant annuel"), start_date: tk("Début du contrat"), end_date: tk("Fin du contrat"), renewal_date: tk("Prochain renouvellement"), notice_days: tk("Préavis en jours") };
const refOf = (d: Contrat) => `import:${slug(d.provider ?? "")}:${slug(d.label)}`.slice(0, 191);

/**
 * Référence de l'engagement que ce document crée ou retrouve, pour ce membre. Celle d'un engagement privé d'un autre
 * membre ne se reprend pas (il en lirait les montants et les remplacerait) : ce membre reçoit alors la sienne.
 */
async function refFor(d: Contrat, userId: number): Promise<string> {
  const base = refOf(d);
  const taken = await one("SELECT 1 AS x FROM commitments WHERE source_ref = ? AND owner_user_id IS NOT NULL AND owner_user_id <> ?", [base, userId]);
  return taken ? `${base.slice(0, 178)}:m${userId}` : base;
}

export const contrat: Extractor<Contrat> = {
  id: "contrat",
  label: tk("Contrat d'assurance ou d'abonnement"),
  matches: (c) => c.kind === "assurance" || (c.kind === "contrat" && c.domain === "budget"),
  instructions:
    "Document attendu : un contrat, des conditions particulières, un avis d'échéance ou une attestation d'une assurance (habitation, auto, santé, emprunteur, prévoyance) ou d'un abonnement (énergie, eau, télécoms, garde, service). « label » : intitulé court (« Assurance habitation », « Électricité », « Mutuelle »). « monthly » et « annual » : le montant payé par mois et par an, toutes taxes comprises — ne renseigne que ceux qui sont écrits (ne convertis pas l'un en l'autre). « renewal_date » : prochaine échéance annuelle ou date anniversaire. « notice_days » : préavis de résiliation en jours. « is_recurring_contract » est faux si le document ne décrit pas un engagement payé régulièrement (devis, sinistre, courrier, facture ponctuelle).",
  schema: {
    properties: {
      is_recurring_contract: { type: "boolean" },
      type: { type: "string", enum: ["assurance", "abonnement", "credit", "taxe", "garde", "budget"] },
      label: { type: "string" },
      provider: str("Assureur ou prestataire, nom usuel"),
      monthly: num("Montant mensuel TTC, si écrit"),
      annual: num("Montant annuel TTC, si écrit"),
      start_date: day("Date d'effet"),
      end_date: day("Date de fin, si le contrat en a une"),
      renewal_date: day("Prochaine échéance ou date anniversaire"),
      notice_days: { type: ["integer", "null"], description: "Préavis de résiliation en jours" },
    },
    required: ["is_recurring_contract", "type", "label", "provider", "monthly", "annual", "start_date", "end_date", "renewal_date", "notice_days"],
  },
  parse: contratParse,
  rejected: (d) => !d.is_recurring_contract || (d.monthly == null && d.annual == null),
  title: (d) => t("{intitule} — {prestataire}", { intitule: d.label, prestataire: d.provider ?? "" }),
  fields: (d) => [
    { key: "type", label: tk("Nature"), type: "choix", value: d.type, options: [{ value: "assurance", label: tk("Assurance") }, { value: "abonnement", label: tk("Abonnement") }, { value: "credit", label: tk("Crédit") }, { value: "taxe", label: tk("Taxe") }, { value: "garde", label: tk("Garde") }, { value: "budget", label: tk("Budget courant") }] },
    { key: "label", label: CONTRAT_LABELS.label, type: "texte", value: d.label, required: true },
    { key: "provider", label: CONTRAT_LABELS.provider, type: "texte", value: d.provider },
    { key: "monthly", label: CONTRAT_LABELS.monthly, type: "montant", value: d.monthly },
    { key: "annual", label: CONTRAT_LABELS.annual, type: "montant", value: d.annual },
    { key: "start_date", label: CONTRAT_LABELS.start_date, type: "date", value: d.start_date },
    { key: "end_date", label: CONTRAT_LABELS.end_date, type: "date", value: d.end_date },
    { key: "renewal_date", label: CONTRAT_LABELS.renewal_date, type: "date", value: d.renewal_date },
    { key: "notice_days", label: CONTRAT_LABELS.notice_days, type: "nombre", value: d.notice_days },
  ],
  checks(d) {
    const out = [{ ok: (d.monthly ?? d.annual ?? 0) > 0, label: t("Montant lu") }];
    if (d.monthly != null && d.annual != null) out.push({ ok: near(d.monthly * 12, d.annual, 1, 0.03), label: t("12 mensualités = montant annuel ({a} × 12 pour {b})", { a: money(d.monthly), b: money(d.annual) }) });
    if (d.start_date && d.end_date) out.push({ ok: d.end_date > d.start_date, label: t("Fin du contrat après son début") });
    return out;
  },
  async existing(d, ctx) {
    // Même engagement : celui que ce document a déjà créé, sinon un engagement du même prestataire au même intitulé.
    const row =
      (await one<Record<string, unknown>>("SELECT * FROM commitments WHERE source_ref = ?", [await refFor(d, ctx.userId)])) ??
      (d.provider ? await one<Record<string, unknown>>("SELECT * FROM commitments WHERE (owner_user_id IS NULL OR owner_user_id = ?) AND provider = ? AND label = ? LIMIT 1", [ctx.userId, d.provider, d.label]) : undefined);
    if (!row) return null;
    return { summary: t("Cet engagement est déjà au budget."), diffs: diffs(row, d, CONTRAT_LABELS) };
  },
  async apply(d, ctx, track) {
    const known = d.provider ? await one<{ id: number }>("SELECT id FROM commitments WHERE (owner_user_id IS NULL OR owner_user_id = ?) AND provider = ? AND label = ? AND source_ref IS NULL LIMIT 1", [ctx.userId, d.provider, d.label]) : undefined;
    const values = { label: d.label.slice(0, 160), type: d.type, provider: d.provider?.slice(0, 120) ?? null, monthly: d.monthly, annual: d.annual, start_date: d.start_date, end_date: d.end_date, renewal_date: d.renewal_date, notice_days: d.notice_days };
    const done = known ? await track.upsert("commitments", { id: known.id }, values) : await track.upsert("commitments", { source_ref: await refFor(d, ctx.userId) }, { ...values, status: "actif", source: "import" });
    return done === "cree" ? t("Engagement ajouté au budget.") : done === "modifie" ? t("Engagement mis à jour.") : t("Engagement déjà à jour.");
  },
};
