/*
 * Reprise d'une migration interrompue. MySQL et MariaDB ne défont pas une instruction de structure : si le processus
 * s'arrête entre deux instructions d'une migration (redémarrage de l'hébergeur pendant un déploiement), ce qui est fait
 * reste fait et la migration n'est pas notée appliquée. La rejouer doit passer sur ce qui est déjà là, au lieu d'échouer
 * à chaque démarrage sur « colonne déjà présente ».
 */

/** Codes d'erreur d'une instruction dont l'effet est déjà en place : la colonne, l'index, la table ou la clé existe, ou ce qu'on retire n'est plus là. */
const ALREADY_DONE = new Set(["ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_TABLE_EXISTS_ERROR", "ER_FK_DUP_NAME", "ER_CANT_DROP_FIELD_OR_KEY"]);

/** Vrai si l'erreur dit que l'instruction de structure a déjà produit son effet. Toute autre erreur arrête la migration. */
export function alreadyDone(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && ALREADY_DONE.has(code);
}

/*
 * Jeu de caractères et collation des tables : ceux de Pécule, les mêmes sur tous les serveurs. Une table créée sans
 * les dire prend ceux du serveur — `utf8mb4_uca1400_ai_ci` sur MariaDB 11, que ni MariaDB 10.6 ni MySQL ne
 * connaissent —, et le schéma de départ, écrit depuis une base, emportait ce choix chez tout le monde : une
 * installation neuve s'arrêtait alors sur « Unknown collation ».
 */
export const TABLE_OPTIONS = "DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

/**
 * `CREATE TABLE` d'une migration qui ne dit ni son jeu de caractères ni sa collation : ceux de Pécule lui sont
 * ajoutés. Toute autre instruction est rendue telle quelle (une table bâtie sur une requête ou sur une autre aussi).
 */
export function withTableOptions(sql: string): string {
  if (!/^(?:\s*--[^\n]*\n)*\s*CREATE\s+(?:TEMPORARY\s+)?TABLE\b/i.test(sql) || /\bSELECT\b/i.test(sql)) return sql;
  const end = sql.lastIndexOf(")");
  if (end < 0) return sql;
  const tail = sql.slice(end + 1);
  if (/\b(?:CHARSET|CHARACTER\s+SET|COLLATE)\b/i.test(tail)) return sql;
  const closed = /;\s*$/.test(tail);
  return `${sql.slice(0, end + 1)}${tail.replace(/;?\s*$/, "")} ${TABLE_OPTIONS}${closed ? ";" : ""}`;
}

/*
 * Schéma de départ interrompu. MySQL et MariaDB ne défont pas une création de table : si le schéma de départ s'arrête
 * en route (serveur coupé, instruction refusée par ce moteur), la base reste à moitié créée et n'est plus « vide ».
 * Une ligne de `_migrations` le dit avant la première table et disparaît après la dernière : tant qu'elle est là, le
 * démarrage suivant reprend le schéma de départ là où il s'était arrêté au lieu de prendre la base pour une ancienne.
 */
export const INITIAL_MARKER = "schema-de-depart:en-cours";
