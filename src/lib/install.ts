import { DOCKER_IMAGE } from "./version.ts";

/*
 * Comment une installation de Pécule est tenue, et les commandes qui vont avec : celles que l'appli affiche à celui
 * qui l'héberge (lien du premier démarrage, mise à jour) dépendent de la façon dont elle a été installée. Fonctions
 * pures, partagées par le serveur, l'écran et les tests.
 *
 *   - « docker » : l'image publiée, lancée par `compose.yaml` — il n'y a ni dépôt ni Node sur la machine, tout se
 *     commande par `docker compose` ;
 *   - « node » : le serveur tourne directement sur Node.js (archive prête à l'emploi, ou dépôt construit sur place),
 *     avec ses scripts à côté de lui.
 */
export type InstallKind = "docker" | "node";

/** Donne le lien du premier démarrage (l'adresse de l'appli avec le code d'installation). */
export const linkCommand = (kind: InstallKind): string => (kind === "docker" ? "docker compose exec pecule node scripts/lien.mjs" : "node scripts/lien.mjs");

/** Installe la dernière version publiée. */
export const updateCommand = (kind: InstallKind): string => (kind === "docker" ? "docker compose pull && docker compose up -d" : "node scripts/maj.mjs");

/** Installe une version précise (une version palier), avant de repasser à la dernière. */
export const versionCommand = (kind: InstallKind, version: string): string => (kind === "docker" ? `PECULE_IMAGE=${DOCKER_IMAGE}:${version} docker compose up -d` : `node scripts/maj.mjs --version ${version}`);

/** Contrôle l'installation (réglages, serveur, version, sauvegardes). */
export const doctorCommand = (kind: InstallKind): string => (kind === "docker" ? "docker compose exec pecule node scripts/doctor.mjs" : "node scripts/doctor.mjs");
