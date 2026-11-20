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

/**
 * `part` : la partie du fichier à lire quand il en porte plusieurs (un compte d'un relevé multi-comptes).
 * `segment` : la tranche de pages montrée, quand un long PDF est lu en plusieurs fois.
 */
export type Ctx = { userId: number; documentId: number | null; relPath: string; part?: string | null; segment?: { from: number; to: number; pages: number } };

export type RowColumn = { key: string; label: string; type: "date" | "texte" | "montant" };
/**
 * Liste de lignes d'un document (les opérations d'un relevé) : lue en plusieurs réponses quand elle est longue,
 * montrée en entier à la relecture et corrigeable ligne à ligne.
 */
export type Rows<T> = {
  /** Clé de la liste dans les données lues. */
  key: string;
  /** Lignes demandées par réponse de l'IA : s'il en reste, la suite lui est redemandée. */
  perReply: number;
  columns: RowColumn[];
  /** Champs imprimés à la fin du document (solde d'arrivée, totaux) : pour un PDF lu par tranches, la dernière tranche qui les porte fait foi. */
  atEnd?: string[];
  /** Ce que la première tranche d'un long PDF a lu (le compte), à désigner aux tranches suivantes. */
  focus?(data: T): string | null;
  /** Devise des montants, quand ce n'est pas celle du foyer. */
  currency?(data: T): string | undefined;
  /** Solde avant la première ligne : l'écran en tire le solde après chaque ligne. */
  opening?(data: T): number | null;
  /** Lignes à regarder de près (celle dont le signe expliquerait un relevé qui ne tombe pas juste). */
  marks?(data: T): { index: number; note: string }[];
};
/** Vue d'ensemble des fichiers d'un même type dans un lot (les relevés d'un compte : période couverte, trous). */
export type Overview = { title: string; detail: string; warnings: string[] };
/** Ce qu'une validation a fait ; `share` : ce qu'elle a fixé et qui vaut pour les fichiers du lot qui parlent du même objet. */
export type Applied = string | { summary: string; share?: Record<string, { from: string | number | null; to: string | number | null }> };

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
  /** Liste de lignes lue en plusieurs réponses et corrigeable à la relecture. */
  rows?: Rows<T>;
  /** Autres parties du même fichier, à lire chacune à part (les autres comptes d'un relevé). */
  parts?(data: T): string[];
  /**
   * Fichiers d'un même lot qui parlent du même objet (les relevés d'un même compte) : une correction de l'un de ces
   * champs est reportée aux autres, tant qu'ils n'ont pas reçu une autre valeur.
   */
  shared?: { keys: string[]; same(a: T, b: T): boolean };
  overview?(items: { id: number; status: string; data: T }[]): Overview[];
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
  apply(data: T, ctx: Ctx, track: Tracker): Promise<Applied>;
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
