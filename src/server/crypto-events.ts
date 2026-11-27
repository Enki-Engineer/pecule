import { exec, one, q } from "./db.ts";
import { ActionError } from "./actions.ts";
import { validPeriod, type EventKind, type EventStatus } from "../lib/crypto-events.ts";
import { t as tr } from "../lib/i18n.ts";

/*
 * Journal des mouvements crypto d'un membre : un récit qu'il tient lui-même, à l'écran ou par l'assistant (achats,
 * ventes, transferts, staking…). Privé : chaque lecture et chaque écriture porte `owner_user_id = ?`. Les genres et
 * ce qu'on déduit d'un mouvement sont dans src/lib/crypto-events.ts.
 */

export type CryptoEventRow = {
  id: number;
  date: string;
  end_date: string | null;
  title: string;
  asset: string | null;
  type: string | null;
  platform: string | null;
  portfolio_id: string | null;
  quantity: number | null;
  value: number | null;
  price: number | null;
  fee: number | null;
  status: string;
  note: string | null;
  origin: string;
  /** Opération bancaire que le mouvement raconte, s'il a été noté depuis elle. */
  transaction_id: string | null;
};

/** Ce qu'un mouvement porte, tel que le donnent l'écran, l'assistant ou une reprise. */
export type EventInput = {
  date: string;
  endDate?: string | null;
  type: EventKind;
  title: string;
  asset?: string | null;
  quantity?: number | null;
  value?: number | null;
  price?: number | null;
  fee?: number | null;
  /** Nom de la plateforme ou du portefeuille ; celui d'un portefeuille relié du membre y rattache le mouvement. */
  platform?: string | null;
  portfolioId?: string | null;
  status?: EventStatus;
  note?: string | null;
};
/** D'où vient la ligne : saisie à l'écran, dictée à l'assistant, reprise d'un autre outil, ou noté depuis ce que Pécule lit (banque, synchronisation, ligne d'un export). */
export type EventOrigin = "main" | "assistant" | "import" | "banque" | "synchro" | "fichier";

// Le nom d'un portefeuille relié suit ses changements ; un portefeuille retiré laisse le nom noté ce jour-là.
const COLUMNS = `e.id, e.date, e.end_date, e.title, e.asset, e.type, COALESCE(s.name, e.platform) AS platform,
  IF(s.portfolio_id IS NULL, NULL, e.portfolio_id) AS portfolio_id, e.quantity, e.value, e.price, e.fee, e.status, e.note, e.origin, e.transaction_id`;
const FROM = "FROM crypto_events e LEFT JOIN crypto_sources s ON s.portfolio_id = e.portfolio_id AND s.owner_user_id = e.owner_user_id";

/** Mouvements du membre, du plus récent au plus ancien. */
export async function cryptoEvents(userId: number, limit = 500) {
  return q<CryptoEventRow>(`SELECT ${COLUMNS} ${FROM} WHERE e.owner_user_id = ? ORDER BY e.date DESC, e.id DESC LIMIT ?`, [userId, limit]);
}

export async function cryptoEvent(userId: number, id: number) {
  return one<CryptoEventRow>(`SELECT ${COLUMNS} ${FROM} WHERE e.id = ? AND e.owner_user_id = ?`, [id, userId]);
}

const text = (v: string | null | undefined, max: number) => v?.trim().slice(0, max) || null;
const amount = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const number = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v);

/**
 * Où le mouvement a eu lieu : un portefeuille relié du membre (donné par son identifiant, ou reconnu à son nom
 * exact quand un seul le porte), sinon le nom écrit. Jamais le portefeuille d'un autre membre.
 */
