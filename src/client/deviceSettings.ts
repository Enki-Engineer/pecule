import type { QueryClient } from "@tanstack/react-query";
import type { ClientEffect, DeviceSettings } from "../lib/device-settings.ts";
import { asAccent } from "../lib/seasons.ts";
import { setDiscreet } from "./discret.ts";
import { setOfflineCache } from "./offline.tsx";
import { setAccentPref, setDensityPref, setSeasonModePref, setThemePref } from "./theme.ts";

/*
 * Réglages de l'appareil changés par l'assistant : le serveur ne garde ni l'apparence ni le mode discret, il
 * renvoie avec l'action confirmée ce qu'il faut appliquer ici (src/lib/device-settings.ts). Chaque réglage passe
 * par la même fonction que l'écran Réglages : l'effet est immédiat, et mémorisé sur l'appareil.
 */

export function applyDeviceSettings(d: DeviceSettings) {
  if (d.theme) setThemePref(d.theme);
  if (d.accent) setAccentPref(asAccent(d.accent));
  if (d.seasons) setSeasonModePref(d.seasons);
  if (d.density) setDensityPref(d.density);
  if (d.instantOpen !== undefined) setOfflineCache(d.instantOpen);
  // En dernier : basculer le mode discret fait redessiner toute l'appli.
  if (d.discreet !== undefined) setDiscreet(d.discreet);
}

/** Applique ce que demande une action de l'assistant tout juste confirmée. */
export function applyEffects(effects: ClientEffect[] | undefined, qc: QueryClient) {
  for (const e of effects ?? []) {
    if (e.device) applyDeviceSettings(e.device);
    // Langue, écrans affichés, jour retenu : ils arrivent avec l'identité du membre (une nouvelle langue recharge l'appli).
    if (e.refreshMember) void qc.invalidateQueries({ queryKey: ["me"] });
  }
}
