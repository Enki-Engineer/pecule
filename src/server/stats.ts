/*
 * Définitions uniques des agrégats : tous les totaux (accueil, mois, tendance, assistant)
 * s'appuient sur ces fragments SQL, pour qu'un même chiffre ait partout la même valeur.
 * Alias attendus : t = tx_lines, a = comptes visibles, c = categories (LEFT JOIN).
 */

/**
 * Jour d'une opération lue directement dans `transactions` (liste, marchands) : le même que celui de la vue
 * `tx_lines`, c'est-à-dire le jour d'achat si le foyer compte ses achats au jour de l'achat (src/server/stat-dates.ts),
 * sinon le jour d'écriture de la banque. À joindre par `STAT_DATE_JOIN`.
 */
export const STAT_DATE_JOIN = "LEFT JOIN app_kv sdb ON sdb.`key` = 'stats:date_basis'";
export const statDate = (alias = "t") => `IF(sdb.value = 'achat', COALESCE(${alias}.purchase_date, ${alias}.date), ${alias}.date)`;

/** Opérations comptées : réglées ou en attente, sur un compte non exclu. */
export const STAT_SCOPE = "t.status IN ('posted', 'pending') AND a.excluded = 0";

/*
 * Un virement entre deux comptes du foyer (catégorie « interne ») ne compte ni en revenu ni en dépense tant que ses
 * deux comptes sont comptés dans la vue regardée. Si le compte d'en face ne l'est pas — le compte personnel d'un autre
 * membre sorti des statistiques, ou le compte commun dans le périmètre « Moi » —, l'argent entre dans la vue ou en
 * sort : c'est un apport (revenu) ou un versement (dépense). La règle et ses noms : src/lib/transfers.ts ; le compte
 * d'en face : table `transfer_peers` (src/server/transfers.ts).
 *
 * `accountsSql` : les comptes tels que les voit le membre (`userAccountsSql`), ceux-là mêmes que la requête joint sous
 * l'alias `a` — c'est d'eux que dépend ce qu'une ligne vaut.
 */

/** Vrai pour un mouvement interne dont le pendant est sur un compte que la vue ne compte pas. */
export const crossesView = (accountsSql: string) =>
  `(c.kind = 'interne' AND EXISTS (SELECT 1 FROM transfer_peers tp WHERE tp.transaction_id = t.id
     AND NOT EXISTS (SELECT 1 FROM ${accountsSql} pa WHERE pa.id = tp.peer_account_id AND pa.excluded = 0)))`;

/**
 * Nature d'une ligne : celle de sa catégorie ; sans catégorie, un débit est une dépense et un crédit un revenu ; un
 * virement qui franchit la vue est un revenu s'il entre, une dépense s'il sort. À nommer (`AS kind`) pour grouper.
 */
export const lineKind = (accountsSql: string) =>
  `(CASE WHEN ${crossesView(accountsSql)} THEN IF(t.amount < 0, 'depense', 'revenu') ELSE COALESCE(c.kind, IF(t.amount < 0, 'depense', 'revenu')) END)`;

/** Ligne comptée en dépense (montant net : un remboursement classé en dépense vient en déduction). */
export const isExpense = (accountsSql: string) => `${lineKind(accountsSql)} = 'depense'`;

/** Mouvement interne resté neutre : ses deux bouts sont dans la vue, ou son pendant n'a pas été retrouvé. */
export const isNeutral = (accountsSql: string) => `(c.kind = 'interne' AND NOT ${crossesView(accountsSql)})`;

/** Nature d'une ligne d'après sa seule catégorie, virements non requalifiés : pour ce qui cherche un achat, pas un total. */
export const CATEGORY_KIND = "COALESCE(c.kind, IF(t.amount < 0, 'depense', 'revenu'))";

/**
 * Titulaire du compte d'en face quand la ligne franchit la vue, NULL sinon : c'est lui que nomme « Apports de … » ou
 * « Versements à … » (`nameTransfers`, src/lib/transfers.ts). À sélectionner `AS peer` et à grouper avec la catégorie.
 */
export const peerOwner = (accountsSql: string) =>
  `(CASE WHEN ${crossesView(accountsSql)} THEN (SELECT po.owner FROM transfer_peers tq JOIN accounts po ON po.id = tq.peer_account_id WHERE tq.transaction_id = t.id) END)`;

/** Identifiant de la ligne « Apports de … » ou « Versements à … » d'un virement qui franchit la vue (celui de `transferId`, src/lib/transfers.ts), NULL sinon : une clé de regroupement. */
export const transferKey = (accountsSql: string) => `(CASE WHEN ${crossesView(accountsSql)} THEN CONCAT('virement:', IF(t.amount < 0, 'verse', 'recu'), ':', ${peerOwner(accountsSql)}) END)`;
