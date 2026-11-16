import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { moveItem } from "../lib/dashboard.ts";

/*
 * Réordonner des blocs en les faisant glisser, dans une page dont les blocs n'ont pas tous la même taille
 * (tableau de bord et accueil du téléphone en mode construction). Le bloc saisi reste à sa place, estompé ; son
 * image suit le pointeur ; dès que le pointeur passe sur un autre bloc, l'ordre change et les blocs glissent vers
 * leur nouvelle place. Relâcher garde l'ordre, Échap rend celui du départ.
 *
 * À la souris, on saisit le bloc n'importe où. Au doigt, un appui long le saisit (un geste plus bref fait défiler
 * la page, comme d'habitude) ; une poignée (`data-grip`) le saisit sans attendre.
 */

/** Distance à parcourir avant qu'un appui devienne un déplacement : un clic ne déplace rien. */
const START_PX = 5;
/** Appui long, au doigt : durée sans bouger, et ce qu'on tolère de tremblement. */
const HOLD_MS = 320;
const HOLD_PX = 10;
/** Bande, en haut et en bas de la fenêtre, où la page défile pendant un déplacement. */
const EDGE_PX = 90;
const MOVE_MS = 200;
/** Repère interne : le pointeur est après le dernier bloc de la zone. */
const END = "\u0000fin";

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
  /** Le bloc suit le pointeur. Avant : l'appui n'est pas encore un déplacement. */
  active: boolean;
  /** Bloc tout juste ajouté, saisi ailleurs (tiroir d'ajout) : on attend qu'il soit à l'écran pour le porter. */
  adopted: boolean;
  /** Appui long en attente, au doigt. */
  hold: number;
  /** Dernier bloc avec lequel on a échangé : on attend que le pointeur l'ait quitté avant d'échanger de nouveau. */
  last: string | null;
  /** Tant que les blocs glissent vers leur nouvel ordre, les positions lues seraient fausses. */
  busyUntil: number;
  raf: number;
  ghost: HTMLElement | null;
  origin: string[] | null;
  stop: () => void;
};

