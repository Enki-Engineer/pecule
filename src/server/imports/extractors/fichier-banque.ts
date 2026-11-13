import { z } from "zod";
import { ActionError } from "../../actions.ts";
import { importBankFile } from "../../bank-files.ts";
import { one, q } from "../../db.ts";
import { listMembers } from "../../members.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { ownerKey, ownerLabel } from "../../../lib/labels.ts";
import type { Extractor } from "../registry.ts";

/*
 * Export de la banque (OFX, QIF, CSV) trouvé dans un dossier déposé : lu par le parseur exact (src/lib/bank-files.ts),
 * jamais par l'IA. La relecture demande seulement le compte qui reçoit les opérations. Le fichier reste au coffre.
 */

const NEW = "__nouveau__";
const parse = z.object({
  account_id: z.string().nullable(),
  name: z.string().nullable(),
  kind: z.enum(["courant", "carte", "epargne"]),
  owner: z.string(),
  file_account: z.string().nullable(),
  format: z.string(),
  rows: z.number(),
  skipped: z.number(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  accounts: z.array(z.object({ account: z.string(), rows: z.number() })),
  sample: z.array(z.object({ date: z.string(), label: z.string(), amount: z.number() })),
});
export type BankFileData = z.infer<typeof parse>;

async function text(documentId: number | null): Promise<string> {
  const f = documentId ? await one<{ content: Buffer }>("SELECT content FROM document_files WHERE document_id = ?", [documentId]) : null;
  if (!f) throw new ActionError(404, t("Le fichier n'est plus au coffre."));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(f.content);
  } catch {
    return new TextDecoder("windows-1252").decode(f.content);
  }
}

const options = (d: BankFileData) => ({
  accountId: d.account_id && d.account_id !== NEW ? d.account_id : undefined,
  create: d.account_id && d.account_id !== NEW ? undefined : { name: d.name?.trim() || t("Compte importé"), kind: d.kind, owner: d.owner },
  fileAccount: d.file_account ?? undefined,
});

export const fichierBanque: Extractor<BankFileData> = {
  id: "fichier_banque",
  label: tk("Export de la banque"),
  matches: () => false,
  instructions: "",
  schema: { properties: {}, required: [] },
  parse,
  title: (d) => t("Export de la banque — {n} opérations", { n: d.rows }),
  async fields(d) {
    const [accounts, members] = await Promise.all([q<{ id: string; name: string }>("SELECT id, COALESCE(display_name, name) AS name FROM accounts ORDER BY name"), listMembers()]);
    return [
      { key: "account_id", label: tk("Compte"), type: "choix", value: accounts.some((a) => a.id === d.account_id) || d.account_id === NEW ? d.account_id : null, options: [{ value: NEW, label: tk("Nouveau compte…") }, ...accounts.map((a) => ({ value: a.id, label: a.name }))], required: true },
      ...(d.accounts.length > 1 ? [{ key: "file_account", label: tk("Compte du fichier"), type: "choix" as const, value: d.file_account, options: d.accounts.map((a) => ({ value: a.account, label: `${a.account} · ${a.rows}` })), required: true }] : []),
      { key: "name", label: tk("Nom du compte"), type: "texte", value: d.name },
      { key: "kind", label: tk("Nature du compte"), type: "choix", value: d.kind, options: [{ value: "courant", label: tk("Compte courant") }, { value: "epargne", label: tk("Épargne") }, { value: "carte", label: tk("Carte") }] },
      { key: "owner", label: tk("Titulaire"), type: "choix", value: d.owner, options: ["joint", ...members.map((m) => ownerKey(m.name)), "pro", "autre"].map((o) => ({ value: o, label: ownerLabel(o) })) },
    ];
  },
  table: (d) => ({ title: t("Opérations"), columns: [t("Date"), t("Libellé"), t("Montant")], lines: d.sample.map((r) => [r.date, r.label, r.amount]), total: d.rows }),
  checks: (d) => [
    { ok: d.rows > 0, label: t("{n} opérations lues ({format})", { n: d.rows, format: d.format.toUpperCase() }) },
    { ok: d.skipped === 0, label: d.skipped ? t("{n} lignes illisibles écartées", { n: d.skipped }) : t("Aucune ligne illisible") },
    { ok: d.accounts.length <= 1 || !!d.file_account, label: t("Compte du fichier désigné") },
    // Un compte existant, ou « Nouveau compte… » choisi exprès : jamais de compte créé sans qu'on l'ait demandé.
    { ok: !!d.account_id, label: t("Compte de Pécule choisi") },
  ],
  async existing(d, ctx) {
    if (!d.account_id || d.account_id === NEW || (d.accounts.length > 1 && !d.file_account)) return null;
    const r = await importBankFile(await text(ctx.documentId), { ...options(d), apply: false });
    return { summary: t("Compte « {compte} » : {a} opérations déjà connues, {b} à ajouter.", { compte: r.target?.name ?? "", a: r.known, b: r.fresh }), diffs: [] };
  },
  async apply(d, ctx, track) {
    if (d.accounts.length > 1 && !d.file_account) throw new ActionError(400, t("Ce fichier mêle plusieurs comptes : choisis lequel importer."));
    const r = await importBankFile(await text(ctx.documentId), { ...options(d), apply: true });
    // Ce que l'import a créé est noté au journal, pour pouvoir l'annuler.
    if (r.createdAccount) track.log.push({ op: "upsert", table: "accounts", key: { id: r.createdAccount }, before: null });
    for (const id of r.ids ?? []) track.log.push({ op: "upsert", table: "transactions", key: { id }, before: null });
    return t("{a} opérations ajoutées à « {compte} » ({b} déjà connues).", { a: r.fresh, compte: r.target?.name ?? "", b: r.known });
  },
};
