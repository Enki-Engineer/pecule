import { nameFromBankLabels } from "./bank-labels.ts";
import { exec } from "./db.ts";
import { refreshDebitNames } from "./debits.ts";
import { syncEnableBanking, type EbSyncResult } from "./enable-banking.ts";
import { fintaEnabled, markCardDuplicates, syncFromFinta } from "./finta.ts";
import { matchInvoices } from "./invoices.ts";

/*
 * Synchronisation bancaire, toutes sources confondues : Finta s'il est configuré, Enable Banking s'il a des
 * accords, puis ce qui suit toute arrivée d'opérations (doublons de cartes, noms des prélèvements, factures).
 * Aucune source n'est obligatoire : sans aucune, il n'y a simplement rien à lire.
 */

export type BankSyncResult = { runId: number | null; seen: number; inserted: number; auto: number };

/** Après toute arrivée d'opérations, quelle qu'en soit la source. */
export async function afterBankSync(): Promise<void> {
  await markCardDuplicates();
  // Prélèvements SEPA : noms et catégories d'après les engagements du Budget.
  await refreshDebitNames().catch((e) => console.error("[prélèvements] noms", e));
  // Puis les noms appris des libellés de la banque (salaire, énergie, loyer… de même forme).
  await nameFromBankLabels().catch((e) => console.error("[libellés de la banque] noms", e));
  // Les nouvelles opérations peuvent enfin correspondre à des factures déjà reçues.
  await matchInvoices();
}

/** Lecture d'Enable Banking, notée dans le journal des synchronisations comme les autres. */
async function runEnableBanking(source: string, force: boolean): Promise<EbSyncResult | null> {
  const result = await syncEnableBanking({ force });
  if (!result) return null;
  await exec("INSERT INTO sync_runs (source, status, finished_at, tx_seen, tx_new, error) VALUES (?, ?, UTC_TIMESTAMP(), ?, ?, ?)", [
    `eb:${source}`.slice(0, 16),
    result.errors.length ? "error" : "ok",
    result.seen,
    result.inserted + result.attached,
    result.errors.length ? result.errors.join(" ; ").slice(0, 2000) : null,
  ]);
  return result;
}

/**
 * Lit toutes les sources bancaires. `source` : auto (planificateur), cron, manuel, assistant. Une lecture à la
 * demande d'un membre force Enable Banking (sinon limité à une lecture toutes les 6 heures).
 * Renvoie null si une synchronisation est déjà en cours et que rien n'a pu être lu.
 */
export async function syncBanks(source: string): Promise<BankSyncResult | null> {
  const finta = fintaEnabled() ? await syncFromFinta(source) : null;
  const eb = await runEnableBanking(source, source === "manuel" || source === "assistant").catch((e) => {
    console.error("[Enable Banking] échec", e);
    return null;
  });
  if (!finta && !eb) return fintaEnabled() ? null : { runId: null, seen: 0, inserted: 0, auto: 0 };
  await afterBankSync();
  return { runId: finta?.runId ?? null, seen: (finta?.seen ?? 0) + (eb?.seen ?? 0), inserted: (finta?.inserted ?? 0) + (eb ? eb.inserted + eb.attached : 0), auto: finta?.auto ?? 0 };
}

/** Lecture d'Enable Banking seule, tout de suite (bouton « Lire maintenant », retour d'un accord). */
export async function readEnableBankingNow(source = "manuel"): Promise<EbSyncResult | null> {
  const result = await runEnableBanking(source, true);
  if (result) await afterBankSync();
  return result;
}
