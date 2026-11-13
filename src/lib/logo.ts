/*
 * Logo de Pécule : le coffre au trésor. Le coffre de tous les jours existe sur cinq fonds ;
 * pendant un thème de l'année, il prend le décor et le contenu du thème. Fichiers dessinés par
 * scripts/logo.mjs dans public/icons/coffre. Même calcul recopié dans public/theme-init.js.
 */
import { SEASONS, type Season } from "./seasons.ts";
import { localized, tk } from "./i18n.ts";

export const LOGO_FONDS = [
  localized({ id: "petrole", label: tk("Pétrole") }, "label"),
  localized({ id: "nuit", label: tk("Nuit") }, "label"),
  localized({ id: "foret", label: tk("Forêt") }, "label"),
  localized({ id: "sable", label: tk("Sable") }, "label"),
  localized({ id: "corail", label: tk("Corail") }, "label"),
] as const;
export type LogoFond = (typeof LOGO_FONDS)[number]["id"];
export type LogoId = LogoFond | Season;

/** Thèmes dans l'ordre de l'année : les saisons, puis les fêtes. */
export const LOGO_THEMES: Season[] = ["hiver", "printemps", "ete", "automne", "anniversaire", "nouvel-an", "epiphanie", "chandeleur", "saint-valentin", "saint-patrick", "paques", "14-juillet", "rentree", "halloween", "fete-lumieres", "noel"];

/** Fond mémorisé sur l'appareil ; pétrole par défaut ou si la valeur est inconnue. */
export const asFond = (v: string | null | undefined): LogoFond => LOGO_FONDS.find((f) => f.id === v)?.id ?? "petrole";

/** Thème choisi pour l'icône de l'écran d'accueil, ou null (« comme le logo »). */
export const asHomeTheme = (v: string | null | undefined): Season | null => (v && Object.hasOwn(SEASONS, v) ? (v as Season) : null);

/** Logo affiché dans l'appli et dans l'onglet : le thème du moment prime sur le fond choisi. */
export const logoId = (season: Season | null, fond: LogoFond): LogoId => season ?? fond;

/** Icône de l'écran d'accueil : le thème choisi, sinon le coffre de tous les jours. */
export const homeIconId = (choice: string | null | undefined, fond: LogoFond): LogoId => asHomeTheme(choice) ?? fond;

export const logoSrc = (id: LogoId) => `/icons/coffre/${id}.svg`;
export const tabIconSrc = (id: LogoId) => `/icons/coffre/onglet-${id}.svg`;
export const touchIconSrc = (id: LogoId) => `/icons/coffre/${id}-180.png`;
export const manifestSrc = (id: LogoId) => `/icons/coffre/${id}.webmanifest`;
