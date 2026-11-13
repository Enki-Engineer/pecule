import type { z } from "zod";
import type { Check, Confidence } from "../../lib/imports.ts";
import type { Tracker } from "./track.ts";
import { householdCurrency } from "../region.ts";
import { formatMoney } from "../../lib/currencies.ts";
import { locale } from "../../lib/i18n.ts";

/*
 * Registre des extracteurs de l'import massif. Un extracteur = un type de document que Pécule sait lire et ranger
 * dans ses écrans : ce qu'il y cherche (schéma et consignes pour l'IA), comment il le vérifie (contrôles
 * arithmétiques), ce que Pécule contient déjà pour la même clé, et comment il l'écrit — seulement à la validation.
 * Ajouter un type de document = un fichier dans `extractors/` et une ligne dans `EXTRACTORS` (index.ts).
 */

export type FieldType = "texte" | "montant" | "nombre" | "date" | "mois" | "annee" | "pourcent" | "choix";
/** Champ relu et corrigeable à l'écran : `key` est une clé de premier niveau des données lues. */
export type Field = { key: string; label: string; type: FieldType; value: string | number | null; options?: { value: string; label: string }[]; required?: boolean };
/** Tableau montré à la relecture (échéancier, carrière, opérations) : lecture seule. */
export type Table = { title: string; columns: string[]; lines: (string | number | null)[][]; total: number };
/** Ce que Pécule contient déjà pour la même clé : `diffs` vide = rien ne changerait. */
export type Existing = { summary: string; diffs: { label: string; before: string; after: string }[] } | null;

export type Ctx = { userId: number; documentId: number | null; relPath: string };

export type Extractor<T extends Record<string, unknown> = Record<string, unknown>> = {
  id: string;
  /** Nom du type de document (marqué `tk`, traduit à l'affichage). */
  label: string;
  /** Ce document, tel que rangé par le classement (type, domaine, titre), est-il de ce type ? */
  matches(c: { kind: string; domain: string; title: string }): boolean;
  /** Le document ne regarde que le membre qui l'a déposé (bulletin, retraite). */
  private?: boolean;
  /** Consignes de lecture, et schéma JSON des données attendues (propriétés et champs requis). */
  instructions: string;
  schema: { properties: Record<string, unknown>; required: string[] };
  parse: z.ZodType<T>;
  maxTokens?: number;
  /** Un PDF d'au plus ce nombre de pages est montré tel quel (12 par défaut) ; au-delà, son texte. */
  pdfUpTo?: number;
  /** Contexte du foyer utile à la lecture (liste des biens, des crédits connus…). */
  context?(ctx: Ctx): Promise<string>;
  /** Vrai si la lecture dit que ce n'est finalement pas ce type de document : il reste rangé au coffre. */
  rejected?(data: T): boolean;
  title(data: T): string;
  fields(data: T, ctx: Ctx): Promise<Field[]> | Field[];
  table?(data: T): Table | null;
  checks(data: T): Check[];
  existing(data: T, ctx: Ctx): Promise<Existing>;
  /** Écrit les données dans les écrans, par le journal `track` ; rend une phrase qui dit ce qui a été fait. */
  apply(data: T, ctx: Ctx, track: Tracker): Promise<string>;
};

export type Reading = { data: Record<string, unknown>; confidence: Confidence; doubts: string[] };

/** Petits outils d'écriture des schémas. */
export const num = (description: string) => ({ type: ["number", "null"], description });
export const str = (description: string) => ({ type: ["string", "null"], description });
export const day = (description: string) => ({ type: ["string", "null"], description: `${description} (AAAA-MM-JJ)` });

/** Montant affiché à la relecture, dans la devise du foyer (ou celle du document quand il en a une autre). */
export const money = (v: number | null | undefined, currency: string = householdCurrency()) => (v == null ? "—" : formatMoney(v, currency, locale()));

/** Écarts entre une ligne existante et la proposition, champ par champ (une valeur absente de la proposition ne compte pas). */
export function diffs(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string>): { label: string; before: string; after: string }[] {
  const show = (v: unknown) => (v == null || v === "" ? "—" : typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v));
  const out: { label: string; before: string; after: string }[] = [];
  for (const [col, label] of Object.entries(labels)) {
    const a = after[col];
    if (a == null) continue;
    const b = before[col];
    const equal = b != null && (typeof a === "number" || typeof b === "number" ? Math.abs(Number(a) - Number(b)) < 0.005 : String(a).trim() === String(b).trim());
    if (!equal) out.push({ label, before: show(b), after: show(a) });
  }
  return out;
}
