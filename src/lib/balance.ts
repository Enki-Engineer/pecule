/*
 * Solde bas : la règle d'un membre (seuil, délai de prévenance, comptes surveillés) et la prévision du solde d'un
 * compte, jour par jour — le solde d'aujourd'hui, puis ce qui est attendu sur ce compte : ce qui y revient chaque
 * mois (prélèvements, virements, salaire) et le prélèvement d'une carte à débit différé. Règles pures ; le serveur
 * fournit les soldes et les mouvements attendus (src/server/balance.ts).
 */

export type AccountRule = { /** Faux : ce compte n'est pas surveillé. */ watch?: boolean; /** Seuil propre à ce compte ; absent : celui de la règle. */ threshold?: number | null };

export type BalanceRule = {
  /** Faux : aucun compte n'est surveillé, aucune alerte de solde. */
  enabled: boolean;
  /** En dessous, un compte est signalé (devise du foyer). */
  threshold: number;
  /** Prévenir quand le seuil serait franchi dans ce nombre de jours, au plus. */
  days: number;
  /** Réglages propres à un compte (identifiant → réglage) ; un compte absent suit la règle. */
  accounts: Record<string, AccountRule>;
};

export const DEFAULT_BALANCE_RULE: BalanceRule = { enabled: true, threshold: 200, days: 7, accounts: {} };
/** Délais proposés à l'écran ; la règle accepte tout nombre de jours de 1 à `MAX_BALANCE_DAYS`. */
export const BALANCE_DAYS = [3, 7, 14, 30] as const;
export const MAX_BALANCE_DAYS = 31;
const MAX_AMOUNT = 10_000_000;

const amount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX_AMOUNT ? Math.round(v * 100) / 100 : null);

/** Règle lisible quoi qu'on lui donne : ce qui manque ou ne tient pas debout prend la valeur de `base`. */
export function cleanBalanceRule(input: unknown, base: BalanceRule = DEFAULT_BALANCE_RULE): BalanceRule {
  const r = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof BalanceRule, unknown>>;
  const days = typeof r.days === "number" && Number.isInteger(r.days) && r.days >= 1 && r.days <= MAX_BALANCE_DAYS ? r.days : base.days;
  const accounts: Record<string, AccountRule> = {};
  const given = r.accounts && typeof r.accounts === "object" ? (r.accounts as Record<string, unknown>) : base.accounts;
  for (const [id, raw] of Object.entries(given)) {
    if (!raw || typeof raw !== "object" || id.length > 64) continue;
    const a = raw as AccountRule;
    const own: AccountRule = {};
    if (a.watch === false) own.watch = false;
    const t = amount(a.threshold);
    if (t != null) own.threshold = t;
    // Un réglage qui ne dit rien de plus que la règle n'est pas gardé.
    if (Object.keys(own).length) accounts[id] = own;
  }
  return { enabled: typeof r.enabled === "boolean" ? r.enabled : base.enabled, threshold: amount(r.threshold) ?? base.threshold, days, accounts };
}

/** Ce que la règle dit d'un compte : surveillé ou non, et à quel seuil. */
export const accountRule = (rule: BalanceRule, accountId: string): { watched: boolean; threshold: number } => ({
  watched: rule.enabled && rule.accounts[accountId]?.watch !== false,
  threshold: rule.accounts[accountId]?.threshold ?? rule.threshold,
});

/** Mouvement attendu sur un compte : une récurrence, ou le prélèvement d'une carte à débit différé. */
export type Movement = { date: string; amount: number; name: string; source: "recurrence" | "carte"; /** Jour habituel déjà passé : compté comme imminent. */ late?: boolean };
export type BalancePoint = { date: string; balance: number };

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Solde prévu de `today` (rang 0) à `days` jours plus tard. Un mouvement en retard — son jour habituel est passé —
 * est compté dès aujourd'hui : il peut tomber d'un moment à l'autre. Ce qui est attendu après la fenêtre est ignoré.
 */
