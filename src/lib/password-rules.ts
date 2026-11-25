import { t } from "./i18n.ts";

/*
 * Règles d'un mot de passe de Pécule, les mêmes à l'écran et sur le serveur. La longueur d'abord : douze caractères
 * au moins, sans obligation de chiffres ni de signes — une phrase convient. La clé d'accès reste la connexion
 * proposée d'abord ; le mot de passe sert là où elle ne peut pas se créer.
 */

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

/** `court`, `long`, ou `simple` (un même caractère répété, ou le prénom suivi de chiffres) ; `null` s'il convient. */
export type PasswordProblem = "court" | "long" | "simple";

export function passwordProblem(password: string, name?: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN) return "court";
  if (length > PASSWORD_MAX) return "long";
  if (new Set(password.toLowerCase()).size < 5) return "simple";
  const letters = password.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (name && letters === name.trim().toLowerCase().replace(/[^\p{L}]/gu, "")) return "simple";
  return null;
}

/** Le refus, dit au membre (dans sa langue : à appeler pendant une requête, ou à l'écran). */
export function passwordProblemText(problem: PasswordProblem): string {
  if (problem === "court") return t("Le mot de passe doit compter au moins {n} caractères.", { n: PASSWORD_MIN });
  if (problem === "long") return t("Le mot de passe est trop long ({n} caractères au plus).", { n: PASSWORD_MAX });
  return t("Ce mot de passe se devine trop facilement : choisis une phrase, ou plusieurs mots.");
}
