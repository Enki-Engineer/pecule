import { z } from "zod";
import { ActionError } from "../actions.ts";
import { batchView, discardItem, editItem, itemView, listBatches, retryItem, revertItem, validateItem, validateSafe, type RowEdit } from "../imports/batches.ts";
import { ToolError, readTool, writeTool } from "./registry.ts";
import { t as tr } from "../../lib/i18n.ts";

/*
 * Import massif de documents : suivre un lot et relire ses fichiers. Le dépôt des fichiers se fait par l'écran
 * du coffre (zone de dépôt) ou par `node scripts/importer.mjs <dossier>` (un outil ne transporte pas de fichiers).
 */

const guard = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (e) {
    if (e instanceof ActionError) throw new ToolError(e.message);
    throw e;
  }
};

const listImports = readTool({
  name: "list_imports",
  description:
    "Imports massifs de documents du membre. Sans batch_id : les lots (nom, date, fichiers, à relire, coût de l'IA). Avec batch_id : une ligne par fichier du lot — état (a_relire = proposition prête, valide = écrit dans les écrans, range = rangé au coffre ou aux factures, doublon, ignore, erreur), type reconnu, contrôles passés, écarts avec l'existant, « safe » (validable sans relecture).",
  input: z.object({ batch_id: z.number().int().optional() }),
  run: ({ userId }, i) => guard(async () => (i.batch_id ? batchView(userId, i.batch_id) : { batches: await listBatches(userId) })),
});

const getImportItem = readTool({
  name: "get_import_item",
  description:
    "Proposition d'un fichier d'un import massif : champs lus (clé, libellé, valeur, choix possibles), contrôles arithmétiques, doutes de la lecture, ce que Pécule contient déjà pour la même clé et ce qui changerait, aperçu du tableau (échéancier, carrière, opérations). lignes : true pour recevoir toutes les lignes d'un relevé de compte (ses opérations, numérotées à partir de 0, avec celles dont le signe ou la présence expliquerait un relevé qui ne tombe pas juste) — à demander seulement pour corriger une opération.",
  input: z.object({ item_id: z.number().int(), lignes: z.boolean().optional() }),
  run: ({ userId }, i) =>
    guard(async () => {
      const { rows, ...view } = await itemView(userId, i.item_id);
      return i.lignes && rows ? { ...view, lignes: { devise: rows.currency, solde_de_depart: rows.opening, a_verifier: rows.marks, liste: rows.lines.map((l, index) => ({ index, ...l })) } } : { ...view, lignes: rows ? rows.lines.length : null };
    }),
});

const ACTIONS = { valider: validateItem, ecarter: discardItem, relire: retryItem, annuler: revertItem } as const;

type RowInput = { op: "set" | "remove" | "add"; index?: number; values?: Record<string, string | number | null> };
/** Corrections de lignes données par l'assistant, ramenées à la forme attendue par la relecture. */
function rowEdits(list: RowInput[] | undefined): RowEdit[] {
  return (list ?? []).map((r) => {
    if (r.op === "add") return { op: "add", index: r.index, values: r.values ?? {} };
    if (r.index === undefined) throw new ToolError("index manquant pour corriger ou retirer une ligne.");
    return r.op === "remove" ? { op: "remove", index: r.index } : { op: "set", index: r.index, values: r.values ?? {} };
  });
}

