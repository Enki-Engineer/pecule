import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { one, q } from "../../db.ts";
import { afterBankSync } from "../../bank-sync.ts";
import { guessCategory } from "../../guess.ts";
import { fxConverter } from "../../fx.ts";
import { householdCurrency, today } from "../../region.ts";
import { isCurrency } from "../../../lib/currencies.ts";
import { listMembers } from "../../members.ts";
import { historyLabel } from "../../../lib/bank-history.ts";
import { reconcile, type RecTx } from "../../../lib/bank-reconcile.ts";
import { near, sum } from "../../../lib/imports.ts";
import { locale, t, tk, tn } from "../../../lib/i18n.ts";
import { labelKey, ownerKey, ownerLabel } from "../../../lib/labels.ts";
import { balanceGap, coverage, sameAccount, suspects, tailKey } from "../../../lib/statements.ts";
import { day, money, num, str, type Extractor } from "../registry.ts";

/*
 * Relevé de compte en PDF → opérations du compte (`origin = 'fichier'`), pour reprendre un historique que la banque
 * ne donne plus autrement. Le relevé doit tomber juste (solde de départ + opérations = solde d'arrivée) ; une
 * opération déjà connue du compte n'est pas recréée. Un relevé qui porte plusieurs comptes donne une proposition par
 * compte (`parts`), une longue liste d'opérations est lue en plusieurs réponses et se corrige ligne à ligne (`rows`),
 * et les relevés d'un même compte déposés ensemble partagent le choix du compte et disent s'il en manque un
 * (`shared`, `overview`).
 */

const NEW = "__nouveau__";
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parse = z.object({
  is_bank_statement: z.boolean(),
  account_id: z.string().nullable(),
  owner: z.string().nullable(),
  bank: z.string().nullable(),
  account_label: z.string().nullable(),
  account_tail: z.string().nullable(),
  period_start: z.string().regex(DAY).nullable(),
  period_end: z.string().regex(DAY).nullable(),
  opening_balance: z.number().nullable(),
  closing_balance: z.number().nullable(),
  total_debit: z.number().nullable().optional(),
  total_credit: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  other_accounts: z.array(z.object({ label: z.string(), tail: z.string().nullable() })).optional(),
  operations: z.array(z.object({ date: z.string().regex(DAY), label: z.string().min(1).max(500), amount: z.number() })),
});
type Statement = z.infer<typeof parse>;

type Account = { id: string; name: string; raw: string; institution: string | null; source: string; currency: string };
const accounts = () => q<Account>("SELECT id, COALESCE(display_name, name) AS name, name AS raw, institution, source, currency FROM accounts ORDER BY name");
/** Devise du relevé, quand elle est lue et que Pécule sait la convertir. */
const statementCurrency = (d: Statement) => {
  const code = d.currency?.trim().toUpperCase();
  return isCurrency(code) ? code : undefined;
};
const tailText = (tail: string | null | undefined) => (tailKey(tail) ? `•••• ${tailKey(tail)}` : null);
const accountName = (d: Statement) => [d.bank, d.account_label, tailText(d.account_tail)].filter(Boolean).join(" · ").slice(0, 255) || "Compte";
const identity = (d: Statement) => ({ bank: d.bank, label: d.account_label, tail: d.account_tail });
const dayText = (d: string) => new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * Compte qui reçoit le relevé : celui choisi, sinon un compte créé par un relevé précédent du même compte (même nom,
 * ou même fin de numéro dans la même banque).
 */
async function target(d: Statement): Promise<Account | null> {
  const list = await accounts();
  if (d.account_id && d.account_id !== NEW) return list.find((a) => a.id === d.account_id) ?? null;
  const manual = list.filter((a) => a.source === "manuel");
  const tail = tailText(d.account_tail);
  return manual.find((a) => a.raw === accountName(d)) ?? (tail ? manual.find((a) => a.raw.endsWith(tail) && sameAccount({ bank: a.institution, label: null, tail }, { bank: d.bank, label: null, tail })) : null) ?? null;
}

