/*
 * Langues de Pécule : français (langue d'écriture du code), anglais, allemand, italien, espagnol.
 *
 * Le texte français est la clé : `t("Je t'écoute")` rend la traduction de la langue courante, et le français
 * lui-même quand elle manque — un écran pas encore traduit reste simplement en français. Les dictionnaires
 * (`src/i18n/<langue>.ts`) associent chaque texte français à sa traduction ; un test vérifie qu'aucun texte
 * passé à `t` ou `tn` n'y manque.
 *
 * - `t("Bonjour {nom}", { nom })` : texte avec variables entre accolades ;
 * - `tn("{n} opération", "{n} opérations", n)` : singulier ou pluriel selon la langue (`{n}` = le nombre) ;
 * - `t("Mois##menu")` : même texte français, sens différent — ce qui suit « ## » ne s'affiche jamais ;
 * - `td(categorie.name)` : nom d'une catégorie ou d'un poste (donnée traduite à l'affichage, voir plus bas) ;
 * - `tk("Recherche…")` : marque un texte écrit au chargement d'un module (il sera traduit par `t(variable)`
 *   là où il est rendu : sur le serveur, la langue n'est connue que pendant la requête).
 *
 * La langue courante vient d'un résolveur : une constante sur l'appareil (posée avant le premier rendu),
 * le contexte de la requête sur le serveur. Module pur : aucun accès au réseau ni au stockage.
 */

export const LANGS = [
  { id: "fr", label: "Français", locale: "fr-FR", french: "français" },
  { id: "en", label: "English", locale: "en-GB", french: "anglais" },
  { id: "de", label: "Deutsch", locale: "de-DE", french: "allemand" },
  { id: "it", label: "Italiano", locale: "it-IT", french: "italien" },
  { id: "es", label: "Español", locale: "es-ES", french: "espagnol" },
] as const;
export type Lang = (typeof LANGS)[number]["id"];
export const LANG_IDS = LANGS.map((l) => l.id) as [Lang, ...Lang[]];
export const DEFAULT_LANG: Lang = "fr";
export const isLang = (v: unknown): v is Lang => LANGS.some((l) => l.id === v);
export const langInfo = (lang: Lang) => LANGS.find((l) => l.id === lang)!;

/** Traduction d'un texte : une chaîne, ou [singulier, pluriel] pour `tn`. */
export type Entry = string | readonly [one: string, other: string];
export type Dict = Readonly<Record<string, Entry>>;

const dicts: Partial<Record<Lang, Dict>> = {};
/** Met un dictionnaire à disposition (appareil : celui de la langue choisie ; serveur : tous). */
export function registerDict(lang: Lang, dict: Dict) {
  dicts[lang] = dict;
}

let resolver: () => Lang = () => DEFAULT_LANG;
/** Branche la langue courante (constante sur l'appareil, contexte de la requête sur le serveur). */
export function setLangResolver(fn: () => Lang) {
  resolver = fn;
}
export const currentLang = (): Lang => resolver();
/** Format des nombres et des dates (« fr-FR », « en-GB »…). */
export const locale = (lang: Lang = currentLang()): string => langInfo(lang).locale;

const fill = (text: string, vars?: Record<string, string | number>) => (vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text);
const visible = (text: string) => {
  const i = text.indexOf("##");
  return i < 0 ? text : text.slice(0, i);
};

/** Traduit dans une langue donnée (le français d'origine si la traduction manque). */
export function translate(lang: Lang, text: string, vars?: Record<string, string | number>): string {
  const entry = lang === "fr" ? undefined : dicts[lang]?.[text];
  return fill(typeof entry === "string" ? entry : visible(text), vars);
}

const rules = new Map<Lang, Intl.PluralRules>();
const isOne = (lang: Lang, n: number) => {
  let r = rules.get(lang);
  if (!r) rules.set(lang, (r = new Intl.PluralRules(langInfo(lang).locale)));
  return r.select(n) === "one";
};

/** Singulier ou pluriel dans une langue donnée, selon ses propres règles (en français, 0 et 1 sont au singulier). */
export function translatePlural(lang: Lang, one: string, other: string, n: number, vars?: Record<string, string | number>): string {
  const entry = lang === "fr" ? undefined : dicts[lang]?.[one];
  const [a, b] = Array.isArray(entry) ? entry : [visible(one), visible(other)];
  return fill(isOne(lang, n) ? a : b, { n, ...vars });
}

/** Texte dans la langue courante. */
export const t = (text: string, vars?: Record<string, string | number>): string => translate(resolver(), text, vars);
/** Singulier ou pluriel dans la langue courante. */
export const tn = (one: string, other: string, n: number, vars?: Record<string, string | number>): string => translatePlural(resolver(), one, other, n, vars);
/*
 * Noms de données traduits à l'affichage : catégories et postes. Ce ne sont pas des textes du code mais des
 * données de la famille, écrites dans la langue de celui qui les a créées ; leurs traductions vivent en base
 * (table `data_translations`) et arrivent par `GET /api/i18n/data`. `td(nom)` rend le nom dans la langue
 * courante ; à défaut la traduction du texte (les repères « À classer », « Autres postes », marqués `tk`), puis
 * le nom tel qu'il est écrit. Le nom d'origine reste l'identifiant :
 * on ne traduit qu'au moment d'afficher, jamais ce qu'on compare, filtre ou renvoie au serveur.
 */
const data: Partial<Record<Lang, Readonly<Record<string, string>>>> = {};
export function registerData(lang: Lang, names: Readonly<Record<string, string>>) {
  data[lang] = names;
}
/** Nom d'une catégorie ou d'un poste dans une langue donnée. */
// Sans traduction de donnée : le dictionnaire des textes (un repère comme « À classer » tient lieu de poste), puis le nom tel quel.
export const translateData = (lang: Lang, name: string): string => data[lang]?.[name] ?? translate(lang, name);
/** Nom d'une catégorie ou d'un poste dans la langue courante (null et undefined passent tels quels). */
export function td<T extends string | null | undefined>(name: T): T {
  return (name ? translateData(resolver(), name) : name) as T;
}

/** Marque un texte à traduire plus tard par `t(variable)` (constante de module partagée avec le serveur) : rend le texte tel quel. */
export const tk = (text: string): string => text;

/**
 * Table de libellés traduite à la lecture : chaque valeur, écrite en français et marquée `tk`, est rendue dans la
 * langue courante au moment où on la lit — une constante de module partagée avec le serveur reste ainsi juste
 * dans toutes les langues, sans rien changer chez ceux qui la lisent (`LABELS[code]`, `Object.entries(LABELS)`).
 */
export function labels<K extends string>(map: Readonly<Record<K, string>>): Readonly<Record<K, string>> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(map) as K[]) Object.defineProperty(out, k, { enumerable: true, get: () => t(map[k]) });
  return out;
}
/** Même principe pour un objet : les champs texte nommés sont traduits à la lecture, le reste est recopié. */
export function localized<T extends object>(obj: T, ...keys: (keyof T)[]): T {
  const out = { ...obj };
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string") Object.defineProperty(out, k, { enumerable: true, get: () => t(v) });
  }
  return out;
}
