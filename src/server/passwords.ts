import { randomBytes } from "node:crypto";
import { exec, one } from "./db.ts";
import { runReal } from "./demo-context.ts";
import { hashPassword, verifyPassword } from "./password-hash.ts";

/*
 * Mots de passe des membres. La clé d'accès reste la connexion proposée d'abord ; le mot de passe sert là où elle ne
 * peut pas se créer (le http du réseau de la maison, une adresse IP, un appareil sans authentificateur), ou si le
 * membre le préfère. Tout ce qui suit lit et écrit la vraie base, jamais celle de la démo.
 *
 * - Seule une empreinte scrypt est gardée, avec ses réglages et son sel (`password-hash.ts`).
 * - Les essais sont freinés par membre : au cinquième mot de passe faux de suite, la connexion par mot de passe se
 *   ferme une minute, puis deux, quatre, huit, quinze. La clé d'accès du membre continue de marcher.
 * - L'administrateur peut exiger la clé d'accès (`passkeysOnly`, gardé dans app_kv « acces ») : plus aucun mot de
 *   passe n'est alors accepté ni gardé.
 */

/** Essais faux tolérés avant le premier arrêt. */
export const FREE_TRIES = 5;

/** Empreinte d'un mot de passe que personne n'a : elle fait durer autant l'essai sur un prénom inconnu que sur un vrai. */
let decoy: Promise<string> | null = null;
const decoyHash = () => (decoy ??= hashPassword(randomBytes(18).toString("base64url")));

/** L'administrateur exige-t-il la clé d'accès ? (Alors aucun mot de passe n'est accepté.) */
export async function passkeysOnly(): Promise<boolean> {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = 'acces'"));
  try {
    return (JSON.parse(row?.value ?? "{}") as { passkeysOnly?: unknown }).passkeysOnly === true;
  } catch {
    return false;
  }
}

/** Exiger la clé d'accès, ou admettre de nouveau le mot de passe. L'exiger efface tous les mots de passe gardés. */
export async function setPasskeysOnly(on: boolean): Promise<void> {
  await runReal(async () => {
    await exec("INSERT INTO app_kv (`key`, value) VALUES ('acces', ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [JSON.stringify({ passkeysOnly: on })]);
    if (on) await exec("DELETE FROM passwords");
  });
}

export const hasPassword = async (userId: number): Promise<boolean> => !!(await runReal(() => one("SELECT 1 AS x FROM passwords WHERE user_id = ?", [userId])));

/** Un membre au moins a-t-il un mot de passe ? (L'écran de connexion ne propose le mot de passe que dans ce cas.) */
export const anyPassword = async (): Promise<boolean> => !!(await runReal(() => one("SELECT 1 AS x FROM passwords LIMIT 1")));

/** Pose ou remplace le mot de passe d'un membre ; les essais faux comptés jusque-là sont oubliés. */
export async function setPassword(userId: number, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await runReal(() =>
    exec(
      "INSERT INTO passwords (user_id, hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE hash = VALUES(hash), failures = 0, locked_until = NULL, changed_at = UTC_TIMESTAMP()",
      [userId, hash],
    ),
  );
}

export async function removePassword(userId: number): Promise<void> {
  await runReal(() => exec("DELETE FROM passwords WHERE user_id = ?", [userId]));
}

/** Ce que vaut un essai : le bon mot de passe, un faux, ou une porte fermée encore `wait` secondes. */
export type Attempt = "ok" | "faux" | { wait: number };

/**
 * Un essai de mot de passe pour ce membre. L'essai est compté avant le calcul de l'empreinte, d'une seule instruction :
 * des demandes envoyées en même temps ne passent pas toutes sous l'arrêt, chacune prend son tour au compteur. Le bon
 * mot de passe remet le compteur à zéro.
 */
async function attempt(userId: number, hash: string, password: string): Promise<Attempt> {
  // L'arrêt est calculé avant que le compteur avance : la même instruction vaut pour MySQL et pour MariaDB.
  const counted = await exec(
    `UPDATE passwords SET locked_until = IF(failures + 1 >= ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL LEAST(15, 1 << LEAST(GREATEST(failures + 1 - ?, 0), 4)) MINUTE), NULL),
     failures = failures + 1 WHERE user_id = ? AND (locked_until IS NULL OR locked_until <= UTC_TIMESTAMP())`,
    [FREE_TRIES, FREE_TRIES, userId],
  );
  if (!counted.affectedRows) {
    const row = await one<{ wait: number | null }>("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), locked_until) AS wait FROM passwords WHERE user_id = ?", [userId]);
    return { wait: Math.max(1, Number(row?.wait ?? 60)) };
  }
  if (!(await verifyPassword(password, hash))) return "faux";
  await exec("UPDATE passwords SET failures = 0, locked_until = NULL WHERE user_id = ?", [userId]);
  return "ok";
}

/** Le mot de passe actuel d'un membre connecté, redemandé avant de le changer : l'essai compte comme une connexion. */
export async function currentPassword(userId: number, password: string): Promise<Attempt> {
  return runReal(async () => {
    const row = await one<{ hash: string }>("SELECT hash FROM passwords WHERE user_id = ?", [userId]);
    return row ? attempt(userId, row.hash, password) : "faux";
  });
}

/**
 * Connexion par prénom et mot de passe.
 *   - `{ userId }` : c'est bien lui ;
 *   - `{ wait }` : trop d'essais faux, la connexion par mot de passe de ce membre est fermée encore `wait` secondes ;
 *   - `null` : prénom inconnu, membre sans mot de passe ou mot de passe faux — la réponse ne dit pas lequel.
 */
export async function passwordLogin(name: string, password: string): Promise<{ userId: number } | { wait: number } | null> {
  return runReal(async () => {
    const row = await one<{ user_id: number; hash: string }>("SELECT p.user_id, p.hash FROM passwords p JOIN users u ON u.id = p.user_id WHERE u.name = ?", [name.trim()]);
    if (!row) {
      await verifyPassword(password, await decoyHash());
      return null;
    }
    const result = await attempt(row.user_id, row.hash, password);
    return result === "ok" ? { userId: row.user_id } : result === "faux" ? null : result;
  });
}
