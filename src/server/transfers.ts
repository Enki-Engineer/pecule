import { exec, one, q } from "./db.ts";
import { isDemo } from "./demo-context.ts";
import { pairTransfers } from "../lib/transfers.ts";

/*
 * La table `transfer_peers` : pour chaque mouvement interne dont on retrouve le pendant, le compte de l'autre bout.
 * C'est elle que lisent les statistiques pour savoir si un virement reste dans la vue du membre ou la franchit
 * (`crossesView`, src/server/stats.ts ; la règle est décrite dans src/lib/transfers.ts).
 *
 * Elle se déduit des opérations et n'est jamais saisie : Pécule la recalcule dès que ce qui la fonde a changé — une
 * opération arrivée, reclassée, supprimée, ventilée, une catégorie qui devient « interne ». Plutôt que d'accrocher ce
 * calcul à chacun des chemins qui écrivent une opération (synchronisation, import, règle, assistant, annulation…),
 * une empreinte des mouvements internes est comparée à celle du dernier calcul avant toute lecture des statistiques :
 * une requête légère, et la table est toujours juste.
 */

const KEY = "transferts:empreinte";

/** Les lignes rapprochées : classées dans une catégorie « interne », en cours ou réglées, non ventilées. */
const INTERNAL = `FROM transactions t JOIN categories c ON c.id = t.category_id
  WHERE c.kind = 'interne' AND t.status IN ('posted', 'pending')
    AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)`;

const fingerprint = async () =>
  (await one<{ f: string }>(`SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT_WS('|', t.id, t.account_id, t.date, t.amount))), 0)) AS f ${INTERNAL}`))?.f ?? "0:0";

const chunks = <T>(list: T[], size = 400): T[][] => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Recalcule la table depuis les opérations ; n'écrit que ce qui a changé. Rend le nombre de lignes rapprochées. */
export async function refreshTransferPeers(): Promise<number> {
  const lines = await q<{ id: string; accountId: string; date: string; amount: number }>(
    `SELECT t.id, t.account_id AS accountId, DATE_FORMAT(t.date, '%Y-%m-%d') AS date, t.amount ${INTERNAL}`,
  );
  const peers = pairTransfers(lines.map((l) => ({ ...l, amount: Number(l.amount) })));
  const current = new Map((await q<{ id: string; peer: string }>("SELECT transaction_id AS id, peer_account_id AS peer FROM transfer_peers")).map((r) => [r.id, r.peer]));
  const stale = [...current.keys()].filter((id) => !peers.has(id));
  const changed = [...peers].filter(([id, peer]) => current.get(id) !== peer);
  for (const ids of chunks(stale)) await exec(`DELETE FROM transfer_peers WHERE transaction_id IN (${ids.map(() => "?").join(", ")})`, ids);
  for (const rows of chunks(changed))
    await exec(
      `INSERT INTO transfer_peers (transaction_id, peer_account_id) VALUES ${rows.map(() => "(?, ?)").join(", ")}
       ON DUPLICATE KEY UPDATE peer_account_id = VALUES(peer_account_id)`,
      rows.flat(),
    );
  return peers.size;
}

async function refreshIfChanged() {
  // L'empreinte est lue avant les lignes : si une opération change pendant le calcul, la prochaine lecture le verra.
  const [now, kept] = await Promise.all([fingerprint(), one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [KEY])]);
  if (kept?.value === now) return;
  await refreshTransferPeers();
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [KEY, now]);
}

/** Un calcul à la fois par base (la vraie, celle de la démo) : les lectures arrivées pendant ce temps attendent le même. */
const running = new Map<string, Promise<void>>();

/**
 * À appeler avant de lire des statistiques : met la table à jour si les mouvements internes ont changé depuis le
 * dernier calcul. Une panne ici ne ferme pas l'appli : les virements restent comptés comme au dernier calcul.
 */
export function ensureTransferPeers(): Promise<void> {
  const base = isDemo() ? "demo" : "reelle";
  let pending = running.get(base);
  if (!pending) {
    pending = refreshIfChanged()
      .catch((e) => console.error("[virements] rapprochement des mouvements internes", e))
      .finally(() => running.delete(base));
    running.set(base, pending);
  }
  return pending;
}
