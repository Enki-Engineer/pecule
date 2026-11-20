/*
 * Format de la sauvegarde complète (logique pure, testée) : écriture SQL des valeurs, découpage des
 * tables en parties, noms des fichiers dans l'archive, manifeste. Voir backup.ts pour le reste.
 */

/** Version du format : à augmenter si la restauration d'une ancienne archive demande un autre traitement. */
export const BACKUP_FORMAT = 1;

export const MANIFEST_PATH = "manifeste.json";
export const README_PATH = "LISEZ-MOI.txt";
export const SCHEMA_PATH = "base/structure.sql";

/**
 * Tables dont une colonne porte le contenu d'un fichier : ce contenu va dans l'archive comme un vrai
 * fichier (consultable), pas dans le SQL. `rows` : la table a d'autres colonnes, écrites en SQL sans
 * le contenu ; sinon la restauration recrée la ligne (clé + contenu).
 * Toute colonne LONGBLOB du schéma doit figurer ici (contrôlé par un test).
 */
export const FILE_TABLES = [
  {
    table: "invoice_files",
    key: "invoice_id",
    column: "content",
    rows: false,
    dir: "fichiers/factures",
    list: `SELECT f.invoice_id AS id, i.file_name AS name, i.file_mime AS mime, DATE_FORMAT(i.invoice_date, '%Y') AS folder
           FROM invoice_files f LEFT JOIN invoices i ON i.id = f.invoice_id ORDER BY f.invoice_id`,
  },
  {
    table: "document_files",
    key: "document_id",
    column: "content",
    rows: false,
    dir: "fichiers/documents",
    list: `SELECT f.document_id AS id, d.file_name AS name, d.file_mime AS mime, d.domain AS folder
           FROM document_files f LEFT JOIN documents d ON d.id = f.document_id ORDER BY f.document_id`,
  },
  {
    table: "logos",
    key: "key",
    column: "data",
    rows: true,
    dir: "fichiers/logos",
    list: "SELECT `key` AS id, NULL AS name, mime, NULL AS folder FROM logos WHERE data IS NOT NULL ORDER BY `key`",
  },
] as const;

export type FileTable = (typeof FILE_TABLES)[number];

export type BackupManifest = {
  format: number;
  application: "Pécule";
  /** Date et heure de la sauvegarde (ISO, UTC) : l'état de la base à cet instant précis. */
  creeLe: string;
  /** Version du serveur de base de données d'origine (la restauration vise la même famille). */
  serveur: string;
  base: string;
  /** Nom d'hôte de l'installation d'origine (les clés d'accès des membres y sont liées) ; absent des archives d'avant la 1.23.0. */
  origine?: string;
  /** Dernière migration appliquée : la version de Pécule à faire tourner sur la base restaurée. */
  derniereMigration: string | null;
  tables: { nom: string; lignes: number; parties: string[] }[];
  vues: string[];
  /** Contenus sortis de la base : la restauration écrit `chemin` dans `table`.`colonne` de la ligne `cle` = `valeur`. */
  fichiers: { table: string; colonne: string; cle: string; valeur: string | number; chemin: string }[];
  /** Tout ce que contient l'archive (hors ce manifeste), avec taille et empreinte SHA-256. */
  entrees: { chemin: string; octets: number; sha256: string }[];
  totaux: { tables: number; lignes: number; fichiers: number; octetsFichiers: number };
};

export type ColumnKind = "nombre" | "binaire" | "texte";

/** Façon d'écrire une colonne d'après son type (DATA_TYPE d'information_schema). */
export function columnKind(dataType: string): ColumnKind {
  const t = dataType.toLowerCase();
  if (/^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|year)$/.test(t)) return "nombre";
  if (/blob$|binary$|^bit$|^geometry|^point$|^linestring$|polygon$|^geomcollection$/.test(t)) return "binaire";
  return "texte";
}

const ESCAPES: Record<string, string> = { "\0": "\\0", "\n": "\\n", "\r": "\\r", "\x1a": "\\Z", "'": "\\'", "\\": "\\\\" };

/** Chaîne SQL sur une seule ligne (les sauts de ligne sont échappés : une instruction = une ligne). */
export const sqlString = (s: string) => `'${s.replace(/[\0\n\r\x1a'\\]/g, (c) => ESCAPES[c])}'`;

const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

/** Valeur telle que la base l'a rendue (octets bruts, null = NULL) → écriture SQL. */
export function sqlValue(raw: Buffer | null, kind: ColumnKind): string {
  if (raw === null) return "NULL";
  if (kind === "binaire") return raw.length ? `0x${raw.toString("hex")}` : "''";
  const text = raw.toString("utf8");
  return kind === "nombre" && NUMBER.test(text) ? text : sqlString(text);
}

export const sqlIdent = (name: string) => `\`${name.replace(/`/g, "``")}\``;

