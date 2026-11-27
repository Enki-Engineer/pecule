import { exec, one, q } from "./db.ts";
import { ActionError, userAccountsSql } from "./actions.ts";
import { STAT_DATE_JOIN, statDate } from "./stats.ts";
import { householdCurrency, today } from "./region.ts";
import { priceFactor } from "./wealth.ts";
import { addCryptoEvent, type EventInput } from "./crypto-events.ts";
import { alreadyTold, detectMoves, PLATFORM_WORDS, platformOf, type Holding } from "../lib/crypto-moves.ts";
import { kindOf, type EventKind } from "../lib/crypto-events.ts";
import { moveEventKind, OBSERVED } from "../lib/crypto-files.ts";
import { t as tr } from "../lib/i18n.ts";

/*
 * Mouvements que Pécule propose de noter au journal crypto, d'après ce qu'il lit déjà : une opération bancaire vers
 * une plateforme crypto (relue à chaque fois dans les opérations du membre), un solde qui a bougé entre deux
 * synchronisations (gardé dans `crypto_proposals`). Une proposition n'écrit rien au journal : le membre la note —
 * il peut tout y corriger — ou l'écarte. Les règles sont dans src/lib/crypto-moves.ts. Les lignes lues dans les
 * exports d'une appli se consultent à part (`sourceMoves`) : le membre y choisit celles qu'il note.
 */

export type Proposal = {
  /** « tx:<opération> » ou « sync:… » : ce que l'écran renvoie pour la noter ou l'écarter. */
  ref: string;
  origin: "banque" | "synchro";
  date: string;
  /** Synchronisation : jour de la lecture d'avant (le mouvement a eu lieu entre les deux). */
  since: string | null;
  type: EventKind;
  asset: string | null;
  quantity: number | null;
  /** Dans la devise du foyer ; estimée au cours du jour de la lecture pour une synchronisation. */
  value: number | null;
  platform: string | null;
  /** Transfert entre deux portefeuilles du membre : celui d'où vient la crypto. */
  fromPlatform: string | null;
  /** Mouvement dont l'autre bout n'est pas connu : la crypto est arrivée (in) ou partie (out). */
  direction: "in" | "out" | null;
  /** Banque : le libellé de l'opération et le compte, pour la reconnaître. */
  label: string | null;
  account: string | null;
};

const MAX_SHOWN = 30;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Opérations du membre qui peuvent se proposer : sur ses comptes et les comptes communs, comptés dans ses statistiques. */
const ownOperations = (userId: number) =>
  `FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id
   WHERE t.status = 'posted' AND a.excluded = 0 AND a.owner NOT IN (SELECT LOWER(u.name) FROM users u WHERE u.id <> ${Number(userId)})`;

/**
 * Opérations bancaires vers une plateforme crypto (ou qui en reviennent) que le journal ne raconte pas encore : ni
 * notées, ni écartées, ni couvertes par un mouvement d'argent du journal sur la même plateforme aux mêmes dates.
 * Un virement de quelques centimes — l'essai par lequel une plateforme vérifie un compte — n'est pas proposé.
 */
