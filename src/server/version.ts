import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanVersion } from "../lib/version.ts";

/*
 * La version de Pécule en service. Le build l'inscrit dans `dist/server.mjs` (`scripts/build-server.mjs`) : le
 * serveur la connaît même sans `package.json` à côté de lui. En développement et dans les tests, elle se lit dans
 * `package.json`. Ce module ne dépend ni des réglages ni de la base.
 */

declare const __PECULE_VERSION__: string | undefined;
declare const __PECULE_DEPUIS__: string | undefined;

const here = path.dirname(fileURLToPath(import.meta.url));

/** Racine de l'installation : le premier dossier, en remontant, qui porte un `package.json` (à défaut, le dossier courant). */
export function appRoot(): string {
  for (let dir = here, i = 0; i < 6; i++, dir = path.dirname(dir)) if (existsSync(path.join(dir, "package.json"))) return dir;
  return process.cwd();
}

function readPackage(): { version?: string; pecule?: { depuis?: string } } {
  try {
    return JSON.parse(readFileSync(path.join(appRoot(), "package.json"), "utf8"));
  } catch {
    return {};
  }
}

const built = typeof __PECULE_VERSION__ === "string";
const pkg = built ? {} : readPackage();

/** Version en service (« 1.22.0 »). */
export const VERSION: string = cleanVersion(built ? __PECULE_VERSION__ : pkg.version) ?? "0.0.0";

/**
 * Plus ancienne version depuis laquelle celle-ci se met à jour directement (`pecule.depuis` de `package.json`) : les
 * migrations antérieures sont repliées dans le schéma de départ, une base restée en deçà doit d'abord passer par elle.
 */
export const DEPUIS: string = cleanVersion(typeof __PECULE_DEPUIS__ === "string" ? __PECULE_DEPUIS__ : pkg.pecule?.depuis) ?? VERSION;
