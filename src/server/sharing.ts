import { exec, one, q } from "./db.ts";
import { isDemo } from "./demo-context.ts";
import { listMembers, type Member } from "./members.ts";

/*
 * Partage des revenus avec le foyer. Les bulletins de paie et les déclarations d'impôt personnelles d'un membre ne
 * regardent que lui ; il peut choisir de les compter dans la vue « Foyer » des écrans Revenus et Impôts, où les
 * autres membres lisent alors ses montants — jamais ses documents, qui restent privés au coffre. Un réglage par
 * membre, gardé dans app_kv (« partage:revenus:<id> »), éteint tant qu'il ne l'a pas allumé lui-même. La famille de
 * la démo partage d'office : c'est ce qui montre la vue du foyer.
 */

export type Scope = "foyer" | "moi";

const key = (userId: number) => `partage:revenus:${Number(userId)}`;
const PREFIX = "partage:revenus:";

export async function incomeShared(userId: number): Promise<boolean> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key(userId)]);
  return row ? row.value === "on" : isDemo();
}

export async function setIncomeShared(userId: number, shared: boolean) {
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key(userId), shared ? "on" : "off"]);
}

export type Audience = {
  me: Member;
  /** Membres dont les revenus sont lus : moi, puis — dans la vue du foyer — ceux qui partagent les leurs. Dans l'ordre des membres. */
  shown: Member[];
  /** Autres membres qui ne partagent pas leurs revenus : la vue du foyer le dit, sans rien montrer d'eux. */
  withheld: Member[];
  /** Le foyer compte plusieurs membres : il y a une différence possible entre « Foyer » et « Moi ». */
  several: boolean;
  /** Est-ce que je partage mes propres revenus ? */
  sharing: boolean;
};

/** Qui est compté dans la vue d'un membre, selon le périmètre choisi. */
export async function audience(userId: number, scope: Scope): Promise<Audience> {
  const [members, rows] = await Promise.all([listMembers(), q<{ key: string; value: string }>("SELECT `key`, value FROM app_kv WHERE `key` LIKE ?", [`${PREFIX}%`])]);
  const set = new Map(rows.map((r) => [Number(r.key.slice(PREFIX.length)), r.value === "on"]));
  const shares = (id: number) => set.get(id) ?? isDemo();
  const me = members.find((m) => m.id === userId) ?? { id: userId, name: "", role: "membre" as const };
  const others = members.filter((m) => m.id !== userId);
  return {
    me,
    shown: scope === "moi" ? [me] : members.filter((m) => m.id === userId || shares(m.id)),
    withheld: others.filter((m) => !shares(m.id)),
    several: members.length > 1,
    sharing: shares(userId),
  };
}
