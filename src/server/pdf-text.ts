import { Worker } from "node:worker_threads";

/*
 * Texte d'un PDF. À part de `documents.ts` pour que la traduction des demandes à l'IA puisse s'en servir sans
 * dépendre de lui (un fournisseur qui ne lit pas les PDF reçoit leur texte : `src/server/ai-wires.ts`).
 */

/** Texte gardé d'un document, au plus. */
export const MAX_TEXT = 1_000_000;

/*
 * Lecture du texte d'un PDF dans un fil à part, une à la fois, avec un délai et une mémoire bornés : un PDF piégé
 * (flux compressés géants, milliers de pages) ne doit ni figer ni faire tomber le serveur, qui n'a qu'un processus.
 * Au-delà des bornes, le document est gardé sans texte (il reste lisible par l'IA page par page, et à l'écran).
 */
export const PDF_TIMEOUT_MS = 20_000;
const PDF_MAX_PAGES = 400;
const PDF_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const { extractText, getDocumentProxy } = await import(workerData.unpdf);
  const pdf = await getDocumentProxy(new Uint8Array(workerData.content));
  if (pdf.numPages > workerData.maxPages) return parentPort.postMessage({ totalPages: pdf.numPages, text: "" });
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  parentPort.postMessage({ totalPages, text: String(text).slice(0, workerData.maxText) });
})().catch((e) => parentPort.postMessage({ error: String(e && e.message || e) }));
`;
// Adresse du paquet résolue ici (à côté du serveur) : le fil, lui, résoudrait depuis le dossier courant du processus.
const UNPDF = (() => {
  try {
    return import.meta.resolve("unpdf");
  } catch {
    return "unpdf";
  }
})();
let pdfQueue: Promise<unknown> = Promise.resolve();
/** Un seul travail sur un PDF à la fois (lecture du texte, découpe) : chacun a son fil, sa mémoire et son délai. */
export function queued<T>(run: () => Promise<T>): Promise<T> {
  const next = pdfQueue.then(run, run);
  pdfQueue = next.catch(() => undefined);
  return next;
}

export function pdfTextIsolated(content: Buffer): Promise<{ totalPages: number; text: string }> {
  const run = () =>
    new Promise<{ totalPages: number; text: string }>((resolve, reject) => {
      const worker = new Worker(PDF_WORKER, { eval: true, workerData: { content, unpdf: UNPDF, maxPages: PDF_MAX_PAGES, maxText: MAX_TEXT }, resourceLimits: { maxOldGenerationSizeMb: 384 } });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error("lecture trop longue, abandonnée"));
      }, PDF_TIMEOUT_MS);
      worker.once("message", (m: { totalPages?: number; text?: string; error?: string }) => {
        clearTimeout(timer);
        void worker.terminate();
        if (m.error || m.totalPages === undefined) reject(new Error(m.error ?? "réponse vide"));
        else resolve({ totalPages: m.totalPages, text: m.text ?? "" });
      });
      worker.once("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error("lecture interrompue (mémoire ou erreur)"));
      });
    });
  return queued(run);
}
