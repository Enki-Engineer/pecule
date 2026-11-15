import { useEffect, useLayoutEffect, useRef, useState } from "react";

/*
 * Infobulles : une seule bulle pour toute l'appli, posée à la racine. Elle s'affiche au survol (après un court
 * arrêt) ou au focus du clavier de tout élément qui porte `data-tip` ou un `title` — le `title` est mis de côté
 * le temps du survol, pour que la bulle grise du navigateur ne s'y ajoute pas, puis remis en place. Un raccourci
 * écrit entre parenthèses à la fin du texte (« Rechercher (⌘K) ») est rendu comme une touche. Sur le téléphone,
 * une pastille d'aide (`<span data-tip tabIndex={0}>`) s'ouvre au toucher.
 */

const DELAY = 350;
const SHORTCUT = /^(.*\S)\s+\(([^()]*[⌘⌥⇧⌃↑↓←→][^()]*|Échap|Entrée|[A-Z?/])\)$/u;
const ACTIVE = "data-tip-active";

type Tip = { text: string; rect: DOMRect; help: boolean };

/** `title` mis de côté pendant que la bulle de son élément est demandée. */
const titles = new WeakMap<Element, string>();

function take(el: Element): string | null {
  const title = el.getAttribute("title");
  if (title) {
    titles.set(el, title);
    el.removeAttribute("title");
  }
  return title ?? el.getAttribute("data-tip");
}

function giveBack(el: Element) {
  el.removeAttribute(ACTIVE);
  const title = titles.get(el);
  titles.delete(el);
  // React a pu poser un nouveau `title` entre-temps : il fait foi.
  if (title && !el.hasAttribute("title")) el.setAttribute("title", title);
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Element | null = null;
    let lastHide = 0;
    const hide = () => {
      clearTimeout(timer);
      if (current) {
        lastHide = Date.now();
        giveBack(current);
      }
      current = null;
      setTip(null);
    };
    const show = (el: Element, now = false) => {
      if (el === current) return;
      hide();
      const text = take(el);
      if (!text) return;
      el.setAttribute(ACTIVE, "");
      current = el;
      // D'une bulle à sa voisine (barre d'outils) : pas de nouveau délai.
      const wait = now || Date.now() - lastHide < 400 ? 0 : DELAY;
      timer = setTimeout(() => current === el && el.isConnected && setTip({ text, rect: el.getBoundingClientRect(), help: el.matches("span[data-tip][tabindex]") }), wait);
    };
    const target = (e: Event) => (e.target instanceof Element ? e.target.closest(`[data-tip], [title], [${ACTIVE}]`) : null);
    const over = (e: MouseEvent) => {
      const el = target(e);
      if (el) show(el);
      else if (current) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = target(e);
      if (el && e.target instanceof Element && e.target.matches(":focus-visible")) show(el, true);
    };
    // Pastille d'aide posée dans un lien ou une carte cliquable : le toucher l'ouvre au lieu de suivre le lien.
    const click = (e: MouseEvent) => {
      const el = e.target instanceof Element ? e.target.closest("span[data-tip][tabindex]") : null;
      if (!el) return hide();
      e.preventDefault();
      e.stopPropagation();
      if (current === el) hide();
      else show(el, true);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    const hover = window.matchMedia("(hover: hover)").matches;
    if (hover) document.addEventListener("mouseover", over);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", hide);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    return () => {
      hide();
      document.removeEventListener("mouseover", over);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  useLayoutEffect(() => {
    const el = box.current;
    if (!tip || !el) return setPos(null);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.min(Math.max(8, tip.rect.left + tip.rect.width / 2 - w / 2), window.innerWidth - w - 8);
    // Une pastille d'aide explique le chiffre posé sous elle : sa bulle passe au-dessus quand il y a la place.
    const above = tip.help ? tip.rect.top - h - 8 >= 8 : tip.rect.bottom + 8 + h > window.innerHeight;
    setPos({ left, top: above ? tip.rect.top - h - 8 : tip.rect.bottom + 8, above });
  }, [tip]);

  if (!tip) return null;
  const m = SHORTCUT.exec(tip.text);
  return (
    <div
      ref={box}
      role="tooltip"
      className="tooltip pointer-events-none fixed z-[90] max-w-72 rounded-[10px] bg-ink px-2.5 py-1.5 text-[12.5px] font-medium leading-snug text-card shadow-[0_8px_24px_-8px_rgb(0_0_0/0.45)]"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      {m ? (
        <span className="flex items-center gap-2">
          {m[1]}
          <kbd className="rounded-[5px] bg-card/20 px-1.5 py-px font-sans text-[11.5px]">{m[2]}</kbd>
        </span>
      ) : (
        tip.text
      )}
    </div>
  );
}
