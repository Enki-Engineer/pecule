import { q } from "./db.ts";
import { userAccountsSql } from "./actions.ts";
import { STAT_SCOPE } from "./stats.ts";
import { today } from "./region.ts";
import { documentVisible, type documentDetail } from "./documents.ts";
import type { CommitmentRow } from "./situation.ts";
import { COMPARABLE_COMMITMENTS, CONTRACT_KINDS, paidSummary, renewal, shareBudget, shiftDays, yearlyCost, type PaidMonth } from "../lib/contracts.ts";

/*
 * Comparaison de contrats : ce que l'assistant (et le serveur MCP) lit pour dire si une offre vaut mieux que le
 * contrat en cours. Trois sources : le coffre (texte de l'offre et du contrat), le budget (montant, renouvellement,
 * préavis de l'engagement) et les opérations (ce qui a vraiment été prélevé). Rien n'est écrit ici.
 */

export type ContractDocument = NonNullable<Awaited<ReturnType<typeof documentDetail>>>;

/** Texte donné en une lecture, tous documents confondus : la réponse d'un outil est bornée, le reste se lit par get_document. */
export const TEXT_BUDGET = 22_000;
/** Budget de texte quand la réponse porte aussi la liste des candidats. */
export const TEXT_BUDGET_WITH_CANDIDATES = 15_000;
/** En dessous, un document qui a un fichier n'a pas été lu (photo floue, scan trop long). */
const UNREAD_BELOW = 200;

