import { householdDay } from "../region.ts";
import { today } from "../region.ts";
import { isExpense, lineKind, peerOwner, STAT_DATE_JOIN, STAT_SCOPE, statDate } from "../stats.ts";
import { ensureTransferPeers } from "../transfers.ts";
import { nameTransfers, parseTransferId, transferId, transferName } from "../../lib/transfers.ts";
import { fillPurchaseDates } from "../stat-dates.ts";
import { addMonths, isYearPeriod, PERIOD_RE, periodRange } from "../../lib/periods.ts";
import { Router, json, raw, type Request, type Response } from "express";
import { z } from "zod";
import { db, exec, one, q } from "../db.ts";
import { desc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { alerts, auditLog, users } from "../db/schema/index.ts";
import { EXCHANGE_IDS } from "../../lib/crypto-exchanges.ts";
import { FILE_APP_IDS } from "../../lib/crypto-files.ts";
import { acceptSourceValue, addExchange, addWallet, archiveManualLine, countOnce, deleteArchivedLine, importCryptoFile, cryptoStatus, observeFileBalance, removeWallet, restoreManualLine, setSourceEnabled, syncCrypto, syncSummary } from "../crypto.ts";
import { requireAdmin, requireApiToken, requireAuth, requireSyncAccess, createEnrollmentLink } from "../auth.ts";
import { guessCategory, lastSyncRuns, markCardDuplicates, fintaConnections, fintaEnabled } from "../finta.ts";
import { syncBanks } from "../bank-sync.ts";
import { labelKey } from "../../lib/labels.ts";
import { t as tr } from "../../lib/i18n.ts";
import { labelShape, merchantName, natureSql, shapeRegex } from "../../lib/nature.ts";
import { summarizeLoan, type ScheduleRow } from "../../lib/loans.ts";
import { summarizePayouts } from "../../lib/payouts.ts";
import { payouts } from "../payouts.ts";
import { computeWealth, cryptoPositions, ensureFreshPrices, refreshWealth, snapshotWealth, wealthHistory } from "../wealth.ts";
import { assistantEnabled, confirmPending, deleteThread, getThread, listThreads, sendMessage, updateThread, type AssistantEvent, type PublicThread } from "../assistant.ts";
import { listMemories } from "../tools/analyse.ts";
import { getLogo, logoKeyAllowed, logoStatus, refreshWeakLogos, resetLogo } from "../logos.ts";
import { registerUndo, runUndo, snapshotTransactions } from "../undo.ts";
import { suggestCategories } from "../suggest.ts";
import { applyClassification, CLASSIFY_BATCH, proposeClassification } from "../classify-ai.ts";
import { meterCost } from "../ai.ts";
import { assertAiBudget } from "../ai-cost.ts";
import { generateSummary, latestSummary } from "../weekly.ts";
import { ADMIN_NOTIF_TYPES, NOTIF_TYPES, getSubscription, notify, recentNotifications, subscribe, unsubscribe, updatePrefs, vapidKeys, type NotifPrefs } from "../notify.ts";
import { deleteEnvelope, deleteGoal, envelopeCandidates, listEnvelopes, listGoals, saveEnvelope, saveGoal } from "../planning.ts";
import { recordAlert } from "../journal.ts";
import { agenda } from "../agenda.ts";
import { dashLayout, saveDashLayout } from "../dashboard.ts";
import { cleanLayout } from "../../lib/dashboard.ts";
import { searchDocuments } from "../documents.ts";
import { day } from "../tools/registry.ts";
import { coloredPostes, comparePeriods, comparisonSpan, forecast, listMonths, monthDebits, monthFlows, monthlyTrend, monthMerchants, monthTimeline, natureTrend, yearDebits } from "../flows.ts";
import { debitSeries, nameDebits, refreshDebitNames, resetDebitNames } from "../debits.ts";
import { importBankLabels } from "../bank-labels.ts";
import { importBankHistory, removeBankHistory } from "../bank-history.ts";
import { saveCommitment } from "../situation.ts";
import { rateLimit } from "express-rate-limit";
import { invoicesAdmin, invoicesApi } from "./invoices.ts";
import { documentsAdmin, documentsApi } from "./documents.ts";
import { situationAdmin, situationApi } from "./situation.ts";
import { funApi } from "./fun.ts";
import { balanceApi } from "./balance.ts";
import { balanceForecast } from "../balance.ts";
import { householdApi } from "./household.ts";
import { importsApi } from "./imports.ts";
import { connectionsApi } from "./connections.ts";
import { bankApi } from "./bank.ts";
import { aiSettingsApi } from "./ai-settings.ts";
import { aiCostApi } from "./ai-cost.ts";
import { ActionError, saveAccountSettings, setTransactionCategory, setTransactionNote, updateAsset, updateCryptoPosition, userAccountsSql } from "../actions.ts";
import { hourly } from "../limits.ts";
import { memberIdByName } from "../members.ts";
import { isDemo } from "../demo-context.ts";
import { ebAdoptedAccounts } from "../enable-banking.ts";
import { updateAvailable } from "../updates.ts";

export const api = Router();

const month = z.string().regex(/^\d{4}-\d{2}$/);
/** Période d'analyse : un mois (« 2026-11 ») ou une année entière (« 2026 »). */
const period = z.string().regex(PERIOD_RE);
/** Période d'une requête d'analyse (`period`, ou l'ancien paramètre `month` d'un écran pas encore rechargé). */
const periodOf = (req: Request) => period.parse(req.query.period ?? req.query.month);

/** Périmètre de lecture choisi dans la barre supérieure (« Foyer » par défaut, « Moi » = mes comptes). */
const scopeOf = (req: Request): "foyer" | "moi" => (req.get("x-perimetre") === "moi" ? "moi" : "foyer");
const userAccounts = (req: Request) => userAccountsSql(req.user?.id ?? 0, scopeOf(req));

// Opérations prises en compte dans les statistiques : non supprimées, compte non exclu.

/* ---------- Synchro (jeton de synchro accepté) ---------- */

api.post("/sync", requireSyncAccess, hourly(12), async (req, res) => {
  const result = await syncBanks(req.user ? "manuel" : "cron");
  if (!result) return res.status(409).json({ error: tr("Une synchronisation est déjà en cours") });
  res.json(result);
});

api.use(requireAuth);
// Les statistiques lisent le rapprochement des virements entre comptes : remis à jour s'il a changé (une requête légère).
api.use(async (_req, _res, next) => {
  await ensureTransferPeers();
  next();
});
api.use(invoicesApi);
api.use(documentsApi);
api.use(situationApi);
api.use(funApi);
api.use(balanceApi);
api.use(householdApi);
api.use(importsApi);
api.use(connectionsApi);
api.use(bankApi);
api.use(aiSettingsApi);
api.use(aiCostApi);

api.get("/sync/runs", async (_req, res) => {
  res.json({ runs: await lastSyncRuns(15) });
});

api.get("/sync/connections", async (_req, res) => {
  res.json(await fintaConnections());
});

/* ---------- Comptes et accueil ---------- */

api.get("/accounts", async (req, res) => {
  const accounts = await q(
    `SELECT a.id, a.name, a.display_name, a.institution, a.owner, a.kind, a.currency, a.balance, a.balance_original, a.balance_at, a.source,
            COALESCE(p.hidden, a.hidden) AS hidden, COALESCE(p.excluded, a.excluded) AS excluded,
            (SELECT MAX(date) FROM transactions t WHERE t.account_id = a.id) AS last_tx
     FROM accounts a LEFT JOIN account_prefs p ON p.account_id = a.id AND p.user_id = ?
     ORDER BY COALESCE(p.hidden, a.hidden), CASE a.owner WHEN 'joint' THEN 0 WHEN 'autre' THEN 2 WHEN 'pro' THEN 3 ELSE 1 END, a.owner, FIELD(a.kind, 'courant', 'epargne', 'carte', 'autre'), a.sort_order, a.name`,
    [req.user!.id],
  );
  // `feed` : ce qui alimente le compte aujourd'hui, pas ce qui l'a créé. Un compte rattaché à Enable Banking garde sa
  // source d'origine en base ; un compte que Finta ne lit plus (connexion expirée, carte remplacée) est « à l'arrêt » ;
  // un compte venu d'un export ou d'une reprise n'a que son historique.
  if (isDemo()) return res.json({ accounts: (accounts as { id: string }[]).map((a) => ({ ...a, feed: "demo" })) });
  const adopted = await ebAdoptedAccounts().catch(() => new Set<string>());
  const live = new Set(fintaEnabled() ? (await q<{ id: string }>("SELECT DISTINCT account_id AS id FROM account_sources WHERE connection_status = 'active'")).map((r) => r.id) : []);
  const feedOf = (a: { id: string; source: string }) =>
    adopted.has(a.id) || a.source === "enablebanking" ? "enablebanking" : a.source === "manuel" ? "manuel" : a.source === "finta" ? (live.has(a.id) ? "finta" : "arret") : "historique";
  res.json({ accounts: (accounts as { id: string; source: string }[]).map((a) => ({ ...a, feed: feedOf(a) })) });
});

api.patch("/accounts/:id", async (req, res) => {
  const body = z
    .object({ displayName: z.string().max(120).nullable().optional(), hidden: z.boolean().optional(), excluded: z.boolean().optional() })
    .parse(req.body);
  // Le nom affiché est commun à la famille ; masquer / exclure ne vaut que pour soi.
  await saveAccountSettings(req.user!.id, req.params.id, body);
  res.json({ ok: true });
});

api.get("/summary", async (req, res) => {
  const d = today();
  const thisMonth = d.slice(0, 7);
  const prev = new Date(`${thisMonth}-01T12:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevMonth = prev.toISOString().slice(0, 7);
  const dayOfMonth = Number(d.slice(8, 10));

  const spend = async (m: string, uptoDay: number) =>
    (
      await one<{ total: number | null }>(
        `SELECT -SUM(t.amount) AS total FROM tx_lines t JOIN ${userAccounts(req)} a ON a.id = t.account_id
         LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${STAT_SCOPE} AND t.date >= ? AND t.date < DATE_ADD(?, INTERVAL 1 MONTH) AND DAY(t.date) <= ? AND ${isExpense(userAccounts(req))}`,
        [`${m}-01`, `${m}-01`, uptoDay],
      )
    )?.total ?? 0;

  // Mêmes regroupements que l'écran Mois (par poste), pour que les montants concordent.
  // Un versement vers un compte hors de la vue du membre y fait son propre poste, comme à l'écran Mois.
  const top = (
    await q<{ id: string; name: string; poste: string | null; peer: string | null; total: number }>(
      `SELECT COALESCE(c.poste, c.name) AS id, COALESCE(c.poste, c.name) AS name, c.poste, ${peerOwner(userAccounts(req))} AS peer, -SUM(t.amount) AS total
       FROM tx_lines t JOIN ${userAccounts(req)} a ON a.id = t.account_id
       JOIN categories c ON c.id = t.category_id
       WHERE ${STAT_SCOPE} AND ${isExpense(userAccounts(req))} AND t.date >= ? GROUP BY COALESCE(c.poste, c.name), c.poste, peer ORDER BY total DESC LIMIT 4`,
      [`${thisMonth}-01`],
    )
  ).map(({ peer, ...r }) => (peer ? { ...r, id: transferName("verse", peer, tr), name: transferName("verse", peer, tr), poste: transferName("verse", peer, tr) } : r));
  const uncategorized = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM tx_lines t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE ${STAT_SCOPE} AND t.category_id IS NULL`,
  );
  const lastSync = await one("SELECT status, finished_at, started_at, error FROM sync_runs ORDER BY id DESC LIMIT 1");
  res.json({
    month: thisMonth,
    spentThisMonth: await spend(thisMonth, 31),
    spentPrevMonthSameDay: await spend(prevMonth, dayOfMonth),
    spentPrevMonth: await spend(prevMonth, 31),
    topCategories: top,
    uncategorized: uncategorized?.n ?? 0,
    lastSync: lastSync ?? null,
  });
});

/* ---------- Catégories et règles ---------- */

api.get("/categories", async (_req, res) => {
  res.json({ categories: await q("SELECT * FROM categories ORDER BY sort_order, id") });
});

api.get("/rules", async (_req, res) => {
  res.json({ rules: await q("SELECT r.*, c.name AS category_name FROM rules r JOIN categories c ON c.id = r.category_id ORDER BY r.pattern") });
});

api.delete("/rules/:id", async (req, res) => {
  await exec("DELETE FROM rules WHERE id = ?", [req.params.id]);
  res.json({ ok: true });
});

/* ---------- Opérations ---------- */

/** Filtres de la liste des opérations (écran Opérations, forage des graphiques). */
const txFilters = z.object({
  /** Mois ou année entière : le jour retenu est celui des statistiques (jour d'achat ou d'écriture, selon le foyer). */
  month: period.optional(),
  /** Une opération précise (arrivée depuis un graphique ou la recherche). */
  id: z.string().max(160).optional(),
  account: z.string().optional(),
  category: z.string().optional(),
  poste: z.string().optional(),
  q: z.string().max(100).optional(),
  uncategorized: z.enum(["1"]).optional(),
  /** Nature (carte, prélèvement…) : filtre du forage des graphiques de l'Analyse. */
  nature: z.enum(["carte", "prelevement", "virement", "retrait", "frais", "interne", "remboursement", "entree"]).optional(),
  /** Marchand exact (nom affiché), pour le forage « Marchands ». */
  merchant: z.string().max(160).optional(),
  /** Débits seulement. */
  debits: z.enum(["1"]).optional(),
  /** Crédits seulement. */
  credits: z.enum(["1"]).optional(),
});

/**
 * Conditions d'une liste d'opérations, les mêmes pour la liste et pour son bilan mois par mois. `x` : alias de
 * `transactions` (a = comptes du membre, `STAT_DATE_JOIN` joint). Le marchand, lui, se filtre après la lecture.
 */
async function txWhere(req: Request, f: z.infer<typeof txFilters>, x = "t") {
  const where = [`${x}.status IN ('posted', 'pending')`];
  const params: unknown[] = [];
  const day = statDate(x);
  if (f.month) {
    const r = periodRange(f.month);
    where.push(`${day} >= ? AND ${day} < ?`), params.push(r.start, r.end);
  }
  if (f.id) where.push(`${x}.id = ?`), params.push(f.id);
  if (f.account) where.push(`${x}.account_id = ?`), params.push(f.account);
  // « Apports de … », « Versements à … » (forage d'une répartition) : les virements qui franchissent la vue, par titulaire
  // du compte d'en face. Un graphique par poste envoie le nom du versement, celui que ce serveur vient de lui donner.
  const owners = f.poste && !f.category ? await q<{ owner: string }>("SELECT DISTINCT owner FROM accounts") : [];
  const named = owners.find((o) => transferName("verse", o.owner, tr) === f.poste);
  const transfer = parseTransferId(f.category) ?? (named ? { way: "verse" as const, owner: named.owner } : null);
  if (transfer)
    where.push(
      `${x}.amount ${transfer.way === "recu" ? ">" : "<"} 0 AND ${x}.category_id IN (SELECT id FROM categories WHERE kind = 'interne')
       AND ${x}.id IN (SELECT tp.transaction_id FROM transfer_peers tp JOIN accounts po ON po.id = tp.peer_account_id
         WHERE po.owner = ? AND NOT EXISTS (SELECT 1 FROM ${userAccounts(req)} pa WHERE pa.id = tp.peer_account_id AND pa.excluded = 0))`,
    ),
      params.push(transfer.owner);
  // Une opération ventilée répond aux catégories de ses lignes.
  else if (f.category) where.push(`${x}.id IN (SELECT l.id FROM tx_lines l WHERE l.category_id = ?)`), params.push(f.category);
  if (f.poste && !named) where.push(`${x}.id IN (SELECT l.id FROM tx_lines l JOIN categories lc ON lc.id = l.category_id WHERE lc.poste = ?)`), params.push(f.poste);
  if (f.uncategorized) where.push(`${x}.category_id IS NULL AND a.excluded = 0`);
  if (f.nature) where.push(`${natureSql(x)} = ?`), params.push(f.nature);
  if (f.debits) where.push(`${x}.amount < 0`);
  if (f.credits) where.push(`${x}.amount > 0`);
  if (f.q)
    where.push(
      `(${x}.label LIKE ? OR ${x}.merchant LIKE ? OR ${x}.bank_label LIKE ? OR ${x}.note LIKE ? OR ${x}.id IN (SELECT it.transaction_id FROM invoice_transactions it JOIN invoices i ON i.id = it.invoice_id
         LEFT JOIN invoice_items ii ON ii.invoice_id = i.id WHERE (i.owner_user_id IS NULL OR i.owner_user_id = ${Number(req.user!.id)}) AND (i.title LIKE ? OR ii.label LIKE ?)))`,
    ),
      params.push(...Array(6).fill(`%${f.q}%`));
  if (!f.account && !f.id) where.push("a.excluded = 0");
  return { where, params, transfer };
}

/** Bilan mois par mois de la liste filtrée (bandeau de chaque mois de l'écran Opérations) et postes colorés. */
api.get("/transactions/months", async (req, res) => {
  const f = txFilters.omit({ merchant: true }).parse(req.query);
  const { where, params, transfer } = await txWhere(req, f, "tr");
  // Une liste réduite à des apports ou à des versements : ni catégorie ni poste du référentiel à recouper.
  res.json({ months: await listMonths(userAccounts(req), where, params, transfer ? {} : f), colored: await coloredPostes(userAccounts(req)) });
});

api.get("/transactions", async (req, res) => {
  const f = txFilters
    .extend({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0) })
    .parse(req.query);
  const { where, params } = await txWhere(req, f);
  const day = statDate("t");
  const raw = await q<{ label: string; merchant: string | null; amount: number; peer: string | null; category_name: string | null; category_poste: string | null; category_kind: string | null }>(
    `SELECT t.id, t.account_id, ${day} AS date, t.date AS booked_date, t.purchase_date, t.amount, t.original_amount, t.original_currency, t.label, t.merchant, t.bank_label, t.status, t.category_id, t.category_source, t.note,
            c.name AS category_name, c.poste AS category_poste, c.kind AS category_kind, ${peerOwner(userAccounts(req))} AS peer,
            COALESCE(a.display_name, a.name) AS account_name, a.owner AS account_owner,
            (SELECT COUNT(*) FROM invoice_transactions it WHERE it.transaction_id = t.id) AS invoice_count,
            (SELECT COUNT(*) FROM transaction_splits s WHERE s.transaction_id = t.id) AS split_count
     FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id ${STAT_DATE_JOIN}
     WHERE ${where.map((w) => `(${w})`).join(" AND ")}
     ORDER BY ${day} DESC, t.amount ASC LIMIT ? OFFSET ?`,
    [...params, f.merchant ? 2000 : f.limit + 1, f.merchant ? 0 : f.offset],
  );
  // Le nom affiché d'un marchand se calcule depuis le libellé : filtre fait ici (volumes d'un mois).
  const rows = f.merchant ? raw.filter((r) => merchantName(r.label, r.merchant) === f.merchant).slice(f.offset, f.offset + f.limit + 1) : raw;
  // Un virement qui franchit la vue compte : la ligne porte son nom d'apport ou de versement et la nature qu'elle a
  // dans les statistiques ; `transfer` dit pourquoi à l'écran. Sa catégorie en base (`category_id`) ne change pas.
  const shown = rows.slice(0, f.limit).map(({ peer, ...r }) => {
    if (!peer) return r;
    const way = Number(r.amount) > 0 ? ("recu" as const) : ("verse" as const);
    const name = transferName(way, peer, tr);
    return { ...r, category_name: name, category_poste: way === "verse" ? name : null, category_kind: way === "recu" ? "revenu" : "depense", transfer: { way, owner: peer, id: transferId(way, peer) } };
  });
  res.json({ transactions: shown, hasMore: rows.length > f.limit });
});

