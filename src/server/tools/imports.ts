import { z } from "zod";
import { ActionError } from "../actions.ts";
import { batchView, discardItem, editItem, itemView, listBatches, retryItem, revertItem, validateItem, validateSafe } from "../imports/batches.ts";
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
  description: "Proposition d'un fichier d'un import massif : champs lus (clé, libellé, valeur, choix possibles), contrôles arithmétiques, doutes de la lecture, ce que Pécule contient déjà pour la même clé et ce qui changerait, aperçu du tableau (échéancier, carrière, opérations).",
  input: z.object({ item_id: z.number().int() }),
  run: ({ userId }, i) => guard(() => itemView(userId, i.item_id)),
});

const ACTIONS = { valider: validateItem, ecarter: discardItem, relire: retryItem, annuler: revertItem } as const;

const reviewImportItem = writeTool({
  name: "review_import_item",
  description:
    "Relecture d'un fichier d'un import massif. action : « valider » (écrit la proposition dans les écrans), « ecarter » (le document reste au coffre, rien n'est écrit), « relire » (relance la lecture), « annuler » (défait une validation). corrections : valeurs corrigées avant de valider, par clé de champ (voir get_import_item ; une date en AAAA-MM-JJ, un choix par sa valeur).",
  input: z.object({ item_id: z.number().int(), action: z.enum(["valider", "ecarter", "relire", "annuler"]), corrections: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional() }),
  describe: ({ userId }, i) =>
    guard(async () => {
      const item = await itemView(userId, i.item_id);
      const titre = item.title ?? item.path;
      const label = i.action === "valider" ? tr("Valider « {titre} »", { titre }) : i.action === "ecarter" ? tr("Écarter « {titre} »", { titre }) : i.action === "relire" ? tr("Relire « {titre} »", { titre }) : tr("Annuler la validation de « {titre} »", { titre });
      const failed = item.checks.filter((c) => !c.ok).map((c) => c.label);
      return {
        label,
        details: [
          item.path,
          ...Object.entries(i.corrections ?? {}).map(([k, v]) => `${k} → ${v ?? "—"}`),
          ...(i.action === "valider" && failed.length ? [tr("Contrôles en échec : {liste}", { liste: failed.join(" ; ") })] : []),
          ...(i.action === "valider" && item.existing?.diffs.length ? item.existing.diffs.map((d) => `${d.label} : ${d.before} → ${d.after}`) : []),
        ],
      };
    }),
  run: ({ userId }, i) =>
    guard(async () => {
      if (i.corrections && Object.keys(i.corrections).length) await editItem(userId, i.item_id, i.corrections);
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