const visible = (userId: number, alias: string) => `(${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ${Number(userId)})`;
const num = (v: unknown) => (v == null ? null : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Documents prêts à comparer : métadonnées, faits clés et début du texte, la place étant partagée entre eux. */
export function documentBlocks(docs: ContractDocument[], budget: number) {
  const shares = shareBudget(
    docs.map((d) => d.text?.length ?? 0),
    budget,
  );
  return docs.map((d, i) => {
    const total = d.text?.length ?? 0;
    const unread = !!d.has_file && total < UNREAD_BELOW;
    return {
      id: d.id,
      title: d.title,
      kind: d.kind,
      domain: d.domain,
      doc_date: d.doc_date,
      expires_at: d.expires_at,
      summary: d.summary?.slice(0, 900) ?? null,
      facts: d.facts.slice(0, 14).map((f) => ({ label: f.label.slice(0, 80), value: f.value.slice(0, 200) })),
      text: d.text ? d.text.slice(0, shares[i]) : null,
      text_total: total,
      ...(total > shares[i] ? { text_note: `Début du texte seulement (${shares[i]} caractères sur ${total}) : la suite se lit par get_document avec offset.` } : {}),
      ...(unread ? { text_note: "Texte non lu (photo ou scan) : seuls le résumé et les faits clés sont connus. Demande les chiffres qui manquent ou un PDF." } : {}),
    };
  });
}

type PaidRow = { id: string; date: string; amount: number; account_id: string | number };

/**
 * Ce qui a été prélevé pour un engagement sur les douze derniers mois, d'après son motif de libellé (le même que
 * celui du budget) : total net, par mois, dernier prélèvement. Null si l'engagement n'a pas de motif.
 */
export async function paidFor(userId: number, c: Pick<CommitmentRow, "label" | "label_regex" | "match_pattern">) {
  if (!c.label_regex && !c.match_pattern) return null;
  const to = today();
  const from = shiftDays(to, -364);
  const A = userAccountsSql(userId);
  const rows = await q<PaidRow>(
    `SELECT t.id, t.date, t.amount, t.account_id FROM tx_lines t JOIN ${A} a ON a.id = t.account_id JOIN transactions tt ON tt.id = t.id
     WHERE ${STAT_SCOPE} AND ${c.label_regex ? "tt.merchant = ?" : "tt.label_key LIKE ?"} AND t.date BETWEEN ? AND ? ORDER BY t.date, t.id`,
    [c.label_regex ? c.label : `%${c.match_pattern}%`, from, to],
  );
  if (!rows.length) return { from, to, found: false as const };
  // Une opération ventilée a plusieurs lignes : on compte l'opération une fois, pour son montant entier.
  const byTx = new Map<string, { date: string; amount: number }>();
  for (const r of rows) {
    const tx = byTx.get(String(r.id)) ?? { date: String(r.date).slice(0, 10), amount: 0 };
    tx.amount += Number(r.amount);
    byTx.set(String(r.id), tx);
  }
  const months = new Map<string, PaidMonth>();
  for (const tx of byTx.values()) {
    const m = months.get(tx.date.slice(0, 7)) ?? { month: tx.date.slice(0, 7), total: 0, count: 0 };
    m.total -= tx.amount;
    m.count += 1;
    months.set(m.month, m);
  }
  const accounts = [...new Set(rows.map((r) => r.account_id))];
  const [first] = await q<{ d: string | null }>(
    `SELECT MIN(t.date) AS d FROM tx_lines t JOIN ${A} a ON a.id = t.account_id WHERE ${STAT_SCOPE} AND t.account_id IN (${accounts.map(() => "?").join(", ")})`,
    accounts,
  );
  const summary = paidSummary([...months.values()], from, first?.d ? String(first.d).slice(0, 10) : null);
  const last = [...byTx.values()].at(-1)!;
  return {
    from,
    to,
    found: true as const,
    total: summary?.total ?? 0,
    count: summary?.count ?? 0,
    months: summary?.months ?? 0,
    monthly_average: summary?.monthlyAverage ?? 0,
    last: { date: last.date, amount: r2(-last.amount) },
    partial_history: summary?.partial ?? false,
    by_month: summary?.byMonth ?? [],
  };
}

/** Engagement du budget prêt à comparer : montants ramenés au mois et à l'année, prochaine échéance, date limite de résiliation, prélèvements réels. */
export async function commitmentBlock(userId: number, c: CommitmentRow) {
  const cost = yearlyCost({ monthly: num(c.monthly), annual: num(c.annual) });
  const next = renewal(c.renewal_date, c.notice_days, today());
  const paid = await paidFor(userId, c);
  return {
    id: c.id,
    label: c.label,
    provider: c.provider,
    type: c.type,
    status: c.status,
    monthly: cost?.monthly ?? null,
    annual: cost?.annual ?? null,
    start_date: c.start_date,
    end_date: c.end_date,
    notice_days: c.notice_days,
    renewal: next
      ? { recorded: next.recorded, next: next.next, assumed_yearly: next.assumedYearly, cancel_before: next.cancelBefore, days_left: next.daysLeft }
      : null,
    notes: c.notes?.slice(0, 600) ?? null,
    paid,
    ...(paid === null ? { paid_note: "Engagement sans motif de libellé : ses prélèvements ne sont pas retrouvés. Cherche-les par search_transactions (nom du prestataire, sum_matching)." } : {}),
    ...(paid && !paid.found ? { paid_note: "Aucun prélèvement retrouvé sur douze mois avec le motif de l'engagement : vérifie par search_transactions (nom du prestataire)." } : {}),
  };
}

/** Contrats en cours parmi lesquels choisir celui que l'offre remplacerait : engagements du budget et contrats du coffre. */
export async function currentCandidates(userId: number, want: { commitments: boolean; documents: boolean }, excludeDocuments: number[] = []) {
  const commitments = want.commitments
    ? (
        await q<Pick<CommitmentRow, "id" | "label" | "provider" | "type" | "monthly" | "annual" | "renewal_date">>(
          `SELECT c.id, c.label, c.provider, c.type, c.monthly, c.annual, c.renewal_date FROM commitments c
           WHERE ${visible(userId, "c")} AND c.status IN ('actif', 'a_verifier', 'a_completer') AND c.type IN (${COMPARABLE_COMMITMENTS.map(() => "?").join(", ")})
           ORDER BY c.type, c.label LIMIT 40`,
          [...COMPARABLE_COMMITMENTS],
        )
      ).map((c) => {
        const cost = yearlyCost({ monthly: num(c.monthly), annual: num(c.annual) });
        return { commitment_id: c.id, label: c.label, provider: c.provider, type: c.type, monthly: cost?.monthly ?? null, annual: cost?.annual ?? null, renewal_date: c.renewal_date };
      })
    : undefined;
  const exclude = excludeDocuments.filter((id) => Number.isInteger(id));
  const documents = want.documents
    ? (
        await q<{ id: number; title: string; kind: string; doc_date: string | null; expires_at: string | null }>(
          `SELECT d.id, d.title, d.kind, d.doc_date, d.expires_at FROM documents d
           WHERE ${documentVisible(userId)} AND d.kind IN (${CONTRACT_KINDS.map(() => "?").join(", ")})${exclude.length ? ` AND d.id NOT IN (${exclude.map(() => "?").join(", ")})` : ""}
           ORDER BY d.doc_date IS NULL, d.doc_date DESC, d.id DESC LIMIT 25`,
          [...CONTRACT_KINDS, ...exclude],
        )
      ).map((d) => ({ document_id: d.id, title: d.title, kind: d.kind, doc_date: d.doc_date, expires_at: d.expires_at }))
    : undefined;
  return { ...(commitments ? { commitments } : {}), ...(documents ? { documents } : {}) };
}