async function place(userId: number, platform: string | null | undefined, portfolioId: string | null | undefined) {
  if (portfolioId) {
    const src = await one<{ name: string }>("SELECT name FROM crypto_sources WHERE portfolio_id = ? AND owner_user_id = ?", [portfolioId, userId]);
    if (!src) throw new ActionError(404, tr("Portefeuille introuvable"));
    return { platform: src.name.slice(0, 60), portfolioId };
  }
  const name = text(platform, 60);
  if (!name) return { platform: null, portfolioId: null };
  const same = await q<{ portfolio_id: string }>("SELECT portfolio_id FROM crypto_sources WHERE owner_user_id = ? AND LOWER(name) = LOWER(?) LIMIT 2", [userId, name]);
  return { platform: name, portfolioId: same.length === 1 ? same[0].portfolio_id : null };
}

function check(date: string, endDate: string | null | undefined) {
  if (!validPeriod(date, endDate)) throw new ActionError(400, tr("La fin de la période précède son début"));
}

/**
 * Ajoute un mouvement au journal du membre ; rend son identifiant. `link.transactionId` : l'opération bancaire qu'il
 * raconte ; `link.sourceRef` : la ligne d'export dont il vient (l'appelant a vérifié que le membre les voit).
 */
export async function addCryptoEvent(userId: number, e: EventInput, origin: EventOrigin, link: { transactionId?: string; sourceRef?: string } = {}): Promise<number> {
  check(e.date, e.endDate);
  const where = await place(userId, e.platform, e.portfolioId);
  const r = await exec(
    `INSERT INTO crypto_events (owner_user_id, date, end_date, title, asset, type, platform, portfolio_id, quantity, value, price, fee, status, note, origin, transaction_id, source_ref)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, e.date, e.endDate || null, e.title.trim().slice(0, 255), text(e.asset, 120), e.type, where.platform, where.portfolioId, number(e.quantity), amount(e.value), number(e.price), amount(e.fee), e.status ?? "fait", text(e.note, 4000), origin, link.transactionId ?? null, link.sourceRef ?? null],
  );
  return r.insertId;
}

/** Modifie un mouvement du membre : seuls les champs donnés changent (`null` vide un champ). */
export async function updateCryptoEvent(userId: number, id: number, patch: Partial<EventInput>) {
  const before = await one<{ date: string; end_date: string | null; platform: string | null; portfolio_id: string | null }>(
    "SELECT date, end_date, platform, portfolio_id FROM crypto_events WHERE id = ? AND owner_user_id = ?",
    [id, userId],
  );
  if (!before) throw new ActionError(404, tr("Mouvement introuvable"));
  check(patch.date ?? before.date, patch.endDate === undefined ? before.end_date : patch.endDate);
  const sets: string[] = [];
  const values: unknown[] = [];
  const set = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.date !== undefined) set("date", patch.date);
  if (patch.endDate !== undefined) set("end_date", patch.endDate || null);
  if (patch.title !== undefined) set("title", patch.title.trim().slice(0, 255));
  if (patch.asset !== undefined) set("asset", text(patch.asset, 120));
  if (patch.type !== undefined) set("type", patch.type);
  if (patch.quantity !== undefined) set("quantity", number(patch.quantity));
  if (patch.value !== undefined) set("value", amount(patch.value));
  if (patch.price !== undefined) set("price", number(patch.price));
  if (patch.fee !== undefined) set("fee", amount(patch.fee));
  if (patch.status !== undefined) set("status", patch.status);
  if (patch.note !== undefined) set("note", text(patch.note, 4000));
  if (patch.platform !== undefined || patch.portfolioId !== undefined) {
    const where = await place(userId, patch.platform, patch.portfolioId);
    set("platform", where.platform);
    set("portfolio_id", where.portfolioId);
  }
  if (sets.length) await exec(`UPDATE crypto_events SET ${sets.join(", ")} WHERE id = ? AND owner_user_id = ?`, [...values, id, userId]);
}

export async function deleteCryptoEvent(userId: number, id: number) {
  const r = await exec("DELETE FROM crypto_events WHERE id = ? AND owner_user_id = ?", [id, userId]);
  if (!r.affectedRows) throw new ActionError(404, tr("Mouvement introuvable"));
}
