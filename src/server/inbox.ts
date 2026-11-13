import { createHash } from "node:crypto";
import { one } from "./db.ts";
import { classifyDocument, createDocumentFromFile, extractText } from "./documents.ts";
import { createInvoiceFromFile } from "./invoices.ts";

/*
 * Dépôt d'un fichier sans savoir ce que c'est (assistant, Raccourci iPhone) : Claude le reconnaît,
 * une facture d'achat part dans les factures (lecture des articles, rapprochement), tout le reste
 * dans le coffre de documents.
 */

export type Ingested = { type: "invoice" | "document"; id: number; created: boolean; title: string };

export async function ingestUpload(
  userId: number,
  file: { name: string; mime: string; content: Buffer },
  source: string,
  opts: { accountsSql: string; force?: "invoice" | "document" },
): Promise<Ingested> {
  const hash = createHash("sha256").update(file.content).digest("hex");
  // Fichier déjà connu : son titre n'est rendu que s'il est commun ou à ce membre (jamais celui du document privé d'un autre).
  const shown = (row: { owner_user_id: number | null; title: string }) => (row.owner_user_id === null || row.owner_user_id === userId ? row.title : file.name);
  const inv = await one<{ id: number; title: string; owner_user_id: number | null }>("SELECT id, title, owner_user_id FROM invoices WHERE file_sha256 = ?", [hash]);
  if (inv && opts.force !== "document") return { type: "invoice", id: inv.id, created: false, title: shown(inv) };
  const doc = await one<{ id: number; title: string; owner_user_id: number | null }>("SELECT id, title, owner_user_id FROM documents WHERE file_sha256 = ?", [hash]);
  if (doc && opts.force !== "invoice") return { type: "document", id: doc.id, created: false, title: shown(doc) };

  if (opts.force === "invoice") {
    const r = await createInvoiceFromFile(file, { accountsSql: opts.accountsSql, source });
    const t = await one<{ title: string }>("SELECT title FROM invoices WHERE id = ?", [r.id]);
    return { type: "invoice", id: r.id, created: r.created, title: t?.title ?? file.name };
  }
  const { text, pages } = await extractText(file.content, file.mime);
  const classification = await classifyDocument(file.content, file.mime, text, pages, file.name, userId).catch((e) => {
    console.error("[dépôt] reconnaissance impossible", e);
    return null;
  });
  if (classification?.is_invoice && opts.force !== "document") {
    const r = await createInvoiceFromFile(file, { accountsSql: opts.accountsSql, source });
    const t = await one<{ title: string }>("SELECT title FROM invoices WHERE id = ?", [r.id]);
    return { type: "invoice", id: r.id, created: r.created, title: t?.title ?? classification.title };
  }
  const d = await createDocumentFromFile(userId, file, source, { text, pages, classification });
  return { type: "document", ...d };
}
