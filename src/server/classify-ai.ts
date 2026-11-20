import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ActionError, userAccountsSql } from "./actions.ts";
import { aiClient, aiEnabled, aiModel, recordUsage } from "./ai.ts";
import { exec, q } from "./db.ts";
import { householdSummary } from "./household.ts";
import { logAudit } from "./journal.ts";
import { registerUndo, snapshotTransactions } from "./undo.ts";
import { groupLabels, ruleWorthy, type ClassConfidence, type LabelGroup, type UnclassedRow } from "../lib/classify.ts";
import { t } from "../lib/i18n.ts";

/*
 * Classement en lot par l'IA des opérations sans catégorie (après la reprise d'un historique, par exemple). L'IA ne
 * classe rien : elle propose une catégorie par libellé, d'après le référentiel du foyer et ce qu'il a déjà classé
 * lui-même ; le membre relit, corrige, décoche, puis applique — et peut annuler. Seules des opérations encore sans
 * catégorie sont touchées, à la proposition comme à l'application.
 */

/** Libellés proposés par demande : assez pour avancer vite, assez peu pour être relus. */
export const CLASSIFY_BATCH = 120;
const MAX_ROWS = 30_000;

const answer = z.object({ classements: z.array(z.object({ n: z.number().int(), categorie: z.string().nullable(), confiance: z.enum(["haute", "moyenne", "basse"]) })) });

/** Schéma de la réponse, tel qu'il part au fournisseur d'IA. */
export const CLASSIFY_OPS_SCHEMA = {
  type: "object",
  properties: {
    classements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer", description: "Numéro du libellé dans la liste" },
          categorie: { type: ["string", "null"], description: "Identifiant de la catégorie choisie dans le référentiel, null si rien ne permet de trancher" },
          confiance: { type: "string", enum: ["haute", "moyenne", "basse"] },
        },
        required: ["n", "categorie", "confiance"],
        additionalProperties: false,
      },
    },
  },
  required: ["classements"],
  additionalProperties: false,
};

const SYSTEM = `Tu classes les opérations bancaires d'un foyer dans ses catégories. On te donne son référentiel, des exemples de ce qu'il a déjà classé lui-même, et une liste de libellés d'opérations encore sans catégorie. Pour chaque libellé, rends l'identifiant de la catégorie la plus probable, ou null si rien ne permet de trancher (un chèque, un virement à une personne, un libellé opaque) : une absence vaut mieux qu'une supposition.
Règles :
- Appuie-toi d'abord sur les exemples du foyer : ils montrent ses habitudes, et priment sur l'usage courant.
- Un débit va dans une catégorie de dépense ou d'épargne, un crédit dans une catégorie de revenu. Deux exceptions : un mouvement entre les comptes du foyer (virement vers ou depuis un livret ou un autre compte du foyer, relevé d'une carte à débit différé, retrait ou dépôt d'espèces) va dans une catégorie interne, quel que soit son sens ; un crédit qui rembourse une dépense (avoir d'un commerçant, remboursement de soins) va dans la catégorie de cette dépense.
- N'emploie que des identifiants du référentiel. Rends une ligne par libellé, avec son numéro.
- « confiance » : « haute » si le libellé nomme sans ambiguïté un commerçant ou un organisme dont l'activité désigne la catégorie, ou s'il ressemble à un exemple du foyer ; « moyenne » si c'est le plus probable sans être sûr ; « basse » si c'est une supposition.`;

type Scope = { rows: UnclassedRow[]; groups: LabelGroup[] };

/** Opérations sans catégorie que le membre voit et qui comptent dans ses statistiques (les mêmes que l'écran « À classer »), hors opérations ventilées. */
async function unclassed(userId: number): Promise<Scope> {
  const rows = await q<UnclassedRow>(
    `SELECT t.id, t.label, t.label_key, t.amount, DATE_FORMAT(t.date, '%Y-%m-%d') AS date FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id
     WHERE t.category_id IS NULL AND a.excluded = 0 AND t.status IN ('posted', 'pending') AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)
     ORDER BY t.date DESC LIMIT ${MAX_ROWS}`,
  );
  return { rows, groups: groupLabels(rows) };
}

export type ClassProposal = Omit<LabelGroup, "ids"> & { categoryId: string | null; confidence: ClassConfidence };