async function bankProposals(userId: number): Promise<Proposal[]> {
  const rows = await q<{ id: string; day: string; amount: number; label: string; merchant: string | null; bank_label: string | null; account: string }>(
    `SELECT t.id, ${statDate("t")} AS day, t.amount, t.label, t.merchant, t.bank_label, COALESCE(a.display_name, a.name) AS account
     FROM transactions t JOIN ${userAccountsSql(userId)} a ON a.id = t.account_id ${STAT_DATE_JOIN}
     LEFT JOIN crypto_events e ON e.transaction_id = t.id AND e.owner_user_id = ?
     LEFT JOIN crypto_proposals p ON p.ref = CONCAT('tx:', t.id) AND p.owner_user_id = ?
     WHERE t.status = 'posted' AND a.excluded = 0 AND a.owner NOT IN (SELECT LOWER(u.name) FROM users u WHERE u.id <> ?)
       AND e.id IS NULL AND p.id IS NULL AND ABS(t.amount) >= 1
       AND (${PLATFORM_WORDS.map(() => "LOWER(CONCAT_WS(' ', t.label, t.merchant, t.bank_label)) LIKE ?").join(" OR ")})
     ORDER BY day DESC, t.id LIMIT 300`,
    [userId, userId, userId, ...PLATFORM_WORDS.map((w) => `%${w}%`)],
  );
  if (!rows.length) return [];
  const told = await q<{ date: string; endDate: string | null; platform: string | null }>(
    `SELECT e.date, e.end_date AS endDate, COALESCE(s.name, e.platform) AS platform
     FROM crypto_events e LEFT JOIN crypto_sources s ON s.portfolio_id = e.portfolio_id AND s.owner_user_id = e.owner_user_id
     WHERE e.owner_user_id = ? AND e.type IN ('depot', 'retrait', 'achat', 'vente')`,
    [userId],
  );
  const currency = householdCurrency();
  const out: Proposal[] = [];
  for (const r of rows) {
    const platform = platformOf(r.label, r.merchant, r.bank_label);
    if (!platform || alreadyTold(r.day, platform.name, told)) continue;
    const amount = Math.abs(Number(r.amount));
    out.push({
      ref: `tx:${r.id}`,
      origin: "banque",
      date: r.day,
      since: null,
      type: Number(r.amount) < 0 ? "depot" : "retrait",
      asset: currency,
      quantity: amount,
      value: amount,
      platform: platform.name,
      fromPlatform: null,
      direction: null,
      label: r.label,
      account: r.account,
    });
    if (out.length >= MAX_SHOWN) break;
  }
  return out;
}

/** Soldes qui ont bougé à une synchronisation, et dont le membre n'a encore rien décidé. */
async function syncProposals(userId: number): Promise<Proposal[]> {
  const rows = await q<{ ref: string; date: string; since: string | null; type: string; asset: string | null; quantity: number | null; value: number | null; platform: string | null; fromPlatform: string | null; direction: string | null }>(
    `SELECT p.ref, p.date, p.since, p.type, p.asset, p.quantity, p.value, s.name AS platform, f.name AS fromPlatform, p.direction
     FROM crypto_proposals p
     LEFT JOIN crypto_sources s ON s.portfolio_id = p.portfolio_id AND s.owner_user_id = p.owner_user_id
     LEFT JOIN crypto_sources f ON f.portfolio_id = p.from_portfolio_id AND f.owner_user_id = p.owner_user_id
     WHERE p.owner_user_id = ? AND p.origin = 'synchro' AND p.status = 'ouverte'
     ORDER BY p.date DESC, p.id DESC LIMIT ?`,
    [userId, MAX_SHOWN],
  );
  return rows.map((r) => ({ ...r, origin: "synchro" as const, type: kindOf(r.type) ?? "autre", direction: r.direction === "in" || r.direction === "out" ? r.direction : null, label: null, account: null }));
}

/** Tout ce que Pécule propose au membre de noter, le plus récent d'abord. */
export async function cryptoProposals(userId: number): Promise<Proposal[]> {
  const all = [...(await syncProposals(userId)), ...(await bankProposals(userId))];
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, MAX_SHOWN);
}

const txId = (ref: string) => (ref.startsWith("tx:") ? ref.slice(3) : null);
/** « move:<portefeuille>:<ligne> » : une ligne lue dans l'export d'une appli (l'identifiant d'un portefeuille peut porter des « : »). */
const moveRef = (ref: string) => {
  const cut = ref.lastIndexOf(":");
  return ref.startsWith("move:") && cut > 5 ? { portfolioId: ref.slice(5, cut), rowKey: ref.slice(cut + 1) } : null;
};

/** L'opération bancaire d'une proposition, si le membre peut la voir. */
async function ownOperation(userId: number, id: string) {
  return one<{ id: string; day: string; amount: number }>(`SELECT t.id, t.date AS day, t.amount ${ownOperations(userId)} AND t.id = ?`, [id]);
}

