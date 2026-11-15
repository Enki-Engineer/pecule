import { useMemo, useState, type ReactNode, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "../cn.ts";
import { locale, t } from "../../lib/i18n.ts";

/*
 * Tableau de données (ordinateur) : colonnes triables, en-tête collant sous la barre supérieure,
 * survol de ligne, ligne sélectionnée, navigation ↑ ↓ et Entrée, pied de tableau (totaux).
 * Les colonnes peuvent se masquer sous une largeur d'écran.
 */

export type Column<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Valeur de tri (absente : colonne non triable). */
  sort?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
  /** Masquée sous cette largeur. */
  hideBelow?: "lg" | "xl" | "2xl";
};

type Sort = { key: string; dir: "asc" | "desc" } | null;

const HIDE = { lg: "hidden lg:table-cell", xl: "hidden xl:table-cell", "2xl": "hidden 2xl:table-cell" } as const;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  selectedKey,
  initialSort = null,
  empty = t("Aucune ligne."),
  footer,
  rowClassName,
  onContextMenu,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  selectedKey?: string | null;
  initialSort?: Sort;
  empty?: ReactNode;
  footer?: ReactNode;
  rowClassName?: (row: T) => string | undefined;
  onContextMenu?: (row: T, e: React.MouseEvent) => void;
}) {
  const [sort, setSort] = useState<Sort>(initialSort);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const val = col.sort;
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), locale(), { numeric: true });
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, sort, columns]);

  const toggle = (c: Column<T>) => {
    if (!c.sort) return;
    setSort((s) => (s?.key !== c.key ? { key: c.key, dir: "desc" } : s.dir === "desc" ? { key: c.key, dir: "asc" } : null));
  };

  const onKey = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!onRowClick || !sorted.length || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const i = sorted.findIndex((r) => rowKey(r) === selectedKey);
    const next = sorted[Math.min(sorted.length - 1, Math.max(0, i + (e.key === "ArrowDown" ? 1 : -1)))];
    onRowClick(next);
    document.querySelector(`[data-row="${CSS.escape(rowKey(next))}"]`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="card overflow-clip">
      <table className="w-full border-collapse text-[13px]" tabIndex={onRowClick ? 0 : undefined} onKeyDown={onKey}>
        <thead className="sticky top-[52px] z-10 bg-card">
          <tr className="border-b border-line">
            {columns.map((c) => (
              <th
                key={c.key}
                style={c.width ? { width: c.width } : undefined}
                className={cn(
                  "h-9 select-none whitespace-nowrap px-3 text-[12.5px] font-medium text-muted",
                  c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                  c.hideBelow && HIDE[c.hideBelow],
                  c.sort && "cursor-pointer hover:text-ink",
                )}
                onClick={() => toggle(c)}
                aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
              >
                <span className={cn("inline-flex items-center gap-1", c.align === "right" && "flex-row-reverse")}>
                  {c.header || <span className="sr-only">{c.key}</span>}
                  {c.sort &&
                    (sort?.key === c.key ? (
                      sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                    ) : (
                      <ChevronsUpDown size={11} className="opacity-40" />
                    ))}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const key = rowKey(r);
            const selected = key === selectedKey;
            return (
              <tr
                key={key}
                data-row={key}
                onClick={() => onRowClick?.(r)}
                onContextMenu={onContextMenu ? (e) => onContextMenu(r, e) : undefined}
                className={cn(
                  "border-b border-line last:border-0",
                  onRowClick && "cursor-pointer",
                  // Ligne choisie : fond teinté et filet d'accent à gauche (visible même dans un long tableau).
                  selected ? "bg-accent-soft [&>td:first-child]:shadow-[inset_3px_0_0_var(--color-accent)]" : "hover:bg-bg",
                  rowClassName?.(r),
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn("h-10 px-3", c.align === "right" ? "tnum text-right" : c.align === "center" ? "text-center" : "", c.hideBelow && HIDE[c.hideBelow], c.className)}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            );
          })}
          {!sorted.length && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-muted">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-line bg-bg/60 font-medium">{footer}</tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
