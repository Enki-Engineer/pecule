import { z } from "zod";
import { ActionError } from "../../actions.ts";
import { one, q } from "../../db.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { day, diffs, num, str, type Extractor } from "../registry.ts";

/* Acte de vente, compromis, bail → fiche du bien (`properties`) et ses faits clés (écran Immobilier). Clé : le bien. */

const NEW = "__nouveau__";
const parse = z.object({
  doc_type: z.enum(["acte_vente", "compromis", "bail", "autre"]),
  property_id: z.string().nullable(),
  name: z.string().nullable(),
  kind: z.string().nullable(),
  city: z.string().nullable(),
  surface: z.number().nullable(),
  rooms: z.number().int().nullable(),
  acquisition_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  acquisition_price: z.number().nullable(),
  acquisition_costs: z.number().nullable(),
  rent_monthly: z.number().nullable(),
  charges_monthly: z.number().nullable(),
  deposit: z.number().nullable(),
  lease_kind: z.string().nullable(),
  lease_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  next_rent_revision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
});
type Deed = z.infer<typeof parse>;

const LABELS = {
  city: tk("Commune"),
  surface: tk("Surface"),
  rooms: tk("Pièces"),
  acquisition_date: tk("Date d'acquisition"),
  acquisition_price: tk("Prix d'acquisition"),
  acquisition_costs: tk("Frais d'acquisition"),
  rent_monthly: tk("Loyer mensuel hors charges"),
  charges_monthly: tk("Charges mensuelles"),
  deposit: tk("Dépôt de garantie"),
  lease_kind: tk("Type de bail"),
  lease_start: tk("Début du bail"),
  next_rent_revision: tk("Prochaine révision du loyer"),
};
const TYPES: Record<string, "texte" | "montant" | "nombre" | "date"> = { city: "texte", surface: "nombre", rooms: "nombre", lease_kind: "texte", acquisition_date: "date", lease_start: "date", next_rent_revision: "date" };

const properties = (userId: number) => q<{ id: string; name: string; city: string | null }>("SELECT id, name, city FROM properties WHERE owner_user_id IS NULL OR owner_user_id = ? ORDER BY sort_order, id", [userId]);
const slug = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

