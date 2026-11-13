import { householdCurrency, moneySymbol, region } from "./region.ts";
import { exec, one, q } from "./db.ts";
import { IS_EXPENSE, STAT_SCOPE } from "./stats.ts";
import { equivalence, FETE_BUDGETS, FUN_UNITS, MONTH_HOURS, type FunBudget, type FunData, type FunHighlight } from "../lib/fun.ts";
import { birthdaysAt, parseBirthdays, SEASONS, seasonAt, seasonWindow, type Birthday, type Season } from "../lib/seasons.ts";
import { t } from "../lib/i18n.ts";

/*
 * Équivalences amusantes (src/lib/fun.ts) : réglage du membre, taux horaire net d'après ses bulletins,
 * dépenses mises en lumière et budget de la fête. Mêmes définitions que stats.ts (lignes comptées,
 * dépenses nettes) : les montants sont ceux des autres écrans, seule leur écriture change.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const key = (userId: number) => `fun:${Number(userId)}`;

/** Activées par défaut ; le membre les coupe dans Réglages → Apparence (valable sur tous ses appareils). */
export async function funEnabled(userId: number): Promise<boolean> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key(userId)]);
  return row?.value !== "off";
}

export async function setFunEnabled(userId: number, enabled: boolean) {
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key(userId), enabled ? "on" : "off"]);
}

/** Anniversaires du foyer (Réglages → Apparence) : une liste partagée par les membres, gardée dans app_kv. */
export async function listBirthdays(): Promise<Birthday[]> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = 'birthdays'");
  if (!row) return [];
  try {
    return parseBirthdays(JSON.parse(row.value));
  } catch {
    return [];
  }
}

