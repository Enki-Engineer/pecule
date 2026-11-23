import { Fragment, type ReactNode } from "react";
import { Link } from "react-router";
import { AlertTriangle, Bookmark, Info, Lightbulb, type LucideIcon } from "lucide-react";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";
import { CALLOUT_LABELS, hideOpenMarks, numericCell, parseInline, parseMarkdown, totalRow, type Block, type CalloutKind, type Inline } from "../../lib/markdown.ts";
import "../../styles/assistant.css";

/*
 * Réponses de l'assistant à l'écran : le découpage est dans lib/markdown.ts, les styles dans styles/assistant.css
 * (classes « md-… »). Encadrés colorés, surlignage, montants favorables ou défavorables en couleur, tableaux à
 * en-tête, lignes alternées et total mis en avant.
 */

const CALLOUT_ICON: Record<CalloutKind, LucideIcon> = { important: Bookmark, warning: AlertTriangle, tip: Lightbulb, note: Info };
/** Intitulé d'un encadré, dans la langue de l'écran. */
export const calloutLabel = (kind: CalloutKind) => t(CALLOUT_LABELS[kind]);

function renderInline(parts: Inline[], key: string): ReactNode[] {
  return parts.map((p, i) => {
    const k = `${key}.${i}`;
    if (p.t === "text") return <Fragment key={k}>{p.v}</Fragment>;
    if (p.t === "code") return <code key={k}>{p.v}</code>;
    const inner = renderInline(p.c, k);
    if (p.t === "link")
      // Seuls les chemins de l'appli sont cliquables : un lien extérieur écrit par l'IA (ou soufflé par un document
      // piégé) pourrait emporter des données dans son adresse — il est montré en clair, sans lien.
      return /^\/(?![/\\])/.test(p.href) ? (
        <Link key={k} to={p.href} className="md-link">
          {inner}
        </Link>
      ) : (
        <Fragment key={k}>
          {inner} ({p.href})
        </Fragment>
      );
    if (p.t === "strong") return <strong key={k}>{inner}</strong>;
    if (p.t === "mark") return <mark key={k}>{inner}</mark>;
    if (p.t === "pos" || p.t === "neg")
      return (
        <span key={k} className={p.t === "pos" ? "md-pos" : "md-neg"}>
          {inner}
        </span>
      );
    return <em key={k}>{inner}</em>;
  });
}
const inline = (text: string, key = "i") => renderInline(parseInline(text), key);

const withBreaks = (text: string) =>
  text.split("\n").map((l, i, all) => (
    <Fragment key={i}>
      {inline(l, `l${i}`)}
      {i < all.length - 1 && <br />}
    </Fragment>
  ));

function Table({ b }: { b: Extract<Block, { kind: "table" }> }) {
  // Colonne alignée à droite : demandé par le tableau (« ---: »), ou colonne de chiffres (sauf la première).
  const right = b.head.map((_, k) => b.align[k] === "right" || (b.align[k] !== "center" && k > 0 && b.rows.length > 0 && b.rows.every((r) => !r[k] || numericCell(r[k]))));
  const side = (k: number) => (right[k] ? "md-right" : b.align[k] === "center" ? "md-center" : undefined);
  // Un chiffre ne se coupe pas ; un texte aligné à droite (« À partir de 50 km », dans une comparaison) peut passer à la ligne.
  const cell = (k: number, text: string) => [side(k), numericCell(text) ? "md-digits" : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {b.head.map((h, k) => (
              <th key={k} className={side(k)}>
                {inline(h, `h${k}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, j) => (
            <tr key={j} className={totalRow(r) ? "md-total" : undefined}>
              {b.head.map((_, k) => (
                <td key={k} className={cell(k, r[k] ?? "")}>
                  {inline(r[k] ?? "", `c${j}-${k}`)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "h")
          return (
            <div key={i} role="heading" aria-level={Math.min(6, b.level + 2)} className={cn("md-h", `md-h${b.level}`)}>
              {inline(b.text)}
            </div>
          );
        if (b.kind === "hr") return <hr key={i} className="md-hr" />;
        if (b.kind === "p") return <p key={i}>{withBreaks(b.text)}</p>;
        if (b.kind === "code")
          return (
            <pre key={i} className="md-code">
              {b.text}
            </pre>
          );
        if (b.kind === "quote")
          return (
            <blockquote key={i} className="md-quote md">
              <Blocks blocks={b.blocks} />
            </blockquote>
          );
        if (b.kind === "callout") {
          const Icon = CALLOUT_ICON[b.type];
          return (
            <div key={i} className="md-callout" data-kind={b.type} role="note">
              <Icon size={16} className="md-callout-icon" aria-hidden />
              <div className="min-w-0">
                <div className="md-callout-title">{calloutLabel(b.type)}</div>
                <div className="md">
                  <Blocks blocks={b.blocks} />
                </div>
              </div>
            </div>
          );
        }
        if (b.kind === "list")
          return (
            <div key={i} className="md-list" role="list">
              {b.items.map((it, j) => (
                <div key={j} role="listitem" className="md-item" style={{ paddingLeft: `${it.depth * 18}px` }}>
                  <span className={cn("md-bullet", b.ordered && it.depth === 0 && "md-num")} aria-hidden={!(b.ordered && it.depth === 0)}>
                    {b.ordered && it.depth === 0 ? `${it.n ?? j + 1}.` : it.depth ? "◦" : "•"}
                  </span>
                  <span className="min-w-0">{inline(it.text, `li${j}`)}</span>
                </div>
              ))}
            </div>
          );
        return <Table key={i} b={b} />;
      })}
    </>
  );
}

/** `streaming` : la réponse s'écrit encore (curseur en fin de texte, marque ouverte pas encore fermée masquée). */
export function Markdown({ text, className, streaming }: { text: string; className?: string; streaming?: boolean }) {
  const blocks = parseMarkdown(streaming ? hideOpenMarks(text) : text);
  return (
    <div className={cn("md", streaming && "md-streaming", className)}>
      <Blocks blocks={blocks} />
    </div>
  );
}
