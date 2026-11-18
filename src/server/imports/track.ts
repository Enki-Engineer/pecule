import { exec, q } from "../db.ts";

/*
 * Écritures d'une validation, gardées pour pouvoir l'annuler : chaque ligne créée ou modifiée est notée avec
 * sa clé et ses valeurs d'avant. Annuler rejoue le journal à l'envers (supprimer ce qui a été créé, remettre
 * ce qui a été modifié). Tables, colonnes et clés viennent du code des extracteurs, jamais d'une saisie.
 */

type Row = Record<string, unknown>;
export type Written =
  | { op: "upsert"; table: string; key: Row; before: Row | null }
  | { op: "replace"; table: string; where: Row; before: Row[] };

const cols = (r: Row) => Object.keys(r);
const whereOf = (key: Row) => cols(key).map((c) => `\`${c}\` <=> ?`).join(" AND ");

export class Tracker {
  readonly log: Written[] = [];

  /**
   * Crée la ligne de cette clé, ou la met à jour. Une valeur absente de la proposition (null) ne remplace
   * jamais une valeur déjà là : ce que Pécule sait reste, sauf correction explicite.
   */
  async upsert(table: string, key: Row, values: Row): Promise<"cree" | "modifie" | "identique"> {
    const [before] = await q<Row>(`SELECT * FROM \`${table}\` WHERE ${whereOf(key)} LIMIT 1`, Object.values(key));
    if (!before) {
      const row = { ...key, ...values };
      await exec(`INSERT INTO \`${table}\` (${cols(row).map((c) => `\`${c}\``).join(", ")}) VALUES (${cols(row).map(() => "?").join(", ")})`, Object.values(row));
      this.log.push({ op: "upsert", table, key, before: null });
      return "cree";
    }
    const changed = Object.entries(values).filter(([c, v]) => v !== null && v !== undefined && !same(before[c], v));
    if (!changed.length) return "identique";
    await exec(`UPDATE \`${table}\` SET ${changed.map(([c]) => `\`${c}\` = ?`).join(", ")} WHERE ${whereOf(key)}`, [...changed.map(([, v]) => v), ...Object.values(key)]);
    this.log.push({ op: "upsert", table, key, before: Object.fromEntries(changed.map(([c]) => [c, before[c] ?? null])) });
    return "modifie";
  }

  /** Remplace toutes les lignes d'un ensemble (l'échéancier d'un crédit), en gardant celles d'avant. */
  async replace(table: string, where: Row, rows: Row[]) {
    const before = await q<Row>(`SELECT * FROM \`${table}\` WHERE ${whereOf(where)}`, Object.values(where));
    await exec(`DELETE FROM \`${table}\` WHERE ${whereOf(where)}`, Object.values(where));
    await insertRows(table, rows.map((r) => ({ ...where, ...r })));
    this.log.push({ op: "replace", table, where, before });
  }
}

async function insertRows(table: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const part = rows.slice(i, i + 200);
    const names = cols(part[0]);
    await exec(`INSERT INTO \`${table}\` (${names.map((c) => `\`${c}\``).join(", ")}) VALUES ${part.map(() => `(${names.map(() => "?").join(", ")})`).join(", ")}`, part.flatMap((r) => names.map((c) => r[c] ?? null)));
  }
}

/** Deux valeurs de la base sont-elles les mêmes (nombres et décimaux en chaîne, dates, textes) ? */
export function same(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "number" || typeof b === "number") return Math.abs(Number(a) - Number(b)) < 0.005;
  return String(a).trim() === String(b).trim();
}

/**
 * Clés complétées à l'annulation d'un journal écrit avant qu'une table gagne une colonne de clé : une déclaration
 * d'impôt notée par sa seule année était celle du foyer. Sans cela, l'annuler retirerait toutes les déclarations de l'année.
 */
const LEGACY_KEYS: Record<string, Row> = { tax_returns: { owner_user_id: 0 } };
const fullKey = (table: string, key: Row): Row => ({ ...LEGACY_KEYS[table], ...key });

/** Défait un journal d'écritures, de la dernière à la première. */
export async function undo(log: Written[]) {
  for (const entry of [...log].reverse()) {
    const w = entry.op === "upsert" ? { ...entry, key: fullKey(entry.table, entry.key) } : entry;
    if (w.op === "replace") {
      await exec(`DELETE FROM \`${w.table}\` WHERE ${whereOf(w.where)}`, Object.values(w.where));
      if (w.before.length) await insertRows(w.table, w.before);
    } else if (!w.before) await exec(`DELETE FROM \`${w.table}\` WHERE ${whereOf(w.key)}`, Object.values(w.key));
    else await exec(`UPDATE \`${w.table}\` SET ${cols(w.before).map((c) => `\`${c}\` = ?`).join(", ")} WHERE ${whereOf(w.key)}`, [...Object.values(w.before), ...Object.values(w.key)]);
  }
}
