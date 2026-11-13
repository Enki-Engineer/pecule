import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { exec, one, q } from "../../db.ts";
import { afterBankSync } from "../../bank-sync.ts";
import { guessCategory } from "../../guess.ts";
import { fxConverter } from "../../fx.ts";
import { householdCurrency, today } from "../../region.ts";
import { isCurrency } from "../../../lib/currencies.ts";
import { listMembers } from "../../members.ts";
import { historyLabel } from "../../../lib/bank-history.ts";
import { reconcile, type RecTx } from "../../../lib/bank-reconcile.ts";
import { near, sum } from "../../../lib/imports.ts";
import { t, tk } from "../../../lib/i18n.ts";
import { labelKey, ownerKey, ownerLabel } from "../../../lib/labels.ts";
import { day, money, num, str, type Extractor } from "../registry.ts";

/*
 * Relevé de compte en PDF → opérations du compte (`origin = 'fichier'`), pour reprendre un historique que la banque
 * ne donne plus autrement. Le relevé doit tomber juste (solde de départ + opérations = solde d'arrivée) ; une
 * opération déjà connue du compte (même date, même montant) n'est pas recréée.
 */

const NEW = "__nouveau__";
const parse = z.object({
  is_bank_statement: z.boolean(),
  account_id: z.string().nullable(),
  owner: z.string().nullable(),
  bank: z.string().nullable(),
  account_label: z.string().nullable(),
  account_tail: z.string().nullable(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  currency: z.string().nullable().optional(),
  operations: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().min(1), amount: z.number() })),
});
type Statement = z.infer<typeof parse>;

type Account = { id: string; name: string; institution: string | null; source: string; currency: string };
const accounts = () => q<Account>("SELECT id, COALESCE(display_name, name) AS name, institution, source, currency FROM accounts ORDER BY name");
/** Devise du relevé, quand elle est lue et que Pécule sait la convertir. */
const statementCurrency = (d: Statement) => {
  const code = d.currency?.trim().toUpperCase();
  return isCurrency(code) ? code : undefined;
};
const accountName = (d: Statement) => [d.bank, d.account_label, d.account_tail ? `•••• ${d.account_tail.slice(-4)}` : null].filter(Boolean).join(" · ").slice(0, 255) || "Compte";

/** Compte qui reçoit le relevé : celui choisi, sinon un compte créé par un relevé précédent du même compte. */
async function target(d: Statement): Promise<Account | null> {
  const list = await accounts();
  if (d.account_id && d.account_id !== NEW) return list.find((a) => a.id === d.account_id) ?? null;
  return list.find((a) => a.source === "manuel" && a.name === accountName(d)) ?? null;
}

async function plan(d: Statement, account: Account | null) {
  const incoming: RecTx[] = d.operations.map((o, i) => ({ id: String(i), date: o.date, amount: o.amount, label: o.label, status: "posted" }));
  if (!account || !d.operations.length) return { fresh: d.operations, known: 0 };
  const days = d.operations.map((o) => o.date).sort();
  // Montants comparés dans la devise du compte, celle du relevé.
  const existing = await q<RecTx>("SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS date, COALESCE(original_amount, amount) AS amount, label, status FROM transactions WHERE account_id = ? AND status <> 'deleted' AND date BETWEEN DATE_SUB(?, INTERVAL 5 DAY) AND DATE_ADD(?, INTERVAL 5 DAY)", [account.id, days[0], days.at(-1)]);
  const r = reconcile(incoming, existing, { nearDays: 0 });
  return { fresh: r.onlyIncoming.map((x) => d.operations[Number(x.id)]), known: r.pairs.length };
}

