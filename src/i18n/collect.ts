import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * Relevé des textes à traduire : tous les textes français passés à `t`, `tr` (nom de `t` là où une variable
 * s'appelle déjà `t`), `tk` et `tn` dans le code. Sert au test de complétude des dictionnaires et à
 * `pnpm i18n:manquants`. Outil de développement : jamais importé par l'appli ni par le serveur.
 */

export type Keys = { texts: Set<string>; plurals: Map<string, string> };

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const SIMPLE = new RegExp(String.raw`(?<![\w.])(?:t|tr|tk)\(\s*${STR}`, "g");
const PLURAL = new RegExp(String.raw`(?<![\w.])tn\(\s*${STR}\s*,\s*${STR}`, "g");

function* files(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) yield full;
  }
}

/** Dossier du texte du manuel (src/lib/manual.ts) : ses traductions vivent à part, voir `manualOnlyKeys`. */
export const MANUAL_DIR = path.join("src", "lib", "manual");
const inManual = (file: string) => file.startsWith(MANUAL_DIR + path.sep);

/**
 * Textes qui ne servent qu'au manuel : leurs traductions sont rangées dans `src/i18n/manual/<langue>.ts`, que
 * l'appareil ne charge qu'en ouvrant le manuel. Un texte du manuel que le reste du code emploie aussi (le nom d'un
 * bouton pris pour titre d'article) reste dans le dictionnaire de l'appli.
 */
export function manualOnlyKeys(root = "src"): Set<string> {
  const all = [...files(root)];
  const manual = collectKeys(root, all.filter(inManual));
  const rest = collectKeys(root, all.filter((f) => !inManual(f)));
  return new Set([...manual.texts, ...manual.plurals.keys()].filter((k) => !rest.texts.has(k) && !rest.plurals.has(k)));
}

/** `only` : ne relever que ces fichiers (chemins depuis la racine du dépôt). */
export function collectKeys(root = "src", only?: string[]): Keys {
  const texts = new Set<string>();
  const plurals = new Map<string, string>();
  for (const file of only ?? files(root)) {
    // Ni les dictionnaires, ni le module de traduction lui-même (ses exemples ne sont pas des textes de l'appli).
    if (file.startsWith(path.join(root, "i18n")) || file === path.join(root, "lib", "i18n.ts")) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(SIMPLE)) texts.add(JSON.parse(`"${m[1]}"`) as string);
    for (const m of source.matchAll(PLURAL)) plurals.set(JSON.parse(`"${m[1]}"`) as string, JSON.parse(`"${m[2]}"`) as string);
  }
  return { texts, plurals };
}

/** Variables entre accolades d'un texte, triées. */
export const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