export type DragSort = {
  /** Bloc en cours de déplacement. */
  dragging: string | null;
  /** `ref` du bloc : sa position sert à savoir sur quoi passe le pointeur. */
  register: (id: string) => (el: HTMLElement | null) => void;
  /** `onPointerDown` de la zone qui saisit le bloc. */
  start: (id: string, e: ReactPointerEvent) => void;
  /**
   * Porte un bloc qu'on vient d'ajouter à la liste, le pointeur déjà enfoncé à (`x`, `y`) : glissé depuis le tiroir
   * d'ajout, il se pose là où on le lâche.
   */
  adopt: (id: string, x: number, y: number) => void;
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

  const finish = useCallback(
    (cancel: boolean) => {
      const s = session.current;
      if (!s) return;
      session.current = null;
      s.stop();
      clearTimeout(s.hold);
      cancelAnimationFrame(s.raf);
      document.body.classList.remove("dash-dragging");
      if (cancel && s.active && s.origin && s.origin.join("|") !== idsRef.current.join("|")) {
        snapshot();
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
    },
    [snapshot],
  );

  useEffect(() => () => finish(true), [finish]);

  /** Ouvre une séance : le pointeur est enfoncé sur le bloc `id` (ou sur ce qui va le devenir). */
  const begin = useCallback(
    (id: string, x: number, y: number, mode: "souris" | "doigt" | "poignee" | "adopte") => {
      if (session.current) return;

      const place = (s: Session) => {
        if (s.ghost) s.ghost.style.transform = `translate3d(${s.x - s.offX}px, ${s.y - s.offY}px, 0) scale(${s.scale})`;
      };

      /** Le bloc sous le pointeur ; `END` quand le pointeur est après le dernier bloc de la zone. */
      const under = (s: Session): string | null => {
        for (const [oid, el] of els.current) {
          const r = el.getBoundingClientRect();
          if (r.width && s.x >= r.left && s.x <= r.right && s.y >= r.top && s.y <= r.bottom) return oid;
        }
        const list = idsRef.current;
        const lastEl = els.current.get(list.at(-1) ?? "");
        const z = zone.current?.getBoundingClientRect();
        if (!lastEl || !z || s.x < z.left || s.x > z.right || s.y < z.top || s.y > z.bottom + 80) return null;
        const r = lastEl.getBoundingClientRect();
        return s.y > r.bottom || (s.y >= r.top && s.x > r.right) ? END : null;
      };

      const tick = () => {
        const s = session.current;
        if (!s) return;
        if (!s.active) {
          // Bloc glissé depuis le tiroir : il vient d'entrer dans la liste, on le porte dès qu'il est dessiné.
          if (s.adopted && els.current.has(s.id)) activate(s);
          else s.raf = requestAnimationFrame(tick);
          return;
        }
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
            const to = over === END ? list.length - 1 : list.indexOf(over);
            if (to >= 0 && to !== at) {
              s.last = over;
              s.busyUntil = performance.now() + MOVE_MS + 30;
              snapshot();
              reorderRef.current(moveItem(list, at, to));
            }
          }
        }
        s.raf = requestAnimationFrame(tick);
      };

      const activate = (s: Session) => {
        const el = els.current.get(s.id);
        if (!el) return;
        clearTimeout(s.hold);
        const r = el.getBoundingClientRect();
        // Saisi sur place, le bloc reste sous le doigt là où on l'a pris ; venu du tiroir, on le tient par un coin.
        s.offX = s.adopted ? Math.min(70, r.width / 2) : s.startX - r.left;
        s.offY = s.adopted ? Math.min(40, r.height / 2) : s.startY - r.top;
        // Un bloc large ou haut est réduit pendant qu'on le porte : on voit où il va.
        s.scale = Math.max(0.4, Math.min(1, 440 / r.width, 380 / r.height));
        const ghost = el.cloneNode(true) as HTMLElement;
        ghost.setAttribute("aria-hidden", "true");
        ghost.className = `${ghost.className} dash-ghost`;
        Object.assign(ghost.style, { position: "fixed", left: "0", top: "0", width: `${r.width}px`, height: `${r.height}px`, margin: "0", zIndex: "70", pointerEvents: "none", transformOrigin: `${s.offX}px ${s.offY}px` });
        document.body.appendChild(ghost);
        s.ghost = ghost;
        s.active = true;
        s.origin = [...idsRef.current];
        place(s);
        document.body.classList.add("dash-dragging");
        setDragging(s.id);
        cancelAnimationFrame(s.raf);
        s.raf = requestAnimationFrame(tick);
      };

      const onMove = (ev: PointerEvent) => {
        const s = session.current;
        if (!s) return;
        s.x = ev.clientX;
        s.y = ev.clientY;
        if (!s.active && !s.adopted) {
          const moved = Math.hypot(s.x - s.startX, s.y - s.startY);
          // Au doigt, bouger avant la fin de l'appui long, c'est faire défiler la page : on laisse faire.
          if (mode === "doigt") {
            if (moved > HOLD_PX) finish(true);
            return;
          }
          if (moved >= START_PX) activate(s);
        }
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
      // Une fois le bloc porté au doigt, la page ne doit plus défiler sous lui ; ni le menu de l'appui long s'ouvrir.
      const onTouchMove = (ev: TouchEvent) => {
        if (session.current?.active && ev.cancelable) ev.preventDefault();
      };
      const onMenu = (ev: Event) => ev.preventDefault();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("contextmenu", onMenu);
      const s: Session = {
        id,
        x,
        y,
        startX: x,
        startY: y,
        offX: 0,
        offY: 0,
        scale: 1,
        active: false,
        adopted: mode === "adopte",
        hold: 0,
        last: null,
        busyUntil: 0,
        raf: 0,
        ghost: null,
        origin: null,
        stop: () => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          window.removeEventListener("pointercancel", onCancel);
          window.removeEventListener("keydown", onKey, true);
          window.removeEventListener("touchmove", onTouchMove);
          window.removeEventListener("contextmenu", onMenu);
        },
      };
      session.current = s;
      if (mode === "doigt") s.hold = window.setTimeout(() => session.current === s && activate(s), HOLD_MS);
      if (mode === "adopte") s.raf = requestAnimationFrame(tick);
    },
    [finish, snapshot, zone],
  );

  const start = useCallback(
    (id: string, e: ReactPointerEvent) => {
      const from = e.target as HTMLElement;
      if (e.button !== 0 || from.closest("[data-nodrag]")) return;
      const grip = !!from.closest("[data-grip]");
      if (e.pointerType === "mouse" || grip) e.preventDefault();
      begin(id, e.clientX, e.clientY, grip ? "poignee" : e.pointerType === "mouse" ? "souris" : "doigt");
    },
    [begin],
  );

  const adopt = useCallback((id: string, x: number, y: number) => begin(id, x, y, "adopte"), [begin]);

  return { dragging, register, start, adopt, snapshot };
}