/** Classement en lot (sélection multiple sur ordinateur) : jamais de règle créée, opérations visibles du membre seulement. */
api.post("/transactions/bulk-category", async (req, res) => {
  const b = z.object({ ids: z.array(z.string().max(160)).min(1).max(500), categoryId: z.string().max(16).nullable(), remember: z.boolean().optional() }).parse(req.body);
  const visible = await q<{ id: string }>(
    `SELECT t.id FROM transactions t JOIN ${userAccountsSql(req.user!.id)} a ON a.id = t.account_id WHERE t.id IN (${b.ids.map(() => "?").join(",")})`,
    b.ids,
  );
  const restore = await snapshotTransactions(visible.map((t) => t.id), !!b.remember && b.categoryId != null);
  // remember : règle créée sur le libellé de la première (mode tri, « classer aussi les autres »).
  for (const [i, t] of visible.entries()) await setTransactionCategory(t.id, b.categoryId, !!b.remember && i === 0);
  res.json({ updated: visible.length, undoId: registerUndo(req.user!.id, `${visible.length} opération(s) reclassée(s)`, restore) });
});

/**
 * Classement en lot par l'IA : une catégorie proposée par libellé encore sans catégorie (rien n'est écrit), puis
 * l'application de ce que le membre a retenu, annulable. Fermé en démo (src/server/demo.ts).
 */
