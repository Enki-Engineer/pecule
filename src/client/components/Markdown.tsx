import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../cn.ts";

/*
 * Markdown des réponses de l'assistant, sans dépendance : titres (#, ##, ###), paragraphes, listes à
 * puces ou numérotées (imbriquées par l'indentation), tableaux (alignement « :--: »), séparateur,
 * citations ; en ligne : **gras**, *italique*, `code`, [lien](/chemin) — interne si le chemin commence par « / ».
 * Tolérant au texte partiel (réponse en cours d'écriture).
 */

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "p"; text: string }
  | { kind: "list"; ordered: boolean; items: { depth: number; text: string; n?: number }[] }
  | { kind: "table"; head: string[]; align: ("left" | "right" | "center")[]; rows: string[][] }
  | { kind: "hr" }
  | { kind: "quote"; text: string };

const LIST = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
const isSep = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

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
    if (/^>\s?/.test(line)) {
      flush();
      out.push({ kind: "quote", text: line.replace(/^>\s?/, "") });
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

/** Éléments en ligne : gras, italique, code, liens. */
function inline(text: string, key = 0): ReactNode[] {
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*(?![\w*])|(?<![\w_])_[^_\s][^_]*_(?![\w_]))/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={`${key}-t${i++}`}>{text.slice(last, m.index)}</Fragment>);
    const tok = m[0];
    const k = `${key}-${i++}`;
    if (tok.startsWith("**")) parts.push(<strong key={k}>{inline(tok.slice(2, -2), i)}</strong>);
    else if (tok.startsWith("`")) parts.push(<code key={k} className="rounded bg-bg px-1 py-0.5 text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok)!;
      parts.push(
        // Seuls les chemins de l'appli sont cliquables : un lien extérieur écrit par l'IA (ou soufflé par un document
        // piégé) pourrait emporter des données dans son adresse — il est montré en clair, sans lien.
        /^\/(?![/\\])/.test(lm[2]) ? (
          <Link key={k} to={lm[2]} className="text-accent underline-offset-2 hover:underline">
            {lm[1]}
          </Link>
        ) : (
          <Fragment key={k}>
            {lm[1]} ({lm[2]})
          </Fragment>
        ),
      );
    } else parts.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) parts.push(<Fragment key={`${key}-end`}>{text.slice(last)}</Fragment>);
  return parts;
}

const withBreaks = (text: string) =>
  text.split("\n").map((l, i, all) => (
    <Fragment key={i}>
      {inline(l, i)}
      {i < all.length - 1 && <br />}
    </Fragment>
  ));

/** Signe ou code d'une devise, tel que l'assistant l'écrit dans la devise du foyer (« € », « $ », « CHF », « CA$ », « zł »). */
const CURRENCY = "(?:€|£|¥|₹|₩|₺|₪|[A-Z]{3}|[A-Z]{0,2}\\$|zł|Kč|kr|Ft|lei)";
const NUMERIC = new RegExp(`^[-+−]?\\s?(?:${CURRENCY}\\s?)?\\d[\\d\\s'’.,]*\\s?(?:%|[kM]?\\s?${CURRENCY})?$`);
const numeric = (s: string) => NUMERIC.test(s.replace(/\*\*/g, "").trim());

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className={cn("space-y-2", className)}>
      {blocks.map((b, i) => {
        if (b.kind === "h")
          return (
            <div key={i} className={cn("font-semibold", b.level <= 2 ? "pt-1 text-[1.05em]" : "pt-0.5")}>
              {inline(b.text)}
            </div>
          );
        if (b.kind === "hr") return <hr key={i} className="border-line" />;
        if (b.kind === "quote")
          return (
            <div key={i} className="border-l-2 border-line pl-3 text-muted">
              {inline(b.text)}
            </div>
          );
        if (b.kind === "p") return <p key={i}>{withBreaks(b.text)}</p>;
        if (b.kind === "list")
          return (
            <div key={i} className="space-y-1">
              {b.items.map((it, j) => (
                <div key={j} className="flex gap-2" style={{ paddingLeft: `${it.depth * 16 + 2}px` }}>
                  <span className={cn("shrink-0 text-muted", b.ordered && it.depth === 0 && "tnum min-w-[1.2em] text-right")}>
                    {b.ordered && it.depth === 0 ? `${it.n ?? j + 1}.` : it.depth ? "◦" : "•"}
                  </span>
                  <span className="min-w-0">{inline(it.text, j)}</span>
                </div>
              ))}
            </div>
          );
        return (
          <div key={i} className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-collapse text-[0.9em]">
              <thead>
                <tr className="border-b border-line">
                  {b.head.map((h, j) => (
                    <th key={j} className={cn("whitespace-nowrap px-2 py-1.5 text-[0.85em] font-medium uppercase tracking-wide text-muted", (b.align[j] === "right" || (b.align[j] !== "center" && b.rows.every((r) => !r[j] || numeric(r[j])) && j > 0)) ? "text-right" : b.align[j] === "center" ? "text-center" : "text-left")}>
                      {inline(h)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-b border-line last:border-0">
                    {b.head.map((_, k) => {
                      const cell = r[k] ?? "";
                      const right = b.align[k] === "right" || (b.align[k] !== "center" && k > 0 && b.rows.every((x) => !x[k] || numeric(x[k])));
                      return (
                        <td key={k} className={cn("px-2 py-1.5 align-top", right ? "tnum whitespace-nowrap text-right" : b.align[k] === "center" ? "text-center" : "")}>
                          {inline(cell, k)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