/** Vrai si la proposition existe et attend encore la décision du membre. */
export async function openProposal(userId: number, ref: string): Promise<boolean> {
  const move = moveRef(ref);
  if (move) {
    const line = await one("SELECT 1 AS x FROM crypto_file_moves WHERE portfolio_id = ? AND owner_user_id = ? AND row_key = ? AND kind <> ?", [move.portfolioId, userId, move.rowKey, OBSERVED]);
    if (!line) return false;
    return !(await one("SELECT 1 AS x FROM crypto_events WHERE owner_user_id = ? AND source_ref = ? LIMIT 1", [userId, ref]));
  }
  const id = txId(ref);
  if (id) {
    if (!(await ownOperation(userId, id))) return false;
    const taken = await one("SELECT 1 AS x FROM crypto_events WHERE transaction_id = ? AND owner_user_id = ? LIMIT 1", [id, userId]);
    return !taken;
  }
  return !!(await one("SELECT 1 AS x FROM crypto_proposals WHERE owner_user_id = ? AND ref = ? AND status = 'ouverte'", [userId, ref]));
}

/**
 * Note au journal le mouvement d'une proposition, tel que le membre l'a relu (il a pu tout corriger). La proposition
 * est soldée : l'opération bancaire est reliée au mouvement, la proposition de synchronisation est marquée notée.
 */
export async function noteProposal(userId: number, ref: string, e: EventInput, via: "main" | "assistant"): Promise<number> {
  if (!(await openProposal(userId, ref))) throw new ActionError(404, tr("Cette proposition n'est plus à noter"));
  if (moveRef(ref)) return addCryptoEvent(userId, e, via === "assistant" ? "assistant" : "fichier", { sourceRef: ref });
  const id = txId(ref);
  if (id) return addCryptoEvent(userId, e, via === "assistant" ? "assistant" : "banque", { transactionId: id });
  // Le nom du portefeuille, gardé tel que proposé, y rattache le mouvement (voir `place`, crypto-events.ts).
  const eventId = await addCryptoEvent(userId, e, via === "assistant" ? "assistant" : "synchro");
  await exec("UPDATE crypto_proposals SET status = 'notee', event_id = ? WHERE owner_user_id = ? AND ref = ?", [eventId, userId, ref]);
  return eventId;
}

/** Écarte des propositions : elles ne seront plus montrées. Rend le nombre de propositions écartées. */
export async function dismissProposals(userId: number, refs: string[]): Promise<number> {
  let n = 0;
  for (const ref of refs) {
    const id = txId(ref);
    if (id) {
      const op = await ownOperation(userId, id);
      if (!op) continue;
      const r = await exec(
        `INSERT INTO crypto_proposals (owner_user_id, ref, origin, status, date, type, value) VALUES (?, ?, 'banque', 'ecartee', ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = 'ecartee'`,
        [userId, ref.slice(0, 191), op.day, Number(op.amount) < 0 ? "depot" : "retrait", Math.abs(Number(op.amount))],
      );
      n += r.affectedRows ? 1 : 0;
    } else {
      const r = await exec("UPDATE crypto_proposals SET status = 'ecartee' WHERE owner_user_id = ? AND ref = ? AND status = 'ouverte'", [userId, ref]);
      n += r.affectedRows;
    }
  }
  return n;
}

/* ---------- Lignes lues dans les exports d'une appli ---------- */

export type SourceMove = {
  /** Ce que l'écran renvoie pour noter la ligne au journal (« move:<portefeuille>:<ligne> »). */
  ref: string;
  at: string;
  /** Genre écrit par l'appli, tel quel. */
  kind: string;
  /** Genre du journal qui lui ressemble, s'il y en a un. */
  type: EventKind | null;
  symbol: string;
  amount: number;
  /** Déjà noté au journal depuis cette ligne. */
  noted: boolean;
};

/**
 * Mouvements que Pécule a lus dans les exports d'un portefeuille du membre (appli sans clé d'API), du plus récent au
 * plus ancien : tels que l'appli les écrit. Rien n'y est proposé d'office — il y en a des centaines — ; le membre
 * note au journal ceux qui comptent pour lui. `null` : ce portefeuille n'est pas à lui, ou n'est pas tenu par fichier.
 */
