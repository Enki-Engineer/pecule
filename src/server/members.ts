import { one, q } from "./db.ts";

/*
 * Membres du foyer : ceux qui se connectent à Pécule. Rien n'est écrit pour un foyer précis : les prénoms
 * viennent de la table `users`, et l'administrateur est le membre qui en porte le rôle.
 */

export type Member = { id: number; name: string; role: "admin" | "membre" };

/** Prénom inconnu donné à un import ou à un outil : erreur 400, jamais un rattachement silencieux au foyer. */
export class UnknownMemberError extends Error {
  status = 400;
  constructor(name: string, known: string[]) {
    super(`Membre inconnu : ${name} (membres : ${known.join(", ") || "aucun"})`);
  }
}

/** Membres dans l'ordre de leur création. */
export const listMembers = () => q<Member>("SELECT id, name, role FROM users ORDER BY id");

/** Administrateur au nom duquel agit le jeton d'administration : le premier membre qui en porte le rôle. */
export const adminMember = () => one<Member>("SELECT id, name, role FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");

/** Membre d'après son prénom (sans tenir compte de la casse). */
export async function memberByName(name: string): Promise<Member> {
  const m = await one<Member>("SELECT id, name, role FROM users WHERE name = ?", [name.trim()]);
  if (!m) throw new UnknownMemberError(name, (await listMembers()).map((u) => u.name));
  return m;
}

/** Propriétaire donné par son prénom à un import : son identifiant, ou null (bien commun) si rien n'est donné. */
export const memberIdByName = async (name: string | null | undefined): Promise<number | null> => (name ? (await memberByName(name)).id : null);