api.post("/transactions/ai-classify", hourly(30), async (req, res) => {
  const { value, error, eur } = await meterCost(() => proposeClassification(req.user!.id));
  if (error) throw error;
  res.json({ ...value, costEur: Math.round(eur * 10_000) / 10_000 });
});

api.post("/transactions/ai-classify/apply", async (req, res) => {
  const b = z.object({ picks: z.array(z.object({ key: z.string().min(1).max(120), credit: z.boolean(), categoryId: z.string().max(16) })).min(1).max(CLASSIFY_BATCH), remember: z.boolean().default(true) }).parse(req.body);
  res.json(await applyClassification(req.user!.id, b.picks, b.remember));
});

/** Prélèvements de même forme que celui-ci (avant de le nommer) : motif, nombre, dernier montant. */
api.get("/transactions/:id/debit-shape", async (req, res) => {
  const tx = await one<{ label: string }>(`SELECT t.label FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE t.id = ?`, [req.params.id]);
  if (!tx) throw new ActionError(404, tr("Opération introuvable"));
  const regex = shapeRegex(labelShape(tx.label));
  const same = await one<{ n: number; total: number | null }>(
    `SELECT COUNT(*) AS n, SUM(t.amount) AS total FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE t.amount < 0 AND LOWER(TRIM(t.label)) REGEXP ?`,
    [regex],
  );
  const linked = await one<{ id: number; label: string }>("SELECT id, label FROM commitments WHERE label_regex = ? AND (owner_user_id IS NULL OR owner_user_id = ?) LIMIT 1", [regex, req.user!.id]);
  res.json({ regex, count: same?.n ?? 0, total: Number(same?.total ?? 0), commitment: linked ?? null });
});

/**
 * Nomme un prélèvement : relie sa forme de libellé à un engagement du budget (existant ou créé) ;
 * tous les prélèvements de même forme prennent son nom (et sa catégorie s'ils n'en ont pas).
 */
/**
 * Libellés de la banque : export CSV « Exporter les opérations » de BoursoBank (corps brut, UTF-8).
 * Garde le libellé de la banque sur chaque opération retrouvée, nomme celles que Finta ne nomme pas
 * et les classe d'après ce nom. Rejouable ; les opérations de tous les comptes de la famille.
 */
api.post("/bank-labels/import", raw({ type: () => true, limit: "8mb" }), async (req, res) => {
  // Corps en tampon : le journal des écritures n'en garde que la taille, jamais le contenu.
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ActionError(400, tr("Fichier vide"));
  res.json(await importBankLabels(req.body.toString("utf8")));
});

api.post("/transactions/:id/name-debit", async (req, res) => {
  const b = z
    .object({
      commitmentId: z.number().int().optional(),
      label: z.string().min(2).max(160).optional(),
      type: z.enum(["credit", "assurance", "abonnement", "taxe", "garde", "budget"]).optional(),
      groupName: z.string().max(80).nullable().optional(),
    })
    .parse(req.body);
  const tx = await one<{ label: string; amount: number; category_id: string | null }>(
    `SELECT t.label, t.amount, t.category_id FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE t.id = ?`,
    [req.params.id],
  );
  if (!tx) throw new ActionError(404, tr("Opération introuvable"));
  const regex = shapeRegex(labelShape(tx.label));
  if (b.commitmentId) await saveCommitment(req.user!.id, b.commitmentId, { labelRegex: regex });
  else {
    if (!b.label) throw new ActionError(400, tr("Nom requis"));
    await saveCommitment(req.user!.id, null, {
      label: b.label,
      type: b.type ?? "abonnement",
      status: "actif",
      monthly: Math.abs(Number(tx.amount)),
      categoryId: tx.category_id,
      labelRegex: regex,
      groupName: b.groupName ?? null,
    });
  }
  const named = await nameDebits();
  res.json({ ok: true, named, regex });
});

/** Catégories proposées pour une opération (fiche, mode tri, gestes). */
api.get("/transactions/:id/suggestions", async (req, res) => {
  res.json({ suggestions: await suggestCategories(req.user!.id, String(req.params.id), Math.min(6, Number(req.query.limit) || 3)) });
});

/** Annule le dernier classement (jeton renvoyé par PATCH /transactions/:id ou bulk-category, valable 5 min). */
api.post("/undo/:id", async (req, res) => {
  const label = await runUndo(req.user!.id, String(req.params.id));
  if (!label) throw new ActionError(410, tr("Trop tard pour annuler (5 minutes) : refais le classement à la main."));
  res.json({ ok: true, undone: label });
});

api.patch("/transactions/:id", async (req, res) => {
  const body = z
    .object({
      categoryId: z.string().max(16).nullable().optional(),
      note: z.string().max(2000).nullable().optional(),
      /** Crée une règle : toutes les opérations de même libellé prendront cette catégorie. */
      remember: z.boolean().optional(),
    })
    .parse(req.body);
  const restore = await snapshotTransactions([req.params.id], !!body.remember && body.categoryId != null);
  if (body.categoryId !== undefined) await setTransactionCategory(req.params.id, body.categoryId, body.remember);
  if (body.note !== undefined) await setTransactionNote(req.params.id, body.note);
  res.json({ ok: true, undoId: registerUndo(req.user!.id, "Classement", restore) });
});

/* ---------- Statistiques d'une période (un mois ou une année) ---------- */

api.get("/months/:month", async (req, res) => {
  const p = period.parse(req.params.month);
  const { start, end, prevStart, year } = periodRange(p);
  const byCategory = async (from: string, to: string) =>
    nameTransfers(
      await q<{ id: string | null; name: string | null; poste: string | null; kind: string | null; peer: string | null; total: number; count: number }>(
        // Sans catégorie : débits comptés en dépenses, crédits en revenus (deux groupes distincts). Un virement qui
        // franchit la vue a sa propre ligne, par titulaire du compte d'en face (`peer`).
        `SELECT c.id, c.name, c.poste, ${lineKind(userAccounts(req))} AS kind, ${peerOwner(userAccounts(req))} AS peer,
                SUM(t.amount) AS total, COUNT(*) AS count
         FROM tx_lines t JOIN ${userAccounts(req)} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
         WHERE ${STAT_SCOPE} AND t.date >= ? AND t.date < ?
         GROUP BY c.id, c.name, c.poste, kind, peer ORDER BY total`,
        [from, to],
      ),
      tr,
    );
  // Dépenses pas à pas, pour le cumul : jour par jour pour un mois, mois par mois pour une année (`day` = le rang).
  const steps = async (from: string, to: string) =>
    q<{ day: number; total: number }>(
      `SELECT ${year ? "MONTH" : "DAY"}(t.date) AS day, -SUM(t.amount) AS total FROM tx_lines t JOIN ${userAccounts(req)} a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${STAT_SCOPE} AND t.date >= ? AND t.date < ? AND ${isExpense(userAccounts(req))}
       GROUP BY day ORDER BY day`,
      [from, to],
    );
  const months = await q<{ month: string }>(
    "SELECT DISTINCT DATE_FORMAT(date, '%Y-%m') AS month FROM transactions WHERE status IN ('posted', 'pending') ORDER BY month DESC",
  );
  res.json({
    month: p,
    categories: await byCategory(start, end),
    previous: await byCategory(prevStart, start),
    // Postes colorés des donuts (même couleur d'un mois à l'autre).
    colored: await coloredPostes(userAccounts(req)),
    daily: await steps(start, end),
    dailyPrev: await steps(prevStart, start),
    months: months.map((r) => r.month),
  });
});

