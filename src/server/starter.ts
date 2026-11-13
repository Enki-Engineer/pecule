import { saveDataNames } from "./data-i18n.ts";
import { exec, one } from "./db.ts";
import { STARTER_CATEGORIES, STARTER_GROUPS, STARTER_NAMES, STARTER_RULES, starterKind } from "../lib/starter.ts";

/**
 * Installation neuve : charge le référentiel de départ (catégories, traductions de leurs noms, règles pour les
 * grandes enseignes) quand la base n'a encore aucune catégorie. Une base qui a déjà les siennes n'est jamais
 * touchée : le référentiel appartient au foyer.
 */
export async function seedStarter(): Promise<{ categories: number; rules: number } | null> {
  const existing = await one<{ n: number }>("SELECT COUNT(*) AS n FROM categories");
  if (existing?.n) return null;
  for (const [i, c] of STARTER_CATEGORIES.entries()) {
    const kind = starterKind(c.id);
    await exec("INSERT IGNORE INTO categories (id, name, group_name, poste, kind, sort_order, description) VALUES (?, ?, ?, ?, ?, ?, ?)", [c.id, c.name, STARTER_GROUPS[kind], c.poste, kind, i, c.description ?? null]);
  }
  await saveDataNames(
    Object.entries(STARTER_NAMES).flatMap(([source, t]) => [
      { source, lang: "fr" as const, text: source },
      { source, lang: "en" as const, text: t.en },
      { source, lang: "de" as const, text: t.de },
      { source, lang: "it" as const, text: t.it },
      { source, lang: "es" as const, text: t.es },
    ]),
    false,
  );
  let rules = 0;
  if (!(await one<{ n: number }>("SELECT COUNT(*) AS n FROM rules"))?.n)
    for (const [pattern, categoryId] of STARTER_RULES) rules += (await exec("INSERT IGNORE INTO rules (pattern, category_id, priority) VALUES (?, ?, 200)", [pattern, categoryId])).affectedRows;
  return { categories: STARTER_CATEGORIES.length, rules };
}
