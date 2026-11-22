/*
 * Virements entre deux comptes du foyer, et ce qu'ils valent dans la vue d'un membre.
 *
 * Un mouvement classé « interne » ne compte ni en revenu ni en dépense : l'argent passe d'un compte à l'autre. C'est
 * vrai tant que les deux comptes sont comptés dans la vue regardée. Si l'un des deux ne l'est pas — le compte
 * personnel d'un autre membre sorti des statistiques, ou le compte commun quand on regarde « Moi » —, l'argent entre
 * dans la vue ou en sort : c'est un apport (compté en revenu) ou un versement (compté en dépense). Sans cela, les
 * dépenses payées avec cet argent n'auraient aucun revenu en face.
 *
 * Ici : retrouver les deux bouts d'un virement, et nommer ce qu'il devient. Le reste est dans src/server/stats.ts
 * (la définition commune) et src/server/transfers.ts (la table `transfer_peers`).
 */

import { OWNER_LABELS, ownerLabel } from "./labels.ts";
import { tk, translate } from "./i18n.ts";

export type TransferLine = { id: string; accountId: string; /** Jour d'écriture de la banque, AAAA-MM-JJ. */ date: string; amount: number };

/** Écart toléré entre les deux écritures d'un même virement (un week-end, un jour férié, un virement différé). */
export const TRANSFER_MAX_DAYS = 5;

const dayNumber = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);

/**
 * Rapproche les deux bouts des virements : un crédit et un débit du même montant, sur deux comptes différents, à
 * `maxDays` jours d'écart au plus. Chaque ligne n'a qu'un pendant ; entre plusieurs candidats, le plus proche dans le
 * temps l'emporte, puis l'ordre des identifiants (le résultat ne dépend pas de l'ordre de lecture). Rend, pour chaque
 * ligne rapprochée, le compte de l'autre bout. Une ligne sans pendant n'y figure pas : elle reste neutre.
 */
export function pairTransfers(lines: readonly TransferLine[], maxDays = TRANSFER_MAX_DAYS): Map<string, string> {
  const byAmount = new Map<number, { credits: TransferLine[]; debits: TransferLine[] }>();
  for (const l of lines) {
    const cents = Math.round(Math.abs(Number(l.amount)) * 100);
    if (!cents) continue;
    const g = byAmount.get(cents) ?? { credits: [], debits: [] };
    (Number(l.amount) > 0 ? g.credits : g.debits).push(l);
    byAmount.set(cents, g);
  }
  const peers = new Map<string, string>();
  for (const { credits, debits } of byAmount.values()) {
    if (!credits.length || !debits.length) continue;
    const candidates: { credit: TransferLine; debit: TransferLine; gap: number }[] = [];
    for (const credit of credits)
      for (const debit of debits) {
        if (credit.accountId === debit.accountId) continue;
        const gap = Math.abs(dayNumber(credit.date) - dayNumber(debit.date));
        if (gap <= maxDays) candidates.push({ credit, debit, gap });
      }
    candidates.sort((a, b) => a.gap - b.gap || a.credit.date.localeCompare(b.credit.date) || a.credit.id.localeCompare(b.credit.id) || a.debit.id.localeCompare(b.debit.id));
    for (const { credit, debit } of candidates) {
      if (peers.has(credit.id) || peers.has(debit.id)) continue;
      peers.set(credit.id, debit.accountId);
      peers.set(debit.id, credit.accountId);
    }
  }
  return peers;
}

/* ---------- Ce que devient un virement qui franchit la vue ---------- */

/** Sens d'un virement qui franchit la vue : reçu d'un compte qui n'y est pas compté, ou versé vers lui. */
export type TransferWay = "recu" | "verse";

const PREFIX = "virement";

/** Identifiant de la ligne « Apports de … » ou « Versements à … » d'une répartition : il sert aussi de filtre à la liste des opérations. */
export const transferId = (way: TransferWay, owner: string) => `${PREFIX}:${way}:${owner}`;

/** Lit un identifiant écrit par `transferId` ; null pour une vraie catégorie. */
export function parseTransferId(id: string | null | undefined): { way: TransferWay; owner: string } | null {
  const [prefix, way, ...rest] = (id ?? "").split(":");
  const owner = rest.join(":");
  return prefix === PREFIX && (way === "recu" || way === "verse") && owner ? { way, owner } : null;
}

export const isTransferId = (id: string | null | undefined): boolean => parseTransferId(id) !== null;

type Translate = (text: string, vars?: Record<string, string | number>) => string;

/** Le français, quelle que soit la langue du membre : ce que lit l'assistant reste en français. */
export const inFrench: Translate = (text, vars) => translate("fr", text, vars);

/**
 * Nom affiché d'un apport ou d'un versement, d'après le titulaire du compte d'en face : une personne du foyer, le
 * compte commun, ou un compte rangé à part (professionnel, autre). `tr` : `t` à l'écran, le français pour l'assistant.
 */
export function transferName(way: TransferWay, owner: string, tr: Translate): string {
  if (owner === "joint") return way === "recu" ? tr(tk("Apports du compte commun")) : tr(tk("Versements au compte commun"));
  if (owner in OWNER_LABELS) return way === "recu" ? tr(tk("Apports d'un compte hors statistiques")) : tr(tk("Versements vers un compte hors statistiques"));
  return way === "recu" ? tr(tk("Apports de {nom}"), { nom: ownerLabel(owner) }) : tr(tk("Versements à {nom}"), { nom: ownerLabel(owner) });
}

/** Nom d'un filtre écrit par `transferId` (« Apports de … », « Versements à … ») ; null pour une vraie catégorie. */
export function transferLabel(id: string | null | undefined, tr: Translate): string | null {
  const transfer = parseTransferId(id);
  return transfer ? transferName(transfer.way, transfer.owner, tr) : null;
}

/** Sens d'une ligne qui franchit la vue, d'après ce qu'elle vaut dans les statistiques. */
export const transferWay = (kind: string | null | undefined): TransferWay => (kind === "revenu" ? "recu" : "verse");

/**
 * Ligne d'une répartition par catégorie. `peer` : titulaire du compte d'en face quand la ligne est un virement qui
 * franchit la vue (`peerOwner`, src/server/stats.ts), null sinon.
 */
export type CategoryRow = { id: string | null; name: string | null; poste: string | null; kind: string | null; peer?: string | null };

/**
 * Donne aux virements qui franchissent la vue leur propre ligne : « Apports de … » parmi les revenus, « Versements
 * à … » parmi les dépenses (où elle fait son propre poste), au lieu de la catégorie « mouvement interne » qu'ils
 * portent en base. Les autres lignes sont rendues telles quelles, sans `peer`.
 */
export function nameTransfers<T extends CategoryRow>(rows: readonly T[], tr: Translate): Omit<T, "peer">[] {
  return rows.map(({ peer, ...row }) => {
    if (!peer) return row;
    const way = transferWay(row.kind);
    const name = transferName(way, peer, tr);
    return { ...row, id: transferId(way, peer), name, poste: way === "verse" ? name : null };
  });
}