export function projectBalance(balance: number, movements: Movement[], today: string, days: number): BalancePoint[] {
  const end = addDays(today, days);
  const byDay = new Map<string, number>();
  for (const m of movements) {
    const date = m.date < today ? today : m.date;
    if (date > end) continue;
    byDay.set(date, (byDay.get(date) ?? 0) + m.amount);
  }
  const out: BalancePoint[] = [];
  let acc = balance;
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i);
    acc = r2(acc + (byDay.get(date) ?? 0));
    out.push({ date, balance: acc });
  }
  return out;
}

export type LowPoint = BalancePoint & { /** Le mouvement qui fait passer sous le seuil : la plus grosse sortie de ce jour-là. */ cause: Movement | null };

/** Premier jour où le solde prévu passe sous le seuil, ou null s'il n'y passe pas dans la fenêtre. */
export function firstLow(points: BalancePoint[], movements: Movement[], threshold: number): LowPoint | null {
  const p = points.find((x) => x.balance < threshold);
  if (!p) return null;
  const today = points[0]?.date ?? p.date;
  const sameDay = movements.filter((m) => m.amount < 0 && (m.date < today ? today : m.date) === p.date).sort((a, b) => a.amount - b.amount);
  return { ...p, cause: sameDay[0] ?? null };
}

/** Le point le plus bas de la fenêtre (le premier, en cas d'égalité). */
export const lowestPoint = (points: BalancePoint[]): BalancePoint | null => points.reduce<BalancePoint | null>((min, p) => (!min || p.balance < min.balance ? p : min), null);

/* ---------- Carte à débit différé : sur quel compte elle est prélevée ---------- */

/** Le relevé mensuel d'une carte à débit différé, tel qu'il s'écrit sur le compte prélevé. */
export const CARD_STATEMENT = /^relev[eé] diff[eé]r[eé]/i;
/** Écart toléré entre le jour où la carte dit être prélevée et le jour où le relevé est écrit sur le compte (week-end, jour férié). */
const STATEMENT_DAYS = 5;

export type CardStatement = { account_id: string; date: string; amount: number; label: string };
/** Ce qu'une carte a fait prélever un jour donné : la somme de ses achats écrits ce jour-là. */
export type CardTotal = { account_id: string; date: string; total: number };

/**
 * Le compte sur lequel chaque carte à débit différé est prélevée, d'après les relevés passés. Deux façons de
 * reconnaître le relevé d'une carte, dans l'ordre : son libellé porte les derniers chiffres connus de la carte ;
 * sinon son montant est, au centime, ce que la carte a fait prélever ce jour-là (la banque ne donne pas toujours
 * le numéro écrit sur le relevé). Un montant que deux comptes ou deux cartes se disputent ne désigne personne :
 * mieux vaut ne rien dire que désigner le mauvais compte. `statements` et `totals` : du plus récent au plus ancien.
 */
export function cardDebitTargets(cards: { accountId: string; tail: string | null }[], statements: CardStatement[], totals: CardTotal[]): Map<string, string> {
  const out = new Map<string, string>();
  const list = statements.filter((s) => CARD_STATEMENT.test(s.label));
  const days = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
  const same = (s: CardStatement, t: CardTotal) => Math.abs(s.amount - t.total) < 0.005 && days(s.date, t.date) <= STATEMENT_DAYS;
  for (const c of cards) {
    const byTail = c.tail ? list.find((s) => s.label.includes(c.tail!)) : undefined;
    if (byTail) {
      out.set(c.accountId, byTail.account_id);
      continue;
    }
    for (const t of totals) {
      if (t.account_id !== c.accountId || !t.total) continue;
      const accounts = new Set(list.filter((s) => same(s, t)).map((s) => s.account_id));
      const rivals = totals.some((o) => o.account_id !== c.accountId && Math.abs(o.total - t.total) < 0.005 && days(o.date, t.date) <= STATEMENT_DAYS);
      if (accounts.size === 1 && !rivals) {
        out.set(c.accountId, [...accounts][0]);
        break;
      }
    }
  }
  return out;
}
