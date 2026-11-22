import { AsyncLocalStorage } from "node:async_hooks";
import type { NextFunction, Request, Response } from "express";
import { asSeasonMode, DEFAULT_SEASON_MODE, type SeasonMode } from "../lib/seasons.ts";

/*
 * Thèmes de l'année : le réglage est gardé par l'appareil (aucun, fêtes seulement, fêtes et saisons), pas par le
 * serveur. L'écran le dit à chaque requête (en-tête `X-Themes`) : ce que le serveur écrit pour cet écran — l'unité
 * amusante du thème du moment dans les réponses de l'assistant — ne parle d'un thème qu'à qui l'affiche. Sans
 * en-tête (jeton, serveur MCP, tâche de fond) : le réglage d'origine, aucun thème.
 */

const store = new AsyncLocalStorage<SeasonMode>();

/** Middleware : retient pour la requête le réglage des thèmes de l'appareil qui l'envoie. */
export function themesContext(req: Request, _res: Response, next: NextFunction) {
  store.run(asSeasonMode(req.get("x-themes")), next);
}

/** Réglage « Thèmes de l'année » de l'appareil qui a fait la requête en cours. */
export const deviceSeasonMode = (): SeasonMode => store.getStore() ?? DEFAULT_SEASON_MODE;
