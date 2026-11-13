import { DEFAULT_LANG, isLang, registerData, registerDict, setLangResolver, type Dict, type Lang } from "../lib/i18n.ts";

/*
 * Langue de Pécule sur cet appareil. Elle est choisie par le membre (Réglages → Apparence → Langue, gardée
 * sur le serveur : elle le suit sur tous ses appareils, dans l'assistant et à la voix) et recopiée ici pour
 * être connue avant le premier rendu, écran de connexion compris. Sans choix : le français — la langue du
 * navigateur ne décide de rien.
 *
 * `initLang()` est appelé par `main.tsx` avant de charger l'appli : le dictionnaire de la langue est en place
 * quand les modules des écrans s'évaluent, donc `t()` fonctionne partout, constantes de module comprises.
 * Changer de langue recharge la page : aucun écran n'a à se redessiner à chaud.
 */

const KEY = "pecule.lang";
/** Langue pour laquelle un rechargement vient d'être demandé (garde-fou contre un rechargement en boucle). */
const RELOAD_KEY = "pecule.lang.reload";
let lang: Lang = DEFAULT_LANG;

/** Dictionnaires chargés à la demande : un appareil en français n'en télécharge aucun. */
const DICTS: Record<Exclude<Lang, "fr">, () => Promise<Dict>> = {
  en: () => import("../i18n/en.ts").then((m) => m.en),
  de: () => import("../i18n/de.ts").then((m) => m.de),
  it: () => import("../i18n/it.ts").then((m) => m.it),
  es: () => import("../i18n/es.ts").then((m) => m.es),
};

/** Langue de l'appli sur cet appareil. */
export const appLang = (): Lang => lang;

export async function initLang() {
  const saved = localStorage.getItem(KEY);
  const wanted = isLang(saved) ? saved : DEFAULT_LANG;
  if (wanted !== "fr") {
    try {
      registerDict(wanted, await DICTS[wanted]());
      lang = wanted;
    } catch {
      // Dictionnaire injoignable (hors ligne, jamais chargé) : l'appli s'ouvre en français plutôt que pas du tout.
    }
  }
  setLangResolver(() => lang);
  document.documentElement.lang = lang;
  // Le rechargement demandé par applyLang a abouti : la marque peut tomber.
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === lang) sessionStorage.removeItem(RELOAD_KEY);
  } catch {
    // stockage de session indisponible
  }
  // Noms de catégories et de postes gardés du dernier passage : traduits dès le premier rendu, même hors ligne.
  const kept = readData();
  if (kept) registerData(lang, kept);
}

/* ---------- Noms de données (catégories, postes) : traduits par le serveur, gardés sur l'appareil ---------- */

const DATA_KEY = "pecule.lang.data";

function readData(): Record<string, string> | null {
  try {
    const saved = JSON.parse(localStorage.getItem(DATA_KEY) ?? "null") as { lang?: string; names?: Record<string, string> } | null;
    return saved?.lang === lang && saved.names ? saved.names : null;
  } catch {
    return null;
  }
}

/** Vrai si l'appareil a déjà les noms traduits de sa langue (sinon l'écran attend le premier envoi du serveur). */
export const hasData = () => readData() !== null;

/** Adopte les noms reçus du serveur ; rend vrai s'ils ont changé (l'écran doit se redessiner). */
export function adoptData(names: Record<string, string>): boolean {
  const before = JSON.stringify(readData() ?? {});
  const after = JSON.stringify(names);
  registerData(lang, names);
  localStorage.setItem(DATA_KEY, JSON.stringify({ lang, names }));
  return before !== after;
}

/**
 * Adopte une langue sur cet appareil ; recharge la page si elle change. Jamais deux rechargements de suite pour
 * la même langue : si l'appareil ne garde pas le choix (stockage refusé, navigation privée), l'appli reste dans
 * sa langue du moment au lieu de se recharger en boucle.
 */
export function applyLang(next: Lang) {
  try {
    localStorage.setItem(KEY, next);
    if (localStorage.getItem(KEY) !== next) return;
    if (next === lang) return;
    localStorage.removeItem(DATA_KEY);
    if (sessionStorage.getItem(RELOAD_KEY) === next) return;
    sessionStorage.setItem(RELOAD_KEY, next);
  } catch {
    return;
  }
  location.reload();
}
