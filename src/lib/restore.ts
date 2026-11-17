/*
 * Restauration d'une sauvegarde à l'installation (écran « Bienvenue dans Pécule », `src/server/restore.ts`) :
 * ce que le serveur et l'écran se disent, et les règles qui ne dépendent de rien (testées).
 */

/** Taille d'un morceau d'archive envoyé par l'écran : assez petit pour passer tous les proxys. */
export const RESTORE_CHUNK = 4 * 1_048_576;

/** Où en est la restauration. `envoi` : aucune n'est lancée (l'archive est peut-être en cours d'envoi). */
export type RestoreStage = "envoi" | "dechiffrement" | "verification" | "preparation" | "donnees" | "fichiers" | "controle" | "demarrage" | "termine" | "echec";

/** Clés gardées chiffrées en base, illisibles quand le secret du serveur n'est plus celui de la sauvegarde. */
export type SealedKind = "ia" | "banque" | "services" | "notifications" | "stockage";

export type RestoreReport = {
  /** Instant de la sauvegarde restaurée (ISO, UTC). */
  sauvegardeDu: string;
  operations: number;
  factures: number;
  documents: number;
  lignes: number;
  /** Migrations appliquées après la restauration (archive d'une version plus ancienne). */
  migrations: number;
  /** L'adresse de l'installation a changé depuis la sauvegarde (clés d'accès inutilisables) ; `null` : l'archive ne le dit pas. */
  adresseChangee: boolean | null;
  /** Clés à ressaisir dans les réglages. */
  clesIllisibles: SealedKind[];
  /** Membres retrouvés ; `lien` : le lien d'inscription d'un administrateur (créer une clé d'accès ici). */
  membres: { nom: string; admin: boolean; lien: string | null }[];
};

export type RestoreStatus = {
  etape: RestoreStage;
  /** Avancement de l'étape en cours, quand il se compte (lignes, fichiers). */
  fait: number;
  total: number;
  /** Raison de l'échec, dans la langue de l'écran. */
  erreur: string | null;
  rapport: RestoreReport | null;
};

/** Archive présente sur le serveur, proposée à la restauration. */
export type ServerArchive = { nom: string; octets: number; at: number };

/**
 * Une archive se restaure-t-elle avec cette version du code ? `known` : les migrations que le code connaît, dans
 * l'ordre (repliées d'abord) ; `folded` : celles qui sont repliées dans le schéma de départ.
 * - `trop-recente` : sa dernière migration est inconnue d'ici, elle vient d'une version plus récente ;
 * - `trop-ancienne` : il lui manque des migrations repliées, que cette version ne sait plus appliquer.
 */
export function archiveCompatibility(derniere: string | null, known: string[], folded: string[]): "ok" | "trop-recente" | "trop-ancienne" {
  // Aucune migration notée : une base d'avant le suivi des migrations, que le code ne sait plus reprendre dès qu'il en a replié.
  if (!derniere) return folded.length ? "trop-ancienne" : "ok";
  const at = known.indexOf(derniere);
  if (at < 0) return "trop-recente";
  const lastFolded = folded.length ? known.indexOf(folded[folded.length - 1]) : -1;
  return at < lastFolded ? "trop-ancienne" : "ok";
}

/**
 * Que faire d'un morceau reçu à la position `offset`, quand le serveur en a déjà `have` ? Un morceau renvoyé après
 * une coupure (déjà écrit en entier) est accepté sans être réécrit ; un trou ou un chevauchement est refusé.
 */
export function chunkPlacement(have: number, offset: number, length: number): "ecrire" | "deja-recu" | "decale" {
  if (offset === have) return "ecrire";
  if (offset + length <= have) return "deja-recu";
  return "decale";
}

/** Nom d'archive acceptable dans le dossier des sauvegardes du serveur : un zip, sans chemin. */
export const isArchiveName = (name: string) => /^[\w .()+-]+\.zip$/.test(name) && !name.startsWith(".");

/** Avancement en pourcentage (0 à 100), borné. */
export const percent = (fait: number, total: number) => (total > 0 ? Math.max(0, Math.min(100, Math.round((fait / total) * 100))) : 0);