export const bien: Extractor<Deed> = {
  id: "bien",
  label: tk("Acte, compromis ou bail"),
  matches: (c) => (c.kind === "acte" || c.kind === "bail") && (c.domain === "immobilier" || c.domain === "autre"),
  maxTokens: 6000,
  instructions:
    "Document attendu : un acte de vente, un compromis ou un bail d'habitation concernant un bien immobilier du foyer. Pour un acte ou un compromis : date de signature, prix, frais d'acquisition (notaire, droits, agence à la charge de l'acquéreur), surface, nombre de pièces. Pour un bail : loyer mensuel hors charges, charges, dépôt de garantie, type de bail (nu, meublé, mobilité…), date de début, prochaine révision du loyer. « property_id » : le bien du foyer concerné, choisi dans la liste fournie d'après l'adresse et la commune, sinon null. « name » : un nom court pour le bien s'il est nouveau (« Appartement Nantes »). « kind » : appartement, maison, studio, parking, terrain, immeuble. « facts » : au plus 10 faits utiles (références cadastrales, lots, servitudes, garanties, durée du bail, indice de révision…), jamais le nom ni les coordonnées d'une personne. « doc_type » = « autre » si ce n'est aucun de ces documents.",
  schema: {
    properties: {
      doc_type: { type: "string", enum: ["acte_vente", "compromis", "bail", "autre"] },
      property_id: str("Identifiant du bien dans la liste fournie, sinon null"),
      name: str("Nom court du bien"),
      kind: str("Nature du bien"),
      city: str("Commune"),
      surface: num("Surface habitable en m²"),
      rooms: { type: ["integer", "null"], description: "Nombre de pièces principales" },
      acquisition_date: day("Date de signature de l'acte ou du compromis"),
      acquisition_price: num("Prix d'acquisition"),
      acquisition_costs: num("Frais d'acquisition à la charge de l'acquéreur"),
      rent_monthly: num("Loyer mensuel hors charges"),
      charges_monthly: num("Provision mensuelle pour charges"),
      deposit: num("Dépôt de garantie"),
      lease_kind: str("Type de bail"),
      lease_start: day("Date de prise d'effet du bail"),
      next_rent_revision: day("Date de la prochaine révision du loyer"),
      facts: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label", "value"], additionalProperties: false } },
    },
    required: ["doc_type", "property_id", "name", "kind", "city", "surface", "rooms", "acquisition_date", "acquisition_price", "acquisition_costs", "rent_monthly", "charges_monthly", "deposit", "lease_kind", "lease_start", "next_rent_revision", "facts"],
  },
  parse,
  context: async (ctx) => `Biens du foyer : ${(await properties(ctx.userId)).map((p) => `${p.id} = ${p.name}${p.city ? ` (${p.city})` : ""}`).join(" ; ") || "aucun enregistré"}.`,
  rejected: (d) => d.doc_type === "autre",
  title: (d) => (d.doc_type === "bail" ? t("Bail — {bien}", { bien: d.name ?? d.city ?? "" }) : d.doc_type === "compromis" ? t("Compromis — {bien}", { bien: d.name ?? d.city ?? "" }) : t("Acte de vente — {bien}", { bien: d.name ?? d.city ?? "" })),
  async fields(d, ctx) {
    const list = await properties(ctx.userId);
    return [
      { key: "property_id", label: tk("Bien"), type: "choix", value: list.some((p) => p.id === d.property_id) || d.property_id === NEW ? d.property_id : null, options: [{ value: NEW, label: tk("Nouveau bien") }, ...list.map((p) => ({ value: p.id, label: p.name }))], required: true },
      { key: "name", label: tk("Nom du bien"), type: "texte", value: d.name },
      ...(Object.keys(LABELS) as (keyof typeof LABELS)[]).filter((k) => d[k] != null || (d.doc_type === "bail" ? ["rent_monthly", "lease_start"] : ["acquisition_price", "acquisition_date"]).includes(k)).map((k) => ({ key: k, label: LABELS[k], type: TYPES[k] ?? ("montant" as const), value: d[k] })),
    ];
  },
  table: (d) => (d.facts.length ? { title: t("Faits clés"), columns: [t("Fait"), t("Valeur")], lines: d.facts.slice(0, 10).map((f) => [f.label, f.value]), total: d.facts.length } : null),
  checks(d) {
    // Jamais de bien créé sans qu'on l'ait demandé : un bien existant, ou « Nouveau bien » choisi exprès.
    const chosen = { ok: !!d.property_id, label: t("Rattachement choisi : un élément existant, ou « nouveau » demandé exprès") };
    if (d.doc_type === "bail")
      return [
        chosen,
        { ok: (d.rent_monthly ?? 0) > 0, label: t("Loyer lu") },
        { ok: !!d.lease_start, label: t("Début du bail lu") },
        ...(d.deposit != null && d.rent_monthly ? [{ ok: d.deposit <= d.rent_monthly * 3 + 1, label: t("Dépôt de garantie cohérent avec le loyer") }] : []),
      ];
    return [
      chosen,
      { ok: (d.acquisition_price ?? 0) > 0, label: t("Prix lu") },
      { ok: !!d.acquisition_date, label: t("Date de signature lue") },
      ...(d.acquisition_costs != null && d.acquisition_price ? [{ ok: d.acquisition_costs < d.acquisition_price * 0.2, label: t("Frais d'acquisition inférieurs à 20 % du prix") }] : []),
    ];
  },
  async existing(d, ctx) {
    if (!d.property_id || d.property_id === NEW) return null;
    const row = await one<Record<string, unknown>>("SELECT * FROM properties WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [d.property_id, ctx.userId]);
    if (!row) return null;
    return { summary: t("Ce bien a déjà sa fiche : ce document la complète."), diffs: diffs(row, d, LABELS) };
  },
  async apply(d, ctx, track) {
    const known = d.property_id && d.property_id !== NEW ? await one<{ id: string }>("SELECT id FROM properties WHERE (owner_user_id IS NULL OR owner_user_id = ?) AND id = ?", [ctx.userId, d.property_id]) : null;
    let id = known?.id;
    if (!id) {
      const name = d.name?.trim() || d.city?.trim();
      if (!name) throw new ActionError(400, t("Donne un nom au nouveau bien."));
      const base = slug(name) || "bien";
      id = base;
      for (let i = 2; await one("SELECT id FROM properties WHERE id = ?", [id]); i++) id = `${base}-${i}`;
      await track.upsert("properties", { id }, { name: name.slice(0, 160), kind: (d.kind ?? "appartement").slice(0, 24), sort_order: Number((await one<{ n: number }>("SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM properties"))?.n ?? 1) });
    }
    const { doc_type: _, property_id: __, name: ___, kind: ____, facts, ...values } = d;
    await track.upsert("properties", { id }, { ...values, lease_kind: values.lease_kind?.slice(0, 24) ?? null, city: values.city?.slice(0, 120) ?? null });
    let n = 0;
    for (const f of facts.slice(0, 10)) {
      const key = slug(f.label).slice(0, 60);
      if (key) await track.upsert("facts", { entity_type: "property", entity_id: id, fact_key: key }, { label: f.label.slice(0, 160), value: f.value.slice(0, 500), as_of: d.acquisition_date ?? d.lease_start, sort_order: 50 + n++ });
    }
    if (ctx.documentId) await track.upsert("documents", { id: ctx.documentId }, { entity_type: "property", entity_id: id });
    return known ? t("Fiche du bien complétée.") : t("Bien ajouté à l'immobilier.");
  },
};
