import { today } from "./region.ts";
import { exec, one, q } from "./db.ts";
import { ActionError } from "./actions.ts";
import { IS_EXPENSE, STAT_SCOPE } from "./stats.ts";
import { t as tr } from "../lib/i18n.ts";

/*
 * Piloter : enveloppes mensuelles (plafond par poste ou catégorie, dépensé du mois, projection de fin
 * de mois, alerte au seuil) et objectifs d'épargne (avancement lu sur un placement lié ou saisi,
 * versement mensuel conseillé pour tenir l'échéance). Mêmes définitions que stats.ts.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const own = (alias: string, userId: number) => `(${alias}.owner_user_id IS NULL OR ${alias}.owner_user_id = ${Number(userId)})`;

/* ---------- Enveloppes ---------- */

type EnvelopeRow = { id: number; owner_user_id: number | null; scope: "poste" | "categorie"; ref: string; monthly: number; alert_pct: number; sort_order: number };

/** Moyenne des dépenses des 3 derniers mois complets, par poste et par catégorie (pour proposer un plafond). */
async function averages(accountsSql: string) {
  const rows = await q<{ poste: string | null; category_id: string | null; total: number }>(
    `SELECT c.poste, t.category_id, -SUM(t.amount) / 3 AS total
     FROM tx_lines t JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND ${IS_EXPENSE} AND t.date >= DATE_SUB(DATE_FORMAT(CURDATE(), '%Y-%m-01'), INTERVAL 3 MONTH) AND t.date < DATE_FORMAT(CURDATE(), '%Y-%m-01')
     GROUP BY c.poste, t.category_id`,
  );
  const byPoste = new Map<string, number>();
  const byCat = new Map<string, number>();
  for (const r of rows) {
    if (r.poste) byPoste.set(r.poste, (byPoste.get(r.poste) ?? 0) + Number(r.total));
    if (r.category_id) byCat.set(r.category_id, Number(r.total));
  }
  return { byPoste, byCat };
}

export async function listEnvelopes(userId: number, accountsSql: string) {
  const rows = await q<EnvelopeRow>(`SELECT e.* FROM envelopes e WHERE ${own("e", userId)} ORDER BY e.sort_order, e.id`);
  const month = today().slice(0, 7);
  const spent = await q<{ poste: string | null; category_id: string | null; total: number }>(
    `SELECT c.poste, t.category_id, -SUM(t.amount) AS total
     FROM tx_lines t JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
     WHERE ${STAT_SCOPE} AND ${IS_EXPENSE} AND t.date >= ? AND t.date < DATE_ADD(?, INTERVAL 1 MONTH)
     GROUP BY c.poste, t.category_id`,
    [`${month}-01`, `${month}-01`],
  );
  const avg = await averages(accountsSql);
  const names = new Map((await q<{ id: string; name: string; poste: string | null }>("SELECT id, name, poste FROM categories")).map((c) => [c.id, c]));
  const d = new Date();
  const day = Number(today().slice(8, 10));
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return rows.map((e) => {
    const total = spent.filter((s) => (e.scope === "poste" ? s.poste === e.ref : s.category_id === e.ref)).reduce((sum, s) => sum + Number(s.total), 0);
    const monthly = Number(e.monthly);
    const pct = monthly > 0 ? total / monthly : 0;
    // Projection simple : rythme du mois jusqu'ici, prolongé jusqu'à la fin du mois.
    const projected = day >= 5 ? (total / day) * daysInMonth : null;
    return {
      id: e.id,
      private: e.owner_user_id != null,
      scope: e.scope,
      ref: e.ref,
      label: e.scope === "poste" ? e.ref : (names.get(e.ref)?.name ?? e.ref),
      poste: e.scope === "poste" ? e.ref : (names.get(e.ref)?.poste ?? null),
      monthly,
      alertPct: e.alert_pct,
      spent: r2(total),
      left: r2(monthly - total),
      pct: r2(pct * 100),
      projected: projected != null ? r2(projected) : null,
      average: r2(e.scope === "poste" ? (avg.byPoste.get(e.ref) ?? 0) : (avg.byCat.get(e.ref) ?? 0)),
      state: pct >= 1 ? "depasse" : pct * 100 >= e.alert_pct ? "alerte" : "ok",
    };
  });
}

/** Postes et catégories de dépense avec leur moyenne sur 3 mois (pour créer une enveloppe). */
export async function envelopeCandidates(accountsSql: string) {
  const avg = await averages(accountsSql);
  const cats = await q<{ id: string; name: string; poste: string | null }>("SELECT id, name, poste FROM categories WHERE kind = 'depense' ORDER BY sort_order, id");
  const postes = [...new Set(cats.map((c) => c.poste).filter((p): p is string => !!p))];
  return {
    postes: postes.map((p) => ({ ref: p, label: p, average: r2(avg.byPoste.get(p) ?? 0) })),
    categories: cats.map((c) => ({ ref: c.id, label: c.name, poste: c.poste, average: r2(avg.byCat.get(c.id) ?? 0) })),
  };
}