export async function saveBirthdays(list: Birthday[]) {
  await exec("INSERT INTO app_kv (`key`, value) VALUES ('birthdays', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify(parseBirthdays(list))]);
}

/** Taux horaire net du membre : net payé moyen de ses trois derniers mois de bulletins, pour un temps plein de 35 h. */
export async function hourlyNet(userId: number): Promise<number | null> {
  const rows = await q<{ net: number }>(
    "SELECT SUM(net_paid) AS net FROM payslips WHERE owner_user_id = ? AND net_paid IS NOT NULL GROUP BY period ORDER BY period DESC LIMIT 3",
    [userId],
  );
  const nets = rows.map((r) => Number(r.net)).filter((n) => n > 0);
  if (!nets.length) return null;
  return r2(nets.reduce((s, n) => s + n, 0) / nets.length / MONTH_HOURS);
}

/** Dépenses à mettre en lumière : la plus grosse des 7 derniers jours, le poste le plus lourd du mois, l'abonnement le plus cher sur un an. */
async function highlights(userId: number, accountsSql: string): Promise<FunHighlight[]> {
  const [biggest, poste, sub] = await Promise.all([
    one<{ id: string; label: string; amount: number; date: string }>(
      `SELECT tr.id, COALESCE(NULLIF(NULLIF(tr.merchant, ''), 'Inconnu'), NULLIF(tr.bank_label, ''), tr.label) AS label, -t.amount AS amount, DATE_FORMAT(t.date, '%Y-%m-%d') AS date
       FROM tx_lines t JOIN transactions tr ON tr.id = t.id JOIN ${accountsSql} a ON a.id = t.account_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${STAT_SCOPE} AND ${IS_EXPENSE} AND t.amount < 0 AND t.date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       ORDER BY t.amount ASC LIMIT 1`,
    ),
    one<{ poste: string; total: number }>(
      `SELECT c.poste, -SUM(t.amount) AS total
       FROM tx_lines t JOIN ${accountsSql} a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id
       WHERE ${STAT_SCOPE} AND c.kind = 'depense' AND c.poste IS NOT NULL AND t.date >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
       GROUP BY c.poste HAVING total > 0 ORDER BY total DESC LIMIT 1`,
    ),
    one<{ label: string; yearly: number }>(
      `SELECT c.label, COALESCE(c.annual, c.monthly * 12) AS yearly FROM commitments c
       WHERE (c.owner_user_id IS NULL OR c.owner_user_id = ?) AND c.type = 'abonnement' AND c.status = 'actif' AND COALESCE(c.annual, c.monthly * 12) > 0
       ORDER BY yearly DESC LIMIT 1`,
      [userId],
    ),
  ]);
  const out: FunHighlight[] = [];
  if (biggest) out.push({ kind: "depense", label: biggest.label, amount: r2(Number(biggest.amount)), detail: t("ta plus grosse dépense des 7 derniers jours"), transactionId: biggest.id, date: biggest.date });
  if (poste) out.push({ kind: "poste", label: poste.poste, amount: r2(Number(poste.total)), detail: t("ton poste le plus lourd ce mois-ci") });
  if (sub) out.push({ kind: "abonnement", label: sub.label, amount: r2(Number(sub.yearly)), detail: t("ton abonnement le plus cher, sur un an") });
  return out;
}

/** Ce que la fête a coûté jusqu'ici dans ses catégories, et la même fête un an plus tôt (null sans opération à l'époque). */
async function feteBudget(accountsSql: string, season: Season, now: Date): Promise<FunBudget | null> {
  const def = FETE_BUDGETS[season];
  if (!def) return null;
  const w = seasonWindow(season, now);
  const from = ymd(w.start);
  const to = ymd(w.end < now ? w.end : now);
  const marks = def.categories.map(() => "?").join(", ");
  const base = `FROM tx_lines t JOIN ${accountsSql} a ON a.id = t.account_id JOIN categories c ON c.id = t.category_id WHERE ${STAT_SCOPE} AND t.date >= ? AND t.date <= ?`;
  const prev = seasonWindow(season, now, -1);
  const [lines, last, lastAny] = await Promise.all([
    q<{ id: string; name: string; total: number }>(`SELECT c.id, c.name, -SUM(t.amount) AS total ${base} AND c.id IN (${marks}) GROUP BY c.id, c.name HAVING total > 0 ORDER BY total DESC`, [from, to, ...def.categories]),
    one<{ total: number | null }>(`SELECT -SUM(t.amount) AS total ${base} AND c.id IN (${marks})`, [ymd(prev.start), ymd(prev.end), ...def.categories]),
    one<{ n: number }>(`SELECT COUNT(*) AS n ${base}`, [ymd(prev.start), ymd(prev.end)]),
  ]);
  return {
    // Nom de la fête et catégories comptées : lus pendant la requête, donc dans sa langue (accesseurs de FETE_BUDGETS).
    title: def.title,
    what: def.what,
    from,
    to,
    total: r2(lines.reduce((s, l) => s + Number(l.total), 0)),
    lines: lines.map((l) => ({ id: l.id, name: l.name, total: r2(Number(l.total)) })),
    lastYear: Number(lastAny?.n ?? 0) > 0 ? r2(Math.max(0, Number(last?.total ?? 0))) : null,
  };
}

/** Données de l'écran : rien d'autre que le réglage quand le membre a coupé les équivalences. */
export async function funData(userId: number, accountsSql: string, season: Season | null): Promise<FunData> {
  if (!(await funEnabled(userId))) return { enabled: false, hourly: null, highlights: [], budget: null };
  const [hourly, list, budget] = await Promise.all([hourlyNet(userId), highlights(userId, accountsSql), season ? feteBudget(accountsSql, season, new Date()) : null]);
  return { enabled: true, hourly, highlights: list, budget };
}

/** Consigne pour l'assistant : l'unité du thème du jour et le taux horaire, ou rien si le membre a coupé les équivalences. */
export async function funPrompt(userId: number): Promise<string | null> {
  if (!(await funEnabled(userId))) return null;
  const [hourly, birthdays] = await Promise.all([hourlyNet(userId), listBirthdays().catch(() => [])]);
  const today = new Date();
  const season = seasonAt(today, "tout", birthdays, region().country);
  const feted = birthdaysAt(today, birthdays).map((b) => b.name);
  const parts: string[] = [];
  if (feted.length) parts.push(`c'est aujourd'hui l'anniversaire de ${feted.join(" et ")} (souhaite-le en une phrase, une seule fois dans la conversation)`);
  // Les unités des thèmes ont un prix fixé en euros : elles ne valent que pour un foyer en euros.
  if (season && householdCurrency() === "EUR") {
    const u = FUN_UNITS[season];
    const sample = equivalence(100, season);
    parts.push(`thème du moment : ${SEASONS[season].label} ${u.emoji} ; unité amusante ${u.ref}${sample ? ` (100 € ≈ ${sample.text})` : ""}`);
  }
  if (hourly) parts.push(`une heure de travail de l'utilisateur vaut ${String(hourly).replace(".", ",")} ${moneySymbol()} nets (bulletins de paie, base 35 h)`);
  if (!parts.length) return null;
  return (
    `Équivalences amusantes (activées par l'utilisateur) : ${parts.join(" ; ")}. Quand on te le demande (« en bières », « en heures de travail »…), ou une seule fois par réponse quand un montant s'y prête, ` +
    `ajoute l'équivalence entre parenthèses après le montant, en rappelant le prix de référence. Le montant reste le chiffre exact ; n'en fais jamais dans un tableau.`
  );
}