/** Demande à l'IA une catégorie pour les libellés les plus fréquents encore sans catégorie. Rien n'est écrit. */
export async function proposeClassification(userId: number): Promise<{ proposals: ClassProposal[]; operations: number; labels: number; remaining: number }> {
  if (!aiEnabled()) throw new ActionError(400, t("L'IA n'est pas réglée : Réglages → Comptes et connexions."));
  const scope = await unclassed(userId);
  const groups = scope.groups.slice(0, CLASSIFY_BATCH);
  const totals = { operations: scope.rows.length, labels: scope.groups.length, remaining: scope.groups.length - groups.length };
  if (!groups.length) return { proposals: [], ...totals };
  const categories = await q<{ id: string; name: string; poste: string | null; kind: string; description: string | null }>("SELECT id, name, poste, kind, description FROM categories ORDER BY sort_order, id");
  // Ce que le foyer a classé lui-même : ses libellés les plus fréquents, avec leur catégorie.
  const examples = await q<{ label: string; category_id: string }>(
    `SELECT MAX(t.label) AS label, t.category_id FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id
     WHERE t.category_id IS NOT NULL AND t.label_key <> '' AND t.category_source IN ('manuel', 'regle', 'notion') GROUP BY t.label_key, t.category_id ORDER BY COUNT(*) DESC LIMIT 80`,
  );
  const text = [
    await householdSummary(userId).catch(() => ""),
    `Référentiel (identifiant · nature · poste · nom · description) :\n${categories.map((c) => `${c.id} · ${c.kind} · ${c.poste ?? "—"} · ${c.name}${c.description ? ` · ${c.description}` : ""}`).join("\n")}`,
    examples.length ? `Exemples du foyer (libellé → catégorie) :\n${examples.map((e) => `${e.label.slice(0, 120)} → ${e.category_id}`).join("\n")}` : "Le foyer n'a encore rien classé lui-même.",
    `Libellés à classer (numéro | sens | montant habituel | nombre d'opérations | libellé) :\n${groups.map((g, n) => `${n} | ${g.credit ? "crédit" : "débit"} | ${Math.abs(g.typical).toFixed(2)} | ${g.count} | ${g.label.slice(0, 160)}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const response = await aiClient()
    .messages.stream({
      model: aiModel(),
      max_tokens: 8000,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low", format: { type: "json_schema", schema: CLASSIFY_OPS_SCHEMA } },
      messages: [{ role: "user", content: text }],
    })
    .finalMessage();
  await recordUsage("classement des opérations", aiModel(), response.usage);
  const out = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  let parsed: z.infer<typeof answer> | null = null;
  try {
    const r = out && response.stop_reason !== "refusal" && response.stop_reason !== "max_tokens" ? answer.safeParse(JSON.parse(out)) : null;
    parsed = r?.success ? r.data : null;
  } catch {
    parsed = null;
  }
  if (!parsed) throw new ActionError(502, t("L'IA n'a pas rendu de classement exploitable : réessaie."));
  const known = new Set(categories.map((c) => c.id));
  const byN = new Map(parsed.classements.map((c) => [c.n, c]));
  const proposals = groups.map(({ ids: _ids, ...g }, n): ClassProposal => {
    const c = byN.get(n);
    // Un identifiant hors du référentiel est une absence de proposition.
    const categoryId = c?.categorie && known.has(c.categorie) ? c.categorie : null;
    return { ...g, categoryId, confidence: categoryId ? c!.confiance : "basse" };
  });
  return { proposals, ...totals };
}

export type ClassPick = { key: string; credit: boolean; categoryId: string };

/**
 * Applique les propositions retenues : chaque libellé prend sa catégorie sur les opérations du membre encore sans
 * catégorie (relues ici : ce qui a été classé entre-temps n'est pas touché). `remember` : le choix devient une règle
 * pour les prochaines opérations de même libellé, sauf quand la clé est trop courte pour en faire une.
 */
export async function applyClassification(userId: number, picks: ClassPick[], remember: boolean): Promise<{ updated: number; rules: number; undoId: string }> {
  const known = new Set((await q<{ id: string }>("SELECT id FROM categories")).map((c) => c.id));
  if (picks.some((p) => !known.has(p.categoryId))) throw new ActionError(400, t("Catégorie inconnue"));
  const scope = await unclassed(userId);
  const byGroup = new Map(scope.groups.map((g) => [`${g.credit ? "+" : "-"}${g.key}`, g]));
  const todo = picks.flatMap((p) => {
    const g = byGroup.get(`${p.credit ? "+" : "-"}${p.key}`);
    return g ? [{ ...p, ids: g.ids, rule: remember && ruleWorthy(p.key) }] : [];
  });
  const ids = todo.flatMap((x) => x.ids);
  const restore = await snapshotTransactions(ids, todo.some((x) => x.rule));
  let rules = 0;
  for (const x of todo) {
    for (let i = 0; i < x.ids.length; i += 500) {
      const part = x.ids.slice(i, i + 500);
      await exec(`UPDATE transactions SET category_id = ?, category_source = 'manuel' WHERE category_id IS NULL AND id IN (${part.map(() => "?").join(",")})`, [x.categoryId, ...part]);
    }
    // Une règle déjà là pour ce libellé reste : elle a été posée exprès.
    if (x.rule) rules += (await exec("INSERT IGNORE INTO rules (pattern, category_id) VALUES (?, ?)", [x.key, x.categoryId])).affectedRows;
  }
  await logAudit("classement proposé par l'IA appliqué", null, { operations: ids.length, libelles: todo.length, regles: rules });
  return { updated: ids.length, rules, undoId: registerUndo(userId, `${ids.length} opération(s) classée(s)`, restore) };
}
