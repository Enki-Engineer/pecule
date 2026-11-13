/**
 * Restaure une sauvegarde complète de Pécule (`pnpm sauvegarde`, ou Réglages → Compte et sécurité)
 * dans une base MariaDB VIDE : structure, lignes, fichiers, puis contrôle (lignes de chaque table,
 * empreinte de chaque fichier relue dans la base). Ne touche jamais une base qui contient déjà une table.
 * Usage : pnpm restaurer <archive.zip> --base "mysql://utilisateur:motdepasse@hote:3306/base"
 */
import mysql from "mysql2/promise";
import { restoreBackup } from "../src/server/backup.ts";
import { fileSource } from "../src/server/zip.ts";

const argv = process.argv.slice(2);
const target = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : undefined;
const file = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--base");
if (!file || !target) throw new Error('Usage : pnpm restaurer <archive.zip> --base "mysql://utilisateur:motdepasse@hote:3306/base"');

const where = new URL(target);
console.log(`Restauration de ${file} dans la base « ${decodeURIComponent(where.pathname.slice(1))} » de ${where.hostname}:${where.port || 3306}`);
const started = Date.now();
const src = await fileSource(file);
const conn = await mysql.createConnection({ uri: target, charset: "utf8mb4", timezone: "Z", dateStrings: true });
try {
  const { manifest, problems } = await restoreBackup(src, conn, (line) => console.log(`  ${line}`));
  if (problems.length) {
    console.error(`✗ ${problems.length} écart(s) entre la base restaurée et la sauvegarde :`);
    for (const p of problems.slice(0, 30)) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    const n = (v: number) => v.toLocaleString("fr-FR");
    console.log(
      `✓ base restaurée et contrôlée en ${Math.round((Date.now() - started) / 1000)} s : ${n(manifest.totaux.tables)} tables, ${n(manifest.totaux.lignes)} lignes, ${n(manifest.totaux.fichiers)} fichiers — état du ${manifest.creeLe.slice(0, 16).replace("T", " à ")} UTC`,
    );
  }
} finally {
  await conn.end();
  await src.close?.();
}
