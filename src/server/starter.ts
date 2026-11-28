import { ActionError } from "./actions.ts";
import { saveDataNames } from "./data-i18n.ts";
import { exec, one, q } from "./db.ts";
import { nextCategoryCode } from "../lib/category-codes.ts";
import { t } from "../lib/i18n.ts";
import { STARTER_CATEGORIES, STARTER_GROUPS, STARTER_NAMES, STARTER_PRIORITY, STARTER_RULES, STARTER_RULES_BEFORE, starterKind } from "../lib/starter.ts";
import { followers, insertRank, ownCode, plannedRules, proposals, rulePlan, type KeyState, type Received, type Rule, type RulePlan } from "../lib/starter-proposals.ts";

/** Ce que le foyer a reçu des catégories ajoutées au jeu de départ (app_kv) : code du jeu → code chez lui. */
const RECEIVED_KEY = "depart:categories";

async function received(): Promise<Received> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [RECEIVED_KEY]);
  try {
    const value: unknown = row ? JSON.parse(row.value) : {};
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
  } catch {
    return {};
  }
}

const saveReceived = (r: Received) => exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [RECEIVED_KEY, JSON.stringify(r)]);

/**
 * Installation neuve : charge le référentiel de départ (catégories, règles pour les grandes enseignes) quand la base
 * n'a encore aucune catégorie. Une base qui a déjà les siennes n'est jamais touchée : le référentiel appartient au
 * foyer, et ce que le jeu de départ a reçu depuis lui est seulement proposé (`starterProposals`).
 *
 * Les noms du jeu, eux, sont enregistrés dans les cinq langues à chaque démarrage, sans rien remplacer : une
 * catégorie proposée se lit dans la langue du membre avant même d'être ajoutée.
 */
export async function seedStarter(): Promise<{ categories: number; rules: number } | null> {
  await saveDataNames(
    Object.entries(STARTER_NAMES).flatMap(([source, names]) => [
      { source, lang: "fr" as const, text: source },
      { source, lang: "en" as const, text: names.en },
      { source, lang: "de" as const, text: names.de },
      { source, lang: "it" as const, text: names.it },
      { source, lang: "es" as const, text: names.es },
    ]),
    false,
  );
  const existing = await one<{ n: number }>("SELECT COUNT(*) AS n FROM categories");
  if (existing?.n) return null;
  for (const [i, c] of STARTER_CATEGORIES.entries()) {
    const kind = starterKind(c.id);
    await exec("INSERT IGNORE INTO categories (id, name, group_name, poste, kind, sort_order, description) VALUES (?, ?, ?, ?, ?, ?, ?)", [c.id, c.name, STARTER_GROUPS[kind], c.poste, kind, i, c.description ?? null]);
  }
  await saveReceived(Object.fromEntries(STARTER_CATEGORIES.filter((c) => c.added).map((c) => [c.id, c.id])));
  let rules = 0;
  if (!(await one<{ n: number }>("SELECT COUNT(*) AS n FROM rules"))?.n)
    for (const [pattern, categoryId] of STARTER_RULES) rules += (await exec("INSERT IGNORE INTO rules (pattern, category_id, priority) VALUES (?, ?, ?)", [pattern, categoryId, STARTER_PRIORITY])).affectedRows;
  return { categories: STARTER_CATEGORIES.length, rules };
}

/* ---------- Catégories proposées à un foyer déjà installé ---------- */

type Own = { id: string; name: string; poste: string | null; sort_order: number };

const referential = async () => ({
  own: await q<Own>("SELECT id, name, poste, sort_order FROM categories ORDER BY sort_order, id"),
  got: await received(),
  rules: await q<Rule>("SELECT pattern, category_id, priority FROM rules"),
});

/** Sans catégorie et sans ventilation : une opération ventilée par une facture a ses catégories dans ses lignes. */
const UNCLASSIFIED = "t.category_id IS NULL AND NOT EXISTS (SELECT 1 FROM transaction_splits s WHERE s.transaction_id = t.id)";

/**
 * Opérations que les règles d'une catégorie ajoutée peuvent concerner, réunies par libellé et par classement : celles
 * qu'une règle a classées et celles qui n'ont pas de catégorie. Tout le foyer, comme une règle : elle classe les
 * opérations de tous les comptes.
 */
