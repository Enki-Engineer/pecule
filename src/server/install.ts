import { existsSync } from "node:fs";
import { DESKTOP_FLAG } from "../lib/desktop.ts";
import type { InstallKind } from "../lib/install.ts";

/**
 * Comment cette installation est tenue (`src/lib/install.ts`) : les commandes que l'appli affiche à celui qui
 * l'héberge en dépendent. L'image Docker le dit elle-même par SETTINGS_DIR ; `/.dockerenv` reconnaît un conteneur
 * lancé autrement ; le superviseur de l'appli de bureau le dit par PECULE_BUREAU. Ce module ne dépend ni des réglages
 * ni de la base.
 */
export const installKind = (): InstallKind => (process.env[DESKTOP_FLAG] === "1" ? "bureau" : process.env.SETTINGS_DIR?.trim() || existsSync("/.dockerenv") ? "docker" : "node");