/* ---------- Crédits immobiliers ---------- */

async function loanWithSummary(userId: number, id?: string) {
  const loans = await q<Record<string, unknown> & { id: string; principal: number; disbursed: number | null }>(
    `SELECT * FROM loans WHERE (owner_user_id IS NULL OR owner_user_id = ?) ${id ? "AND id = ?" : ""} ORDER BY sort_order, id`,
    id ? [userId, id] : [userId],
  );
  const d = today();
  return Promise.all(
    loans.map(async (l) => {
      const schedule = await q<ScheduleRow>(
        "SELECT rang, date, payment, principal, interest, insurance, deferred_interest, remaining FROM loan_schedule WHERE loan_id = ? ORDER BY rang",
        [l.id],
      );
      const base = Number(l.disbursed ?? l.principal);
      return { loan: l, summary: summarizeLoan(schedule, base, d), schedule };
    }),
  );
}

api.get("/loans", async (req, res) => {
  const list = await loanWithSummary(req.user!.id);
  res.json({ loans: list.map(({ loan, summary }) => ({ ...loan, summary })) });
});

api.get("/loans/:id", async (req, res) => {
  const [item] = await loanWithSummary(req.user!.id, req.params.id);
  if (!item) return res.status(404).json({ error: tr("Crédit introuvable") });
  res.json({ ...item.loan, summary: item.summary, schedule: item.schedule });
});


/* ---------- Patrimoine ---------- */

api.get("/wealth", async (req, res) => {
  await ensureFreshPrices();
  const w = await snapshotWealth(req.user!.id);
  res.json({ ...w, history: await wealthHistory(req.user!.id) });
});

api.get("/crypto", async (req, res) => {
  await ensureFreshPrices();
  res.json({ ...(await cryptoPositions(req.user!.id)), status: await cryptoStatus(req.user!.id) });
});

/** Synchro à la demande : portefeuilles lus sur la blockchain, et compte CoinStats du foyer s'il y en a un. */
api.post("/crypto/sync", hourly(6), async (req, res) => {
  const r = await syncCrypto("manuel");
  if (r === null) throw new ActionError(409, tr("Une synchro crypto est déjà en cours, ou aucun portefeuille n'est à relire"));
  // Chacun n'apprend que ce qui est à lui : ses portefeuilles, ses lignes.
  res.json(await syncSummary(req.user!.id, r));
});

/** Inclure ou exclure un portefeuille CoinStats du patrimoine. */
api.patch("/crypto/sources/:id", async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  await setSourceEnabled(req.user!.id, z.string().max(96).parse(req.params.id), enabled);
  res.json({ ok: true });
});

/** Confirmer la nouvelle valeur d'un portefeuille « à vérifier » (vidé ou vendu pour de bon), puis relire CoinStats. */
api.post("/crypto/sources/:id/accept", hourly(12), async (req, res) => {
  if (!(await acceptSourceValue(req.user!.id, z.string().max(96).parse(req.params.id)))) throw new ActionError(409, tr("Ce portefeuille n'attend pas de confirmation"));
  const r = await syncCrypto("manuel");
  if (r === null) throw new ActionError(409, tr("Une synchro crypto est déjà en cours, ou aucun portefeuille n'est à relire"));
  res.json(await syncSummary(req.user!.id, r));
});

/**
 * Ajouter un portefeuille lu par son adresse publique (Bitcoin, Ethereum et chaînes compatibles, Solana, clé étendue
 * d'un compte Bitcoin, staking MultiversX, validateur Ethereum) : reconnu, contrôlé et lu tout de suite.
 */
api.post("/crypto/sources", hourly(30), async (req, res) => {
  const b = z.object({ address: z.string().min(1).max(200), name: z.string().max(160).nullish(), replaces: z.string().max(96).nullish() }).parse(req.body);
  res.json(
    await addWallet(req.user!.id, b).catch((e) => {
      throw new ActionError(400, e instanceof Error ? e.message : String(e));
    }),
  );
});

/**
 * Relier un compte d'exchange par une clé d'API en lecture seule : lue tout de suite, gardée chiffrée, jamais rendue.
 * Une clé qui peut faire plus que lire est refusée quand l'exchange sait le dire.
 */
api.post("/crypto/exchanges", hourly(20), async (req, res) => {
  const b = z
    .object({ exchange: z.enum(EXCHANGE_IDS), key: z.string().min(1).max(400), secret: z.string().max(4000).nullish(), passphrase: z.string().max(200).nullish(), name: z.string().max(160).nullish(), replaces: z.string().max(96).nullish() })
    .parse(req.body);
  res.json(
    await addExchange(req.user!.id, b).catch((e) => {
      throw new ActionError(400, e instanceof Error ? e.message : String(e));
    }),
  );
});

/**
 * Deux sources décrivent les mêmes avoirs (l'une lue sans intermédiaire, l'autre par un agrégateur) : le membre
 * demande de ne les compter qu'une fois. La lecture directe l'emporte, crypto par crypto.
 */
api.post("/crypto/sources/:id/once", async (req, res) => {
  const { other } = z.object({ other: z.string().max(96) }).parse(req.body);
  if (!(await countOnce(req.user!.id, z.string().max(96).parse(req.params.id), other))) throw new ActionError(404, tr("Portefeuille introuvable"));
  res.json({ ok: true });
});

/**
 * Déposer le fichier qu'exporte une appli sans clé d'API (corps brut : CSV de l'appli Crypto.com, classeur de
 * SwissBorg) : ses mouvements s'ajoutent à ceux déjà gardés, les soldes en sont recalculés. C'est sa seule façon d'entrer.
 */
api.post("/crypto/files/:app", hourly(60), raw({ type: () => true, limit: "8mb" }), async (req, res) => {
  const app = z.enum(FILE_APP_IDS).parse(req.params.app);
  // Corps en tampon : le journal des écritures n'en garde que la taille, jamais le contenu.
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw new ActionError(400, tr("Fichier vide"));
  res.json(
    await importCryptoFile(req.user!.id, app, req.body).catch((e) => {
      throw new ActionError(400, e instanceof Error ? e.message : String(e));
    }),
  );
});

/**
 * Solde constaté d'une crypto dans un portefeuille tenu par ses exports : ce que l'appli affiche, quand l'export a
 * un trou. `quantity` à `null` retire le solde constaté.
 */
api.post("/crypto/sources/:id/balance", hourly(120), async (req, res) => {
  const b = z.object({ symbol: z.string().min(1).max(24), quantity: z.number().min(0).max(1e15).nullable() }).parse(req.body);
  const done = await observeFileBalance(req.user!.id, z.string().max(96).parse(req.params.id), b.symbol, b.quantity).catch((e) => {
    throw new ActionError(400, e instanceof Error ? e.message : String(e));
  });
  if (!done) throw new ActionError(404, tr("Portefeuille introuvable"));
  res.json(done);
});

/** Retirer un portefeuille lu par son adresse ou un compte d'exchange (ceux de CoinStats se décochent : ils reviendraient à la synchro). */
api.delete("/crypto/sources/:id", async (req, res) => {
  if (!(await removeWallet(req.user!.id, z.string().max(96).parse(req.params.id)))) throw new ActionError(404, tr("Portefeuille introuvable"));
  res.json({ ok: true });
});

/** Supprimer pour de bon une ligne saisie à la main déjà archivée. */
api.delete("/crypto/:id", async (req, res) => {
  if (!(await deleteArchivedLine(req.user!.id, z.coerce.number().int().positive().parse(req.params.id)))) throw new ActionError(404, tr("Ligne introuvable"));
  res.json({ ok: true });
});

/** Archiver une ligne saisie à la main qu'un portefeuille ajouté vient remplacer. */
api.post("/crypto/:id/archive", async (req, res) => {
  const { portfolioId } = z.object({ portfolioId: z.string().max(96) }).parse(req.body);
  if (!(await archiveManualLine(req.user!.id, Number(req.params.id), portfolioId))) throw new ActionError(404, tr("Portefeuille introuvable"));
  res.json({ ok: true });
});

/** Remettre en compte une ligne manuelle archivée. */
api.post("/crypto/:id/restore", async (req, res) => {
  await restoreManualLine(req.user!.id, z.coerce.number().int().parse(req.params.id));
  res.json({ ok: true });
});

api.patch("/assets/:id", async (req, res) => {
  const body = z
    .object({
      value: z.number().nullable().optional(),
      quantity: z.number().nullable().optional(),
      cash: z.number().nullable().optional(),
      name: z.string().min(1).max(160).optional(),
      closed: z.boolean().optional(),
      // Versements reçus : texte cherché dans le libellé des entrées (null : plus de suivi) ; `followPayouts` : la valeur suit le dernier versement.
      payoutMatch: z.string().trim().max(120).nullable().optional(),
      followPayouts: z.boolean().optional(),
    })
    .parse(req.body);
  await updateAsset(req.user!.id, Number(req.params.id), body);
  res.json({ ok: true });
});

// Versements reçus d'un placement : les entrées qui portent son texte, lues dans les comptes du membre. Le choix
// Foyer / Moi n'y change rien : un versement arrivé sur le compte commun reste celui du placement.
api.get("/assets/:id/payouts", async (req, res) => {
  const asset = await one<{ payout_match: string | null; valuation: string }>("SELECT payout_match, valuation FROM assets WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [
    Number(req.params.id),
    req.user!.id,
  ]);
  if (!asset) throw new ActionError(404, tr("Élément introuvable"));
  const rows = asset.payout_match ? await payouts(userAccountsSql(req.user!.id), asset.payout_match) : [];
  res.json({ match: asset.payout_match, follows: asset.valuation === "versements", payouts: rows.slice(0, 12), ...summarizePayouts(rows, today()) });
});

