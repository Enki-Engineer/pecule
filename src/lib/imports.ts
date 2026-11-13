import { tk } from "./i18n.ts";

/*
 * Import massif de documents : règles pures, partagées par l'écran, le serveur et la ligne de commande.
 * États d'une ligne, tri des fichiers avant l'envoi, estimation du coût, contrôles arithmétiques.
 */

export const ITEM_STATUSES = ["envoi", "attente", "lecture", "a_relire", "valide", "range", "ecarte", "doublon", "ignore", "erreur"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  envoi: tk("Envoi"),
  attente: tk("En attente"),
  lecture: tk("Lecture"),
  a_relire: tk("À relire"),
  valide: tk("Validé##document"),
  range: tk("Rangé"),
  ecarte: tk("Écarté"),
  doublon: tk("Déjà connu"),
  ignore: tk("Non importé"),
  erreur: tk("Erreur"),
};

/** États où le serveur a encore du travail : l'écran continue d'interroger. */
export const isPending = (s: ItemStatus) => s === "envoi" || s === "attente" || s === "lecture";

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_BATCH_FILES = 400;

const MIMES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  ofx: "application/x-ofx",
  qfx: "application/x-ofx",
  qif: "application/x-qif",
};

/** Exports bancaires (OFX, QIF, CSV) : lus par le parseur exact, jamais par l'IA. */
export const isBankFile = (mime: string | null | undefined) => mime === "application/x-ofx" || mime === "application/x-qif" || mime === "text/csv";

export type Verdict = { ok: true; mime: string } | { ok: false; reason: string };

/** Un fichier du dossier déposé est-il importable ? Sinon, pourquoi (raison marquée `tk`, traduite à l'affichage). */
export function acceptFile(relPath: string, size: number): Verdict {
  const name = relPath.split("/").pop() ?? relPath;
  if (name.startsWith(".") || name.startsWith("~$") || /^(thumbs\.db|desktop\.ini)$/i.test(name)) return { ok: false, reason: tk("Fichier technique") };
  if (relPath.split("/").some((part) => part.startsWith(".") || part === "node_modules" || part === "__MACOSX")) return { ok: false, reason: tk("Dossier technique") };
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const mime = MIMES[ext];
  if (!mime) return { ok: false, reason: tk("Type de fichier non pris en charge") };
  if (!size) return { ok: false, reason: tk("Fichier vide") };
  if (size > MAX_FILE_SIZE) return { ok: false, reason: tk("Fichier de plus de 20 Mo") };
  return { ok: true, mime };
}

/** Chemin rendu sûr et court : séparateurs unifiés, pas de remontée de dossier. */
export function cleanPath(relPath: string): string {
  return relPath
    .replace(/\\/g, "/")
    .split("/")
    .filter((p) => p && p !== "." && p !== "..")
    .join("/")
    .slice(-500);
}

export type Price = { input: number; output: number };

/**
 * Coût d'IA prévisible d'un fichier, en dollars, avant de l'avoir lu : deux lectures (reconnaître, puis extraire),
 * environ 1 500 jetons par page (une page ≈ 60 ko de PDF, une photo = une page), et la réponse. Ordre de grandeur
 * seulement : le coût réel est mesuré appel par appel.
 */
export function estimateUsd(size: number, mime: string, price: Price): number {
  if (isBankFile(mime)) return 0;
  const pages = mime === "application/pdf" ? Math.min(40, Math.max(1, Math.round(size / 60_000))) : mime.startsWith("image/") ? 1 : Math.min(40, Math.max(1, Math.round(size / 3_000)));
  const input = 1_500 + Math.min(pages, 4) * 1_500 + pages * 1_500 + 1_500;
  const output = 600 + 1_800;
  return (input * price.input + output * price.output) / 1_000_000;
}

/* ---------- Contrôles ---------- */

export type Check = { ok: boolean; label: string };
export type Confidence = "haute" | "moyenne" | "basse";

/** Deux montants égaux à la tolérance près (1 centime par défaut, ou une part du plus grand). */
export function near(a: number | null | undefined, b: number | null | undefined, tolerance = 0.01, relative = 0): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.max(tolerance, relative * Math.max(Math.abs(a), Math.abs(b))) + 1e-9;
}

export const sum = (values: (number | null | undefined)[]) => Math.round(values.reduce<number>((s, v) => s + (v ?? 0), 0) * 100) / 100;

/**
 * Une proposition est « sûre » quand elle peut être validée sans relecture : tous les contrôles passent, la
 * lecture est sans doute, et elle ne change rien à ce que Pécule contient déjà.
 */
export function isSafe(item: { status: string; checks: Check[] | null; confidence: string | null; changes: number }): boolean {
  return item.status === "a_relire" && item.confidence === "haute" && item.changes === 0 && !!item.checks?.length && item.checks.every((c) => c.ok);
}