/**
 * Ce que le compte connaît déjà. Une opération pour une opération, à la même date et au même montant ; puis, contre
 * les seules opérations que la banque a fournies elle-même, à trois jours près : elle ne date pas toujours une
 * opération comme son relevé. Deux relevés, eux, se comparent au jour près.
 */
async function plan(d: Statement, account: Account | null) {
  const incoming: RecTx[] = d.operations.map((o, i) => ({ id: String(i), date: o.date, amount: o.amount, label: o.label, status: "posted" }));
  if (!account || !d.operations.length) return { fresh: d.operations, known: 0, close: 0 };
  const days = d.operations.map((o) => o.date).sort();
  // Montants comparés dans la devise du compte, celle du relevé.
  const existing = await q<RecTx & { origin: string | null }>(
    "SELECT id, DATE_FORMAT(date, '%Y-%m-%d') AS date, COALESCE(original_amount, amount) AS amount, label, status, origin FROM transactions WHERE account_id = ? AND status <> 'deleted' AND date BETWEEN DATE_SUB(?, INTERVAL 5 DAY) AND DATE_ADD(?, INTERVAL 5 DAY)",
    [account.id, days[0], days.at(-1)],
  );
  const exact = reconcile(incoming, existing, { nearDays: 0 });
  const fed = (exact.onlyExisting as (RecTx & { origin: string | null })[]).filter((e) => e.origin !== "fichier" && e.origin !== "saisie");
  const close = fed.length && exact.onlyIncoming.length ? reconcile(exact.onlyIncoming, fed, { nearDays: 3 }) : null;
  const left = close ? close.onlyIncoming : exact.onlyIncoming;
  return { fresh: left.map((x) => d.operations[Number(x.id)]), known: exact.pairs.length + (close?.pairs.length ?? 0), close: close?.pairs.length ?? 0 };
}

/**
 * Le solde de départ, face au solde que Pécule connaît déjà à cette date pour un compte tenu par ses relevés (le
 * solde d'arrivée du relevé précédent) : un écart dit qu'il manque un relevé entre les deux, ou qu'un solde est mal lu.
 */
async function continuity(d: Statement, account: Account) {
  if (account.source !== "manuel" || account.currency !== householdCurrency() || d.opening_balance == null || !d.period_start) return [];
  const known = await one<{ balance: number }>("SELECT balance FROM balances WHERE account_id = ? AND date BETWEEN DATE_SUB(?, INTERVAL 1 DAY) AND ? ORDER BY date DESC LIMIT 1", [account.id, d.period_start, d.period_start]);
  if (!known || near(Number(known.balance), d.opening_balance)) return [];
  return [{ label: tk("Solde de départ (face au solde déjà connu à cette date)"), before: money(Number(known.balance)), after: money(d.opening_balance) }];
}

