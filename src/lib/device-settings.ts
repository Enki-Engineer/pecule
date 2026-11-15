import { ACCENTS, type SeasonMode } from "./seasons.ts";
import { tk } from "./i18n.ts";

/*
 * Réglages gardés par l'appareil (stockage du navigateur), que l'assistant peut changer à la demande : le serveur ne
 * les connaît pas, il renvoie donc à l'écran, avec l'action confirmée, ce qu'il doit appliquer (`ClientEffect`).
 * Les noms affichés sont ceux de Réglages → Apparence.
 */

export const THEME_PREFS = ["auto", "clair", "sombre"] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export const DENSITIES = ["aeree", "compacte"] as const;
export type Density = (typeof DENSITIES)[number];
export const SEASON_MODES = ["tout", "fetes", "aucun"] as const satisfies readonly SeasonMode[];
export const ACCENT_IDS = ACCENTS.map((a) => a.id) as [string, ...string[]];

export type DeviceSettings = {
  /** Clair, sombre, ou comme l'appareil. */
  theme?: ThemePref;
  /** Couleur de l'appli (`ACCENTS`). */
  accent?: string;
  /** Thèmes de l'année : fêtes et saisons, fêtes seulement, aucun. */
  seasons?: SeasonMode;
  /** Densité de l'affichage sur ordinateur. */
  density?: Density;
  /** Mode discret : les montants sont masqués. */
  discreet?: boolean;
  /** Ouverture instantanée : les dernières données de synthèse sont gardées sur l'appareil. */
  instantOpen?: boolean;
};

/**
 * Ce que l'écran fait quand une action de l'assistant vient d'être confirmée : appliquer des réglages de l'appareil,
 * ou relire l'identité du membre (sa langue, les écrans affichés, le jour retenu pour les opérations en dépendent).
 */
export type ClientEffect = { device?: DeviceSettings; refreshMember?: boolean };

export const THEME_LABELS: Record<ThemePref, string> = { auto: tk("Auto"), clair: tk("Clair"), sombre: tk("Sombre") };
export const DENSITY_LABELS: Record<Density, string> = { aeree: tk("Aérée"), compacte: tk("Compacte") };
export const SEASON_MODE_LABELS: Record<SeasonMode, string> = { tout: tk("Fêtes et saisons"), fetes: tk("Fêtes seulement"), aucun: tk("Aucun##thème") };
