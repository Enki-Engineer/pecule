import { exec, one } from "./db.ts";
import { runReal } from "./demo-context.ts";

/*
 * Bienvenue : la présentation qu'un membre voit à sa première connexion (écran /bienvenue, règles dans
 * src/lib/onboarding.ts). Elle l'attend à partir du moment où il crée sa première clé d'accès, et jusqu'à ce qu'il
 * l'ait finie ou passée : l'état est gardé par membre dans app_kv (« bienvenue:<membre> »), pour le suivre d'un
 * appareil à l'autre. Toujours dans la vraie base : un membre n'est jamais accueilli en démo.
 *
 * Un membre inscrit avant cette présentation n'a pas de ligne : rien ne s'ouvre pour lui, il la rejoue s'il veut.
 */

const key = (userId: number) => `bienvenue:${Number(userId)}`;

/** La présentation attend-elle ce membre ? */
export async function awaitsWelcome(userId: number): Promise<boolean> {
  const row = await runReal(() => one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key(userId)]));
  return row?.value === "a_faire";
}

/** Première clé d'accès d'un membre : la présentation l'attend. Sans effet sur celui qui l'a déjà vue. */
export async function expectWelcome(userId: number): Promise<void> {
  await runReal(() => exec("INSERT IGNORE INTO app_kv (`key`, value) VALUES (?, 'a_faire')", [key(userId)]));
}

/** Présentation finie ou passée : elle ne s'ouvre plus d'elle-même pour ce membre. */
export async function closeWelcome(userId: number): Promise<void> {
  await runReal(() => exec("INSERT INTO app_kv (`key`, value) VALUES (?, 'fait') ON DUPLICATE KEY UPDATE value = VALUES(value)", [key(userId)]));
}