export const releve: Extractor<Statement> = {
  id: "releve",
  label: tk("Relevé de compte"),
  matches: (c) => c.kind === "releve" && c.domain === "banque",
  maxTokens: 32_000,
  // Toujours la page telle qu'elle est imprimée : le texte extrait d'un relevé mêle les colonnes Débit et Crédit.
  pdfUpTo: 40,
  instructions: [
    "Document attendu : un relevé de compte bancaire (compte courant, livret, carte).",
    "Compte lu : un relevé peut porter plusieurs comptes. Lis celui que la demande désigne ; si elle n'en désigne aucun, le premier compte du relevé qui a des opérations. « other_accounts » : chacun des AUTRES comptes du relevé qui a au moins une opération (son intitulé et les 4 derniers chiffres de son numéro) — ils seront lus à part ; liste vide s'il n'y en a pas, ou si la demande désigne le compte à lire.",
    "Opérations : recopie TOUTES celles du compte lu, dans l'ordre, sans en sauter. Date de l'opération (pas la date de valeur). Libellé complet sur une seule ligne : les lignes de détail imprimées sous une opération sont jointes à son libellé. Montant signé, négatif pour un débit, positif pour un crédit : avec deux colonnes Débit et Crédit, c'est la colonne où le montant est imprimé qui donne le signe ; avec une seule colonne, le signe imprimé. Quand le relevé n'imprime pas l'année d'une opération, prends celle de la période du relevé (un relevé à cheval sur décembre et janvier porte deux années). N'inclus ni les lignes de solde (ancien solde, solde intermédiaire, nouveau solde), ni les totaux, ni les reports de page, ni les opérations d'un autre compte.",
    "« opening_balance » et « closing_balance » : soldes de début et de fin de période du compte lu, négatifs s'ils sont débiteurs (un solde imprimé « débiteur », ou dans la colonne Débit, est négatif : c'est une lecture, pas une déduction). « total_debit » et « total_credit » : totaux des mouvements imprimés à la fin du compte, en valeurs positives, null s'ils ne sont pas imprimés. « account_tail » : les 4 derniers chiffres du numéro du compte lu, sans espace, rien de plus. « account_id » : le compte de Pécule correspondant, choisi dans la liste fournie, sinon null — l'absence de compte correspondant est normale pour un compte encore inconnu : elle ne baisse pas la confiance et n'est pas un doute. « is_bank_statement » est faux pour tout autre document (relevé de placement, avis d'opéré, échéancier).",
  ].join("\n"),
  schema: {
    properties: {
      is_bank_statement: { type: "boolean" },
      account_id: str("Identifiant du compte dans la liste fournie, sinon null"),
      owner: str("Toujours null"),
      bank: str("Banque, nom usuel"),
      account_label: str("Intitulé du compte lu (« Compte courant », « Livret A »)"),
      account_tail: str("4 derniers chiffres du numéro du compte lu, sans espace"),
      period_start: day("Début de la période du relevé"),
      period_end: day("Fin de la période du relevé"),
      opening_balance: num("Solde du compte lu en début de période"),
      closing_balance: num("Solde du compte lu en fin de période"),
      total_debit: num("Total des débits imprimé à la fin du compte lu, en valeur positive"),
      total_credit: num("Total des crédits imprimé à la fin du compte lu, en valeur positive"),
      currency: str("Devise du compte, code ISO à trois lettres (EUR, CHF, USD…)"),
      other_accounts: {
        type: "array",
        description: "Les autres comptes du même relevé qui ont au moins une opération",
        items: { type: "object", properties: { label: { type: "string", description: "Intitulé du compte" }, tail: str("4 derniers chiffres de son numéro, sans espace") }, required: ["label", "tail"], additionalProperties: false },
      },
      operations: { type: "array", items: { type: "object", properties: { date: { type: "string" }, label: { type: "string" }, amount: { type: "number" } }, required: ["date", "label", "amount"], additionalProperties: false } },
    },
    required: ["is_bank_statement", "account_id", "owner", "bank", "account_label", "account_tail", "period_start", "period_end", "opening_balance", "closing_balance", "total_debit", "total_credit", "currency", "other_accounts", "operations"],
  },
  parse,
  rows: {
    key: "operations",
    // Une réponse suffit à presque tous les relevés ; au-delà, la suite est redemandée (un relevé de 260 opérations
    // lu en deux réponses coûte un tiers de plus qu'en une).
    perReply: 400,
    columns: [
      { key: "date", label: tk("Date"), type: "date" },
      { key: "label", label: tk("Libellé"), type: "texte" },
      { key: "amount", label: tk("Montant"), type: "montant" },
    ],
    currency: statementCurrency,
    opening: (d) => d.opening_balance,
    marks: (d) =>
      suspects(d.operations, balanceGap(d.opening_balance, d.closing_balance, d.operations)).map((s) => ({
        index: s.index,
        note: s.why === "signe" ? t("Signe à vérifier : inversé, le relevé tomberait juste.") : t("Ligne peut-être en trop : sans elle, le relevé tomberait juste."),
      })),
  },
  parts(d) {
    const own = tailKey(d.account_tail);
    const names = (d.other_accounts ?? [])
      .filter((a) => a.label.trim() && !(own && tailKey(a.tail) === own))
      .map((a) => [a.label.trim(), tailText(a.tail)].filter(Boolean).join(" ").slice(0, 160));
    return [...new Set(names)].slice(0, 8);
  },
  shared: { keys: ["account_id", "owner"], same: (a, b) => sameAccount(identity(a), identity(b)) },
  overview(items) {
    const groups: { first: Statement; list: typeof items }[] = [];
    for (const item of items) {
      const group = groups.find((g) => sameAccount(identity(g.first), identity(item.data)));
      if (group) group.list.push(item);
      else groups.push({ first: item.data, list: [item] });
    }
    // Un relevé seul n'a rien à enchaîner.
    return groups
      .filter((g) => g.list.length > 1)
      .map((g) => {
        const currency = statementCurrency(g.first);
        const c = coverage(g.list.map((i) => ({ id: i.id, start: i.data.period_start, end: i.data.period_end, opening: i.data.opening_balance, closing: i.data.closing_balance, operations: i.data.operations.length })));
        return {
          title: accountName(g.first),
          detail: [tn("{n} relevé", "{n} relevés", c.statements, { n: c.statements }), c.from && c.to ? t("du {a} au {b}", { a: dayText(c.from), b: dayText(c.to) }) : null, tn("{n} opération", "{n} opérations", c.operations, { n: c.operations })].filter(Boolean).join(" · "),
          warnings: [
            ...c.gaps.map((x) => t("Aucun relevé du {a} au {b} : il en manque peut-être un.", { a: dayText(x.from), b: dayText(x.to) })),
            ...c.breaks.map((x) => t("Le solde ne s'enchaîne pas au {date} : {a} à la fin du relevé précédent, {b} au début du suivant.", { date: dayText(x.at), a: money(x.before, currency), b: money(x.after, currency) })),
            ...(c.undated ? [tn("{n} relevé dont la période n'a pas été lue.", "{n} relevés dont la période n'a pas été lue.", c.undated, { n: c.undated })] : []),
          ],
        };
      });
  },
  context: async (ctx) =>
    [
      `Comptes de Pécule : ${(await accounts()).map((a) => `${a.id} = ${a.name}${a.institution ? ` (${a.institution})` : ""}`).join(" ; ") || "aucun"}.`,
      ctx.part ? `Ce relevé porte plusieurs comptes. Compte à lire : « ${ctx.part} », et lui seul (« other_accounts » : liste vide).` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  // Un relevé sans mouvement compte quand même : ses soldes disent que la série n'a pas de trou.
  rejected: (d) => !d.is_bank_statement || (!d.operations.length && (d.opening_balance == null || d.closing_balance == null)),
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
    const currency = statementCurrency(d);
    const total = sum(d.operations.map((o) => o.amount));
    const gap = balanceGap(d.opening_balance, d.closing_balance, d.operations);
    const out = [
      { ok: gap !== null, label: t("Soldes de début et de fin lus") },
      // Un compte existant, ou « Nouveau compte… » choisi exprès : jamais de compte créé sans qu'on l'ait demandé.
      { ok: !!d.account_id, label: t("Compte de Pécule choisi") },
    ];
    if (gap === 0) out.push({ ok: true, label: t("Solde de départ + opérations = solde d'arrivée ({a} + {b} = {c})", { a: money(d.opening_balance, currency), b: money(total, currency), c: money(d.closing_balance, currency) }) });
    else if (gap !== null) {
      out.push({ ok: false, label: t("Solde de départ + opérations ≠ solde d'arrivée : {a} + {b} = {c}, le relevé dit {d} (écart de {e})", { a: money(d.opening_balance, currency), b: money(total, currency), c: money((d.opening_balance ?? 0) + total, currency), d: money(d.closing_balance, currency), e: money(gap, currency) }) });
      // Les totaux imprimés disent de quel côté chercher. Ils ne sont comparés que si le relevé ne tombe pas juste :
      // certaines banques y comptent le solde de départ.
      const debits = -sum(d.operations.filter((o) => o.amount < 0).map((o) => o.amount));
      const credits = sum(d.operations.filter((o) => o.amount > 0).map((o) => o.amount));
      if (d.total_debit != null) out.push({ ok: near(debits, Math.abs(d.total_debit)), label: t("Total des débits : {a} lus, {b} imprimés", { a: money(debits, currency), b: money(Math.abs(d.total_debit), currency) }) });
      if (d.total_credit != null) out.push({ ok: near(credits, Math.abs(d.total_credit)), label: t("Total des crédits : {a} lus, {b} imprimés", { a: money(credits, currency), b: money(Math.abs(d.total_credit), currency) }) });
    }
    if (d.period_start && d.period_end) out.push({ ok: d.operations.every((o) => o.date >= d.period_start! && o.date <= d.period_end!), label: t("Toutes les opérations sont dans la période du relevé") });
    return out;
  },
  async existing(d) {
    const account = await target(d);
    if (!account) return null;
    const p = await plan(d, account);
    const summary = t("Compte « {compte} » : {a} opérations déjà connues, {b} à ajouter.", { compte: account.name, a: p.known, b: p.fresh.length });
    // Des opérations qui s'ajoutent à un compte existant ne changent rien à ce qui est déjà là ; un solde de départ
    // qui ne retombe pas sur le solde connu, si.
    return { summary: p.close ? `${summary} ${t("Dont {n} rapprochées à quelques jours près d'une opération fournie par la banque.", { n: p.close })}` : summary, diffs: await continuity(d, account) };
  },
  async apply(d, _ctx, track) {
    let account = await target(d);
    if (!account) {
      const members = await listMembers();
      const owner = d.owner && (["joint", "pro", "autre"].includes(d.owner) || members.some((m) => ownerKey(m.name) === d.owner)) ? d.owner : "joint";
      const id = `m:${randomBytes(12).toString("hex")}`;
      const name = accountName(d);
      const currency = statementCurrency(d) ?? householdCurrency();
      await track.upsert("accounts", { id }, { name, institution: d.bank?.slice(0, 120) ?? null, owner, kind: /livret|épargne|epargne|pel|ldd/i.test(d.account_label ?? "") ? "epargne" : "courant", currency, hidden: 0, excluded: 0, source: "manuel" });
      account = { id, name, raw: name, institution: d.bank, source: "manuel", currency };
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
    // Le solde d'un compte tenu à la main suit le relevé le plus récent, et chaque relevé laisse son solde d'arrivée
    // dans l'historique : c'est à lui que le relevé suivant compare son solde de départ.
    if (account.source === "manuel" && d.closing_balance != null && d.period_end) {
      const later = await one("SELECT id FROM transactions WHERE account_id = ? AND date > ? LIMIT 1", [account.id, d.period_end]);
      const closing = convert(d.closing_balance, account.currency, d.period_end);
      if (!later) await track.upsert("accounts", { id: account.id }, { balance: closing.amount, balance_original: closing.originalAmount, balance_at: `${d.period_end} 00:00:00` });
      await track.upsert("balances", { account_id: account.id, date: d.period_end }, { balance: closing.amount });
    }
    await afterBankSync();
    const summary = t("{a} opérations ajoutées à « {compte} » ({b} déjà connues).", { a: fresh.length, compte: account.name, b: known });
    // Les autres relevés du même compte, dans le lot, iront dans ce compte sans qu'on le leur redise.
    return d.account_id === account.id ? summary : { summary, share: { account_id: { from: d.account_id, to: account.id } } };
  },
};