/** Réglages posés en tête de chaque fichier SQL : il se recharge seul (`mysql < fichier`), dans n'importe quel ordre. */
export const SQL_PREAMBLE = ["SET NAMES utf8mb4;", "SET FOREIGN_KEY_CHECKS = 0;", "SET UNIQUE_CHECKS = 0;", "SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO,STRICT_TRANS_TABLES';"];

/**
 * Découpe les lignes d'une table en instructions INSERT (une par ligne de texte, ≈ 1 Mo au plus)
 * regroupées en parties (≈ 8 Mo) : chaque partie est un fichier de l'archive, écrit dès qu'il est plein.
 */
export class InsertBuilder {
  private done: string[] = [];
  private tuples: string[] = [];
  private statementBytes = 0;
  private partBytes = 0;

  constructor(
    private readonly head: string,
    private readonly limits: { statement: number; part: number } = { statement: 1_000_000, part: 8_000_000 },
  ) {}

  private flush() {
    if (!this.tuples.length) return;
    this.done.push(`${this.head}${this.tuples.join(",")};`);
    this.tuples = [];
    this.statementBytes = 0;
  }

  /** Ajoute une ligne ; renvoie les instructions d'une partie quand elle est pleine. */
  add(values: string[]): string[] | null {
    const tuple = `(${values.join(",")})`;
    const bytes = Buffer.byteLength(tuple) + 1;
    if (this.tuples.length && this.statementBytes + bytes > this.limits.statement) this.flush();
    this.tuples.push(tuple);
    this.statementBytes += bytes;
    this.partBytes += bytes;
    if (this.partBytes < this.limits.part) return null;
    return this.end();
  }

  /** Instructions restantes (null s'il n'y en a pas). */
  end(): string[] | null {
    this.flush();
    if (!this.done.length) return null;
    const part = this.done;
    this.done = [];
    this.partBytes = 0;
    return part;
  }
}

/** Repère posé devant chaque instruction de la structure (elles s'étendent sur plusieurs lignes). */
const SCHEMA_MARK = "-- §";

/** Fichier de structure : réglages, puis une instruction par table et par vue, chacune sous son repère. */
export function schemaSql(title: string, creates: { label: string; sql: string }[]): string {
  return [`-- ${title}`, ...SQL_PREAMBLE, ...creates.flatMap((c) => [`${SCHEMA_MARK} ${c.label}`, `${c.sql.trim().replace(/;+$/, "")};`]), ""].join("\n");
}

/** Instructions du fichier de structure, dans l'ordre : les réglages (une par ligne), puis chaque bloc sous son repère. */
export function schemaStatements(text: string): string[] {
  const [head, ...blocks] = text.split(new RegExp(`^${SCHEMA_MARK}.*$`, "m"));
  return [...sqlStatements(head), ...blocks.map((b) => b.trim().replace(/;+$/, "")).filter(Boolean)];
}

/**
 * Une instruction d'une archive est-elle de celles qu'une sauvegarde de Pécule écrit ? La restauration n'exécute rien
 * d'autre : une archive reçue d'un tiers ne peut ni lire, ni supprimer, ni toucher une autre base. Structure : les
 * quatre réglages de l'en-tête, `CREATE TABLE` et `CREATE … VIEW … AS select` ; données : `INSERT INTO` la table
 * annoncée par le manifeste, et elle seule.
 */
