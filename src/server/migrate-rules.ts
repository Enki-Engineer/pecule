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