export async function saveEnvelope(userId: number, id: number | null, b: { scope?: "poste" | "categorie"; ref?: string; monthly?: number; alertPct?: number; private?: boolean }) {
  if (id == null) {
    if (!b.ref || b.monthly == null) throw new ActionError(400, tr("Poste et montant requis"));
    const dup = await one<{ id: number }>(`SELECT id FROM envelopes e WHERE e.scope = ? AND e.ref = ? AND ${own("e", userId)}`, [b.scope ?? "poste", b.ref]);
    if (dup) throw new ActionError(409, tr("Une enveloppe existe déjà pour ce poste"));
    const r = await exec("INSERT INTO envelopes (owner_user_id, scope, ref, monthly, alert_pct) VALUES (?, ?, ?, ?, ?)", [
      b.private ? userId : null,
      b.scope ?? "poste",
      b.ref,
      b.monthly,
      b.alertPct ?? 80,
    ]);
    return r.insertId;
  }
  const e = await one<EnvelopeRow>(`SELECT e.* FROM envelopes e WHERE e.id = ? AND ${own("e", userId)}`, [id]);
  if (!e) throw new ActionError(404, tr("Enveloppe introuvable"));
  const sets: string[] = ["updated_at = NOW()"];
  const params: unknown[] = [];
  if (b.monthly !== undefined) sets.push("monthly = ?"), params.push(b.monthly);
  if (b.alertPct !== undefined) sets.push("alert_pct = ?"), params.push(b.alertPct);
  if (b.private !== undefined) sets.push("owner_user_id = ?"), params.push(b.private ? userId : null);
  await exec(`UPDATE envelopes SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  return id;
}

export async function deleteEnvelope(userId: number, id: number) {
  const r = await exec(`DELETE FROM envelopes WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)`, [id, userId]);
  if (!r.affectedRows) throw new ActionError(404, tr("Enveloppe introuvable"));
}

/* ---------- Objectifs d'épargne ---------- */

type GoalRow = { id: number; owner_user_id: number | null; name: string; emoji: string | null; target: number; target_date: string | null; asset_id: number | null; current_manual: number | null; notes: string | null; status: string; created_at: string };

export async function listGoals(userId: number) {
  const rows = await q<GoalRow & { asset_name: string | null; asset_value: number | null; asset_share: number | null }>(
    `SELECT g.*, a.name AS asset_name, a.value AS asset_value, a.share AS asset_share FROM goals g LEFT JOIN assets a ON a.id = g.asset_id
     WHERE ${own("g", userId)} AND g.status <> 'archive' ORDER BY g.status = 'atteint', g.target_date IS NULL, g.target_date, g.id`,
  );
  const now = new Date(`${today()}T12:00:00`);
  return rows.map((g) => {
    const current = g.asset_id && g.asset_value != null ? Number(g.asset_value) : Number(g.current_manual ?? 0);
    const target = Number(g.target);
    const remaining = Math.max(0, target - current);
    let monthsLeft: number | null = null;
    if (g.target_date) {
      const t = new Date(`${String(g.target_date).slice(0, 10)}T12:00:00`);
      monthsLeft = Math.max(0, (t.getFullYear() - now.getFullYear()) * 12 + (t.getMonth() - now.getMonth()));
    }
    return {
      id: g.id,
      private: g.owner_user_id != null,
      name: g.name,
      emoji: g.emoji,
      target,
      targetDate: g.target_date ? String(g.target_date).slice(0, 10) : null,
      assetId: g.asset_id,
      assetName: g.asset_name,
      current: r2(current),
      currentManual: g.current_manual != null ? Number(g.current_manual) : null,
      pct: target > 0 ? r2(Math.min(100, (current / target) * 100)) : 0,
      remaining: r2(remaining),
      monthsLeft,
      // Versement mensuel pour tenir l'échéance (au moins un mois).
      monthlyNeeded: monthsLeft != null && remaining > 0 ? r2(remaining / Math.max(1, monthsLeft)) : null,
      notes: g.notes,
      status: remaining <= 0 ? "atteint" : g.status,
    };
  });
}

export async function saveGoal(
  userId: number,
  id: number | null,
  b: { name?: string; emoji?: string | null; target?: number; targetDate?: string | null; assetId?: number | null; currentManual?: number | null; notes?: string | null; status?: string; private?: boolean },
) {
  if (b.assetId) {
    const a = await one("SELECT id FROM assets WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [b.assetId, userId]);
    if (!a) throw new ActionError(404, tr("Placement introuvable"));
  }
  if (id == null) {
    if (!b.name || b.target == null) throw new ActionError(400, tr("Nom et montant visé requis"));
    const r = await exec("INSERT INTO goals (owner_user_id, name, emoji, target, target_date, asset_id, current_manual, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
      b.private ? userId : null,
      b.name,
      b.emoji ?? null,
      b.target,
      b.targetDate ?? null,
      b.assetId ?? null,
      b.currentManual ?? null,
      b.notes ?? null,
    ]);
    return r.insertId;
  }
  const g = await one<GoalRow>(`SELECT g.* FROM goals g WHERE g.id = ? AND ${own("g", userId)}`, [id]);
  if (!g) throw new ActionError(404, tr("Objectif introuvable"));
  const map: [keyof typeof b, string][] = [
    ["name", "name"],
    ["emoji", "emoji"],
    ["target", "target"],
    ["targetDate", "target_date"],
    ["assetId", "asset_id"],
    ["currentManual", "current_manual"],
    ["notes", "notes"],
    ["status", "status"],
  ];
  const sets = ["updated_at = NOW()"];
  const params: unknown[] = [];
  for (const [k, col] of map) if (b[k] !== undefined) sets.push(`${col} = ?`), params.push(b[k]);
  if (b.private !== undefined) sets.push("owner_user_id = ?"), params.push(b.private ? userId : null);
  await exec(`UPDATE goals SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  return id;
}

export async function deleteGoal(userId: number, id: number) {
  const r = await exec("DELETE FROM goals WHERE id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [id, userId]);
  if (!r.affectedRows) throw new ActionError(404, tr("Objectif introuvable"));
}