api.post("/assets", async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1).max(160),
      category: z.enum(["epargne", "placement", "immobilier", "autre"]),
      value: z.number(),
      institution: z.string().max(255).nullable().optional(),
    })
    .parse(req.body);
  await exec("INSERT INTO assets (owner_user_id, name, category, value, value_date, institution) VALUES (?, ?, ?, ?, CURDATE(), ?)", [
    req.user!.id,
    body.name,
    body.category,
    body.value,
    body.institution ?? null,
  ]);
  await snapshotWealth(req.user!.id);
  res.json({ ok: true });
});

api.patch("/crypto/:id", async (req, res) => {
  const body = z.object({ quantity: z.number().min(0).optional(), manualValue: z.number().nullable().optional() }).parse(req.body);
  await updateCryptoPosition(req.user!.id, Number(req.params.id), body);
  res.json({ ok: true });
});

/* ---------- Tendances (graphiques) ---------- */

/** Revenus, dépenses et épargne par mois (12 derniers mois), dans le périmètre de l'utilisateur. */
/** Revenus, dépenses et épargne mois par mois : les douze derniers mois par défaut, ou du mois `from` au mois `to`. */
api.get("/trend", async (req, res) => {
  const f = z.object({ from: month.optional(), to: month.optional() }).parse(req.query);
  const current = householdDay().slice(0, 7);
  // Sans borne de fin : jusqu'aux opérations déjà datées des mois à venir (achats par carte en attente de prélèvement).
  res.json({ months: await monthlyTrend(userAccounts(req), f.from ?? addMonths(current, -11), f.to ?? addMonths(current, 12)) });
});

/** Solde disponible jour par jour (comptes visibles, hors cartes), sur N jours. */
api.get("/balance-series", async (req, res) => {
  const days = z.coerce.number().int().min(7).max(366).default(90).parse(req.query.days);
  const rows = await q<{ account_id: string; date: string; balance: number }>(
    `SELECT b.account_id, b.date, b.balance FROM balances b JOIN ${userAccounts(req)} a ON a.id = b.account_id
     WHERE a.hidden = 0 AND a.excluded = 0 AND a.kind <> 'carte' AND b.date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     ORDER BY b.date`,
    [days + 40],
  );
  const byAccount = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byAccount.has(r.account_id)) byAccount.set(r.account_id, new Map());
    byAccount.get(r.account_id)!.set(r.date.slice(0, 10), Number(r.balance));
  }
  const series: { date: string; balance: number }[] = [];
  const last = new Map<string, number>();
  const start = new Date(Date.now() - (days + 40) * 86400_000);
  for (let d = new Date(start); d <= new Date(); d.setUTCDate(d.getUTCDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    for (const [acc, m] of byAccount) if (m.has(key)) last.set(acc, m.get(key)!);
    if (d.getTime() >= Date.now() - days * 86400_000 && last.size)
      series.push({ date: key, balance: Math.round([...last.values()].reduce((s, v) => s + v, 0) * 100) / 100 });
  }
  res.json({ series });
});


/* ---------- Assistant IA ---------- */

const assistantLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 60,
  keyGenerator: (req) => `u${req.user?.id ?? 0}`,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  // Fonction : la langue n'est connue qu'au moment de la requête.
  message: () => ({ error: tr("Trop de messages envoyés à l'assistant cette heure-ci.") }),
});

api.get("/assistant/status", (_req, res) => res.json({ enabled: assistantEnabled() }));

