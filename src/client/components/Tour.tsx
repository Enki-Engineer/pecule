import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { ArrowRight, X } from "lucide-react";
import { useMe } from "../api.ts";
import { useNav } from "../modules.ts";
import { stopTour, TOUR_PARAM, tourOpener } from "../tour.ts";
import { useMedia } from "../useMedia.ts";
import { markNav } from "./MobileShell.tsx";
import { placeBubble, spotlight, tourSteps, TOUR_GROUPS, type TourBox, type TourGroup, type TourPlacement, type TourSize, type TourStepId } from "../../lib/tour.ts";
import { locale, t } from "../../lib/i18n.ts";
import "../../styles/visite.css";

/*
 * Visite guidée : le tour de l'appli dans l'appli elle-même. Un voile se pose sur l'écran, une zone éclairée glisse
 * d'un repère de la coquille au suivant (`data-tour`), une bulle dit en deux phrases à quoi il sert ; chaque famille
 * du menu ouvre son écran derrière la bulle. Rien n'est modifié : l'appli est figée le temps de la visite, et l'on
 * revient à l'écran d'où l'on est parti. Étapes et place de la bulle : src/lib/tour.ts. Lancement : src/client/tour.ts.
 *
 * Au clavier : → ou Entrée pour la suite, ← pour revenir, Échap pour quitter.
 */

type Words = { title: string; text: string };

/** Titre et texte d'une étape. `screens` : les écrans d'une famille du menu, tels que le foyer les a gardés. */
function words(id: TourStepId, desktop: boolean, screens: (g: TourGroup) => string): Words {
  const home = t("Ton point de départ : les soldes, les dépenses du mois et ce qui demande ton attention. Tu le composes à ta main.");
  const assistant = { title: t("L'assistant"), text: t("Pose-lui une question sur tes chiffres ou sur l'appli. Il n'écrit rien sans ta confirmation.") };
  switch (id) {
    case "depart":
      return {
        title: t("Faisons le tour de Pécule"),
        text: desktop
          ? t("Le menu d'abord, puis les outils de la barre du haut : chaque endroit s'éclaire, avec un mot d'explication. Deux minutes, et tu t'arrêtes quand tu veux.")
          : t("Les onglets d'abord, puis les boutons du haut : chaque endroit s'éclaire, avec un mot d'explication. Une minute, et tu t'arrêtes quand tu veux."),
      };
    case "tableau":
      return { title: t("Tableau de bord"), text: home };
    case "quotidien":
      return { title: t("Au quotidien"), text: t("Ce que tu regardes chaque semaine : {ecrans}.", { ecrans: screens("quotidien") }) };
    case "patrimoine":
      return { title: t("Patrimoine"), text: t("Ce que tu possèdes, et où tu vas : {ecrans}.", { ecrans: screens("patrimoine") }) };
    case "situation":
      return { title: t("Situation"), text: t("Ce que disent tes bulletins, tes avis et tes relevés : {ecrans}.", { ecrans: screens("situation") }) };
    case "documents":
      return { title: t("Documents"), text: t("Le coffre garde tes papiers, l'échéancier te rappelle leurs dates.") };
    case "recherche":
      return { title: t("La recherche"), text: t("{touche} trouve tout : un écran, une opération, une facture, un article du manuel.", { touche: /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘K" : "Ctrl+K" }) };
    case "perimetre":
      return { title: t("Foyer ou Moi"), text: t("Tout le foyer, ou seulement tes comptes : la bascule vaut pour les écrans qui en dépendent.") };
    case "discret":
      return { title: t("Mode discret"), text: t("Masque tous les montants d'un geste (touche M) : de quoi ouvrir Pécule devant quelqu'un sans montrer tes chiffres.") };
    case "aide":
      return { title: t("Le « ? »"), text: t("En haut de chaque écran, il ouvre la page du manuel qui l'explique.") };
    case "assistant":
    case "onglet-assistant":
      return assistant;
    case "onglet-accueil":
      return { title: t("Accueil"), text: home };
    case "onglet-operations":
      return { title: t("Opérations"), text: t("Toutes tes opérations, à chercher, à classer, à annoter. Tes factures sont dans le même écran.") };
    case "onglet-mois":
      return { title: t("Mois"), text: t("Où est passé l'argent ce mois-ci : dépenses par poste, revenus, et ce qu'il reste.") };
    case "onglet-patrimoine":
      return { title: t("Patrimoine"), text: t("Ce que tu possèdes — comptes, placements, biens — et ce que tu dois encore.") };
    case "outils":
      return { title: t("La loupe et le « ? »"), text: t("En haut à droite : chercher partout, et ouvrir l'aide de l'écran affiché.") };
    case "fin":
      return desktop
        ? { title: t("À toi de jouer"), text: t("En bas du menu : le manuel, qui explique chaque écran, tes réglages — et cette visite, à rejouer quand tu veux.") }
        : { title: t("Tout Pécule"), text: t("Tous les autres écrans sont ici, avec le manuel et les réglages — et cette visite, à rejouer quand tu veux.") };
  }
}

/**
 * Visite en cours, gardée hors du composant : la coquille peut être remontée en route (noms de catégories arrivés
 * du serveur, réglage du foyer changé ailleurs). La visite reprend alors à son étape, et sait toujours d'où elle
 * est partie.
 */
const run = { mounted: 0, index: 0, origin: null as string | null, scrolls: new Map<Element, number>() };
function endRun() {
  run.index = 0;
  run.origin = null;
  // Le menu a pu défiler pour montrer un repère : il reprend sa place.
  run.scrolls.forEach((top, el) => {
    if (el.isConnected) el.scrollTop = top;
  });
  run.scrolls.clear();
  stopTour();
}
/** Amène un repère sous les yeux (le menu latéral défile quand la fenêtre est basse), en retenant d'où l'on part. */
function reveal(el: HTMLElement) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) {
      if (!run.scrolls.has(p)) run.scrolls.set(p, p.scrollTop);
      break;
    }
  }
  el.scrollIntoView({ block: "nearest", inline: "nearest" });
}

