import { householdDay, region } from "./region.ts";
import { exec, one, q } from "./db.ts";
import { ebConsents } from "./enable-banking.ts";
import { ActionError } from "./actions.ts";
import { documentVisible } from "./documents.ts";
import { invoiceVisible } from "./invoices.ts";
import { calendarDates, nextOccurrence, type Recurrence } from "../lib/agenda.ts";
import { locale, t as tr, tn } from "../lib/i18n.ts";

/*
 * Échéancier : tâches et jalons saisis (agenda_items) + échéances calculées à la volée :
 * prochaine mensualité et fin de chaque crédit, fins de garantie, documents qui expirent,
 * engagements à renouveler, calendrier fiscal (dates indicatives). Rien de calculé n'est stocké.
 * Les libellés des échéances calculées sont écrits au moment du calcul, dans la langue de la requête
 * (ou du membre, pour les notifications et le calendrier iCal qui appellent agenda() dans sa langue).
 */

export type AgendaEntry = {
  key: string;
  date: string | null;
  title: string;
  /** tache (à cocher) | jalon (date à retenir) | echeance (calculée) */
  kind: "tache" | "jalon" | "echeance";
  domain: string;
  source: "saisie" | "pret" | "garantie" | "document" | "impots" | "contrat";
  id?: number;
  status?: string;
  recurrence?: string | null;
  amount?: number | null;
  notes?: string | null;
  /** Écran de Pécule où voir le détail. */
  link?: string;
  overdue?: boolean;
  /** Pour l'écran Échéancier (option `recentDone`) : ligne saisie visible de son seul auteur. */
  private?: boolean;
  /** Pour l'écran Échéancier : jour où la tâche a été cochée, et si c'est assez récent pour « Fait récemment ». */
  doneAt?: string | null;
  recent?: boolean;
};

const ITEM_COLS = "a.id, a.kind, a.title, a.notes, a.due_date, a.domain, a.entity_type, a.entity_id, a.amount, a.status, a.done_at, a.recurrence, a.owner_user_id";

/**
 * Échéancier d'un membre entre deux dates (tâches en retard et tâches sans date comprises).
 * `includeDone` : les lignes déjà faites dont la date tombe dans la période. `recentDone` (en jours, demandé par
 * l'écran Échéancier seulement) : en plus, les tâches cochées depuis moins de N jours, datées ou non, marquées
 * `recent` pour être rangées à part ; chaque ligne saisie porte alors ce qu'il faut à sa fiche (`private`, `doneAt`).
 */
