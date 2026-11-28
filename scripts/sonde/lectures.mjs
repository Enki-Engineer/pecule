// Les lectures qu'appelle la sonde (scripts/sonde-lectures.mjs) : chaque route de lecture sans identifiant, avec les
// réglages qui changent sa requête — période, base de comparaison, filtres. Un test compare cette liste aux routes
// déclarées (src/lib/sonde-lectures.test.ts) : une route de lecture ajoutée s'inscrit ici, ou dans HORS_SONDE avec
// sa raison.

/** Routes de lecture laissées hors de la sonde, et pourquoi. */
export const HORS_SONDE = {
  "/backup": "fabrique et envoie une sauvegarde complète",
};

/** Routes appelées telles quelles. */
const SIMPLES = `/accounts /agenda /ai/config /alerts /assistant/memories /assistant/status /assistant/threads /assistant/usage /audit /auth/access /auth/me /auth/users
/backup/info /backup/remote /balance-alert /balance-series /bank-logos /bank/cards /bank/enable-banking /bank/enable-banking/banks
/bank/enable-banking/compare /birthdays /brands /budget /calendar-link /categories /categories/proposals /connections /connections/admin-tokens /crypto /crypto/events
/dashboard /dashboard/layout /documents /documents/topics /envelopes /fun /goals /household /household/date-basis /imports /invoices /loans
/nav-counts /oauth/grants /payslips /payslips/reread /projections /properties /push/key /push/recent /retirement /rules /sharing /status /summary
/sync/connections /sync/runs /taxes /tokens /transactions /transactions/months /trend /updates /voice/status /wealth /weekly-summary`
  .split(/\s+/)
  .filter(Boolean);

const NATURES = ["carte", "prelevement", "virement", "retrait", "frais", "interne", "remboursement", "entree"];
const BASES = ["prev", "year", "avg3", "avg6", "avg12"];

/**
 * Les appels de la sonde pour un jour donné (AAAA-MM-JJ) : des chemins sous /api, réglages compris. Les périodes
 * suivent ce jour (le mois, l'année, le mois d'avant) : la sonde ne vieillit pas.
 */
export function lectures(jour) {
  const mois = jour.slice(0, 7);
  const an = jour.slice(0, 4);
  const [y, m] = mois.split("-").map(Number);
  const avant = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const fin = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const out = [...SIMPLES];
  for (const p of [mois, avant, an]) {
    out.push(`/months/${p}`, `/analysis/flows?period=${p}`, `/analysis/debits?period=${p}`, `/analysis/timeline?period=${p}`, `/analysis/merchants?period=${p}`, `/analysis/debit-series?period=${p}`);
    out.push(`/transactions?month=${p}`, `/transactions/months?month=${p}`, `/budget?month=${p}`, `/analysis/forecast?month=${p}`);
  }
  for (const base of BASES) out.push(`/analysis/compare?from=${mois}-01&to=${fin}&base=${base}`, `/analysis/compare?from=${an}-01-01&to=${an}-12-31&base=${base}`);
  out.push(`/analysis/compare?from=${mois}-01&to=${fin}&base=custom&bfrom=${avant}-01&bto=${avant}-28`, "/analysis/forecast", "/analysis/debit-series", `/analysis/natures?from=${an}-01&to=${mois}`, "/analysis/natures", `/trend?from=${an}-01&to=${mois}`);
  for (const nature of NATURES) out.push(`/transactions?nature=${nature}&month=${mois}`, `/transactions/months?nature=${nature}`);
  out.push("/transactions?q=ab", "/transactions?uncategorized=1", `/transactions?debits=1&month=${mois}`, `/transactions?credits=1&month=${an}`, "/transactions?merchant=ab", "/transactions?poste=ab", "/transactions?category=ab", "/transactions?account=ab", "/transactions?limit=5&offset=5");
  out.push("/transactions/months?q=ab", "/transactions/months?uncategorized=1", "/search?q=ab", "/brands/match?pattern=ab", "/balance-series?days=30", `/assistant/usage?mois=${mois}`, "/assistant/threads?q=ab&limit=5", "/audit?limit=20");
  out.push("/documents?q=ab", "/documents?kind=contrat&domain=banque", "/documents?topic=energie&limit=5&offset=5", "/invoices?q=ab", "/invoices?filtre=a_rapprocher", `/agenda?from=${an}-01-01&to=${an}-12-31&done=1`, "/agenda?faits=30", "/check/monthly", `/check/monthly?month=${avant}`);
  return out;
}

/** Chemin d'un appel, sans ses réglages. */
export const cheminDe = (appel) => appel.split("?")[0];