const viewSize = (): TourSize => ({ width: window.innerWidth, height: window.innerHeight });
const sameBox = (a: TourBox | null, b: TourBox | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
/** Repère affiché en ce moment : les deux coquilles sont dans la page, une seule se voit. */
const findMark = (name: string) => [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((el) => el.getClientRects().length > 0) ?? null;
const boxOf = (el: HTMLElement): TourBox => {
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
};

export function Tour() {
  const desktop = useMedia("(min-width: 768px)");
  const reduce = useMedia("(prefers-reduced-motion: reduce)");
  const nav = useNav();
  const scopeChoice = useMe().data?.user?.scopeChoice !== false;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const titleId = useId();
  const textId = useId();

  const steps = useMemo(() => {
    const groups = Object.fromEntries(nav.flatMap((g) => (TOUR_GROUPS.includes(g.id as TourGroup) && g.items.length ? [[g.id, g.items[0].to]] : []))) as Partial<Record<TourGroup, string>>;
    return tourSteps({ desktop, groups, scopeChoice });
  }, [desktop, nav, scopeChoice]);
  const screens = (g: TourGroup) => new Intl.ListFormat(locale(), { type: "conjunction" }).format(nav.find((x) => x.id === g)?.items.map((i) => i.label) ?? []);

  /** Marge de la zone éclairée autour du repère : plus serrée sur téléphone, où les onglets se touchent. */
  const pad = desktop ? 6 : 3;
  const [index, setIndex] = useState(() => Math.min(run.index, steps.length - 1));
  useEffect(() => {
    run.index = index;
  }, [index]);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  /** Sens du dernier pas : une étape dont le repère manque est sautée dans ce sens. */
  const dir = useRef<1 | -1>(1);
  /** Repère mesuré pour une étape (null : étape sans repère). Tant que l'étape affichée n'a pas le sien, la bulle attend. */
  const [mark, setMark] = useState<{ index: number; box: TourBox | null } | null>(null);
  const [place, setPlace] = useState<{ index: number; at: TourPlacement } | null>(null);
  const [view, setView] = useState(viewSize);
  const [leaving, setLeaving] = useState(false);
  const closed = useRef(false);
  const layer = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  // Écran d'où la visite est partie : on y revient à la fin.
  if (run.origin === null) {
    const search = new URLSearchParams(window.location.search);
    search.delete(TOUR_PARAM);
    const rest = search.toString();
    run.origin = window.location.pathname + (rest ? `?${rest}` : "");
  }

  /** Quitte la visite. `stay` : sans revenir à l'écran de départ (le membre vient lui-même de changer d'écran). */
  function close(stay = false) {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    if (!stay && run.origin && run.origin !== window.location.pathname + window.location.search) {
      markNav("tab");
      navigate(run.origin, { replace: true });
    }
    // Le voile s'efface, puis la coquille retire la visite.
    window.setTimeout(endRun, reduce ? 0 : 200);
  }
  /** Bouton de la bulle qui avait le focus au moment de changer d'étape : celui de la bulle suivante le reprend. */
  const refocus = useRef<string | null>(null);
  const keepButton = () => {
    const active = document.activeElement;
    refocus.current = active instanceof HTMLElement && bubble.current?.contains(active) ? (active.dataset.tourBouton ?? null) : null;
  };
  function next() {
    dir.current = 1;
    keepButton();
    if (last) close();
    else setIndex(index + 1);
  }
  function previous() {
    dir.current = -1;
    keepButton();
    if (index > 0) setIndex(index - 1);
  }

  // La coquille a changé en route (fenêtre élargie ou rétrécie) : les repères ne sont plus les mêmes, la visite s'arrête.
  const shell = useRef(desktop);
  useEffect(() => {
    if (shell.current !== desktop) close();
  }, [desktop]);

  // L'appli est figée le temps de la visite : ni clic, ni focus, ni lecture d'écran hors de la bulle. À la fin, le
  // focus revient à ce qui l'a lancée.
  useEffect(() => {
    run.mounted++;
    const root = document.getElementById("root");
    const opener = tourOpener() ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null);
    root?.setAttribute("inert", "");
    return () => {
      run.mounted--;
      root?.removeAttribute("inert");
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      // La coquille elle-même est partie (session fermée) : la visite ne doit pas reprendre à son retour. Différé :
      // une coquille remontée sur place (ou React qui, en développement, démonte et remonte chaque écran pour
      // l'éprouver) la retrouve en cours.
      window.setTimeout(() => {
        if (run.mounted === 0) endRun();
      }, 0);
    };
  }, []);

  // Chaque étape ouvre son écran derrière la bulle, sans rien ajouter à l'historique.
  useEffect(() => {
    if (leaving || !step.to || step.to === pathname) return;
    markNav("tab");
    navigate(step.to, { replace: true });
  }, [index, steps]);

  // Fenêtre redimensionnée : tout se replace.
  useEffect(() => {
    const on = () => setView(viewSize());
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("resize", on);
    };
  }, []);

  // Repère de l'étape : cherché le temps que son écran arrive, amené dans le menu s'il a défilé, puis suivi (la page
  // peut encore bouger). Introuvable — un bouton que cette fenêtre n'affiche pas — l'étape est sautée.
  useEffect(() => {
    if (!step.target) {
      setMark({ index, box: null });
      return;
    }
    const name = step.target;
    let frame = 0;
    let since = performance.now();
    let seen = false;
    const read = () => {
      const el = findMark(name);
      if (!el) return false;
      if (!seen) reveal(el);
      seen = true;
      const box = boxOf(el);
      setMark((m) => (m && m.index === index && sameBox(m.box, box) ? m : { index, box }));
      return true;
    };
    const look = () => {
      if (read()) return;
      if (performance.now() - since > 1500) return dir.current === 1 ? next() : previous();
      frame = requestAnimationFrame(look);
    };
    look();
    const follow = window.setInterval(() => {
      if (seen) read();
    }, 250);
    const onResize = () => {
      since = performance.now();
      if (seen) read();
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(follow);
      window.removeEventListener("resize", onResize);
    };
  }, [index, steps]);

  // Place de la bulle : une fois le repère de l'étape mesuré, et à chaque fois qu'elle ou la fenêtre change de taille.
  const found = mark && mark.index === index ? mark : null;
  useLayoutEffect(() => {
    const el = bubble.current;
    if (!el || !found) return;
    const put = () => {
      const next = placeBubble(found.box ? spotlight(found.box, view, pad) : null, { width: el.offsetWidth, height: el.offsetHeight }, view, step.sides);
      setPlace((p) => (p && p.index === index && p.at.x === next.x && p.at.y === next.y && p.at.side === next.side && p.at.arrow === next.arrow ? p : { index, at: next }));
    };
    put();
    const watch = new ResizeObserver(put);
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [found, view, index]);
  /** Place de la bulle de l'étape affichée ; null tant qu'elle n'est pas mesurée (la bulle attend, invisible). */
  const at = found && place && place.index === index ? place.at : null;
  const shown = at !== null;

  // Le focus va à la bulle de chaque étape : un lecteur d'écran en lit le titre et le texte. Qui avançait ou reculait
  // par un bouton, au clavier, le retrouve sous ses doigts (sinon Entrée sur « Précédent » reculerait une fois, puis
  // avancerait) — sauf sur la première bulle, où ce bouton-là quitte la visite.
  useEffect(() => {
    if (!shown) return;
    const again = refocus.current && (refocus.current !== "retour" || index > 0) ? bubble.current?.querySelector<HTMLElement>(`[data-tour-bouton="${refocus.current}"]`) : null;
    (again ?? bubble.current)?.focus({ preventScroll: true });
  }, [shown, index]);

  // Bouton Précédent du navigateur (ou du téléphone) : le membre change d'écran lui-même, la visite s'efface.
  useEffect(() => {
    const onPop = () => close(true);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  });

  // Clavier : la visite a la main. → ou Entrée pour la suite, ← pour revenir, Échap pour quitter ; les raccourcis de
  // l'appli attendent la fin (ceux du navigateur ne sont pas touchés).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const box = bubble.current;
      if (e.key === "Tab") {
        // La tabulation tourne dans la bulle : rien d'autre n'est à portée pendant la visite.
        const buttons = box ? [...box.querySelectorAll<HTMLElement>("button")] : [];
        const active = document.activeElement;
        const edge = e.shiftKey ? buttons[0] : buttons.at(-1);
        if (!box?.contains(active) || active === edge || (e.shiftKey && active === box)) {
          e.preventDefault();
          (e.shiftKey ? buttons.at(-1) : buttons[0])?.focus();
        }
        return;
      }
      const onButton = document.activeElement instanceof HTMLButtonElement && !!bubble.current?.contains(document.activeElement);
      if (e.key === "Enter" || e.key === " ") {
        // Sur un bouton de la bulle, la touche est pour lui.
        if (onButton) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) next();
        return;
      }
      e.stopPropagation();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") previous();
      else if (!["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  });

  // La page ne défile pas sous le voile (molette, doigt) ; pincer pour agrandir le texte reste possible.
  useEffect(() => {
    const el = layer.current;
    if (!el) return;
    const hold = (e: Event) => {
      if (e instanceof TouchEvent && e.touches.length > 1) return;
      e.preventDefault();
    };
    el.addEventListener("wheel", hold, { passive: false });
    el.addEventListener("touchmove", hold, { passive: false });
    return () => {
      el.removeEventListener("wheel", hold);
      el.removeEventListener("touchmove", hold);
    };
  }, []);

  // Zone éclairée : celle de l'étape dès que son repère est mesuré ; d'ici là, celle d'avant reste (elle glissera).
  const zone = useRef<{ box: TourBox; empty: boolean } | null>(null);
  const settled = zone.current !== null;
  if (found) zone.current = found.box ? { box: spotlight(found.box, view, pad), empty: false } : { box: { x: Math.round(view.width / 2), y: Math.round(view.height / 2), width: 0, height: 0 }, empty: true };
  const lit = zone.current;

  const w = words(step.id, desktop, screens);
  // L'accueil de la visite ne compte pas parmi les étapes.
  const total = steps.length - 1;

  return createPortal(
    <div ref={layer} className="tour" data-part={leaving}>
      {lit && (
        <div
          aria-hidden
          className="tour-zone"
          data-vide={lit.empty}
          data-pose={settled}
          onClick={lit.empty ? undefined : next}
          style={{ transform: `translate(${lit.box.x}px, ${lit.box.y}px)`, width: lit.box.width, height: lit.box.height }}
        />
      )}
      <div
        key={index}
        ref={bubble}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={textId}
        tabIndex={-1}
        className="tour-bulle rounded-[18px] bg-card p-4 pb-3.5 text-ink shadow-[0_0_0_1px_var(--color-line),0_24px_48px_-16px_rgb(20_20_19/0.4)] outline-none"
        data-vue={shown}
        data-cote={at ? (at.side ?? "centre") : undefined}
        style={at ? ({ transform: `translate(${at.x}px, ${at.y}px)`, "--tour-pointe": `${at.arrow}px` } as CSSProperties) : undefined}
      >
        {at?.side && <span aria-hidden className="tour-pointe" />}
        <div className="flex items-center gap-3">
          {index === 0 ? (
            <span className="flex-1 text-[12.5px] font-medium text-muted">{t("Visite guidée")}</span>
          ) : (
            <>
              <div className="tour-avance flex-1" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={index} aria-label={t("Étape {n} sur {total}", { n: index, total })}>
                <span style={{ transform: `scaleX(${index / total})` }} />
              </div>
              <span aria-hidden className="text-[12px] font-medium tabular-nums text-muted">
                {index} / {total}
              </span>
            </>
          )}
          <button type="button" onClick={() => close()} aria-label={t("Quitter la visite")} className="press -mr-1.5 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-bg hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <h2 id={titleId} className="mt-2 text-[17px] font-semibold leading-snug tracking-[-0.01em]">
          {w.title}
        </h2>
        <p id={textId} className="mt-1.5 text-[14.5px] leading-relaxed text-muted">
          {w.text}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          {index === 0 ? (
            <button type="button" onClick={() => close()} className="press mr-auto -ml-2 rounded-lg px-2.5 py-2 text-[14px] font-medium text-muted hover:text-ink">
              {t("Plus tard")}
            </button>
          ) : (
            <button type="button" onClick={previous} data-tour-bouton="retour" className="press mr-auto -ml-2 rounded-lg px-2.5 py-2 text-[14px] font-medium text-muted hover:text-ink">
              {t("Précédent")}
            </button>
          )}
          <button type="button" onClick={next} data-tour-bouton="suite" className="press flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-[14.5px] font-semibold text-white">
            {index === 0 ? t("Commencer") : last ? t("Terminer") : t("Suivant")}
            {!last && <ArrowRight size={16} className="shrink-0" />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