async function ruleStates(patterns: string[]): Promise<KeyState[]> {
  if (!patterns.length) return [];
  const rows = await q<KeyState>(
    `SELECT t.label_key, t.category_id, t.category_source, COUNT(*) AS n FROM transactions t
     WHERE t.label_key <> '' AND (t.category_source = 'regle' OR (${UNCLASSIFIED})) AND (${patterns.map(() => "t.label_key LIKE CONCAT('%', ?, '%')").join(" OR ")})
     GROUP BY t.label_key, t.category_id, t.category_source`,
    patterns,
  );
  return rows.map((r) => ({ ...r, n: Number(r.n) }));
}

/** Code, chez le foyer, d'une catégorie du jeu de départ (null : il ne l'a pas). */
const codeOf = (own: Own[], got: Received) => (starterId: string) => {
  const c = STARTER_CATEGORIES.find((x) => x.id === starterId);
  return c ? ownCode(c, own, got) : null;
};

/** Motifs des règles qu'un plan écrit ou déplace. */
const patternsOf = (plan: RulePlan) => [...plan.add, ...plan.move];

/** Code qu'aura la catégorie chez le foyer : celui du jeu de départ, ou la suite de son poste s'il est déjà pris. */
const codeFor = (id: string, poste: string, own: Own[]) => (own.some((o) => o.id === id) ? nextCategoryCode(own, poste, starterKind(id)) : id);

export type StarterProposal = {
  /** Code dans le jeu de départ : c'est lui qu'on renvoie pour l'ajouter. */
  id: string;
  name: string;
  poste: string;
  kind: ReturnType<typeof starterKind>;
  /** Le poste n'existe pas encore chez le foyer : la catégorie l'ouvre. */
  newPoste: boolean;
  /** Règles de classement qui arrivent avec elle. */
  rules: number;
  /** Opérations déjà là qui la rejoindront : sans catégorie, ou classées par la règle d'avant. */
  moves: number;
};

/** Catégories du jeu de départ que le foyer n'a pas, avec ce que chacune écrirait. */
export async function starterProposals(): Promise<StarterProposal[]> {
  const { own, got, rules } = await referential();
  const list = proposals(own, got);
  const plans = list.map((c) => ({ c, code: codeFor(c.id, c.poste, own), plan: rulePlan(c.id, rules, codeOf(own, got)) }));
  // Une seule lecture des opérations pour toutes les propositions.
  const states = await ruleStates([...new Set(plans.flatMap((p) => patternsOf(p.plan)))]);
  return plans.map(({ c, code, plan }) => ({
    id: c.id,
    name: c.name,
    poste: c.poste,
    kind: starterKind(c.id),
    newPoste: !own.some((o) => o.poste === c.poste),
    rules: plan.add.length + plan.move.length + plan.guard.length,
    moves: followers(states, rules, plannedRules(rules, plan, code), code).reduce((sum, s) => sum + s.n, 0),
  }));
}

const chunks = <T>(list: T[], size = 500) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/**
 * Ajoute au référentiel une catégorie proposée : à son rang, avec ses règles de départ, et les opérations que ces
 * règles classent chez elle (voir `followers`). Rend de quoi l'annuler tant que rien d'autre ne s'en sert.
 */
