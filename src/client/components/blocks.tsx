import type { ReactNode } from "react";
import { Link } from "react-router";
import { FileText, FolderOpen } from "lucide-react";
import { Card } from "./ui.tsx";
import { cn } from "../cn.ts";
import { useMedia } from "../useMedia.ts";
import { dateFr } from "../format.ts";
import { KIND_LABELS } from "../../lib/documents.ts";
import { HoverPreview } from "./HoverPreview.tsx";
import { locale } from "../../lib/i18n.ts";

/* Briques communes des écrans de situation (immobilier, budget, impôts, retraite, projections). */

/** Tuile de chiffre clé. */
export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <Card className="@container p-4 2xl:p-5">
      <div className="text-[14px] text-muted @[150px]:text-[15px]">{label}</div>
      <div className={cn("figure mt-1.5 text-[21px] @[140px]:text-[24px] @[180px]:text-[28px]", tone === "pos" && "text-pos", tone === "neg" && "text-neg")}>{value}</div>
      {hint && <div className="mt-1.5 text-[12.5px] text-muted">{hint}</div>}
    </Card>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-5 flex items-end justify-between px-1">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{children}</h2>
      {right}
    </div>
  );
}

/** Valeur d'un fait mise en forme : date au format français, unités « date » / « année » non affichées. */
export function factValue(value: string, unit?: string | null) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dateFr(value);
  if (!unit || unit === "date" || unit === "année" || unit === "texte") return value;
  if (/^-?\d+(\.\d+)?$/.test(value)) return `${Number(value).toLocaleString(locale(), { maximumFractionDigits: 4 })} ${unit}`;
  return `${value} ${unit}`;
}

/** Faits clés (libellé → valeur), repris de Notion ou saisis. */
export function FactsCard({ facts }: { facts: { label: string; value: string; unit?: string | null; as_of?: string | null }[] }) {
  if (!facts.length) return null;
  return (
    <Card className="divide-y divide-line">
      {facts.map((f, i) => (
        <div key={i} className="flex justify-between gap-4 px-4 py-2 text-sm">
          <span className="text-muted">{f.label}</span>
          <span className="text-right font-medium">{factValue(f.value, f.unit)}</span>
        </div>
      ))}
    </Card>
  );
}

/** Liste de documents du coffre, vers leur fiche. */
export function DocList({ docs, empty }: { docs: { id: number; title: string; kind: string; doc_date: string | null }[]; empty?: string }) {
  if (!docs.length) return empty ? <div className="px-1 text-sm text-muted">{empty}</div> : null;
  return (
    <Card className="divide-y divide-line">
      {docs.map((d) => (
        <HoverPreview key={d.id} target={{ kind: "document", id: d.id }} className="block">
        <Link to={`/documents?id=${d.id}`} className="press flex items-center gap-3 px-4 py-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">{d.kind === "fiche" ? <FolderOpen size={15} /> : <FileText size={15} />}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px]">{d.title}</span>
            <span className="block text-xs text-muted">
              {KIND_LABELS[d.kind] ?? d.kind}
              {d.doc_date && ` · ${dateFr(d.doc_date)}`}
            </span>
          </span>
        </Link>
        </HoverPreview>
      ))}
    </Card>
  );
}

/** Barre de progression simple (0..1). */
export function Progress({ value, className }: { value: number; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-line", className)}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

/**
 * Tableau compact : vrai tableau sur ordinateur ; sur iPhone, une carte par ligne (première colonne
 * en titre, dernière valeur forte à droite, les autres en grille libellé / valeur) — plus de
 * défilement horizontal.
 */
export function Table({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ("left" | "right")[] }) {
  const desktop = useMedia("(min-width: 768px)");
  if (!desktop)
    return (
      <Card className="divide-y divide-line">
        {rows.map((r, i) => (
          <div key={i} className="px-4 py-3">
            <div className="text-[15px] font-semibold">{r[0]}</div>
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px]">
              {r.slice(1).map((c, j) =>
                head[j + 1] ? (
                  <div key={j} className="flex min-w-0 justify-between gap-2">
                    <span className="truncate text-muted">{head[j + 1]}</span>
                    <span className="tnum shrink-0 text-right">{c}</span>
                  </div>
                ) : (
                  <div key={j} className="text-right">
                    {c}
                  </div>
                ),
              )}
            </div>
          </div>
        ))}
      </Card>
    );
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => (
              <th key={i} className={cn("px-3 py-2 font-medium", (align?.[i] ?? (i ? "right" : "left")) === "right" ? "text-right" : "text-left")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={cn("tnum px-3 py-2", (align?.[j] ?? (j ? "right" : "left")) === "right" ? "text-right" : "text-left")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
