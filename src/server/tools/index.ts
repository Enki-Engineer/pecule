import type Anthropic from "@anthropic-ai/sdk";
import { logAudit, runAs, type Via } from "../journal.ts";
import { banqueTools } from "./banque.ts";
import { facturesTools } from "./factures.ts";
import { patrimoineTools } from "./patrimoine.ts";
import { documentsTools } from "./documents.ts";
import { situationTools } from "./situation.ts";
import { analyseTools } from "./analyse.ts";
import { editionTools } from "./edition.ts";
import { pilotageTools } from "./pilotage.ts";
import { importsTools } from "./imports.ts";
import { contratsTools } from "./contrats.ts";
import { ToolError, inputError, jsonSchema, type Described, type Tool, type ToolCtx } from "./registry.ts";
import { tk } from "../../lib/i18n.ts";

/*
 * Outils de Pécule (registre unique) : définis une fois, utilisés par l'assistant intégré (écritures
 * confirmées à l'écran) et par le serveur MCP (écritures confirmées par le client, ex. Claude Code).
 */

export const TOOLS: Tool[] = [...banqueTools, ...analyseTools, ...facturesTools, ...patrimoineTools, ...documentsTools, ...contratsTools, ...situationTools, ...editionTools, ...pilotageTools, ...importsTools];
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export const WRITE_NAMES = new Set(TOOLS.filter((t) => t.kind === "write").map((t) => t.name));
/** Outils exécutés sans confirmation mais qui modifient des données (mémoire) : refusés quand personne n'est devant l'écran. */
export const MUTATING_NAMES = new Set(TOOLS.filter((t) => t.mutates).map((t) => t.name));

export { ToolError, inputError, jsonSchema };
export type { Tool, ToolCtx };

/** Définitions pour l'API Claude (le schéma JSON est calculé une fois). */
export const ANTHROPIC_TOOLS: Anthropic.Tool[] = TOOLS.map((t) => ({
  name: t.name,
  description: t.kind === "write" ? `${t.description} (action soumise à la confirmation de l'utilisateur)` : t.description,
  input_schema: jsonSchema(t.input),
}));

function get(name: string): Tool {
  const t = BY_NAME.get(name);
  if (!t) throw new ToolError(`Outil inconnu : ${name}`);
  return t;
}

/** Lecture : valide les paramètres et exécute. */
export async function runReadTool(ctx: ToolCtx, name: string, input: unknown): Promise<unknown> {
  const t = get(name);
  if (t.kind !== "read") throw new ToolError(`${name} est une action : elle demande une confirmation`);
  return t.run(ctx, t.input.parse(input ?? {}));
}

export type PendingWrite = { id: string; name: string; input: unknown; label: string; details: string[]; invalid?: string };

/** Écriture proposée : texte de confirmation, ou motif de refus (invalid) renvoyé à Claude. */
export async function describeWrite(ctx: ToolCtx, use: { id: string; name: string; input: unknown }): Promise<PendingWrite> {
  const base = { id: use.id, name: use.name, input: use.input };
  try {
    const t = get(use.name);
    if (t.kind !== "write") throw new ToolError(`${use.name} n'est pas une action`);
    const d: Described = await t.describe(ctx, t.input.parse(use.input ?? {}));
    return { ...base, ...d };
  } catch (e) {
    return { ...base, label: "Demande invalide", details: [], invalid: inputError(e) };
  }
}

/**
 * Écriture confirmée : exécutée au nom du canal (assistant, mcp) et tracée dans le journal d'audit.
 * `acting` : écriture faite dans la vue d'un autre membre (MCP, jeton d'administration) — le journal garde l'auteur réel et la vue.
 */
export function executeWrite(ctx: ToolCtx, w: { name: string; input: unknown; label?: string; details?: string[] }, via: Via, acting?: { actorUserId: number; view: string }): Promise<string> {
  const t = get(w.name);
  if (t.kind !== "write") return Promise.reject(new ToolError(`${w.name} n'est pas une action`));
  return runAs({ userId: acting?.actorUserId ?? ctx.userId, via }, async () => {
    const input = t.input.parse(w.input ?? {});
    // Les contrôles vivent dans describe (cible introuvable, doublon…) : rejoués ici, car le serveur MCP exécute sans écran de confirmation.
    await t.describe(ctx, input);
    const out = await t.run(ctx, input);
    await logAudit(`${via} ${w.name}`, null, { demande: w.label, details: w.details, parametres: w.input, ...(acting ? { vue: acting.view } : {}) });
    return out;
  });
}

/** Libellé d'attente d'un outil (« Recherche des opérations… »). */
export const progressLabel = (name: string) => BY_NAME.get(name)?.progress ?? (WRITE_NAMES.has(name) ? tk("Préparation de l'action…") : tk("Recherche…"));
