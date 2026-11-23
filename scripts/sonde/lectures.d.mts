/** Routes de lecture laissées hors de la sonde, et pourquoi. */
export const HORS_SONDE: Record<string, string>;
/** Les appels de la sonde pour un jour donné (AAAA-MM-JJ) : des chemins sous /api, réglages compris. */
export function lectures(jour: string): string[];
/** Chemin d'un appel, sans ses réglages. */
export function cheminDe(appel: string): string;