/** Logo d'une marque ou d'une enseigne du foyer (d:<domaine>), d'une banque reliée (bank:<pays>:<banque>) ou d'une crypto (coin:<id>) : en cache, téléchargé au premier besoin. */
api.get("/logos/:key", async (req, res) => {
  const key = String(req.params.key);
  if (!(await logoKeyAllowed(key))) return res.status(404).end();
  const logo = await getLogo(key);
  if (!logo) return res.status(404).set("Cache-Control", "private, max-age=86400").end();
  res
    .set({ "Content-Type": logo.mime, "Cache-Control": "private, max-age=2592000", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" })
    .send(logo.data);
});

api.get("/assistant/memories", async (req, res) => {
  res.json({ memories: await listMemories(req.user!.id) });
});

api.delete("/assistant/memories/:id", async (req, res) => {
  const r = await exec("DELETE FROM assistant_memories WHERE id = ? AND user_id = ?", [Number(req.params.id), req.user!.id]);
  if (!r.affectedRows) throw new ActionError(404, tr("Fait introuvable"));
  res.json({ ok: true });
});

api.get("/assistant/threads", async (req, res) => {
  const search = typeof req.query.q === "string" ? req.query.q.slice(0, 120) : "";
  res.json({ threads: await listThreads(req.user!.id, { limit: Math.min(100, Number(req.query.limit) || 30), search }) });
});

api.get("/assistant/threads/:id", async (req, res) => {
  res.json(await getThread(req.user!.id, req.params.id));
});

/** Ranger l'historique : renommer (un titre vide rend la première question) ou épingler une conversation. */
api.patch("/assistant/threads/:id", async (req, res) => {
  const body = z.object({ title: z.string().max(160).optional(), pinned: z.boolean().optional() }).parse(req.body);
  await updateThread(req.user!.id, z.string().uuid().parse(req.params.id), body);
  res.json({ ok: true });
});

api.delete("/assistant/threads/:id", async (req, res) => {
  await deleteThread(req.user!.id, z.string().uuid().parse(req.params.id));
  res.json({ ok: true });
});

/**
 * Réponse de l'assistant : JSON, ou flux SSE avec ?stream=1 (texte au fil de l'eau, étapes « Recherche
 * des opérations… », puis le fil complet). no-transform : la compression ne doit pas retenir le flux.
 */
async function assistantReply(req: Request, res: Response, run: (emit?: (e: AssistantEvent) => void) => Promise<PublicThread>) {
  if (req.query.stream !== "1") return res.json(await run());
  res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
  try {
    send("done", await run((e) => send(e.type, e)));
  } catch (e) {
    if (!(e instanceof ActionError)) {
      console.error("[assistant]", e);
      void recordAlert("assistant", `Erreur de l'assistant : ${e instanceof Error ? e.message : String(e)}`, e);
    }
    send("error", { error: e instanceof ActionError ? e.message : tr("L'assistant n'a pas pu répondre : réessaie dans un instant.") });
  } finally {
    clearInterval(ping);
    res.end();
  }
}

const screenContext = z.object({
  path: z.string().max(200),
  screen: z.string().max(60).optional(),
  entity: z.object({ type: z.string().max(24), id: z.string().max(160), label: z.string().max(200).optional() }).optional(),
});

api.post("/assistant/message", assistantLimiter, async (req, res) => {
  if (!assistantEnabled()) return res.status(503).json({ error: tr("Assistant non configuré") });
  // Plafond du mois atteint, et le foyer a choisi de tout arrêter là : pas de nouvelle demande. Une action déjà
  // proposée se confirme encore (`/assistant/confirm`) : elle ne resterait pas en suspens.
  await assertAiBudget();
  const body = z
    .object({
      threadId: z.string().uuid().optional(),
      text: z.string().min(1).max(2000),
      invoiceIds: z.array(z.number().int()).max(5).optional(),
      documentIds: z.array(z.number().int()).max(5).optional(),
      context: screenContext.optional(),
      /** Message dicté en mode vocal : réponse courte, faite pour être lue à voix haute. */
      voice: z.boolean().optional(),
    })
    .parse(req.body);
  await assistantReply(req, res, (emit) =>
    sendMessage(req.user!.id, body.threadId, body.text, { invoiceIds: body.invoiceIds, documentIds: body.documentIds, context: body.context, voice: body.voice, emit }),
  );
});

api.post("/assistant/confirm", assistantLimiter, async (req, res) => {
  if (!assistantEnabled()) return res.status(503).json({ error: tr("Assistant non configuré") });
  const body = z.object({ threadId: z.string().uuid(), approve: z.boolean(), actionIds: z.array(z.string().nullable()).max(10).optional() }).parse(req.body);
  const ids = body.actionIds?.map((i) => i ?? "");
  await assistantReply(req, res, (emit) => confirmPending(req.user!.id, body.threadId, body.approve, ids, emit));
});

/* ---------- Administration (jeton d'API) : imports et invitations ---------- */

export const admin = Router();
admin.use(requireApiToken, json({ limit: "25mb" }));
admin.use(invoicesAdmin);
admin.use(documentsAdmin);
admin.use(situationAdmin);

/** Noms des prélèvements : liaison automatique aux engagements puis renommage (aussi lancé après chaque synchro). */
admin.post("/debits/refresh", async (_req, res) => {
  res.json(await refreshDebitNames());
});

/** Repart de zéro (noms, catégories posées par la reconnaissance, motifs automatiques), puis reconnaît à nouveau. */
admin.post("/debits/reset", async (_req, res) => {
  const reset = await resetDebitNames();
  res.json({ reset, refreshed: await refreshDebitNames() });
});

admin.post("/enrollment/:name", async (req, res) => {
  const user = await one<{ id: number }>("SELECT id FROM users WHERE name = ?", [req.params.name]);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  res.json({ link: await createEnrollmentLink(user.id) });
});

const categorySchema = z.object({
  id: z.string().max(16),
  name: z.string(),
  group_name: z.string().nullable(),
  poste: z.string().nullable(),
  kind: z.enum(["revenu", "depense", "epargne", "interne"]),
  sort_order: z.number().int(),
  description: z.string().nullable(),
});

admin.post("/import/categories", async (req, res) => {
  const list = z.array(categorySchema).parse(req.body);
  for (const c of list) {
    await exec(
      `INSERT INTO categories (id, name, group_name, poste, kind, sort_order, description) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), group_name = VALUES(group_name), poste = VALUES(poste), kind = VALUES(kind),
         sort_order = VALUES(sort_order), description = VALUES(description)`,
      [c.id, c.name, c.group_name, c.poste, c.kind, c.sort_order, c.description],
    );
  }
  res.json({ imported: list.length });
});

admin.post("/import/accounts", async (req, res) => {
  const list = z
    .array(z.object({ id: z.string(), name: z.string(), institution: z.string().nullable(), owner: z.string(), kind: z.string() }))
    .parse(req.body);
  let created = 0;
  for (const a of list) {
    // Comptes connus seulement de l'outil repris (cartes remplacées) : masqués mais comptés dans les statistiques.
    const r = await exec(
      "INSERT IGNORE INTO accounts (id, name, institution, owner, kind, hidden, source) VALUES (?, ?, ?, ?, ?, 1, 'reprise')",
      [a.id, a.name, a.institution, a.owner, a.kind],
    );
    created += r.affectedRows;
  }
  res.json({ created });
});

admin.post("/import/transactions", async (req, res) => {
  const list = z
    .array(
      z.object({
        id: z.string().max(160),
        accountId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.number(),
        label: z.string(),
        merchant: z.string().nullable(),
        categoryId: z.string().nullable(),
      }),
    )
    .parse(req.body);
  let inserted = 0;
  let categorized = 0;
  for (const t of list) {
    const key = labelKey(t.label, t.merchant);
    const r = await exec(
      `INSERT INTO transactions (id, account_id, date, amount, label, merchant, label_key, status, category_id, category_source, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'posted', ?, ?, 'reprise')
       ON DUPLICATE KEY UPDATE
         category_id = IF(category_source IS NULL OR category_source IN ('auto', 'regle'), COALESCE(VALUES(category_id), category_id), category_id),
         category_source = IF(category_source IS NULL OR category_source IN ('auto', 'regle'), IF(VALUES(category_id) IS NULL, category_source, 'reprise'), category_source)`,
      [t.id, t.accountId, t.date, t.amount, t.label.slice(0, 512), t.merchant, key, t.categoryId, t.categoryId ? "reprise" : null],
    );
    if (r.affectedRows === 1) inserted++;
    if (t.categoryId) categorized++;
  }
  // Les opérations restées sans catégorie profitent de l'historique fraîchement importé.
  const pending = await q<{ id: string; label_key: string }>("SELECT id, label_key FROM transactions WHERE category_id IS NULL");
  let auto = 0;
  for (const p of pending) {
    const g = await guessCategory(p.label_key);
    if (g) {
      await exec("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ?", [g.categoryId, g.source, p.id]);
      auto++;
    }
  }
  const duplicates = await markCardDuplicates();
  res.json({ received: list.length, inserted, categorized, auto, duplicates });
});

/**
 * Historique de la banque (relevés de BoursoBank, opérations de Bankin') : crée les opérations
 * absentes de Pécule. À blanc par défaut (`?appliquer=1` pour écrire) ; rejouable.
 */
admin.post("/import/bank-history", async (req, res) => {
  const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const body = z
    .object({
      rows: z
        .array(
          z.object({
            account: z.string().min(1).max(64),
            accountName: z.string().max(120).nullish(),
            date: isoDay,
            label: z.string().min(1).max(512),
            suggested: z.string().max(255).nullable().default(null),
            amount: z.number(),
            category: z.string().max(255).nullish(),
            card: z.boolean(),
          }),
        )
        .min(1)
        .max(50_000),
      accounts: z
        .record(
          z.string(),
          z.object({
            id: z.string().min(3).max(64),
            name: z.string().min(1).max(255),
            displayName: z.string().max(120).nullish(),
            owner: z.string().min(2).max(16),
            kind: z.enum(["courant", "carte", "epargne"]),
            like: z.string().max(64).nullish(),
            hidden: z.boolean().nullish(),
            excluded: z.boolean().nullish(),
            force: z.boolean().nullish(),
          }),
        )
        .optional(),
      bankCategories: z.record(z.string().max(255), z.string().max(16)).optional(),
    })
    .parse(req.body);
  const report = await importBankHistory({ ...body, dryRun: req.query.appliquer !== "1" });
  if (req.query.appliquer === "1") await fillPurchaseDates();
  res.json(report);
});

/** Retire tout ce que l'import de l'historique a créé (opérations `origin = 'banque'` et comptes créés pour elles). */
admin.delete("/import/bank-history", async (_req, res) => {
  res.json(await removeBankHistory());
});

admin.post("/import/rules", async (req, res) => {
  const list = z.array(z.object({ pattern: z.string().min(3), categoryId: z.string(), priority: z.number().int().optional() })).parse(req.body);
  for (const r of list) {
    await exec(
      "INSERT INTO rules (pattern, category_id, priority) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE category_id = VALUES(category_id), priority = VALUES(priority)",
      [r.pattern, r.categoryId, r.priority ?? 100],
    );
  }
  res.json({ imported: list.length });
});

admin.post("/import/loans", async (req, res) => {
  const list = z
    .array(
      z.object({
        id: z.string().max(32),
        name: z.string(),
        property: z.string(),
        bank: z.string(),
        reference: z.string().nullable(),
        type: z.string(),
        principal: z.number(),
        disbursed: z.number().nullable(),
        rate: z.number(),
        durationMonths: z.number().int(),
        startDate: z.string(),
        endDate: z.string(),
        notes: z.string().nullable(),
        sortOrder: z.number().int(),
        schedule: z.array(
          z.object({
            rang: z.number().int(),
            date: z.string(),
            payment: z.number(),
            principal: z.number(),
            interest: z.number(),
            insurance: z.number(),
            deferredInterest: z.number(),
            remaining: z.number(),
          }),
        ),
      }),
    )
    .parse(req.body);
  for (const l of list) {
    await exec(
      `INSERT INTO loans (id, name, property, bank, reference, type, principal, disbursed, rate, duration_months, start_date, end_date, notes, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), property = VALUES(property), bank = VALUES(bank), reference = VALUES(reference),
         type = VALUES(type), principal = VALUES(principal), disbursed = VALUES(disbursed), rate = VALUES(rate),
         duration_months = VALUES(duration_months), start_date = VALUES(start_date), end_date = VALUES(end_date),
         notes = VALUES(notes), sort_order = VALUES(sort_order)`,
      [l.id, l.name, l.property, l.bank, l.reference, l.type, l.principal, l.disbursed, l.rate, l.durationMonths, l.startDate, l.endDate, l.notes, l.sortOrder],
    );
    await exec("DELETE FROM loan_schedule WHERE loan_id = ?", [l.id]);
    for (const s of l.schedule) {
      await exec(
        "INSERT INTO loan_schedule (loan_id, rang, date, payment, principal, interest, insurance, deferred_interest, remaining) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [l.id, s.rang, s.date, s.payment, s.principal, s.interest, s.insurance, s.deferredInterest, s.remaining],
      );
    }
  }
  res.json({ loans: list.length, rows: list.reduce((n, l) => n + l.schedule.length, 0) });
});


/** Reprise du patrimoine depuis un autre outil : placements, positions crypto, instantanés historiques. Idempotent. */
admin.post("/import/wealth", async (req, res) => {
  const body = z
    .object({
      assets: z.array(
        z.object({
          owner: z.string().nullable(),
          name: z.string(),
          category: z.enum(["epargne", "placement", "immobilier", "autre"]),
          institution: z.string().nullable(),
          valuation: z.enum(["manuel", "cotation"]),
          ticker: z.string().nullable(),
          quantity: z.number().nullable(),
          cash: z.number().nullable(),
          value: z.number().nullable(),
          valueDate: z.string().nullable(),
          invested: z.number().nullable(),
          share: z.number(),
          liquidity: z.string().nullable(),
          loanIds: z.string().nullable(),
          notes: z.string().nullable(),
          sortOrder: z.number().int(),
        }),
      ),
      crypto: z.array(
        z.object({
          owner: z.string(),
          symbol: z.string(),
          name: z.string(),
          coingeckoId: z.string().nullable(),
          quantity: z.number(),
          manualValue: z.number().nullable(),
          location: z.string().nullable(),
          updatedAt: z.string(),
          sortOrder: z.number().int(),
        }),
      ),
      snapshots: z.array(z.object({ owner: z.string(), date: z.string(), gross: z.number(), debts: z.number(), net: z.number() })),
    })
    .parse(req.body);
  const userId = (name: string | null) => memberIdByName(name);
  for (const a of body.assets) {
    const owner = await userId(a.owner);
    const existing = await one<{ id: number }>("SELECT id FROM assets WHERE name = ? AND owner_user_id <=> ?", [a.name, owner]);
    const values = [a.category, a.institution, a.valuation, a.ticker, a.quantity, a.cash, a.value, a.valueDate, a.invested, a.share, a.liquidity, a.loanIds, a.notes, a.sortOrder];
    if (existing)
      await exec(
        `UPDATE assets SET category = ?, institution = ?, valuation = ?, ticker = ?, quantity = ?, cash = ?, value = ?, value_date = ?, invested = ?,
           share = ?, liquidity = ?, loan_ids = ?, notes = ?, sort_order = ? WHERE id = ?`,
        [...values, existing.id],
      );
    else
      await exec(
        `INSERT INTO assets (category, institution, valuation, ticker, quantity, cash, value, value_date, invested, share, liquidity, loan_ids, notes, sort_order, owner_user_id, name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [...values, owner, a.name],
      );
  }
  for (const c of body.crypto) {
    await exec(
      `INSERT INTO crypto_positions (owner_user_id, symbol, line_key, name, coingecko_id, quantity, manual_value, location, updated_at, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), coingecko_id = VALUES(coingecko_id), quantity = VALUES(quantity),
         manual_value = VALUES(manual_value), location = VALUES(location), updated_at = VALUES(updated_at), sort_order = VALUES(sort_order)`,
      [await userId(c.owner), c.symbol, c.symbol, c.name, c.coingeckoId, c.quantity, c.manualValue, c.location, c.updatedAt, c.sortOrder],
    );
  }
  for (const s of body.snapshots) {
    await exec(
      `INSERT INTO wealth_snapshots (user_id, date, gross, debts, net, source) VALUES (?, ?, ?, ?, ?, 'reprise')
       ON DUPLICATE KEY UPDATE gross = IF(source = 'reprise', VALUES(gross), gross), debts = IF(source = 'reprise', VALUES(debts), debts), net = IF(source = 'reprise', VALUES(net), net)`,
      [await userId(s.owner), s.date, s.gross, s.debts, s.net],
    );
  }
  const prices = await refreshWealth();
  res.json({ assets: body.assets.length, crypto: body.crypto.length, snapshots: body.snapshots.length, prices });
});

admin.get("/wealth/:name", async (req, res) => {
  const user = await one<{ id: number }>("SELECT id FROM users WHERE name = ?", [req.params.name]);
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
  res.json(await computeWealth(user.id));
});

/** Contrôle : totaux mensuels par catégorie (comparaison avec l'outil d'origine après une reprise). */
admin.get("/check/monthly", async (req, res) => {
  res.json({
    rows: await q(
      `SELECT DATE_FORMAT(t.date, '%Y-%m') AS month, COUNT(*) AS n, SUM(t.amount) AS total,
              SUM(t.category_id IS NULL) AS uncategorized
       FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id
       WHERE t.status IN ('posted', 'pending') AND a.excluded = 0 GROUP BY month ORDER BY month`,
    ),
  });
});

/** Structure réelle de la base (lecture seule) : contrôle du schéma Drizzle par `pnpm db:check`. */
admin.get("/logos", async (_req, res) => {
  res.json({ logos: await logoStatus() });
});

admin.post("/logos/refresh", async (req, res) => {
  res.json({ removed: await refreshWeakLogos(Number(req.query.min) || 3000) });
});

admin.delete("/logos/:key", async (req, res) => {
  await resetLogo(String(req.params.key));
  res.json({ ok: true });
});

admin.get("/schema", async (_req, res) => {
  const columns = await q(
    `SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, COLUMN_TYPE AS type, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS dflt,
            COLUMN_KEY AS col_key, EXTRA AS extra, ORDINAL_POSITION AS pos
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  );
  const indexes = await q(
    `SELECT TABLE_NAME AS tbl, INDEX_NAME AS name, NON_UNIQUE AS non_unique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
     FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY TABLE_NAME, INDEX_NAME`,
  );
  const foreignKeys = await q(
    `SELECT k.TABLE_NAME AS tbl, k.CONSTRAINT_NAME AS name, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS cols,
            k.REFERENCED_TABLE_NAME AS ref_tbl, r.DELETE_RULE AS on_delete
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.TABLE_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
     GROUP BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.REFERENCED_TABLE_NAME, r.DELETE_RULE ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME`,
  );
  const tables = await q(`SELECT TABLE_NAME AS tbl, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`);
  res.json({ tables, columns, indexes, foreignKeys });
});

/* ---------- Journal : alertes techniques et audit ---------- */

api.get("/alerts", async (req, res) => {
  // Alertes techniques : affaire de l'administrateur (elles peuvent citer des données de tout le foyer).
  if (!req.user!.admin) return res.json({ alerts: [] });
  const rows = await db
    .select()
    .from(alerts)
    .where(or(isNull(alerts.resolvedAt), gt(alerts.lastAt, sql`NOW() - INTERVAL 30 DAY`)))
    .orderBy(sql`${alerts.resolvedAt} IS NULL DESC`, desc(alerts.lastAt))
    .limit(40);
  res.json({ alerts: rows });
});

api.post("/alerts/:id/resolve", requireAdmin, async (req, res) => {
  const id = z.coerce.number().int().parse(req.params.id);
  await db.update(alerts).set({ resolvedAt: sql`CURRENT_TIMESTAMP` }).where(eq(alerts.id, id));
  res.json({ ok: true });
});

api.get("/audit", async (req, res) => {
  const limit = z.coerce.number().int().min(1).max(200).default(40).parse(req.query.limit ?? undefined);
  const rows = await db
    .select({ id: auditLog.id, at: auditLog.at, via: auditLog.via, action: auditLog.action, target: auditLog.target, details: auditLog.details, user: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    // L'administrateur voit tout le journal ; un membre, ses propres écritures (le détail peut porter des données privées).
    .where(req.user!.admin ? undefined : eq(auditLog.userId, req.user!.id))
    .orderBy(desc(auditLog.id))
    .limit(limit);
  res.json({ entries: rows });
});

/* ---------- Recherche universelle (palette ⌘K) ---------- */

api.get("/search", async (req, res) => {
  const text = z.string().trim().min(2).max(80).parse(req.query.q);
  const like = `%${text.replace(/[%_]/g, (c) => `\\${c}`)}%`;
  const uid = req.user!.id;
  const [transactions, invoices, accounts, assets, crypto, documents] = await Promise.all([
    q(
      `SELECT t.id, t.date, t.amount, t.label, t.merchant, t.bank_label, c.name AS category_name, COALESCE(a.display_name, a.name) AS account_name
       FROM transactions t JOIN ${userAccounts(req)} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.status IN ('posted', 'pending') AND (t.label LIKE ? OR t.merchant LIKE ? OR t.bank_label LIKE ? OR t.note LIKE ? OR c.name LIKE ?)
       ORDER BY t.date DESC LIMIT 8`,
      [like, like, like, like, like],
    ),
    q(
      `SELECT i.id, i.merchant, i.title, i.invoice_date, i.total, i.currency FROM invoices i
       WHERE (i.owner_user_id IS NULL OR i.owner_user_id = ?)
         AND (i.merchant LIKE ? OR i.title LIKE ? OR i.invoice_number LIKE ? OR i.order_ref LIKE ?
              OR EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.id AND it.label LIKE ?))
       ORDER BY i.invoice_date DESC LIMIT 6`,
      [uid, like, like, like, like, like],
    ),
    q(
      `SELECT a.id, COALESCE(a.display_name, a.name) AS name, a.kind, a0.balance FROM ${userAccounts(req)} a JOIN accounts a0 ON a0.id = a.id
       WHERE a.hidden = 0 AND (a.name LIKE ? OR a.display_name LIKE ?) LIMIT 5`,
      [like, like],
    ),
    q(`SELECT id, name, category, value FROM assets WHERE closed = 0 AND (owner_user_id IS NULL OR owner_user_id = ?) AND (name LIKE ? OR institution LIKE ?) LIMIT 5`, [uid, like, like]),
    q(
      `SELECT symbol, MIN(name) AS name, SUM(quantity) AS quantity FROM crypto_positions
       WHERE owner_user_id = ? AND archived_at IS NULL AND (symbol LIKE ? OR name LIKE ? OR location LIKE ?) GROUP BY symbol LIMIT 5`,
      [uid, like, like, like],
    ),
    searchDocuments(uid, { q: text, limit: 6 }).then((r) => r.documents),
  ]);
  res.json({ transactions, invoices, accounts, assets, crypto, documents });
});

/* ---------- Analyse : flux, natures, prélèvements, marchands ---------- */

api.get("/analysis/flows", async (req, res) => {
  res.json(await monthFlows(userAccounts(req), periodOf(req)));
});

/* ---------- Résumé de la semaine ---------- */

api.get("/weekly-summary", async (req, res) => {
  res.json({ summary: await latestSummary(req.user!.id) });
});
api.post("/weekly-summary", async (req, res) => {
  const cur = await latestSummary(req.user!.id);
  // Au plus une génération à la demande par jour (chaque résumé coûte un appel à Claude).
  if (cur && Date.now() - Date.parse(cur.createdAt) < 20 * 3600_000) throw new ActionError(429, tr("Résumé déjà préparé aujourd'hui."));
  await generateSummary(req.user!.id, true);
  res.json({ summary: await latestSummary(req.user!.id) });
});

/* ---------- Notifications push ---------- */

const pushSub = z.object({ endpoint: z.string().url().max(600), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) });
const notifPrefs = z.object(
  Object.fromEntries([...Object.keys(NOTIF_TYPES).map((k) => [k, z.boolean().optional()]), ["lowBalance", z.number().min(0).max(100000).optional()]]),
) as z.ZodType<NotifPrefs>;

api.get("/push/key", async (req, res) => {
  // Le plafond de l'IA se règle par l'administrateur : son alerte n'est proposée qu'à lui.
  const types = Object.fromEntries(Object.entries(NOTIF_TYPES).filter(([k]) => req.user!.admin || !ADMIN_NOTIF_TYPES.has(k)));
  res.json({ publicKey: (await vapidKeys()).publicKey, types });
});
api.post("/push/subscribe", async (req, res) => {
  const b = z.object({ subscription: pushSub, device: z.string().max(120).nullable().optional() }).parse(req.body);
  await subscribe(req.user!.id, b.subscription, b.device ?? null);
  res.json({ ok: true, subscription: await getSubscription(req.user!.id, b.subscription.endpoint) });
});
api.post("/push/status", async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().max(600) }).parse(req.body);
  res.json({ subscription: await getSubscription(req.user!.id, endpoint) });
});
api.patch("/push/prefs", async (req, res) => {
  const b = z.object({ endpoint: z.string().max(600), prefs: notifPrefs }).parse(req.body);
  await updatePrefs(req.user!.id, b.endpoint, b.prefs);
  res.json({ ok: true });
});
api.post("/push/unsubscribe", async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().max(600) }).parse(req.body);
  await unsubscribe(req.user!.id, endpoint);
  res.json({ ok: true });
});
api.post("/push/test", hourly(20), async (req, res) => {
  const sent = await notify(req.user!.id, "test", null, { title: "Pécule", body: tr("Les notifications fonctionnent sur cet appareil."), url: "/reglages/notifications" });
  res.json({ sent });
});
api.get("/push/recent", async (req, res) => {
  res.json({ notifications: await recentNotifications(req.user!.id) });
});