export async function addStarterCategory(starterId: string): Promise<{ id: string; name: string; rules: number; moves: number; undo: () => Promise<void> }> {
  const { own, got, rules } = await referential();
  const c = proposals(own, got).find((x) => x.id === starterId);
  if (!c) throw new ActionError(404, t("Cette catégorie n'est plus proposée"));
  const kind = starterKind(c.id);
  const code = codeFor(c.id, c.poste, own);
  const rank = insertRank(c, own, got);
  const plan = rulePlan(c.id, rules, codeOf(own, got));
  const moving = followers(await ruleStates(patternsOf(plan)), rules, plannedRules(rules, plan, code), code);

  await exec("UPDATE categories SET sort_order = sort_order + 1 WHERE sort_order >= ?", [rank]);
  await exec("INSERT INTO categories (id, name, group_name, poste, kind, sort_order, description) VALUES (?, ?, ?, ?, ?, ?, ?)", [code, c.name, STARTER_GROUPS[kind], c.poste, kind, rank, c.description ?? null]);
  await saveReceived({ ...got, [c.id]: code });

  for (const pattern of plan.add) await exec("INSERT IGNORE INTO rules (pattern, category_id, priority) VALUES (?, ?, ?)", [pattern, code, STARTER_PRIORITY]);
  for (const pattern of plan.move) await exec("UPDATE rules SET category_id = ? WHERE pattern = ? AND priority = ? AND category_id = ?", [code, pattern, STARTER_PRIORITY, STARTER_RULES_BEFORE[pattern]]);
  for (const [pattern, target] of plan.guard) await exec("INSERT IGNORE INTO rules (pattern, category_id, priority) VALUES (?, ?, ?)", [pattern, target, STARTER_PRIORITY]);

  const moved: { ids: string[]; category_id: string | null; category_source: string | null }[] = [];
  for (const s of moving) {
    const rows =
      s.category_id === null
        ? await q<{ id: string }>(`SELECT t.id FROM transactions t WHERE t.label_key = ? AND ${UNCLASSIFIED}`, [s.label_key])
        : await q<{ id: string }>("SELECT id FROM transactions WHERE label_key = ? AND category_source = 'regle' AND category_id = ?", [s.label_key, s.category_id]);
    const ids = rows.map((r) => r.id);
    for (const part of chunks(ids)) await exec("UPDATE transactions SET category_id = ?, category_source = 'regle' WHERE id IN (?)", [code, part]);
    if (ids.length) moved.push({ ids, category_id: s.category_id, category_source: s.category_id === null ? null : "regle" });
  }

  const undo = async () => {
    // Depuis l'ajout, la catégorie a pu servir : on ne la retire pas sous ce qui la porte.
    const mine = new Set(moved.flatMap((m) => m.ids));
    const patterns = new Set([...plan.add, ...plan.move]);
    const elsewhere = [
      (await q<{ id: string }>("SELECT id FROM transactions WHERE category_id = ?", [code])).some((r) => !mine.has(r.id)),
      (await q<{ pattern: string }>("SELECT pattern FROM rules WHERE category_id = ?", [code])).some((r) => !patterns.has(r.pattern)),
      !!(await one("SELECT 1 AS x FROM transaction_splits WHERE category_id = ? LIMIT 1", [code])),
      !!(await one("SELECT 1 AS x FROM invoice_items WHERE category_id = ? LIMIT 1", [code])),
      !!(await one("SELECT 1 AS x FROM commitments WHERE category_id = ? LIMIT 1", [code])),
      !!(await one("SELECT 1 AS x FROM envelopes WHERE scope = 'categorie' AND ref = ? LIMIT 1", [code])),
    ];
    if (elsewhere.some(Boolean)) throw new ActionError(409, t("Cette catégorie sert déjà : elle est gardée."));
    for (const m of moved) for (const part of chunks(m.ids)) await exec("UPDATE transactions SET category_id = ?, category_source = ? WHERE id IN (?) AND category_id = ?", [m.category_id, m.category_source, part, code]);
    for (const pattern of plan.add) await exec("DELETE FROM rules WHERE pattern = ? AND category_id = ?", [pattern, code]);
    for (const pattern of plan.move) await exec("UPDATE rules SET category_id = ? WHERE pattern = ? AND category_id = ?", [STARTER_RULES_BEFORE[pattern], pattern, code]);
    for (const [pattern, target] of plan.guard) await exec("DELETE FROM rules WHERE pattern = ? AND category_id = ? AND priority = ?", [pattern, target, STARTER_PRIORITY]);
    await exec("DELETE FROM categories WHERE id = ?", [code]);
    await exec("UPDATE categories SET sort_order = sort_order - 1 WHERE sort_order > ?", [rank]);
    const now = await received();
    delete now[c.id];
    await saveReceived(now);
  };

  return { id: code, name: c.name, rules: plan.add.length + plan.move.length + plan.guard.length, moves: moved.reduce((sum, m) => sum + m.ids.length, 0), undo };
}