export async function sourceMoves(userId: number, portfolioId: string, limit = 200): Promise<{ name: string; total: number; moves: SourceMove[] } | null> {
  const src = await one<{ name: string; type: string }>("SELECT name, type FROM crypto_sources WHERE portfolio_id = ? AND owner_user_id = ?", [portfolioId, userId]);
  if (!src || !src.type.startsWith("f-")) return null;
  const count = await one<{ n: number }>("SELECT COUNT(*) AS n FROM crypto_file_moves WHERE portfolio_id = ? AND owner_user_id = ? AND kind <> ?", [portfolioId, userId, OBSERVED]);
  const rows = await q<{ row_key: string; at: string; kind: string; symbol: string; amount: number; noted: number | null }>(
    `SELECT m.row_key, DATE_FORMAT(m.at, '%Y-%m-%d %H:%i:%s') AS at, m.kind, m.symbol, m.amount, e.id AS noted
     FROM crypto_file_moves m
     LEFT JOIN crypto_events e ON e.owner_user_id = m.owner_user_id AND e.source_ref = CONCAT('move:', m.portfolio_id, ':', m.row_key)
     WHERE m.portfolio_id = ? AND m.owner_user_id = ? AND m.kind <> ?
     ORDER BY m.at DESC, m.id DESC LIMIT ?`,
    [portfolioId, userId, OBSERVED, limit],
  );
  return {
    name: src.name,
    total: Number(count?.n ?? 0),
    moves: rows.map((r) => ({ ref: `move:${portfolioId}:${r.row_key}`, at: r.at, kind: r.kind, type: moveEventKind(r.kind), symbol: r.symbol, amount: Number(r.amount), noted: r.noted != null })),
  };
}

/* ---------- Synchronisation : ce qui a bougé entre deux lectures ---------- */

type OwnedHolding = Holding & { ownerUserId: number };

/** Ce que portent, à l'instant, les portefeuilles lus sans intermédiaire (adresses, exchanges), tous membres confondus. */
export async function directHoldings(): Promise<OwnedHolding[]> {
  return q<OwnedHolding>(
    `SELECT c.owner_user_id AS ownerUserId, c.portfolio_id AS portfolioId, c.symbol, SUM(c.quantity) AS quantity, MAX(COALESCE(pg.price_eur, ps.price_eur)) AS priceEur
     FROM crypto_positions c
     LEFT JOIN prices pg ON pg.id = CONCAT('cg:', c.coingecko_id)
     LEFT JOIN prices ps ON ps.id = CONCAT('cs:', c.coinstats_id)
     WHERE c.source IN ('onchain', 'exchange') AND c.archived_at IS NULL AND c.portfolio_id IS NOT NULL
     GROUP BY c.owner_user_id, c.portfolio_id, c.symbol`,
  );
}

/**
 * Après une synchronisation : compare ce que portaient les portefeuilles avant (`before`) à ce qu'ils portent
 * maintenant, et garde une proposition par mouvement reconnu. `read` : pour chaque portefeuille relu avec succès et
 * déjà lu auparavant, le jour de sa lecture d'avant. Rend le nombre de propositions gardées.
 */
export async function proposeFromSync(runId: number, before: OwnedHolding[], read: Map<string, string | null>): Promise<number> {
  if (!read.size) return 0;
  const after = await directHoldings();
  const factor = await priceFactor().catch(() => null);
  const day = today();
  let kept = 0;
  for (const owner of new Set([...before, ...after].map((h) => h.ownerUserId))) {
    const mine = (rows: OwnedHolding[]) => rows.filter((h) => h.ownerUserId === owner).map((h) => ({ ...h, quantity: Number(h.quantity), priceEur: h.priceEur == null ? null : Number(h.priceEur) }));
    for (const m of detectMoves(mine(before), mine(after), new Set(read.keys()))) {
      const ref = `sync:${runId}:${m.portfolioId}:${m.asset}:${m.kind}${m.direction ?? ""}`.slice(0, 191);
      const r = await exec(
        `INSERT IGNORE INTO crypto_proposals (owner_user_id, ref, origin, date, since, type, asset, quantity, value, portfolio_id, from_portfolio_id, direction)
         VALUES (?, ?, 'synchro', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [owner, ref, day, read.get(m.portfolioId)?.slice(0, 10) ?? null, m.kind, m.asset.slice(0, 120), m.quantity, m.valueEur != null && factor != null ? round2(m.valueEur * factor) : null, m.portfolioId, m.fromPortfolioId, m.direction],
      );
      kept += r.affectedRows;
    }
  }
  return kept;
}