const reviewImportItem = writeTool({
  name: "review_import_item",
  description:
    "Relecture d'un fichier d'un import massif. action : « valider » (écrit la proposition dans les écrans), « ecarter » (le document reste au coffre, rien n'est écrit), « relire » (relance la lecture), « annuler » (défait une validation), « corriger » (enregistre les corrections sans valider : la proposition reste à relire). corrections : valeurs corrigées, par clé de champ (voir get_import_item ; une date en AAAA-MM-JJ, un choix par sa valeur) ; le compte choisi pour un relevé vaut pour les autres relevés du même compte dans le lot. lignes : corrections des opérations d'un relevé de compte, appliquées dans l'ordre — { op: « set », index, values: { date, label, amount } } change une ligne (seules les valeurs données), { op: « remove », index } la retire, { op: « add », index?, values } en ajoute une (avant la ligne index, à la fin sinon) ; les index sont ceux de get_import_item avec lignes: true, et se décalent après un retrait ou un ajout.",
  input: z.object({
    item_id: z.number().int(),
    action: z.enum(["valider", "ecarter", "relire", "annuler", "corriger"]),
    corrections: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
    lignes: z.array(z.object({ op: z.enum(["set", "remove", "add"]), index: z.number().int().min(0).optional(), values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional() })).max(200).optional(),
  }),
  describe: ({ userId }, i) =>
    guard(async () => {
      const item = await itemView(userId, i.item_id);
      const titre = item.title ?? item.path;
      const label =
        i.action === "valider" ? tr("Valider « {titre} »", { titre }) : i.action === "ecarter" ? tr("Écarter « {titre} »", { titre }) : i.action === "relire" ? tr("Relire « {titre} »", { titre }) : i.action === "corriger" ? tr("Corriger « {titre} »", { titre }) : tr("Annuler la validation de « {titre} »", { titre });
      const failed = item.checks.filter((c) => !c.ok).map((c) => c.label);
      return {
        label,
        details: [
          item.path,
          ...Object.entries(i.corrections ?? {}).map(([k, v]) => `${k} → ${v ?? "—"}`),
          ...rowEdits(i.lignes).map((r) => (r.op === "remove" ? tr("Ligne {n} retirée", { n: r.index + 1 }) : `${r.op === "add" ? tr("Ligne ajoutée") : tr("Ligne {n}", { n: r.index + 1 })} : ${Object.values(r.values).join(" · ")}`)),
          ...(i.action === "valider" && failed.length ? [tr("Contrôles en échec : {liste}", { liste: failed.join(" ; ") })] : []),
          ...(i.action === "valider" && item.existing?.diffs.length ? item.existing.diffs.map((d) => `${d.label} : ${d.before} → ${d.after}`) : []),
        ],
      };
    }),
  run: ({ userId }, i) =>
    guard(async () => {
      const rows = rowEdits(i.lignes);
      const corrected = (i.corrections && Object.keys(i.corrections).length) || rows.length ? await editItem(userId, i.item_id, i.corrections ?? {}, rows) : null;
      if (i.action === "corriger") {
        if (!corrected) throw new ToolError("Aucune correction donnée.");
        return `Corrigé. Contrôles : ${corrected.checks.map((c) => `${c.ok ? "✓" : "✗"} ${c.label}`).join(" ; ")}.`;
      }
      const r = await ACTIONS[i.action](userId, i.item_id);
      return r.summary ?? `Fait : ${r.status}.`;
    }),
});

const validateSafeImports = writeTool({
  name: "validate_safe_imports",
  description: "Valide d'un coup tous les fichiers « sûrs » d'un lot d'import massif : contrôles passés, lecture sans doute, rien de changé à ce que Pécule contient déjà. Le reste demande une relecture fichier par fichier.",
  input: z.object({ batch_id: z.number().int() }),
  describe: ({ userId }, i) =>
    guard(async () => {
      const b = await batchView(userId, i.batch_id);
      const safe = b.items.filter((x) => x.safe);
      if (!safe.length) throw new ToolError("Aucun fichier sûr dans ce lot.");
      return { label: tr("Valider les fichiers sûrs du lot « {nom} »", { nom: b.name }), details: safe.map((x) => x.title ?? x.path) };
    }),
  run: ({ userId }, i) =>
    guard(async () => {
      const r = await validateSafe(userId, i.batch_id);
      return `${r.validated} fichier(s) validé(s)${r.failed.length ? `, ${r.failed.length} en échec : ${r.failed.map((f) => f.error).join(" ; ")}` : ""}.`;
    }),
});

export const importsTools = [listImports, getImportItem, reviewImportItem, validateSafeImports];