export const releve: Extractor<Statement> = {
  id: "releve",
  label: tk("Relevé de compte"),
  matches: (c) => c.kind === "releve" && c.domain === "banque",
  maxTokens: 32_000,
  pdfUpTo: 20,
  instructions:
    "Document attendu : un relevé de compte bancaire (compte courant, livret, carte). Recopie TOUTES les opérations du compte principal du relevé, dans l'ordre, sans en sauter : date de l'opération (pas la date de valeur), libellé complet sur une ligne, montant signé — négatif pour un débit, positif pour un crédit. N'inclus ni les lignes de solde, ni les totaux, ni les opérations d'un autre compte figurant sur le même relevé. « opening_balance » et « closing_balance » : soldes de début et de fin de période (négatifs si débiteurs). « account_tail » : les 4 derniers caractères du numéro de compte, rien de plus. « account_id » : le compte de Pécule correspondant, choisi dans la liste fournie, sinon null. « is_bank_statement » est faux pour tout autre document (relevé de placement, avis d'opéré, échéancier).",
  schema: {
    properties: {
      is_bank_statement: { type: "boolean" },
      account_id: str("Identifiant du compte dans la liste fournie, sinon null"),
      owner: str("Toujours null"),
      bank: str("Banque, nom usuel"),
      account_label: str("Intitulé du compte (« Compte courant », « Livret A »)"),
      account_tail: str("4 derniers caractères du numéro de compte"),
      period_start: day("Début de la période du relevé"),
      period_end: day("Fin de la période du relevé"),
      opening_balance: num("Solde en début de période"),
      closing_balance: num("Solde en fin de période"),
      currency: str("Devise du compte, code ISO à trois lettres (EUR, CHF, USD…)"),
      operations: { type: "array", items: { type: "object", properties: { date: { type: "string" }, label: { type: "string" }, amount: { type: "number" } }, required: ["date", "label", "amount"], additionalProperties: false } },
    },
    required: ["is_bank_statement", "account_id", "owner", "bank", "account_label", "account_tail", "period_start", "period_end", "opening_balance", "closing_balance", "currency", "operations"],
  },
  parse,
  context: async () => `Comptes de Pécule : ${(await accounts()).map((a) => `${a.id} = ${a.name}${a.institution ? ` (${a.institution})` : ""}`).join(" ; ") || "aucun"}.`,
  rejected: (d) => !d.is_bank_statement || !d.operations.length,
  title: (d) => t("Relevé {compte} — {n} opérations", { compte: accountName(d), n: d.operations.length }),
  async fields(d) {
    const [list, members, found] = await Promise.all([accounts(), listMembers(), target(d)]);
    return [
      { key: "account_id", label: tk("Compte"), type: "choix", value: found?.id ?? (d.account_id === NEW ? NEW : null), options: [{ value: NEW, label: tk("Nouveau compte…") }, ...list.map((a) => ({ value: a.id, label: a.name }))], required: true },
      { key: "owner", label: tk("Titulaire (nouveau compte)"), type: "choix", value: d.owner ?? "joint", options: ["joint", ...members.map((m) => ownerKey(m.name)), "pro", "autre"].map((o) => ({ value: o, label: ownerLabel(o) })) },
      { key: "bank", label: tk("Banque"), type: "texte", value: d.bank },
      { key: "account_label", label: tk("Intitulé du compte"), type: "texte", value: d.account_label },
      { key: "period_start", label: tk("Début de période"), type: "date", value: d.period_start },
      { key: "period_end", label: tk("Fin de période"), type: "date", value: d.period_end },
      { key: "opening_balance", label: tk("Solde de départ"), type: "montant", value: d.opening_balance },
      { key: "closing_balance", label: tk("Solde d'arrivée"), type: "montant", value: d.closing_balance },
    ];
  },
  table: (d) => ({
    title: t("Opérations"),
    columns: [t("Date"), t("Libellé"), t("Montant")],
    lines: [...d.operations.slice(0, 6), ...(d.operations.length > 9 ? d.operations.slice(-3) : d.operations.slice(6))].map((o) => [o.date, o.label, o.amount]),
    total: d.operations.length,
  }),
  checks(d) {
    const total = sum(d.operations.map((o) => o.amount));
    const out = [
      { ok: d.opening_balance != null && d.closing_balance != null, label: t("Soldes de début et de fin lus") },
      // Un compte existant, ou « Nouveau compte… » choisi exprès : jamais de compte créé sans qu'on l'ait demandé.
      { ok: !!d.account_id, label: t("Compte de Pécule choisi") },
    ];
    if (d.opening_balance != null && d.closing_balance != null)
      out.push({ ok: near(d.opening_balance + total, d.closing_balance, 0.01), label: t("Solde de départ + opérations = solde d'arrivée ({a} + {b} = {c})", { a: money(d.opening_balance, statementCurrency(d)), b: money(total, statementCurrency(d)), c: money(d.closing_balance, statementCurrency(d)) }) });
    if (d.period_start && d.period_end) out.push({ ok: d.operations.every((o) => o.date >= d.period_start! && o.date <= d.period_end!), label: t("Toutes les opérations sont dans la période du relevé") });
    return out;
  },
  async existing(d) {
    const account = await target(d);
    if (!account) return null;
    const p = await plan(d, account);
    // Des opérations qui s'ajoutent à un compte existant ne changent rien à ce qui est déjà là.
    return { summary: t("Compte « {compte} » : {a} opérations déjà connues, {b} à ajouter.", { compte: account.name, a: p.known, b: p.fresh.length }), diffs: [] };
  },
  async apply(d, _ctx, track) {
    let account = await target(d);
    if (!account) {
      const members = await listMembers();
      const owner = d.owner && (["joint", "pro", "autre"].includes(d.owner) || members.some((m) => ownerKey(m.name) === d.owner)) ? d.owner : "joint";
      const id = `m:${randomBytes(12).toString("hex")}`;
      const name = accountName(d);
      await track.upsert("accounts", { id }, { name, institution: d.bank?.slice(0, 120) ?? null, owner, kind: /livret|épargne|epargne|pel|ldd/i.test(d.account_label ?? "") ? "epargne" : "courant", currency: statementCurrency(d) ?? householdCurrency(), hidden: 0, excluded: 0, source: "manuel" });
      account = { id, name, institution: d.bank, source: "manuel", currency: statementCurrency(d) ?? householdCurrency() };
    }
    const { fresh, known } = await plan(d, account);
    // Les montants du relevé sont dans la devise du compte : ramenés à celle du foyer au cours de leur jour, l'original gardé.
    const convert = await fxConverter([account.currency], d.period_start ?? d.operations.map((o) => o.date).sort()[0] ?? today());
    const seen = new Map<string, number>();
    for (const row of fresh) {
      const base = `${row.date}|${row.amount}|${row.label}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const id = `f:${createHash("sha1").update(`${account.id}|${base}|${n}`).digest("hex").slice(0, 32)}`;
      const label = historyLabel(row.label);
      const key = labelKey(label);
      const guess = await guessCategory(key);
      const held = convert(row.amount, account.currency, row.date);
      await track.upsert("transactions", { id }, { account_id: account.id, date: row.date, amount: held.amount, original_amount: held.originalAmount, original_currency: held.originalCurrency, label, bank_label: row.label.slice(0, 255), label_key: key, status: "posted", origin: "fichier", category_id: guess?.categoryId ?? null, category_source: guess?.source ?? null });
    }
    // Le solde d'un compte tenu à la main suit le relevé le plus récent.
    if (account.source === "manuel" && d.closing_balance != null && d.period_end) {
      const later = await one("SELECT id FROM transactions WHERE account_id = ? AND date > ? LIMIT 1", [account.id, d.period_end]);
      const closing = convert(d.closing_balance, account.currency, d.period_end);
      if (!later) await track.upsert("accounts", { id: account.id }, { balance: closing.amount, balance_original: closing.originalAmount, balance_at: `${d.period_end} 00:00:00` });
      await exec("INSERT IGNORE INTO balances (account_id, date, balance) VALUES (?, ?, ?)", [account.id, d.period_end, closing.amount]);
    }
    await afterBankSync();
    return t("{a} opérations ajoutées à « {compte} » ({b} déjà connues).", { a: fresh.length, compte: account.name, b: known });
  },
};