/* ---------- Enveloppes et objectifs d'épargne ---------- */

api.get("/envelopes", async (req, res) => {
  const [envelopes, candidates] = await Promise.all([listEnvelopes(req.user!.id, userAccounts(req)), envelopeCandidates(userAccounts(req))]);
  res.json({ envelopes, candidates });
});
const envelopeBody = z.object({
  scope: z.enum(["poste", "categorie"]).optional(),
  ref: z.string().min(1).max(120).optional(),
  monthly: z.number().min(0).max(1_000_000).optional(),
  alertPct: z.number().int().min(10).max(100).optional(),
  private: z.boolean().optional(),
});
api.post("/envelopes", async (req, res) => {
  res.json({ id: await saveEnvelope(req.user!.id, null, envelopeBody.parse(req.body)) });
});
api.patch("/envelopes/:id", async (req, res) => {
  res.json({ id: await saveEnvelope(req.user!.id, Number(req.params.id), envelopeBody.parse(req.body)) });
});
api.delete("/envelopes/:id", async (req, res) => {
  await deleteEnvelope(req.user!.id, Number(req.params.id));
  res.json({ ok: true });
});

api.get("/goals", async (req, res) => {
  res.json({ goals: await listGoals(req.user!.id) });
});
const goalBody = z.object({
  name: z.string().min(1).max(120).optional(),
  emoji: z.string().max(16).nullable().optional(),
  target: z.number().min(1).max(100_000_000).optional(),
  targetDate: day.nullable().optional(),
  assetId: z.number().int().nullable().optional(),
  currentManual: z.number().min(0).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(["actif", "atteint", "archive"]).optional(),
  private: z.boolean().optional(),
});
api.post("/goals", async (req, res) => {
  res.json({ id: await saveGoal(req.user!.id, null, goalBody.parse(req.body)) });
});
api.patch("/goals/:id", async (req, res) => {
  res.json({ id: await saveGoal(req.user!.id, Number(req.params.id), goalBody.parse(req.body)) });
});
api.delete("/goals/:id", async (req, res) => {
  await deleteGoal(req.user!.id, Number(req.params.id));
  res.json({ ok: true });
});

