/**
 * Textes à traduire qui manquent aux dictionnaires (src/i18n/<langue>.ts), ou qui n'y servent plus.
 * Usage : pnpm i18n:manquants [--json] [--fichiers a.tsx b.ts]
 *   --json : la liste des textes français manquants, pour les traduire d'un bloc ; --fichiers (en dernier) : ne regarder que ces fichiers
 */
import { collectKeys } from "../src/i18n/collect.ts";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { it } from "../src/i18n/it.ts";

// --fichiers a.tsx b.ts : ne regarder que ces fichiers (traduction d'un écran).
const at = process.argv.indexOf("--fichiers");
const keys = collectKeys("src", at >= 0 ? process.argv.slice(at + 1).filter((a) => !a.startsWith("--")) : undefined);
const all = [...keys.texts, ...keys.plurals.keys()];
const dicts = { en, de, it, es };
if (process.argv.includes("--utilises")) {
  // Tous les textes du code (pour le ménage des dictionnaires).
  console.log(JSON.stringify(all));
} else if (process.argv.includes("--json")) {
  const missing = all.filter((k) => Object.values(dicts).some((d) => !(k in d)));
  console.log(JSON.stringify(missing.map((k) => (keys.plurals.has(k) ? [k, keys.plurals.get(k)] : k)), null, 1));
} else {
  console.log(`${all.length} textes dans le code (${keys.plurals.size} pluriels)`);
  for (const [lang, d] of Object.entries(dicts)) {
    const missing = all.filter((k) => !(k in d));
    const unused = Object.keys(d).filter((k) => !all.includes(k));
    console.log(`${lang} : ${missing.length} manquant(s), ${unused.length} inutile(s)`);
    for (const k of missing.slice(0, 15)) console.log(`   − ${k}`);
    for (const k of unused.slice(0, 15)) console.log(`   + ${k}`);
  }
}
