/*
 * Markdown des réponses de l'assistant, sans dépendance : découpage en blocs et en éléments de ligne (fonctions
 * pures, l'écran les dessine dans components/Markdown.tsx).
 *
 * Blocs : titres (#, ##, ###), paragraphes, listes à puces ou numérotées (imbriquées par l'indentation), tableaux
 * (alignement « :--: »), séparateur, citations (plusieurs lignes « > » forment un seul bloc), bloc de code (```),
 * encadrés « > [!IMPORTANT] », « > [!WARNING] », « > [!TIP] », « > [!NOTE] » (ce qu'il faut retenir, un risque,
 * un conseil, une précision).
 * En ligne : **gras**, *italique*, `code`, [lien](/chemin), ==surlignage==, {+favorable+} (vert), {-défavorable-} (rouge).
 * Tolérant au texte partiel (réponse en cours d'écriture).
 */

export type CalloutKind = "important" | "warning" | "tip" | "note";

export type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; ordered: boolean; items: { depth: number; text: string; n?: number }[] }
  | { kind: "table"; head: string[]; align: ("left" | "right" | "center")[]; rows: string[][] }
  | { kind: "hr" }
  | { kind: "quote"; blocks: Block[] }
  | { kind: "callout"; type: CalloutKind; blocks: Block[] }
  | { kind: "code"; text: string };

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "mark" | "pos" | "neg"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] };

const LIST = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?/;
const FENCE = /^\s{0,3}```/;
const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

/** Sans accents ni casse : pour reconnaître un mot-clé ou chercher dans un texte. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Mots-clés d'un encadré (ceux de GitHub, et leurs équivalents français). */
const CALLOUTS: Record<string, CalloutKind> = {
  important: "important",
  "a retenir": "important",
  retenir: "important",
  essentiel: "important",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  danger: "warning",
  tip: "tip",
  conseil: "tip",
  astuce: "tip",
  success: "tip",
  note: "note",
  info: "note",
};
const CALLOUT = /^\[!([^\]\n]{2,20})\]\s*(.*)$/;

export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      // Jusqu'à la fermeture, ou jusqu'à la fin tant que la réponse s'écrit.
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) code.push(lines[i]);
      out.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      out.push({ kind: "h", level: h[1].length, text: h[2] });
      continue;
    }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      flush();
      out.push({ kind: "hr" });
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isSep(lines[i + 1])) {
      flush();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left")) as ("left" | "right" | "center")[];
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) rows.push(splitRow(lines[i++]));
      i--;
      out.push({ kind: "table", head, align, rows });
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]); i++) inner.push(lines[i].replace(QUOTE, ""));
      i--;
      const mark = CALLOUT.exec(inner[0].trim());
      const type = mark ? CALLOUTS[fold(mark[1]).trim()] : undefined;
      if (mark && type) out.push({ kind: "callout", type, blocks: parseMarkdown([mark[2], ...inner.slice(1)].join("\n")) });
      else out.push({ kind: "quote", blocks: parseMarkdown(inner.join("\n")) });
      continue;
    }
    const li = LIST.exec(line);
    if (li) {
      flush();
      const ordered = /\d/.test(li[2]);
      const item = { depth: Math.floor(li[1].replace(/\t/g, "  ").length / 2), text: li[3], n: ordered ? Number.parseInt(li[2], 10) : undefined };
      const last = out.at(-1);
      if (last?.kind === "list" && (last.ordered === ordered || item.depth > 0)) last.items.push(item);
      else out.push({ kind: "list", ordered, items: [item] });
      continue;
    }
    // Ligne de continuation d'un élément de liste (indentée) : rattachée à l'élément.
    const prev = out.at(-1);
    if (!para.length && prev?.kind === "list" && /^\s{2,}\S/.test(line)) {
      prev.items[prev.items.length - 1].text += ` ${line.trim()}`;
      continue;
    }
    para.push(line);
  }
  flush();
  return out;
}

const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|==(?=\S)[^=\n]*[^=\s]==|\{\+[^{}\n]+?\+\}|\{-[^{}\n]+?-\}|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|(?<![\w_])_[^_\s][^_]*_(?![\w_]))/g;

/** Éléments en ligne : gras, italique, code, liens, surlignage, couleur. */
export function parseInline(text: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const tok = m[0];
    if (m.index > last) parts.push({ t: "text", v: text.slice(last, m.index) });
    if (tok.startsWith("**")) parts.push({ t: "strong", c: parseInline(tok.slice(2, -2)) });
    else if (tok.startsWith("`")) parts.push({ t: "code", v: tok.slice(1, -1) });
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      parts.push({ t: "link", href: lm[2], c: parseInline(lm[1]) });
    } else if (tok.startsWith("==")) parts.push({ t: "mark", c: parseInline(tok.slice(2, -2)) });
    else if (tok.startsWith("{+")) parts.push({ t: "pos", c: parseInline(tok.slice(2, -2).trim()) });
    else if (tok.startsWith("{-")) parts.push({ t: "neg", c: parseInline(tok.slice(2, -2).trim()) });
    else parts.push({ t: "em", c: parseInline(tok.slice(1, -1)) });
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push({ t: "text", v: text.slice(last) });
  return parts;
}

