import { isDemo } from "./demo-context.ts";
import { env } from "./env.ts";
import { exec, one, q, withLock } from "./db.ts";
import { classifyAccount, labelKey } from "../lib/labels.ts";
import { accountHousehold } from "./household.ts";
import { ebAdoptedAccounts } from "./enable-banking.ts";
import { guessCategory } from "./guess.ts";
import { fxConverter } from "./fx.ts";
import { householdCurrency, today } from "./region.ts";
import { cleanCurrency } from "../lib/currencies.ts";
import { recordAlert } from "./journal.ts";

export { guessCategory };

const BASE = "https://api.finta.io/v2";

/** Finta n'est lu que si sa clé est donnée (variable FINTA_API_KEY). */
export const fintaEnabled = () => !!env.FINTA_API_KEY;

type FintaAccount = {
  id: string;
  providerAccountId: string | null;
  bankConnectionId: string | null;
  bankConnectionStatus: string | null;
  institutionName: string | null;
  name: string;
  currency: string | null;
  currentBalance: number | null;
  availableBalance: number | null;
  balanceAsOf: string | null;
  status: string;
};

type FintaTransaction = {
  id: string;
  bankAccountId: string;
  providerId: string | null;
  status: "posted" | "pending" | "deleted";
  summary: string | null;
  originalDescription: string | null;
  merchantName: string | null;
  amount: number;
  postedDate: string | null;
  authorizedDate: string | null;
};

type FintaBalance = { bankAccountId: string; date: string; balance: number };