/** Comparer deux périodes : dépenses par poste, revenus, épargne (référence : précédente, l'an dernier, moyenne, libre). */
api.get("/analysis/compare", async (req, res) => {
  const f = z
    .object({ from: day, to: day, base: z.enum(["prev", "year", "avg3", "avg6", "avg12", "custom"]).default("prev"), bfrom: day.optional(), bto: day.optional() })
    .parse(req.query);
  const a = { from: f.from, to: f.to };
  const b = comparisonSpan(a, f.base, f.bfrom && f.bto ? { from: f.bfrom, to: f.bto } : undefined);
  res.json({ label: b.label, ...(await comparePeriods(userAccounts(req), a, b)) });
});

api.get("/analysis/natures", async (req, res) => {
  const f = z.object({ from: month.optional(), to: month.optional() }).parse(req.query);
  const current = householdDay().slice(0, 7);
  res.json({ months: await natureTrend(userAccounts(req), f.from ?? addMonths(current, -11), f.to ?? current) });
});

/** Prélèvements : le calendrier d'un mois (passés, attendus, absents), ou le tableau d'une année (créancier par mois). */
api.get("/analysis/debits", async (req, res) => {
  const p = periodOf(req);
  res.json(isYearPeriod(p) ? await yearDebits(userAccounts(req), p) : await monthDebits(req.user!.id, userAccounts(req), p));
});

api.get("/analysis/timeline", async (req, res) => {
  res.json(await monthTimeline(userAccounts(req), periodOf(req)));
});

api.get("/analysis/merchants", async (req, res) => {
  res.json({ merchants: await monthMerchants(userAccounts(req), periodOf(req)) });
});

/** Prévision : le mois en cours et les trois suivants, entre ce qui est déjà écrit et ce qui est attendu (récurrences). */
api.get("/analysis/forecast", async (req, res) => {
  res.json(await forecast(userAccounts(req)));
});

api.get("/analysis/debit-series", async (req, res) => {
  res.json({ series: await debitSeries(req.user!.id) });
});

/* ---------- Compteurs du menu (ordinateur) ---------- */

api.get("/nav-counts", async (req, res) => {
  const uid = req.user!.id;
  const today = householdDay();
  const [unc, inv, tasks, alertsOpen] = await Promise.all([
    one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM tx_lines t JOIN ${userAccounts(req)} a ON a.id = t.account_id WHERE t.status IN ('posted', 'pending') AND a.excluded = 0 AND t.category_id IS NULL`,
    ),
    one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM invoices i WHERE (i.owner_user_id IS NULL OR i.owner_user_id = ?) AND i.no_match = 0
         AND NOT EXISTS (SELECT 1 FROM invoice_transactions it WHERE it.invoice_id = i.id)
         AND i.invoice_date >= (SELECT DATE_SUB(MIN(date), INTERVAL 7 DAY) FROM transactions)`,
      [uid],
    ),
    one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM agenda_items a WHERE (a.owner_user_id IS NULL OR a.owner_user_id = ?) AND a.kind = 'tache' AND a.status = 'a_faire' AND a.due_date < ?",
      [uid, today],
    ),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL"),
  ]);
  // Comptes surveillés sous leur seuil, ou qui y passeraient dans le délai de la règle du membre (menu « Soldes à venir »).
  const lowBalance = (await balanceForecast(uid)).accounts.filter((a) => a.watched && a.low).length;
  // Une version plus récente est publiée : dit à l'administrateur seulement (c'est lui qui met Pécule à jour), jamais en démo.
  const update = !!req.user!.admin && !req.user!.demo && (await updateAvailable()).kind !== "a-jour";
  res.json({ uncategorized: unc?.n ?? 0, invoicesToMatch: inv?.n ?? 0, tasksOverdue: tasks?.n ?? 0, alerts: alertsOpen?.n ?? 0, lowBalance, update });
});

/* ---------- Tableau de bord : à traiter et échéances ---------- */

// Agencement du tableau de bord du membre : `null` tant qu'il n'a rien arrangé (l'écran montre la vue d'ensemble).
api.get("/dashboard/layout", async (req, res) => {
  res.json({ layout: await dashLayout(req.user!.id) });
});

api.put("/dashboard/layout", async (req, res) => {
  const layout = cleanLayout((req.body as { layout?: unknown } | undefined)?.layout);
  if (!layout) throw new ActionError(400, tr("Agencement illisible"));
  res.json({ layout: await saveDashLayout(req.user!.id, layout) });
});

api.get("/dashboard", async (req, res) => {
  const uid = req.user!.id;
  const [alertsOpen, invoicesToMatch, staleAssets, cryptoRun, upcoming] = await Promise.all([
    one<{ n: number }>("SELECT COUNT(*) AS n FROM alerts WHERE resolved_at IS NULL"),
    one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM invoices i WHERE (i.owner_user_id IS NULL OR i.owner_user_id = ?) AND i.no_match = 0
         AND NOT EXISTS (SELECT 1 FROM invoice_transactions it WHERE it.invoice_id = i.id)
         AND i.invoice_date >= (SELECT DATE_SUB(MIN(date), INTERVAL 7 DAY) FROM transactions)`,
      [uid],
    ),
    // Valeurs saisies à la main depuis plus de 90 jours : à relever.
    q<{ id: number; name: string; value_date: string | null }>(
      `SELECT id, name, value_date FROM assets WHERE closed = 0 AND valuation = 'manuel' AND (owner_user_id IS NULL OR owner_user_id = ?)
         AND (value_date IS NULL OR value_date < DATE_SUB(CURDATE(), INTERVAL 90 DAY)) ORDER BY value_date LIMIT 6`,
      [uid],
    ),
    one<{ status: string; finished_at: string | null; started_at: string }>("SELECT status, finished_at, started_at FROM crypto_sync_runs ORDER BY id DESC LIMIT 1"),
    // Échéancier des 60 prochains jours (crédits, garanties, documents, impôts, tâches) : même calcul que l'écran Échéancier.
    agenda(uid, householdDay(), new Date(Date.now() + 60 * 86400_000).toISOString().slice(0, 10)),
  ]);
  res.json({
    alertsOpen: alertsOpen?.n ?? 0,
    invoicesToMatch: invoicesToMatch?.n ?? 0,
    staleAssets,
    cryptoRun: cryptoRun ?? null,
    tasksOverdue: upcoming.filter((e) => e.overdue && e.kind === "tache").length,
    upcoming: upcoming
      .filter((e): e is typeof e & { date: string } => !!e.date && !e.overdue)
      .slice(0, 10)
      .map((e) => ({ kind: e.source, date: e.date, label: e.title, amount: e.amount ?? null, link: e.link ?? "/echeancier" })),
  });
});