/** Texte d'une ligne sans ses marques (gras, couleur, surlignage, code) ; un lien garde son intitulé. */
const leafText = (p: Inline): string => (p.t === "text" || p.t === "code" ? p.v : p.c.map(leafText).join(""));
export const inlineText = (text: string): string => parseInline(text).map(leafText).join("");

/**
 * Pendant l'écriture d'une réponse : une marque de couleur ou de surlignage ouverte mais pas encore fermée
 * (« {+12 » en fin de texte) ne s'affiche pas en clair.
 */
export const hideOpenMarks = (text: string) => text.replace(/(\{[+-]|==)(?=[^{}=\n]*$)/, "");

/**
 * Texte brut d'une réponse (copie, aperçu d'une notification) : sans gras, couleur ni surlignage ; un encadré
 * commence par son intitulé (`label`), un lien devient « intitulé (adresse) » — `origin` complète un chemin de l'appli.
 */
export function plainMarkdown(md: string, o: { label?: (kind: CalloutKind) => string; origin?: string } = {}): string {
  return md
    .replace(/\r/g, "")
    .split("\n")
    .map((raw) => {
      let line = raw;
      if (QUOTE.test(line)) {
        line = line.replace(QUOTE, "");
        const mark = CALLOUT.exec(line.trim());
        const type = mark ? CALLOUTS[fold(mark[1]).trim()] : undefined;
        if (mark && type) line = [o.label ? `${o.label(type)} :` : "", mark[2]].filter(Boolean).join(" ");
      }
      return line
        .replace(/^(\s*)#{1,6}\s+/, "$1")
        .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => (o.origin === undefined ? label : `${label} (${/^\/(?![/\\])/.test(url) ? o.origin : ""}${url})`))
        .replace(/\{\+\s*([^{}\n]+?)\s*\+\}/g, "$1")
        .replace(/\{-\s*([^{}\n]+?)\s*-\}/g, "$1")
        .replace(/==(?=\S)([^=\n]*[^=\s])==/g, "$1")
        .replace(/\*\*([^*\n]+)\*\*/g, "$1")
        .replace(/(^|[\s(«])\*([^*\n]+)\*(?=[\s).,;:!?»]|$)/g, "$1$2")
        .replace(/`([^`\n]+)`/g, "$1");
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Signe ou code d'une devise, tel que l'assistant l'écrit dans la devise du foyer (« € », « $ », « CHF », « CA$ », « zł »). */
const CURRENCY = "(?:€|£|¥|₹|₩|₺|₪|[A-Z]{3}|[A-Z]{0,2}\\$|zł|Kč|kr|Ft|lei)";
const NUMERIC = new RegExp(`^[-+−]?\\s?(?:${CURRENCY}\\s?)?\\d[\\d\\s'’.,]*\\s?(?:%|[kM]?\\s?${CURRENCY})?$`);
/** Une cellule de tableau qui ne contient qu'un nombre, un montant ou un pourcentage (alignée à droite). */
export const numericCell = (s: string) => NUMERIC.test(inlineText(s).trim());

/** Une ligne de total (« Total », « **Total général** », « Somme »…) : mise en avant en bas d'un tableau. */
export const totalRow = (row: string[]) => /^(total|totaux|somme|sous-total|summe|gesamt|insgesamt|totale|suma|subtotal|sum)\b/.test(fold(inlineText(row[0] ?? "")).trim());
