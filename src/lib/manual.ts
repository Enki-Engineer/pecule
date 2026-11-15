import { currentLang, dictEntry, translate, type Lang } from "./i18n.ts";
import { fold } from "./markdown.ts";
import type { ModuleId } from "./modules.ts";
import { MANUAL } from "./manual/index.ts";

/*
 * Manuel de Pécule : des thèmes, et dans chaque thème des articles. Le même contenu (src/lib/manual/, un fichier par thème)
 * sert à l'écran « Manuel » (/manuel) et à l'assistant, qui y cherche avant de répondre à une question sur l'appli.
 *
 * Un article est écrit en français, texte par texte (`tk`), et affiché dans la langue du membre comme le reste de
 * l'appli. Le nom d'un bouton, d'un menu ou d'un écran s'y écrit « [[Réglages]] » : c'est le texte français que
 * le code passe à `t()`, remplacé à l'affichage par ce que l'écran montre dans la langue du membre — le manuel ne
 * peut donc pas nommer un bouton autrement que l'appli, dans aucune langue (un test vérifie que chaque nom existe).
 * Les adresses ([texte](/chemin)) sont celles de l'appli : l'écran en fait des liens.
 */

/** Écran ou réglage dont parle un article : son adresse, et son nom tel qu'on le lit à l'écran (« Réglages → Apparence »). */
export type ManualLink = { to: string; label: string[] };
/** Bloc d'un article : un paragraphe (Markdown en ligne), des étapes numérotées, une liste, ou un encadré. */
export type ManualBlock = string | { steps: string[] } | { list: string[] } | { tip: string } | { note: string } | { warning: string };
export type ManualArticle = {
  /** Identifiant stable : l'adresse de l'article (/manuel/<id>) et ce que l'assistant demande à lire. */
  id: string;
  title: string;
  /** Une phrase : ce que l'article permet de faire (liste des articles, résultats de recherche). */
  summary: string;
  body: ManualBlock[];
  /** Écrans et réglages à ouvrir. */
  links?: ManualLink[];
  /** Mots de recherche qui ne sont pas dans le texte (synonymes, façons de le demander). */
  words?: string;
  /** Article d'un écran facultatif (src/lib/modules.ts) : signalé quand le foyer a retiré l'écran. */
  module?: ModuleId;
};
export type ManualTheme = { id: string; title: string; hint: string; articles: ManualArticle[] };

export { MANUAL };

const NAME = /\[\[([^[\]]+)\]\]/g;
/** Noms d'éléments de l'écran cités dans un texte (« [[Synchroniser]] » → « Synchroniser »). */
export const manualNames = (text: string): string[] => [...text.matchAll(NAME)].map((m) => m[1]);
/** Adresses de l'appli citées dans un texte ([texte](/chemin)). */
export const manualTargets = (text: string): string[] => [...text.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);

/** Un texte du manuel dans une langue : traduit, puis chaque nom d'élément remplacé par celui de l'écran (en gras si `bold`). */
export function manualText(text: string, lang: Lang = currentLang(), bold = true): string {
  // Le texte entier n'est pas un libellé : ce qui suit « ## » dans un nom d'élément (« [[Mois##menu]] ») ne doit pas le couper.
  const entry = dictEntry(lang, text);
  return (typeof entry === "string" ? entry : text).replace(NAME, (_m, key: string) => (bold ? `**${translate(lang, key)}**` : translate(lang, key)));
}

/** Nom d'un écran ou d'un réglage tel qu'on le lit (« Réglages → Apparence »). */
export const linkLabel = (link: ManualLink, lang: Lang = currentLang()): string => link.label.map((k) => translate(lang, k)).join(" → ");

/** Tous les textes d'un bloc, dans l'ordre. */
export function blockTexts(b: ManualBlock): string[] {
  if (typeof b === "string") return [b];
  if ("steps" in b) return b.steps;
  if ("list" in b) return b.list;
  return ["tip" in b ? b.tip : "note" in b ? b.note : b.warning];
}

/** Un bloc en Markdown (celui que dessine components/Markdown.tsx et que lit l'assistant). */
function blockMarkdown(b: ManualBlock, lang: Lang): string {
  const tx = (s: string) => manualText(s, lang);
  if (typeof b === "string") return tx(b);
  if ("steps" in b) return b.steps.map((s, i) => `${i + 1}. ${tx(s)}`).join("\n");
  if ("list" in b) return b.list.map((s) => `- ${tx(s)}`).join("\n");
  const [kind, text] = "tip" in b ? ["TIP", b.tip] : "note" in b ? ["NOTE", b.note] : ["WARNING", b.warning];
  return `> [!${kind}]\n> ${tx(text)}`;
}

/** Corps d'un article en Markdown, dans une langue. */
export const articleBody = (a: ManualArticle, lang: Lang = currentLang()): string => a.body.map((b) => blockMarkdown(b, lang)).join("\n\n");

