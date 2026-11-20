// Types de `reglages.mjs` (script sans dépendance, lu tel quel par Node) pour les tests et l'éditeur.
export type InstallSettings = {
  env: Record<string, string>;
  inside: boolean;
  docker: boolean;
  fresh: boolean;
  file: string | null;
  asked: string | null;
  kept: boolean;
  keptFile: string | null;
  dir: string | null;
};
export const ROOT: string;
export function parseSettings(text: string): Record<string, string>;
export function composeDir(): string | null;
export function dockerState(): "pret" | "arrete" | "absent";
export function loadSettings(options?: { file?: string }): InstallSettings;
export function localPort(settings: InstallSettings): string;
export function run(settings: Pick<InstallSettings, "inside" | "docker" | "file">, command: string): string;