export async function agenda(userId: number, from: string, to: string, opts: { includeDone?: boolean; recentDone?: number } = {}): Promise<AgendaEntry[]> {
  const today = householdDay();
  const out: AgendaEntry[] = [];
  const mine = `(a.owner_user_id IS NULL OR a.owner_user_id = ${Number(userId)})`;
  // `done_at` est gardé en temps universel : la limite se calcule de la même façon.
  const recentFrom = opts.recentDone ? new Date(Date.now() - opts.recentDone * 86_400_000).toISOString().slice(0, 19).replace("T", " ") : null;

  const items = await q<{
    id: number;
    kind: "tache" | "jalon";
    title: string;
    notes: string | null;
    due_date: string | null;
    domain: string;
    entity_type: string | null;
    entity_id: string | null;
    amount: number | null;
    status: string;
    done_at: string | null;
    recurrence: string | null;
    owner_user_id: number | null;
  }>(
    `SELECT ${ITEM_COLS} FROM agenda_items a WHERE ${mine} AND (
       (a.kind = 'tache' AND a.status = 'a_faire' AND (a.due_date IS NULL OR a.due_date <= ?))
       OR (a.due_date BETWEEN ? AND ? ${opts.includeDone ? "" : "AND a.status = 'a_faire'"})
       ${recentFrom ? "OR (a.kind = 'tache' AND a.status = 'fait' AND a.done_at >= ?)" : ""})
     ORDER BY a.due_date IS NULL, a.due_date, a.id`,
    recentFrom ? [to, from, to, recentFrom] : [to, from, to],
  );
  for (const i of items)
    out.push({
      key: `item:${i.id}`,
      id: i.id,
      date: i.due_date,
      title: i.title,
      kind: i.kind,
      domain: i.domain,
      source: "saisie",
      status: i.status,
      recurrence: i.recurrence,
      amount: i.amount == null ? null : Number(i.amount),
      notes: i.notes,
      link: entityLink(i.entity_type, i.entity_id),
      // Seule une tâche peut être en retard ; un jalon passé reste une date (affichée seulement dans la période).
      overdue: i.kind === "tache" && i.status === "a_faire" && !!i.due_date && i.due_date < today,
      ...(recentFrom
        ? {
            private: i.owner_user_id != null,
            // Jour du foyer où la tâche a été cochée.
            doneAt: i.status === "fait" && i.done_at ? householdDay(new Date(`${i.done_at.replace(" ", "T")}Z`)) : null,
            recent: i.kind === "tache" && i.status === "fait" && !!i.done_at && i.done_at >= recentFrom,
          }
        : {}),
    });

  // Crédits : prochaine mensualité et fin.
  const loans = await q<{ id: string; name: string; end_date: string; next_date: string | null; next_payment: number | null }>(
    `SELECT l.id, l.name, l.end_date,
            (SELECT s.date FROM loan_schedule s WHERE s.loan_id = l.id AND s.date >= ? AND s.payment > 0 ORDER BY s.date LIMIT 1) AS next_date,
            (SELECT s.payment FROM loan_schedule s WHERE s.loan_id = l.id AND s.date >= ? AND s.payment > 0 ORDER BY s.date LIMIT 1) AS next_payment
     FROM loans l WHERE (l.owner_user_id IS NULL OR l.owner_user_id = ?)`,
    [from, from, userId],
  );
  for (const l of loans) {
    if (l.next_date && l.next_date <= to)
      out.push({ key: `pret:${l.id}:${l.next_date}`, date: l.next_date, title: tr("Mensualité · {nom}", { nom: l.name }), kind: "echeance", domain: "immobilier", source: "pret", amount: l.next_payment == null ? null : -Number(l.next_payment), link: `/credits/${l.id}` });
    if (l.end_date >= from && l.end_date <= to)
      out.push({ key: `pret-fin:${l.id}`, date: l.end_date, title: tr("Fin du crédit · {nom}", { nom: l.name }), kind: "jalon", domain: "immobilier", source: "pret", link: `/credits/${l.id}` });
  }

  // Garanties qui se terminent.
  const warranties = await q<{ id: number; merchant: string; title: string; warranty_until: string }>(
    `SELECT i.id, i.merchant, i.title, i.warranty_until FROM invoices i WHERE ${invoiceVisible(userId)} AND i.warranty_until BETWEEN ? AND ? ORDER BY i.warranty_until`,
    [from, to],
  );
  for (const w of warranties)
    out.push({ key: `garantie:${w.id}`, date: w.warranty_until, title: tr("Fin de garantie · {titre}", { titre: w.title }), kind: "echeance", domain: "budget", source: "garantie", notes: w.merchant, link: `/factures?id=${w.id}` });

  // Documents qui expirent (et ceux expirés depuis moins de 3 mois).
  const docs = await q<{ id: number; title: string; expires_at: string; domain: string }>(
    `SELECT d.id, d.title, d.expires_at, d.domain FROM documents d WHERE ${documentVisible(userId)}
       AND d.expires_at BETWEEN DATE_SUB(?, INTERVAL 3 MONTH) AND ? ORDER BY d.expires_at`,
    [from, to],
  );
  for (const d of docs)
    out.push({ key: `document:${d.id}`, date: d.expires_at, title: tr("Échéance · {titre}", { titre: d.title }), kind: "echeance", domain: d.domain, source: "document", link: `/documents?id=${d.id}`, overdue: d.expires_at < today });

  // Engagements (contrats, assurances, abonnements) à renouveler ou à résilier.
  const commitments = await q<{ id: number; label: string; renewal_date: string; notice_days: number | null; monthly: number | null }>(
    `SELECT c.id, c.label, c.renewal_date, c.notice_days, c.monthly FROM commitments c
     WHERE (c.owner_user_id IS NULL OR c.owner_user_id = ?) AND c.status IN ('actif', 'a_verifier') AND c.renewal_date BETWEEN ? AND ?`,
    [userId, from, to],
  );
  for (const c of commitments)
    out.push({
      key: `contrat:${c.id}`,
      date: c.renewal_date,
      title: tr("Renouvellement · {nom}", { nom: c.label }),
      kind: "echeance",
      domain: "budget",
      source: "contrat",
      notes: c.notice_days ? tn("Préavis : {n} jour", "Préavis : {n} jours", c.notice_days) : null,
      link: "/budget",
    });

  // Accord de lecture des comptes donné à la banque (Enable Banking, 180 jours) : sans renouvellement, les comptes
  // ne sont plus lus. L'échéance est montrée à tout le foyer ; elle entre dans les rappels comme les autres.
  for (const c of await ebConsents().catch(() => [])) {
    const day = c.validUntil.slice(0, 10);
    if (day < from || day > to) continue;
    out.push({
      key: `banque:${c.id}`,
      date: day,
      title: tr("Accord bancaire à renouveler · {banque}", { banque: c.aspsp }),
      kind: "echeance",
      domain: "banque",
      source: "contrat",
      notes: tr("Réglages → Comptes et connexions → Enable Banking, « Renouveler »."),
      link: "/reglages/connexions?c=banque",
    });
  }

  // Calendrier fiscal (dates indicatives).
  for (const c of calendarDates(from, to, region().country))
    out.push({ key: `impots:${c.date}`, date: c.date, title: c.title, kind: "echeance", domain: "impots", source: "impots", notes: c.notes, link: "/impots" });

  return out.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.title.localeCompare(b.title, locale()));
}

