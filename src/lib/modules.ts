import { tk } from "./i18n.ts";

/*
 * Écrans facultatifs de Pécule : un foyer sans bien immobilier ou sans crypto n'a pas à voir ces écrans.
 * Le réglage est celui du foyer (liste des écrans retirés, vide par défaut). Retirer un écran ne supprime
 * aucune donnée : il sort du menu, de la palette et des raccourcis, et son adresse ramène à l'accueil.
 */

export const MODULES = ["immobilier", "crypto", "projections", "revenus", "impots", "retraite"] as const;
export type ModuleId = (typeof MODULES)[number];

export const MODULE_INFO: Record<ModuleId, { label: string; hint: string; paths: string[] }> = {
  immobilier: { label: tk("Immobilier"), hint: tk("Biens, valeur, loyers, taxe foncière"), paths: ["/immobilier"] },
  crypto: { label: tk("Crypto"), hint: tk("Positions, cours, journal des mouvements"), paths: ["/patrimoine/crypto"] },
  projections: { label: tk("Projections"), hint: tk("Scénarios de patrimoine à plusieurs années"), paths: ["/projections"] },
  revenus: { label: tk("Revenus"), hint: tk("Bulletins de paie, sources de revenus"), paths: ["/revenus"] },
  impots: { label: tk("Impôts"), hint: tk("Impôt sur le revenu, taxes foncières"), paths: ["/impots"] },
  retraite: { label: tk("Retraite"), hint: tk("Carrière, trimestres, estimations"), paths: ["/retraite"] },
};

/** Écrans qui lisent des documents français (avis d'impôt, relevé de carrière) : retirés d'office quand le foyer vit ailleurs, et remis à la demande. */
export const FRENCH_MODULES: readonly ModuleId[] = ["impots", "retraite"];

const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`);

/** L'écran facultatif auquel appartient une adresse, ou null (écran toujours présent). */
export function moduleOfPath(path: string): ModuleId | null {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return MODULES.find((m) => MODULE_INFO[m].paths.some((p) => under(clean, p))) ?? null;
}

/** Liste valide des écrans retirés, à partir de n'importe quelle valeur enregistrée. */
export function cleanModulesOff(value: unknown): ModuleId[] {
  if (!Array.isArray(value)) return [];
  return MODULES.filter((m) => value.includes(m));
}

/** Une adresse est-elle affichable avec ces écrans retirés ? */
export const pathEnabled = (path: string, off: readonly string[]): boolean => {
  const m = moduleOfPath(path);
  return !m || !off.includes(m);
};
