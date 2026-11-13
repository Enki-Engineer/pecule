import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../cn.ts";

/*
 * Menu contextuel (clic droit, ordinateur) : s'ouvre à la position de la souris, reste dans la
 * fenêtre, se ferme au clic ailleurs, à Échap ou au défilement. ↑ ↓ et Entrée pour choisir.
 */

export type MenuItem = { label: string; icon?: ReactNode; hint?: string; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator";
export type MenuState = { x: number; y: number; items: MenuItem[] } | null;

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null);
  const open = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  return { menu, open, close: () => setMenu(null) };
}

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(-1);

  // Garde le menu dans la fenêtre (près des bords droit et bas).
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 8), y: Math.min(menu.y, window.innerHeight - r.height - 8) });
    setActive(-1);
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const items = menu.items;
    const selectable = items.map((it, i) => (it !== "separator" && !it.disabled ? i : -1)).filter((i) => i >= 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => {
          const k = selectable.indexOf(a);
          const next = e.key === "ArrowDown" ? selectable[(k + 1) % selectable.length] : selectable[(k - 1 + selectable.length) % selectable.length];
          return next ?? -1;
        });
      }
      if (e.key === "Enter") {
        setActive((a) => {
          const it = items[a];
          if (it && it !== "separator" && !it.disabled) {
            onClose();
            it.onSelect();
          }
          return a;
        });
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("blur", onClose);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  return createPortal(
    <div
      ref={ref}
      role="menu"
      className="fixed z-[80] min-w-56 rounded-lg border border-line bg-card p-1 text-[13px] shadow-lg"
      style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? "visible" : "hidden" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) =>
        it === "separator" ? (
          <div key={`s${i}`} className="my-1 h-px bg-line" />
        ) : (
          <button
            key={it.label}
            type="button"
            role="menuitem"
            disabled={it.disabled}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left disabled:opacity-40",
              active === i && "bg-bg",
              it.danger ? "text-neg" : "text-ink",
            )}
          >
            <span className="grid w-4 place-items-center text-muted">{it.icon}</span>
            <span className="flex-1 truncate">{it.label}</span>
            {it.hint && <span className="text-[11px] text-muted">{it.hint}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
