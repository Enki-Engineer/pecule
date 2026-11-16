import { exec, one } from "./db.ts";
import { cleanLayout, type DashLayout } from "../lib/dashboard.ts";

/*
 * Agencement du tableau de bord d'un membre (src/lib/dashboard.ts) : ses chiffres clés et ses cartes, dans l'ordre,
 * avec leur largeur. Gardé par le serveur pour le suivre d'un ordinateur à l'autre ; l'accueil du téléphone garde le
 * sien sur l'appareil.
 */

const key = (userId: number) => `dash:${Number(userId)}`;

/** `null` tant que le membre n'a rien arrangé : l'écran montre alors la vue d'ensemble. */
export async function dashLayout(userId: number): Promise<DashLayout | null> {
  const row = await one<{ value: string }>("SELECT value FROM app_kv WHERE `key` = ?", [key(userId)]);
  if (!row) return null;
  try {
    return cleanLayout(JSON.parse(row.value));
  } catch {
    return null;
  }
}

export async function saveDashLayout(userId: number, layout: DashLayout): Promise<DashLayout> {
  await exec("INSERT INTO app_kv (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [key(userId), JSON.stringify(layout)]);
  return layout;
}
