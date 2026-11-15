import { region } from "./region.ts";
import { useEffect, useState } from "react";
import { asAccent, birthdaysAt, DEFAULT_ACCENT, parseBirthdays, seasonAt, SEASONS, type Accent, type Birthday, type Season, type SeasonMode } from "../lib/seasons.ts";
import { locale } from "../lib/i18n.ts";
import { asFond, asHomeTheme, homeIconId, logoId, manifestSrc, tabIconSrc, touchIconSrc, type LogoFond, type LogoId } from "../lib/logo.ts";
import type { Density, ThemePref } from "../lib/device-settings.ts";

export type { Density, ThemePref };
const KEY = "pecule.theme";

function apply(pref: ThemePref) {
  const dark = pref === "sombre" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

/** Préférence d'apparence (mémorisée sur l'appareil) ; « auto » suit le changement du système en direct. */
export function useTheme(): [ThemePref, (p: ThemePref) => void] {
  const [pref, setPref] = useState<ThemePref>(() => (localStorage.getItem(KEY) as ThemePref) || "auto");
  // Plusieurs composants utilisent le hook (coquille, Réglages) : ils se tiennent au courant.
  useEffect(() => {
    const sync = () => setPref((localStorage.getItem(KEY) as ThemePref) || "auto");
    window.addEventListener("pecule-theme", sync);
    return () => {
      window.removeEventListener("pecule-theme", sync);
    };
  }, []);
  useEffect(() => {
    apply(pref);
    if (pref !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("auto");
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
    };
  }, [pref]);
  return [pref, setThemePref];
}

/** Change la préférence, d'un écran ou d'ailleurs (réglage demandé à l'assistant) : tous ceux qui l'affichent suivent. */
export function setThemePref(p: ThemePref) {
  localStorage.setItem(KEY, p);
  apply(p);
  window.dispatchEvent(new Event("pecule-theme"));
}

/* ---------- Couleur d'accent et thèmes de saison ---------- */


const ACCENT_KEY = "pecule.accent";
const SEASONS_KEY = "pecule.seasons";
const BIRTHDAYS_KEY = "pecule.anniversaires";
let preview: Season | null = null;

/** Anniversaires du foyer recopiés sur l'appareil (lus aussi par public/theme-init.js avant le premier rendu). */
function storedBirthdays(): Birthday[] {
  try {
    return parseBirthdays(JSON.parse(localStorage.getItem(BIRTHDAYS_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** Recopie la liste du serveur sur l'appareil et réapplique le thème (un anniversaire ajouté pour aujourd'hui se voit tout de suite). */
export function storeBirthdays(list: Birthday[]) {
  const next = JSON.stringify(parseBirthdays(list));
  if (localStorage.getItem(BIRTHDAYS_KEY) === next) return;
  localStorage.setItem(BIRTHDAYS_KEY, next);
  applyAppearance();
}

/** Réglage des thèmes de l'année ; l'ancien « off » vaut « aucun », l'ancien « on » vaut « tout ». */
export function seasonMode(): SeasonMode {
  const v = localStorage.getItem(SEASONS_KEY);
  return v === "off" || v === "aucun" ? "aucun" : v === "fetes" ? "fetes" : "tout";
}

/** Applique couleur et thème de l'année (aperçu prioritaire, sinon celui du jour selon le réglage). */
export function applyAppearance() {
  const root = document.documentElement;
  const accent = asAccent(localStorage.getItem(ACCENT_KEY));
  if (accent !== DEFAULT_ACCENT) root.dataset.accent = accent;
  else delete root.dataset.accent;
  const season = preview ?? seasonAt(new Date(), seasonMode(), storedBirthdays(), region().country);
  if (season) root.dataset.season = season;
  else delete root.dataset.season;
  applyLogo(season);
  window.dispatchEvent(new Event("pecule-appearance"));
}

/* ---------- Logo : le coffre suit le thème ; l'icône de l'écran d'accueil se choisit ---------- */

const FOND_KEY = "pecule.logo.fond";
const HOME_KEY = "pecule.logo.icone";

function setLink(rel: string, href: string) {
  const l = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (l && l.getAttribute("href") !== href) l.setAttribute("href", href);
}

/** Logo du moment (thème, sinon fond choisi) dans l'onglet ; icône et manifeste de l'écran d'accueil selon le choix. */
function applyLogo(season: Season | null) {
  const fond = asFond(localStorage.getItem(FOND_KEY));
  const id = logoId(season, fond);
  document.documentElement.dataset.logo = id;
  setLink("icon", tabIconSrc(id));
  const home = homeIconId(localStorage.getItem(HOME_KEY), fond);
  setLink("apple-touch-icon", touchIconSrc(home));
  setLink("manifest", manifestSrc(home));
}

/** Logo affiché en ce moment (posé par theme-init.js avant le premier rendu), suivi en direct. */
export function useLogoId(): LogoId {
  const read = () => (document.documentElement.dataset.logo as LogoId | undefined) ?? asFond(localStorage.getItem(FOND_KEY));
  const [id, setId] = useState(read);
  useEffect(() => {
    const on = () => setId(read());
    window.addEventListener("pecule-appearance", on);
    return () => {
      window.removeEventListener("pecule-appearance", on);
    };
  }, []);
  return id;
}

/** Réglages du logo sur cet appareil : fond du coffre de tous les jours, icône de l'écran d'accueil. */
export function useLogo() {
  const [fond, setFondState] = useState<LogoFond>(() => asFond(localStorage.getItem(FOND_KEY)));
  const [home, setHomeState] = useState<Season | null>(() => asHomeTheme(localStorage.getItem(HOME_KEY)));
  return {
    fond,
    setFond: (f: LogoFond) => {
      localStorage.setItem(FOND_KEY, f);
      setFondState(f);
      applyAppearance();
    },
    home,
    setHome: (h: Season | null) => {
      if (h) localStorage.setItem(HOME_KEY, h);
      else localStorage.removeItem(HOME_KEY);
      setHomeState(h);
      applyAppearance();
    },
  };
}

/** Saison affichée en ce moment (aperçu compris), suivie en direct. */
export function useSeason(): Season | null {
  const read = () => (document.documentElement.dataset.season as Season | undefined) ?? null;
  const [s, setS] = useState(read);
  useEffect(() => {
    const on = () => setS(read());
    window.addEventListener("pecule-appearance", on);
    return () => {
      window.removeEventListener("pecule-appearance", on);
    };
  }, []);
  return s;
}

/** Salutation du thème affiché (« Joyeux Noël 🎄 », « Joyeux anniversaire Camille 🎂 »), ou null pour une saison. */
export function useSeasonGreeting(): string | null {
  const season = useSeason();
  if (!season || !SEASONS[season].greeting) return null;
  const names = season === "anniversaire" ? birthdaysAt(new Date(), storedBirthdays()).map((b) => b.name) : [];
  // « Camille et Alex », « Camille and Alex »… : la conjonction suit la langue.
  const who = names.length ? ` ${new Intl.ListFormat(locale(), { type: "conjunction" }).format(names)}` : "";
  return `${SEASONS[season].greeting}${who} ${SEASONS[season].emoji}`;
}

/* ---------- Densité (ordinateur) ---------- */

const DENSITY_KEY = "pecule.densite";
const readDensity = (): Density => (localStorage.getItem(DENSITY_KEY) === "compacte" ? "compacte" : "aeree");

/** Change la densité, d'un écran ou d'ailleurs (réglage demandé à l'assistant). */
export function setDensityPref(d: Density) {
  if (d === "compacte") localStorage.setItem(DENSITY_KEY, d);
  else localStorage.removeItem(DENSITY_KEY);
  if (d === "compacte") document.documentElement.dataset.density = "compact";
  else delete document.documentElement.dataset.density;
  window.dispatchEvent(new Event("pecule-density"));
}

/**
 * Densité de l'affichage sur ordinateur, mémorisée sur l'appareil (posée avant le premier rendu par
 * public/theme-init.js). « Compacte » resserre marges, lignes et cartes — la taille du texte ne change pas.
 */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = useState<Density>(readDensity);
  useEffect(() => {
    const sync = () => setDensity(readDensity());
    window.addEventListener("pecule-density", sync);
    return () => {
      window.removeEventListener("pecule-density", sync);
    };
  }, []);
  return [density, setDensityPref];
}

/** Change la couleur de l'appli, d'un écran ou d'ailleurs (réglage demandé à l'assistant). */
export function setAccentPref(a: Accent) {
  localStorage.setItem(ACCENT_KEY, a);
  applyAppearance();
}

/** Change le réglage des thèmes de l'année, d'un écran ou d'ailleurs. */
export function setSeasonModePref(mode: SeasonMode) {
  localStorage.setItem(SEASONS_KEY, mode);
  applyAppearance();
}

/** Réglages d'apparence de l'appareil : couleur, thèmes de saison, aperçu d'une saison. */
export function useAppearance() {
  const [accent, setAccentState] = useState<Accent>(() => asAccent(localStorage.getItem(ACCENT_KEY)));
  const [seasons, setSeasonsState] = useState<SeasonMode>(seasonMode);
  const [previewing, setPreviewing] = useState<Season | null>(preview);
  // Le réglage peut changer ailleurs que sur cet écran (assistant) : il est relu à chaque application.
  useEffect(() => {
    const sync = () => {
      setAccentState(asAccent(localStorage.getItem(ACCENT_KEY)));
      setSeasonsState(seasonMode());
    };
    window.addEventListener("pecule-appearance", sync);
    return () => {
      window.removeEventListener("pecule-appearance", sync);
    };
  }, []);
  return {
    accent,
    setAccent: setAccentPref,
    seasons,
    setSeasons: setSeasonModePref,
    previewing,
    setPreview: (s: Season | null) => {
      preview = s;
      setPreviewing(s);
      applyAppearance();
    },
  };
}
