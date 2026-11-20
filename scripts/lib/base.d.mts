// Types de `base.mjs` (script sans dépendance, lu tel quel par Node) pour les tests et l'éditeur.
export type DatabaseProbe = { reachable: true; version: string; tables: number } | { reachable: false; error: string } | null;
export function supported(version: string | null | undefined): boolean;
export function probeDatabase(url: string): Promise<DatabaseProbe>;
export function describeDatabase(probe: DatabaseProbe): string | null;