export function allowedRestoreStatement(sql: string, kind: "structure" | "donnees", table?: string): boolean {
  const s = sql.trim().replace(/;+$/, "");
  // Les réglages de l'en-tête ouvrent chaque fichier de l'archive, structure comme données.
  if (SQL_PREAMBLE.some((p) => p.replace(/;$/, "") === s)) return true;
  // Des lignes écrites une à une (« … VALUES (… ») : jamais un INSERT … SELECT, qui lirait ailleurs.
  if (kind === "donnees") return !!table && /^[A-Za-z0-9_]+$/.test(table) && new RegExp(`^INSERT INTO \`${table}\` \\((\`[^\`]+\`)(, ?\`[^\`]+\`)*\\) VALUES \\(`).test(s);
  // Hors des textes entre apostrophes (valeurs par défaut, commentaires) : ce que l'instruction fait vraiment.
  const bare = s.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
  // Une table se décrit, elle ne se remplit pas d'une lecture (CREATE TABLE … SELECT).
  if (/^CREATE TABLE `[A-Za-z0-9_]+` \(/.test(s)) return !/\bselect\b/i.test(bare);
  // Une vue ne lit que les tables de sa base : ni fichier, ni table nommée avec sa base (« `autre`.`table` »).
  return (
    /^CREATE OR REPLACE (ALGORITHM=[A-Z]+ )?(SQL SECURITY (DEFINER|INVOKER) )?VIEW `[A-Za-z0-9_]+` AS select /i.test(s) &&
    !/\binto\s+(outfile|dumpfile)\b/i.test(bare) &&
    !/`[^`]+`\.`[^`]+`\.`[^`]+`/.test(bare) &&
    !/\b(from|join)\s*\(*\s*(`[^`]+`|[A-Za-z0-9_$]+)\s*\.\s*(`|[A-Za-z0-9_$])/i.test(bare)
  );
}

/** Nom d'une partie : `base/donnees/<table>.sql`, puis `<table>.002.sql`… quand la table est découpée. */
export const partPath = (table: string, index: number) => `base/donnees/${table}${index ? `.${String(index + 1).padStart(3, "0")}` : ""}.sql`;

/** Instructions d'un fichier de données (une par ligne ; lignes vides et commentaires « -- » ignorés). */
export const sqlStatements = (text: string) => text.split("\n").filter((l) => l.trim() && !l.startsWith("--"));

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

/** Morceau de nom sûr sur Mac, iPhone et Windows (ni séparateur, ni caractère de contrôle), accents gardés. */
export function safeName(name: string, max = 110): string {
  const clean = name
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (clean.length <= max) return clean;
  const ext = /\.[A-Za-z0-9]{1,6}$/.exec(clean)?.[0] ?? "";
  return `${clean.slice(0, max - ext.length).trimEnd()}${ext}`;
}

/** Les formats déjà compressés sont rangés tels quels dans l'archive. */
export const alreadyCompressed = (mime: string | null) => !!mime && /^(application\/pdf|image\/(jpeg|png|webp|gif|heic|heif)|application\/(zip|gzip)|application\/vnd\.openxmlformats)/.test(mime);

/** Chemin d'un fichier dans l'archive : `<dossier>/<sous-dossier>/<identifiant> - <nom>.<extension>`. */
export function filePath(t: Pick<FileTable, "dir">, row: { id: string | number; name: string | null; mime: string | null; folder: string | null }): string {
  const id = typeof row.id === "number" ? String(row.id).padStart(6, "0") : safeName(String(row.id), 80);
  const ext = EXTENSIONS[(row.mime ?? "").toLowerCase().split(";")[0].trim()];
  let name = row.name ? safeName(row.name) : "";
  // Un nom sans extension prend celle de son type (« facture » → « facture.pdf », pas de nom → « .pdf »).
  if (ext && !/\.[A-Za-z0-9]{1,6}$/.test(name)) name = `${name}.${ext}`;
  const leaf = !name ? id : name.startsWith(".") ? `${id}${name}` : `${id} - ${name}`;
  const folder = row.folder ? safeName(row.folder, 40) : "";
  return [t.dir, folder, leaf].filter(Boolean).join("/");
}

/**
 * Vue telle que la base la décrit → instruction rejouable ailleurs : sans le compte qui l'a créée
 * (DEFINER, propre à l'hébergeur) ni le nom de la base d'origine devant les tables, et avec le NOT de la norme là
 * où MariaDB écrit « !exists( » (un « ! » que MySQL annonce retirer).
 */
export function portableView(createSql: string, database: string): string {
  return createSql
    .replace(/\sDEFINER=(`[^`]*`|[^\s@]+)@(`[^`]*`|\S+)/i, "")
    .replace(/^CREATE\s+/i, "CREATE OR REPLACE ")
    .replaceAll(`${sqlIdent(database)}.`, "")
    .replace(/!exists\(/gi, "not exists(");
}

/** Nom du fichier téléchargé : `pecule-sauvegarde-AAAA-MM-JJ-HHMM.zip`, à l'heure du foyer. */
export function backupFileName(now: Date, timeZone = "Europe/Paris"): string {
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone, dateStyle: "short", timeStyle: "short" }).format(now);
  return `pecule-sauvegarde-${stamp.replace(" ", "-").replace(":", "")}.zip`;
}

/*
 * Sauvegarde écrite par le serveur lui-même, juste avant d'appliquer une migration à une base déjà en service
 * (`src/server/pre-migration.ts`). Son nom porte l'instant (UTC), le nombre de migrations déjà appliquées — l'état
 * de la base, pour ne pas la refaire à chaque nouvel essai d'un démarrage qui échoue — et une fin tirée au hasard.
 */
export const PRE_MIGRATION_PREFIX = "pecule-avant-migration-";

export function preMigrationFileName(now: Date, applied: number, suffix: string): string {
  const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  return `${PRE_MIGRATION_PREFIX}${stamp}-m${applied}-${suffix}.zip`;
}

/** Ce que dit le nom d'une sauvegarde d'avant migration ; `null` si ce n'en est pas une (ou si elle est en cours d'écriture). */
export function parsePreMigrationName(name: string): { applied: number } | null {
  const m = /^pecule-avant-migration-\d{4}-\d{2}-\d{2}-\d{4}-m(\d+)-[0-9a-f]+\.zip$/.exec(name);
  return m ? { applied: Number(m[1]) } : null;
}

/**
 * Faut-il écrire une sauvegarde avant cette migration ? Non si la même base (même nombre de migrations appliquées)
 * vient d'être sauvegardée : c'est un démarrage qui recommence après un échec, rien n'a été écrit entre-temps.
 */
export function preMigrationBackupDue(existing: { name: string; at: number }[], applied: number, now: number, freshMs = 24 * 3_600_000): boolean {
  return !existing.some((f) => parsePreMigrationName(f.name)?.applied === applied && now - f.at < freshMs && now >= f.at);
}

/** Les sauvegardes d'avant migration à retirer pour n'en garder que `keep`, les plus récentes. */
export function preMigrationBackupsToPrune(existing: { name: string; at: number }[], keep: number): string[] {
  return existing
    .filter((f) => parsePreMigrationName(f.name))
    .sort((a, b) => b.at - a.at || (a.name < b.name ? 1 : -1))
    .slice(Math.max(0, keep))
    .map((f) => f.name);
}

const ko = (n: number) => (n >= 1_048_576 ? `${(n / 1_048_576).toFixed(1).replace(".", ",")} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`);

/** Notice rangée dans l'archive : ce qu'elle contient, comment la relire et la restaurer. */
export function readme(m: Pick<BackupManifest, "creeLe" | "serveur" | "base" | "derniereMigration" | "totaux">): string {
  const n = (v: number) => v.toLocaleString("fr-FR");
  return `Pécule — sauvegarde complète
============================

Sauvegarde du ${m.creeLe.slice(0, 10).split("-").reverse().join("/")} à ${m.creeLe.slice(11, 16)} (UTC) : l'état exact de la base à cet instant.
Base « ${m.base} » (${m.serveur}), dernière migration : ${m.derniereMigration ?? "aucune"}.
${n(m.totaux.tables)} tables, ${n(m.totaux.lignes)} lignes, ${n(m.totaux.fichiers)} fichiers (${ko(m.totaux.octetsFichiers)}).

Cette archive contient les données bancaires et les documents de toute la famille, en clair :
à garder dans un endroit sûr, à ne jamais envoyer par mail ni déposer sur un partage.

Contenu
-------
base/structure.sql      Tables et vues (CREATE TABLE, CREATE VIEW).
base/donnees/*.sql      Les lignes de chaque table (INSERT) ; une grosse table est découpée
                        en plusieurs fichiers (.002.sql, .003.sql…).
fichiers/factures/      Les factures, par année : « <n° de facture dans Pécule> - <nom> ».
fichiers/documents/     Les documents du coffre, par domaine : « <n° du document> - <nom> ».
fichiers/logos/         Les logos des marques et des cryptos.
manifeste.json          Inventaire : lignes par table, emplacement de chaque fichier dans la base,
                        taille et empreinte SHA-256 de tout ce que contient l'archive.

Les factures, documents et logos sont des fichiers ordinaires : ils s'ouvrent tels quels.
Dans la base, leur contenu vit dans les tables invoice_files, document_files et logos ;
le manifeste dit quelle ligne reçoit quel fichier.

Ce que l'archive ne contient pas
--------------------------------
- Les secrets de l'hébergement (variables d'environnement : accès à la base, jetons, clés Finta,
  CoinStats et de l'IA) : ils sont dans le fichier de réglages du serveur (.env), à garder à part.
  La clé d'IA enregistrée dans les réglages est dans la base, chiffrée avec API_TOKEN.
- La base du mode démo (données fictives, recréées chaque jour).
- Le code de Pécule (dépôt git).

Vérifier
--------
Depuis le dépôt de Pécule :   pnpm sauvegarde --verifier <archive.zip>
(relit chaque fichier de l'archive et compare taille et empreinte au manifeste)

Restaurer
---------
Dans une installation neuve de Pécule : à l'écran « Bienvenue dans Pécule », « J'ai une sauvegarde : la restaurer »
(code d'installation, puis cette archive).

En ligne de commande, dans une base MariaDB VIDE (jamais sur une base qui contient déjà des tables) :

    pnpm restaurer <archive.zip> --base "mysql://utilisateur:motdepasse@hote:3306/nom_de_la_base"

La commande recrée les tables, recharge les lignes, remet chaque fichier à sa place, puis compare
le nombre de lignes et l'empreinte de chaque fichier au manifeste. Il reste à pointer Pécule
(DATABASE_URL) sur cette base.

À la main, sans Pécule : charger base/structure.sql puis chaque fichier de base/donnees avec le
client mysql (chaque fichier se suffit, l'ordre est libre) ; les contenus des fichiers sont alors
à réinsérer d'après la liste « fichiers » du manifeste.
`;
}