async function finta<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.FINTA_API_KEY}` } });
    if (res.status === 429) {
      const wait = Math.min(120, Number(res.headers.get("retry-after") ?? 30));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Finta ${path} → HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return (await res.json()) as T;
  }
  throw new Error(`Finta ${path} : limite de requêtes atteinte`);
}

async function paginate<T>(path: string, key: string, params: Record<string, string | number | undefined>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await finta<Record<string, unknown> & { pageInfo?: { nextCursor?: string | null; hasMore?: boolean } }>(path, {
      ...params,
      limit: 250,
      cursor,
    });
    out.push(...((page[key] as T[]) ?? []));
    cursor = page.pageInfo?.hasMore ? (page.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

async function upsertAccounts(): Promise<Map<string, string>> {
  const { accounts } = await finta<{ accounts: FintaAccount[] }>("/accounts", { status: "all" });
  const map = new Map<string, string>(); // finta id → id Pécule (providerAccountId)
  const latest = new Map<string, FintaAccount>();
  for (const a of accounts) {
    const id = a.providerAccountId ?? a.id;
    map.set(a.id, id);
    const prev = latest.get(id);
    if (!prev || (a.balanceAsOf ?? "") > (prev.balanceAsOf ?? "")) latest.set(id, a);
    await exec(
      `INSERT INTO account_sources (finta_account_id, account_id, connection_id, connection_status) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE account_id = VALUES(account_id), connection_id = VALUES(connection_id), connection_status = VALUES(connection_status)`,
      [a.id, id, a.bankConnectionId, a.bankConnectionStatus],
    );
  }
  // Titulaire d'un nouveau compte : déduit de son intitulé d'après les personnes du foyer (jamais recalculé ensuite).
  const household = await accountHousehold();
  // Un compte alimenté en direct par la banque (Enable Banking) n'est plus écrit par cette source.
  const direct = await ebAdoptedAccounts();
  // Solde d'un compte en devise : gardé tel quel, et ramené à la devise du foyer au cours du jour.
  // Une devise absente, mal écrite ou que Pécule ne sait pas convertir est prise pour celle du foyer (montants écrits tels quels).
  const home = householdCurrency();
  const convert = await fxConverter([...latest.values()].map((a) => cleanCurrency(a.currency, home)), today());
  for (const [id, a] of latest) {
    if (direct.has(id)) continue;
    const { owner, kind } = classifyAccount(a.name, a.institutionName, household);
    const stated = a.currentBalance ?? a.availableBalance;
    const held = stated == null ? null : convert(stated, cleanCurrency(a.currency, home), today());
    const pro = owner === "pro" ? 1 : 0;
    await exec(
      `INSERT INTO accounts (id, name, institution, owner, kind, currency, balance, balance_original, balance_at, hidden, excluded, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finta')
       ON DUPLICATE KEY UPDATE
         -- Un compte repris de Notion (masqué) et toujours connu de Finta redevient visible.
         hidden = IF(source = 'notion', VALUES(hidden), hidden), excluded = IF(source = 'notion', VALUES(excluded), excluded),
         name = VALUES(name), institution = VALUES(institution), currency = VALUES(currency),
         balance_original = IF(VALUES(balance) IS NULL, balance_original, VALUES(balance_original)),
         balance = COALESCE(VALUES(balance), balance), balance_at = COALESCE(VALUES(balance_at), balance_at), source = 'finta'`,
      [id, a.name, a.institutionName, owner, kind, cleanCurrency(a.currency, home), held?.amount ?? null, held?.originalAmount ?? null, a.balanceAsOf ? a.balanceAsOf.slice(0, 19).replace("T", " ") : null, pro, pro],
    );
  }
  return map;
}

/**
 * Doublons de cartes : BoursoBank recopie certains achats d'une carte sur le compte
 * courant ET sur le compte de la carte (débit immédiat), ou sur deux cartes après un
 * renouvellement. Même empreinte GoCardless (partie après l'identifiant du compte),
 * même date, même montant, l'un des deux sur un compte carte → la copie côté carte
 * passe en « duplicate » (exclue des listes et des totaux). Relancé après chaque synchro.
 */
export async function markCardDuplicates(): Promise<number> {
  await exec("UPDATE transactions SET status = 'posted' WHERE status = 'duplicate'");
  const res = await exec(
    `UPDATE transactions t
     JOIN accounts a ON a.id = t.account_id
     JOIN transactions o ON o.id <> t.id AND o.date = t.date AND o.amount = t.amount
       AND CHAR_LENGTH(t.id) > 37 AND SUBSTRING(o.id, 38) = SUBSTRING(t.id, 38)
     JOIN accounts oa ON oa.id = o.account_id
     SET t.status = 'duplicate'
     WHERE a.kind = 'carte' AND t.status IN ('posted', 'pending') AND o.status IN ('posted', 'pending')
       -- Une opération confirmée par la lecture directe de la banque n'est pas un doublon.
       AND t.bank_ref IS NULL
       AND (oa.kind <> 'carte' OR o.id < t.id)`,
  );
  return res.affectedRows;
}

export type SyncResult = { runId: number; seen: number; inserted: number; auto: number };

/** Synchronise comptes, soldes et opérations depuis Finta (fenêtre glissante). Appelée par syncBanks. */
export async function syncFromFinta(source: string): Promise<SyncResult | null> {
  // Jamais de vraies opérations dans la base de démo.
  if (isDemo()) throw new Error("Synchronisation indisponible en mode démo");
  if (!fintaEnabled()) return null;
  return withLock("pecule:sync", async () => {
    const lastOk = await one<{ n: number }>("SELECT COUNT(*) AS n FROM sync_runs WHERE status = 'ok'");
    const since = new Date(Date.now() - 45 * 86400_000);
    const windowStart = lastOk?.n ? isoDay(since) : "2026-01-01";
    const run = await exec("INSERT INTO sync_runs (source, window_start) VALUES (?, ?)", [source, windowStart]);
    const runId = run.insertId;
    let seen = 0;
    let inserted = 0;
    let auto = 0;
    try {
      const accountMap = await upsertAccounts();
      const direct = await ebAdoptedAccounts();
      // Montants d'un compte en devise : ramenés à la devise du foyer au cours de leur jour, l'original gardé.
      const home = householdCurrency();
      const currencies = new Map((await q<{ id: string; currency: string }>("SELECT id, currency FROM accounts")).map((a) => [a.id, cleanCurrency(a.currency, home)]));
      const convert = await fxConverter([...new Set(currencies.values())], windowStart);

      const txs = await paginate<FintaTransaction>("/transactions", "transactions", { startDate: windowStart, status: "all" });
      // mysql2 renvoie affectedRows = 1 aussi pour une ligne inchangée : on repère les nouvelles à l'avance.
      const known = new Set(
        (await q<{ id: string }>("SELECT id FROM transactions WHERE date >= DATE_SUB(?, INTERVAL 10 DAY)", [windowStart])).map((r) => r.id),
      );
      for (const t of txs) {
        const accountId = accountMap.get(t.bankAccountId);
        const date = t.postedDate ?? t.authorizedDate;
        if (!accountId || !date || direct.has(accountId)) continue;
        seen++;
        const id = t.providerId ?? `finta:${t.id}`;
        const label = (t.summary ?? t.originalDescription ?? "").slice(0, 512) || "(sans libellé)";
        const key = labelKey(label, t.merchantName);
        const money = convert(t.amount, currencies.get(accountId) ?? home, date);
        await exec(
          `INSERT INTO transactions (id, finta_id, account_id, date, amount, original_amount, original_currency, label, merchant, label_key, status, origin)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finta')
           ON DUPLICATE KEY UPDATE finta_id = COALESCE(finta_id, VALUES(finta_id)), date = VALUES(date),
             -- Compte en devise : la conversion déjà gardée reste tant que le montant d'origine n'a pas changé (elle ne suit pas le cours du jour).
             amount = IF(VALUES(original_currency) IS NOT NULL AND original_amount <=> VALUES(original_amount) AND original_currency <=> VALUES(original_currency), amount, VALUES(amount)),
             original_amount = VALUES(original_amount), original_currency = VALUES(original_currency),
             label = VALUES(label), merchant = COALESCE(VALUES(merchant), merchant), status = VALUES(status),
             -- Une opération nommée depuis (engagement, libellé de la banque) garde la clé de ce nom.
             label_key = IF(VALUES(merchant) IS NULL AND merchant IS NOT NULL, label_key, VALUES(label_key))`,
          [id, t.id, accountId, date, money.amount, money.originalAmount, money.originalCurrency, label, t.merchantName, key, t.status],
        );
        if (!known.has(id)) {
          known.add(id); // même providerId vu par deux connexions : une seule insertion
          inserted++;
          const guess = await guessCategory(key);
          if (guess) {
            await exec("UPDATE transactions SET category_id = ?, category_source = ? WHERE id = ? AND category_id IS NULL", [
              guess.categoryId,
              guess.source,
              id,
            ]);
            auto++;
          }
        }
      }

      const balances = await paginate<FintaBalance>("/accounts/balance-history", "balanceHistory", { startDate: windowStart });
      for (const b of balances) {
        const accountId = accountMap.get(b.bankAccountId);
        if (!accountId || direct.has(accountId)) continue;
        await exec("INSERT INTO balances (account_id, date, balance) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE balance = VALUES(balance)", [
          accountId,
          b.date,
          convert(b.balance, currencies.get(accountId) ?? home, b.date).amount,
        ]);
      }

      // Ce qui suit toute arrivée d'opérations (doublons, noms, factures) est fait par syncBanks, pour toutes les sources.
      await exec(
        "UPDATE sync_runs SET status = 'ok', finished_at = UTC_TIMESTAMP(), tx_seen = ?, tx_new = ?, tx_auto = ? WHERE id = ?",
        [seen, inserted, auto, runId],
      );
      return { runId, seen, inserted, auto };
    } catch (e) {
      await exec("UPDATE sync_runs SET status = 'error', finished_at = UTC_TIMESTAMP(), error = ? WHERE id = ?", [String(e).slice(0, 2000), runId]);
      await recordAlert("synchro", `Synchronisation Finta en échec : ${e instanceof Error ? e.message : String(e)}`, e);
      throw e;
    }
  });
}

/** Connexions bancaires Finta (état, reconnexion nécessaire). */
export async function fintaConnections() {
  if (!fintaEnabled()) return { bankConnections: [] };
  return finta<{ bankConnections?: unknown[] }>("/bank-connections", { status: "all" });
}

export async function lastSyncRuns(limit = 10) {
  return q("SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?", [limit]);
}
