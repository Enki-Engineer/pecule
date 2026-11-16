import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { moveItem } from "../lib/dashboard.ts";

/*
 * Réordonner des blocs en les faisant glisser, dans une grille dont les blocs n'ont pas tous la même taille
 * (tableau de bord en mode construction). Le bloc saisi reste à sa place, estompé ; son image suit le pointeur ;
 * dès que le pointeur passe sur un autre bloc, l'ordre change et la grille se réarrange en glissant. Relâcher
 * garde l'ordre, Échap rend celui du départ.
 */

/** Distance à parcourir avant qu'un appui devienne un déplacement : un clic ne déplace rien. */
const START_PX = 5;
/** Bande, en haut et en bas de la fenêtre, où la page défile pendant un déplacement. */
const EDGE_PX = 90;
const MOVE_MS = 200;

const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Session = {
  id: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  offX: number;
  offY: number;
  scale: number;
  active: boolean;
  /** Dernier bloc avec lequel on a échangé : on attend que le pointeur l'ait quitté avant d'échanger de nouveau. */
  last: string | null;
  /** Tant que la grille glisse vers son nouvel ordre, les positions lues seraient fausses. */
  busyUntil: number;
  raf: number;
  ghost: HTMLElement | null;
  origin: string[];
  stop: () => void;
};

export type DragSort = {
  /** Bloc en cours de déplacement. */
  dragging: string | null;
  /** `ref` du bloc : sa position sert à savoir sur quoi passe le pointeur. */
  register: (id: string) => (el: HTMLElement | null) => void;
  /** `onPointerDown` de la zone qui saisit le bloc. Au doigt, seule une poignée (`data-grip`) saisit : le reste fait défiler. */
  start: (id: string, e: ReactPointerEvent) => void;
  /** À appeler juste avant un changement d'agencement fait autrement (flèches, largeur, retrait) : il glissera aussi. */
  snapshot: () => void;
};

