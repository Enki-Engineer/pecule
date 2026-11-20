import { existsSync } from "node:fs";
import type { InstallKind } from "../lib/install.ts";

/**
 * Comment cette installation est tenue (`src/lib/install.ts`) : les commandes que l'appli affiche à celui qui
 * l'héberge en dépendent. L'image Docker le dit elle-même par SETTINGS_DIR ; `/.dockerenv` reconnaît un conteneur
 * lancé autrement. Ce module ne dépend ni des réglages ni de la base.
 */
export const installKind = (): InstallKind => (process.env.SETTINGS_DIR?.trim() || existsSync("/.dockerenv") ? "docker" : "node");