/** Article entier en Markdown (titre, résumé, corps, écrans à ouvrir) : ce que l'assistant lit. */
export function articleMarkdown(a: ManualArticle, lang: Lang = currentLang()): string {
  const links = a.links?.length ? `\n\n${a.links.map((l) => `[${linkLabel(l, lang)}](${l.to})`).join(" · ")}` : "";
  return `## ${manualText(a.title, lang, false)}\n${manualText(a.summary, lang, false)}\n\n${articleBody(a, lang)}${links}`;
}

export type ManualEntry = { theme: ManualTheme; article: ManualArticle };
const ENTRIES: ManualEntry[] = MANUAL.flatMap((theme) => theme.articles.map((article) => ({ theme, article })));
const BY_ID = new Map(ENTRIES.map((e) => [e.article.id, e]));

export const manualEntries = (): readonly ManualEntry[] => ENTRIES;
export const findArticle = (id: string): ManualEntry | undefined => BY_ID.get(id);

/* ---------- Recherche ---------- */

type Indexed = { entry: ManualEntry; title: string; words: string; summary: string; body: string };
const indexes = new Map<Lang, Indexed[]>();

function indexOf(lang: Lang): Indexed[] {
  let index = indexes.get(lang);
  if (!index) {
    const plain = (s: string) => fold(manualText(s, lang, false));
    index = ENTRIES.map((entry) => ({
      entry,
      title: plain(entry.article.title),
      words: `${entry.article.words ? plain(entry.article.words) : ""} ${plain(entry.theme.title)} ${(entry.article.links ?? []).map((l) => fold(linkLabel(l, lang))).join(" ")}`,
      summary: plain(entry.article.summary),
      body: entry.article.body.flatMap(blockTexts).map(plain).join("\n"),
    }));
    indexes.set(lang, index);
  }
  return index;
}

/** Mots d'une recherche : sans accents ni casse, sans les mots d'une ou deux lettres, pluriel simple retiré. */
export const searchWords = (query: string): string[] => [
  ...new Set(
    fold(query)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length > 2)
      .map((w) => (w.length > 4 ? w.replace(/[sx]$/, "") : w)),
  ),
];

/** Poids d'un mot selon l'endroit où il est trouvé : le titre compte plus que le corps. */
const WEIGHTS: [keyof Omit<Indexed, "entry">, number][] = [
  ["title", 10],
  ["words", 6],
  ["summary", 4],
  ["body", 1.5],
];

export type ManualHit = ManualEntry & { score: number };

/**
 * Articles qui répondent à une recherche, les meilleurs d'abord. Chaque mot compte d'autant plus qu'il est rare
 * dans le manuel (un mot présent partout, « comment », « pour », ne pèse presque rien : une question entière se
 * cherche comme quelques mots-clés) et qu'il est trouvé dans le titre plutôt que dans le corps. Ne restent que les
 * articles assez proches du meilleur. `langs` : chercher dans plusieurs langues à la fois (l'assistant formule sa
 * recherche en français ou dans la langue du membre).
 */
export function searchManual(query: string, { limit = 8, langs = [currentLang()] }: { limit?: number; langs?: Lang[] } = {}): ManualHit[] {
  const words = searchWords(query);
  if (!words.length) return [];
  const scores = new Map<string, ManualHit>();
  for (const lang of new Set(langs)) {
    const index = indexOf(lang);
    const found = words.map((w) => index.map((a) => WEIGHTS.find(([field]) => a[field].includes(w))?.[1] ?? 0));
    const rarity = found.map((per) => {
      const df = per.filter(Boolean).length;
      return df ? Math.log(1 + index.length / df) : 0;
    });
    index.forEach((a, i) => {
      let score = 0;
      let matched = 0;
      found.forEach((per, w) => {
        if (per[i]) matched++;
        score += per[i] * rarity[w];
      });
      // Tous les mots trouvés dans le même article : il passe devant ceux qui n'en ont qu'une partie.
      if (matched === words.length && words.length > 1) score *= 1.5;
      const known = scores.get(a.entry.article.id);
      if (score > 0 && (!known || score > known.score)) scores.set(a.entry.article.id, { ...a.entry, score });
    });
  }
  const hits = [...scores.values()].sort((a, b) => b.score - a.score);
  const floor = (hits[0]?.score ?? 0) * 0.3;
  return hits.filter((h) => h.score >= floor).slice(0, limit);
}

/** Sommaire en français pour les consignes de l'assistant : un thème par ligne de titre, puis « id — titre ». */
export function manualOutline(): string {
  return MANUAL.map((th) => `${th.title} :\n${th.articles.map((a) => `- ${a.id} — ${manualText(a.title, "fr", false)}`).join("\n")}`).join("\n");
}