export function useDragSort({ ids, signature, onReorder, zone }: { ids: readonly string[]; /** Change quand l'agencement change (ordre, largeurs). */ signature: string; onReorder: (ids: string[]) => void; zone: React.RefObject<HTMLElement | null> }): DragSort {
  const els = useRef(new Map<string, HTMLElement>());
  const refs = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;
  const before = useRef<Map<string, DOMRect> | null>(null);
  const session = useRef<Session | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const register = useCallback((id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (el) => {
        if (el) els.current.set(id, el);
        else els.current.delete(id);
      };
      refs.current.set(id, ref);
    }
    return ref;
  }, []);

  const snapshot = useCallback(() => {
    before.current = new Map([...els.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
  }, []);

  // Chaque bloc part de là où il était et glisse jusqu'à sa nouvelle place.
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (!prev || reduced()) return;
    for (const [id, el] of els.current) {
      const a = prev.get(id);
      if (!a) continue;
      const b = el.getBoundingClientRect();
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: MOVE_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
    }
  }, [signature]);

  const finish = useCallback((cancel: boolean) => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    s.stop();
    cancelAnimationFrame(s.raf);
    document.body.classList.remove("dash-dragging");
    if (cancel && s.active && s.origin.join("|") !== idsRef.current.join("|")) {
      before.current = new Map([...els.current].map(([id, el]) => [id, el.getBoundingClientRect()]));
      reorderRef.current(s.origin);
    }
    const ghost = s.ghost;
    if (ghost) {
      const slot = els.current.get(s.id)?.getBoundingClientRect();
      if (slot && !reduced() && !cancel) {
        // L'image rejoint la place du bloc avant de disparaître.
        ghost.style.transition = "transform 150ms ease-out, opacity 150ms ease-out";
        ghost.style.transform = `translate3d(${slot.left}px, ${slot.top}px, 0) scale(1)`;
        ghost.style.opacity = "0.2";
        setTimeout(() => ghost.remove(), 160);
      } else ghost.remove();
    }
    if (s.active) setDragging(null);
  }, []);

  useEffect(() => () => finish(true), [finish]);

  const start = useCallback(
    (id: string, e: ReactPointerEvent) => {
      const from = e.target as HTMLElement;
      if (e.button !== 0 || session.current || from.closest("[data-nodrag]")) return;
      if (e.pointerType !== "mouse" && !from.closest("[data-grip]")) return;
      e.preventDefault();

      const place = (s: Session) => {
        if (s.ghost) s.ghost.style.transform = `translate3d(${s.x - s.offX}px, ${s.y - s.offY}px, 0) scale(${s.scale})`;
      };

      const activate = (s: Session) => {
        const el = els.current.get(s.id);
        if (!el) return;
        const r = el.getBoundingClientRect();
        s.offX = s.startX - r.left;
        s.offY = s.startY - r.top;
        // Une grande carte est réduite pendant qu'on la porte : on voit où elle va.
        s.scale = Math.max(0.45, Math.min(1, 440 / r.width));
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.setAttribute("aria-hidden", "true");
        ghost.className = `${ghost.className} dash-ghost`;
        Object.assign(ghost.style, { position: "fixed", left: "0", top: "0", width: `${r.width}px`, height: `${r.height}px`, margin: "0", zIndex: "70", pointerEvents: "none", transformOrigin: `${s.offX}px ${s.offY}px` });
        document.body.appendChild(ghost);
        s.ghost = ghost;
        s.active = true;
        place(s);
        document.body.classList.add("dash-dragging");
        setDragging(s.id);
        s.raf = requestAnimationFrame(tick);
      };

      /** Le bloc sous le pointeur ; « fin » quand le pointeur est après le dernier bloc de la zone. */
      const under = (s: Session): string | null => {
        for (const [oid, el] of els.current) {
          const r = el.getBoundingClientRect();
          if (s.x >= r.left && s.x <= r.right && s.y >= r.top && s.y <= r.bottom) return oid;
        }
        const list = idsRef.current;
        const lastEl = els.current.get(list.at(-1) ?? "");
        const z = zone.current?.getBoundingClientRect();
        if (!lastEl || !z || s.x < z.left || s.x > z.right || s.y < z.top || s.y > z.bottom + 80) return null;
        const r = lastEl.getBoundingClientRect();
        return s.y > r.bottom || (s.y >= r.top && s.x > r.right) ? "\u0000fin" : null;
      };

      const tick = () => {
        const s = session.current;
        if (!s?.active) return;
        // Près du haut ou du bas de la fenêtre, la page défile : plus on approche du bord, plus elle va vite.
        const top = EDGE_PX + 52;
        const bottom = window.innerHeight - EDGE_PX;
        if (s.y < top) window.scrollBy(0, -Math.ceil((top - s.y) / 5));
        else if (s.y > bottom) window.scrollBy(0, Math.ceil((s.y - bottom) / 5));
        if (performance.now() >= s.busyUntil) {
          const over = under(s);
          const list = idsRef.current;
          const at = list.indexOf(s.id);
          if (!over || over === s.id) s.last = null;
          else if (over !== s.last && at >= 0) {
            const to = over === "\u0000fin" ? list.length - 1 : list.indexOf(over);
            if (to >= 0 && to !== at) {
              s.last = over;
              s.busyUntil = performance.now() + MOVE_MS + 30;
              before.current = new Map([...els.current].map(([oid, el]) => [oid, el.getBoundingClientRect()]));
              reorderRef.current(moveItem(list, at, to));
            }
          }
        }
        s.raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent) => {
        const s = session.current;
        if (!s) return;
        s.x = ev.clientX;
        s.y = ev.clientY;
        if (!s.active && Math.hypot(s.x - s.startX, s.y - s.startY) >= START_PX) activate(s);
        place(s);
      };
      const onUp = () => finish(false);
      const onCancel = () => finish(true);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        finish(true);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      session.current = {
        id,
        x: e.clientX,
        y: e.clientY,
        startX: e.clientX,
        startY: e.clientY,
        offX: 0,
        offY: 0,
        scale: 1,
        active: false,
        last: null,
        busyUntil: 0,
        raf: 0,
        ghost: null,
        origin: [...idsRef.current],
        stop: () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          window.removeEventListener("keydown", onKey, true);
        },
      };
    },
    [finish, zone],
  );

  return { dragging, register, start, snapshot };
}