function entityLink(type: string | null, id: string | null): string | undefined {
  if (!type || !id) return undefined;
  if (type === "property") return `/immobilier/${id}`;
  if (type === "loan") return `/credits/${id}`;
  if (type === "document") return `/documents?id=${id}`;
  if (type === "invoice") return `/factures?id=${id}`;
  if (type === "asset") return "/patrimoine";
  return undefined;
}

/* ---------- Tâches ---------- */

export type TaskInput = {
  kind?: "tache" | "jalon";
  title: string;
  notes?: string | null;
  dueDate?: string | null;
  domain?: string;
  entityType?: string | null;
  entityId?: string | null;
  amount?: number | null;
  recurrence?: Recurrence | null;
  private?: boolean;
  source?: string;
  sourceRef?: string | null;
  status?: "a_faire" | "fait";
};

export async function createTask(userId: number | null, t: TaskInput): Promise<number> {
  const r = await exec(
    `INSERT INTO agenda_items (owner_user_id, kind, title, notes, due_date, domain, entity_type, entity_id, amount, status, done_at, recurrence, source, source_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title), notes = VALUES(notes), due_date = VALUES(due_date), domain = VALUES(domain), amount = VALUES(amount), kind = VALUES(kind)`,
    [
      t.private && userId ? userId : null,
      t.kind ?? "tache",
      t.title.slice(0, 255),
      t.notes ?? null,
      t.dueDate ?? null,
      t.domain ?? "autre",
      t.entityType ?? null,
      t.entityId ?? null,
      t.amount ?? null,
      t.status ?? "a_faire",
      t.status === "fait" ? new Date().toISOString().slice(0, 19).replace("T", " ") : null,
      t.recurrence ?? null,
      t.source ?? "manuel",
      t.sourceRef ?? null,
    ],
  );
  return r.insertId;
}

async function visibleItem(userId: number, id: number) {
  const i = await one<{ id: number; title: string; status: string; due_date: string | null; recurrence: Recurrence | null; kind: string } & Record<string, unknown>>(
    `SELECT a.* FROM agenda_items a WHERE a.id = ? AND (a.owner_user_id IS NULL OR a.owner_user_id = ?)`,
    [id, userId],
  );
  if (!i) throw new ActionError(404, tr("Tâche introuvable"));
  return i;
}

/**
 * Coche (ou décoche) une tâche ; une tâche récurrente cochée crée l'occurrence suivante. La remettre à faire retire
 * cette occurrence tant qu'elle n'a pas été touchée (même intitulé, même date, encore à faire) : sans cela, annuler
 * une coche laisserait la tâche en double.
 */
export async function setTaskDone(userId: number, id: number, done: boolean): Promise<{ next?: number }> {
  const i = await visibleItem(userId, id);
  await exec("UPDATE agenda_items SET status = ?, done_at = ? WHERE id = ?", [done ? "fait" : "a_faire", done ? new Date().toISOString().slice(0, 19).replace("T", " ") : null, id]);
  if (!done && i.status === "fait" && i.recurrence && i.due_date)
    await exec(
      `DELETE FROM agenda_items WHERE source = 'recurrence' AND kind = 'tache' AND status = 'a_faire' AND title = ? AND due_date = ? AND recurrence = ?
         AND owner_user_id <=> ? AND id > ? ORDER BY id LIMIT 1`,
      [i.title, nextOccurrence(i.due_date, i.recurrence), i.recurrence, (i.owner_user_id as number | null) ?? null, id],
    );
  if (done && i.status !== "fait" && i.recurrence && i.due_date) {
    const next = await createTask(null, {
      kind: "tache",
      title: i.title,
      notes: (i.notes as string | null) ?? null,
      dueDate: nextOccurrence(i.due_date, i.recurrence),
      domain: i.domain as string,
      entityType: (i.entity_type as string | null) ?? null,
      entityId: (i.entity_id as string | null) ?? null,
      amount: i.amount == null ? null : Number(i.amount),
      recurrence: i.recurrence,
      source: "recurrence",
    });
    if (i.owner_user_id) await exec("UPDATE agenda_items SET owner_user_id = ? WHERE id = ?", [i.owner_user_id, next]);
    return { next };
  }
  return {};
}

export async function updateTask(userId: number, id: number, b: Partial<TaskInput>) {
  await visibleItem(userId, id);
  const cols: Record<string, unknown> = {
    title: b.title,
    notes: b.notes,
    due_date: b.dueDate,
    domain: b.domain,
    amount: b.amount,
    recurrence: b.recurrence,
    kind: b.kind,
    owner_user_id: b.private === undefined ? undefined : b.private ? userId : null,
  };
  const sets = Object.entries(cols).filter(([, v]) => v !== undefined);
  if (sets.length) await exec(`UPDATE agenda_items SET ${sets.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`, [...sets.map(([, v]) => v), id]);
}

export async function deleteTask(userId: number, id: number) {
  await visibleItem(userId, id);
  await exec("DELETE FROM agenda_items WHERE id = ?", [id]);
}
