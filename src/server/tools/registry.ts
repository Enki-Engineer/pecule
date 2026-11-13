import { z } from "zod";
import { locale, t as tr } from "../../lib/i18n.ts";

/*
 * Registre d'outils : un outil = un nom, une description, un schéma zod (validation + JSON Schema
 * pour Claude et MCP) et une fonction. Les lectures s'exécutent directement ; les écritures se
 * décrivent d'abord (écran de confirmation de l'assistant), puis s'exécutent.
 */

export type ToolCtx = { userId: number };
export type Described = { label: string; details: string[] };
type Input = z.ZodObject;

type Base<S extends Input> = {
  name: string;
  description: string;
  input: S;
  /** Libellé affiché pendant l'exécution (« Recherche des opérations… »). */
  progress?: string;
  /** Outil exécuté sans confirmation mais qui modifie des données (mémoire de l'assistant) : refusé à un accès en lecture seule. */
  mutates?: boolean;
};
export type ReadTool<S extends Input = Input> = Base<S> & { kind: "read"; run(ctx: ToolCtx, input: z.output<S>): Promise<unknown> };
export type WriteTool<S extends Input = Input> = Base<S> & {
  kind: "write";
  /** Texte de confirmation ; lève ToolError si la demande est impossible (cible introuvable…). */
  describe(ctx: ToolCtx, input: z.output<S>): Promise<Described>;
  /** Exécution ; renvoie un compte rendu court pour Claude. */
  run(ctx: ToolCtx, input: z.output<S>): Promise<string>;
};
export type Tool = ReadTool | WriteTool;

export const readTool = <S extends Input>(t: Omit<ReadTool<S>, "kind">): Tool => ({ ...t, kind: "read" }) as unknown as Tool;
export const writeTool = <S extends Input>(t: Omit<WriteTool<S>, "kind">): Tool => ({ ...t, kind: "write" }) as unknown as Tool;

/** Erreur destinée à Claude (message lisible, pas de pile). */
export class ToolError extends Error {}

const SAFE = Number.MAX_SAFE_INTEGER;

/** Retire le bruit de z.toJSONSchema (bornes des entiers, $schema) qui coûte des jetons à chaque appel. */
function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "$schema") continue;
    if ((k === "minimum" && v === -SAFE) || (k === "maximum" && v === SAFE)) continue;
    out[k] = clean(v);
  }
  return out;
}

export type JsonObjectSchema = { type: "object"; properties: Record<string, unknown>; required?: string[]; [k: string]: unknown };

export function jsonSchema(s: Input): JsonObjectSchema {
  const js = clean(z.toJSONSchema(s, { io: "input" })) as JsonObjectSchema;
  return { ...js, type: "object", properties: js.properties ?? {}, additionalProperties: false };
}

/** Message d'erreur de validation compréhensible par Claude. */
export function inputError(e: unknown): string {
  if (e instanceof z.ZodError) return `Paramètres invalides : ${e.issues.map((i) => `${i.path.join(".") || "(racine)"} ${i.message}`).join(" ; ")}`;
  if (e instanceof ToolError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

export const r2 = (n: number) => Math.round(n * 100) / 100;
export { money, today } from "../region.ts";
/*
 * Textes de confirmation (describe) : écrits pendant la requête du membre, donc dans sa langue — montants et
 * dates au format de cette langue. Ce qui part vers Claude (résultats de run, ToolError) reste en français.
 */
const dateText = (d: string, year: boolean) => {
  const at = new Date(`${d.slice(0, 10)}T12:00:00Z`);
  // Date illisible : on la montre comme avant, découpée dans le texte.
  if (Number.isNaN(at.getTime())) return `${d.slice(8, 10)}/${d.slice(5, 7)}${year ? `/${d.slice(0, 4)}` : ""}`;
  return at.toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
};
/** Date complète d'un texte de confirmation (JJ/MM/AAAA en français). */
export const longDate = (d: string) => dateText(d, true);
/** Jour et mois d'un texte de confirmation (JJ/MM en français). */
export const shortDate = (d: string) => dateText(d, false);
/** Ligne de détail « Libellé : valeur » (la ponctuation suit la langue). */
export const field = (label: string, value: string | number) => tr("{libelle} : {valeur}", { libelle: label, valeur: value });
/** Ligne de détail « Libellé : avant → après ». */
export const change = (label: string, before: string | number, after: string | number) => tr("{libelle} : {avant} → {apres}", { libelle: label, avant: before, apres: after });
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date AAAA-MM-JJ attendue");
export const month = z.string().regex(/^\d{4}-\d{2}$/, "mois AAAA-MM attendu");
