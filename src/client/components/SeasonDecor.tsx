import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useSeason } from "../theme.ts";
import { decorDue, type Season } from "../../lib/seasons.ts";

/*
 * Décor sur l'accueil : neige à Noël et en hiver, confettis au Jour de l'an, chauves-souris à
 * Halloween, cœurs à la Saint-Valentin, fleurs à Pâques et au printemps, fournitures à la rentrée,
 * feuilles en automne, soleil en été. Joué à l'ouverture de l'appli ou au retour dessus, sur l'accueil,
 * avec un délai entre deux (`decorDue` : trois heures pour une fête, huit pour une saison) pour ne pas
 * gêner la lecture ; toujours pour un aperçu. Une dizaine de secondes, sans gêner les clics ; rien si
 * l'appareil demande de réduire les animations.
 */

const DURATION = 11_000;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const CONFETTI = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "#d4a72c"];

const FALLING: Record<Exclude<Season, "halloween" | "nouvel-an">, string[]> = {
  noel: ["❄", "❅", "❆"],
  hiver: ["❄", "❅", "❆"],
  anniversaire: ["🎈", "🎉", "🎂", "🎁"],
  epiphanie: ["👑", "⭐", "✨"],
  chandeleur: ["🥞", "🍋", "🍯"],
  "saint-patrick": ["☘️", "🍀", "🌈"],
  "14-juillet": ["🎆", "🎇", "✨"],
  "fete-lumieres": ["🕯️", "✨", "🌟"],
  paques: ["🌸", "🌷", "🥚"],
  "saint-valentin": ["💕", "💗", "❤️"],
  rentree: ["✏️", "📚", "📐", "🖍️"],
  printemps: ["🌸", "🌼", "🍃"],
  ete: ["☀️", "🍉", "🐚", "🌴"],
  automne: ["🍂", "🍁", "🍃"],
};

function pieces(season: Season) {
  if (season === "halloween")
    return Array.from({ length: 6 }, (_, i) => ({ kind: "fly" as const, char: "🦇", style: { top: `${rand(8, 45)}vh`, fontSize: `${rand(18, 30)}px`, animationDuration: `${rand(5, 8)}s`, animationDelay: `${i * 0.9}s`, ["--dy" as string]: `${rand(-10, 6)}vh` } }));
  if (season === "nouvel-an")
    return Array.from({ length: 60 }, () => ({
      kind: "fall" as const,
      char: "",
      style: {
        left: `${rand(0, 100)}vw`,
        width: `${rand(5, 9)}px`,
        height: `${rand(8, 14)}px`,
        borderRadius: "2px",
        background: CONFETTI[Math.floor(rand(0, CONFETTI.length))],
        animationDuration: `${rand(3, 5.5)}s`,
        animationDelay: `${rand(0, 1.2)}s`,
        ["--dx" as string]: `${rand(-60, 60)}px`,
        ["--rot" as string]: `${rand(-540, 540)}deg`,
      },
    }));
  const snow = season === "noel" || season === "hiver";
  const chars = FALLING[season];
  return Array.from({ length: snow ? (season === "noel" ? 26 : 18) : 14 }, () => ({
    kind: "fall" as const,
    char: chars[Math.floor(rand(0, chars.length))],
    style: {
      left: `${rand(0, 100)}vw`,
      fontSize: `${rand(snow ? 10 : 14, snow ? 20 : 22)}px`,
      color: snow ? "#9fb6cc" : undefined,
      opacity: snow ? 0.8 : 0.9,
      animationDuration: `${rand(6, 10)}s`,
      animationDelay: `${rand(0, 3)}s`,
      ["--dx" as string]: `${rand(-40, 40)}px`,
      ["--rot" as string]: `${rand(-180, 180)}deg`,
    },
  }));
}

const LAST = "pecule.decor.last";
const PREVIEW = "pecule.decor.preview";

/** Dernier décor joué sur cet appareil. */
function lastDecor(): { season: string; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST) ?? "null") as { season?: unknown; at?: unknown } | null;
    return v && typeof v.season === "string" && typeof v.at === "number" ? { season: v.season, at: v.at } : null;
  } catch {
    return null;
  }
}

export function SeasonDecor() {
  const season = useSeason();
  const { pathname } = useLocation();
  const [show, setShow] = useState<{ season: Season; at: number } | null>(null);
  useEffect(() => {
    if (!season || pathname !== "/") return;
    const play = () => {
      if (document.visibilityState !== "visible") return;
      const preview = sessionStorage.getItem(PREVIEW) === season;
      sessionStorage.removeItem(PREVIEW);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const at = Date.now();
      if (!preview && !decorDue(season, lastDecor(), at)) return;
      // Anciennes marques (une par jour ou par saison) : retirées au passage.
      for (const k of Object.keys(localStorage)) if (k.startsWith("pecule.decor.") && k !== LAST) localStorage.removeItem(k);
      localStorage.setItem(LAST, JSON.stringify({ season, at }));
      setShow({ season, at });
    };
    play();
    // Retour dans l'appli restée ouverte en arrière-plan : l'écran n'est pas rechargé.
    document.addEventListener("visibilitychange", play);
    return () => {
      document.removeEventListener("visibilitychange", play);
    };
  }, [season, pathname]);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(null), DURATION);
    return () => {
      clearTimeout(t);
    };
  }, [show]);
  const list = useMemo(() => (show ? pieces(show.season) : []), [show]);
  // Le décor ne suit pas sur un autre écran.
  if (!show || pathname !== "/") return null;
  return createPortal(
    <div key={show.at} aria-hidden className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
      {list.map((p, i) => (
        <span key={i} className={p.kind === "fly" ? "decor-fly" : "decor-piece"} style={p.style}>
          {p.char}
        </span>
      ))}
    </div>,
    document.body,
  );
}
