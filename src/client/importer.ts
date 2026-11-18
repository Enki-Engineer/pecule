import { api } from "./api.ts";
import { acceptFile, cleanPath, MAX_BATCH_FILES, type Check, type ItemStatus } from "../lib/imports.ts";

/* Import massif, côté appareil : lire un dossier déposé, calculer les empreintes, annoncer puis envoyer les fichiers. */

export type ImportItem = {
  id: number;
  path: string;
  /** Partie du fichier lue par cette ligne (un compte d'un relevé qui en porte plusieurs). */
  part: string | null;
  size: number;
  status: ItemStatus;
  extractor: string | null;
  type: string | null;
  title: string | null;
  documentId: number | null;
  invoiceId: number | null;
  confidence: string | null;
  checksOk: number;
  checksTotal: number;
  changes: number;
  known: boolean;
  safe: boolean;
  error: string | null;
  summary: string | null;
  costEur: number;
};
export type ImportBatch = {
  id: number;
  name: string;
  status: string;
  createdAt: string;
  costCapEur: number;
  costEur: number;
  capped: boolean;
  /** Plafond du mois de l'IA atteint, lectures de fond en pause (Réglages → Coût de l'IA). */
  budgetPaused: boolean;
  ai: boolean;
  counts: Partial<Record<ItemStatus, number>>;
  safe: number;
  /** Ce que les fichiers d'un même type disent ensemble : les relevés d'un compte, leur période, ce qui manque. */
  overview: { title: string; detail: string; warnings: string[] }[];
  items: ImportItem[];
  estimateEur?: number;
};
export type ImportField = { key: string; label: string; type: "texte" | "montant" | "nombre" | "date" | "mois" | "annee" | "pourcent" | "choix"; value: string | number | null; options?: { value: string; label: string }[]; required?: boolean };
export type ImportDetail = ImportItem & {
  doubts: string[];
  fields: ImportField[];
  edited: string[];
  table: { title: string; columns: string[]; lines: (string | number | null)[][]; total: number } | null;
  rows: ImportRows | null;
  checks: Check[];
  existing: { summary: string; diffs: { label: string; before: string; after: string }[] } | null;
};
/** Lignes d'un fichier montrées en entier et corrigeables une à une (les opérations d'un relevé). */
export type ImportRows = {
  key: string;
  columns: { key: string; label: string; type: "date" | "texte" | "montant" }[];
  lines: Record<string, string | number | null>[];
  currency: string | null;
  /** Solde avant la première ligne : l'écran en tire le solde après chaque ligne. */
  opening: number | null;
  marks: { index: number; note: string }[];
};
export type RowEdit = { op: "set"; index: number; values: Record<string, string | number | null> } | { op: "remove"; index: number } | { op: "add"; index?: number; values: Record<string, string | number | null> };
export type BatchLine = { id: number; name: string; status: string; created_at: string; files: number; to_review: number; done: number; cost_eur: number };

export type Picked = { path: string; file: File };

type Entry = { isFile: boolean; isDirectory: boolean; name: string; file?: (ok: (f: File) => void, ko: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (list: Entry[]) => void, ko: (e: unknown) => void) => void } };

async function walk(entry: Entry, base: string, out: Picked[]) {
  const path = base ? `${base}/${entry.name}` : entry.name;
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((ok, ko) => entry.file!(ok, ko));
    out.push({ path, file });
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // Un dossier se lit par paquets : on redemande jusqu'à ce qu'il n'y ait plus rien.
    for (;;) {
      const list = await new Promise<Entry[]>((ok, ko) => reader.readEntries(ok, ko));
      if (!list.length) break;
      for (const child of list) await walk(child, path, out);
    }
  }
}

/** Fichiers d'un dépôt (glisser-déposer) : les dossiers sont parcourus en entier, chemins gardés. */
export async function droppedFiles(data: DataTransfer): Promise<Picked[]> {
  const out: Picked[] = [];
  const entries = [...data.items].map((i) => (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() ?? null);
  if (entries.some(Boolean)) for (const e of entries) if (e) await walk(e, "", out);
  if (!out.length) for (const f of data.files) out.push({ path: f.name, file: f });
  return out;
}

/** Fichiers choisis par le sélecteur (dossier entier ou fichiers). */
export const pickedFiles = (list: FileList): Picked[] => [...list].map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }));

async function sha256(file: File): Promise<string | null> {
  if (!crypto.subtle) return null;
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type Progress = { step: "empreintes" | "envoi"; done: number; total: number };

/**
 * Ouvre un lot avec ces fichiers et envoie ceux que Pécule ne connaît pas encore (deux à la fois).
 * L'empreinte est calculée ici : un fichier déjà au coffre n'est pas renvoyé.
 */
export async function startImport(name: string, picked: Picked[], onProgress: (p: Progress) => void): Promise<ImportBatch> {
  const files = picked.slice(0, MAX_BATCH_FILES).map((p) => ({ ...p, path: cleanPath(p.path) }));
  const declared: { path: string; size: number; sha256: string | null }[] = [];
  let n = 0;
  for (const f of files) {
    onProgress({ step: "empreintes", done: n++, total: files.length });
    declared.push({ path: f.path, size: f.file.size, sha256: acceptFile(f.path, f.file.size).ok ? await sha256(f.file) : null });
  }
  const batch = await api<ImportBatch>("/imports", { method: "POST", json: { name, files: declared } });
  const byPath = new Map(files.map((f) => [f.path, f.file]));
  const queue = batch.items.filter((i) => i.status === "envoi");
  let sent = 0;
  onProgress({ step: "envoi", done: 0, total: queue.length });
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const file = byPath.get(item.path);
      if (file) await api(`/imports/items/${item.id}/file`, { method: "POST", body: await file.arrayBuffer(), headers: { "Content-Type": "application/octet-stream" } }).catch(() => undefined);
      onProgress({ step: "envoi", done: ++sent, total: sent + queue.length });
    }
  };
  await Promise.all([worker(), worker()]);
  return batch;
}
