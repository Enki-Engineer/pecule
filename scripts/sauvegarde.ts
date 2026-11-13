/**
 * Sauvegarde complète de Pécule : télécharge l'archive zip de la production (toute la base, les
 * factures, les documents du coffre, les logos), puis la relit en entier et la compare à son manifeste.
 * Usage : pnpm sauvegarde [--vers <dossier>]         (par défaut data/sauvegardes, hors dépôt)
 *         pnpm sauvegarde --verifier <archive.zip>    (relit une archive déjà téléchargée)
 * PECULE_URL et PECULE_API_TOKEN dans .env (jeton d'administration).
 */
import "dotenv/config";
import { createWriteStream, mkdirSync, renameSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { verifyBackup } from "../src/server/backup.ts";
import { fileSource } from "../src/server/zip.ts";

const argv = process.argv.slice(2);
const option = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const mo = (n: number) => `${(n / 1_048_576).toFixed(1).replace(".", ",")} Mo`;
const n = (v: number) => v.toLocaleString("fr-FR");

/** Relit l'archive ; renvoie vrai si tout correspond au manifeste. */
async function verify(file: string): Promise<boolean> {
  const src = await fileSource(file);
  try {
    const { manifest: m, problems } = await verifyBackup(src);
    console.log(`  sauvegarde du ${m.creeLe.slice(0, 16).replace("T", " à ")} UTC — base ${m.base} (${m.serveur})`);
    console.log(`  ${n(m.totaux.tables)} tables, ${n(m.totaux.lignes)} lignes, ${n(m.totaux.fichiers)} fichiers (${mo(m.totaux.octetsFichiers)}), dernière migration ${m.derniereMigration ?? "—"}`);
    if (problems.length) {
      console.error(`✗ ${problems.length} écart(s) avec le manifeste :`);
      for (const p of problems.slice(0, 30)) console.error(`  - ${p}`);
      return false;
    }
    console.log(`✓ archive complète : ${n(m.entrees.length)} fichiers relus, tailles et empreintes conformes (${mo(src.size)})`);
    return true;
  } finally {
    await src.close?.();
  }
}

const existing = option("--verifier");
if (existing) {
  console.log(`Vérification de ${existing}`);
  process.exit((await verify(existing)) ? 0 : 1);
}

const url = process.env.PECULE_URL;
const token = process.env.PECULE_API_TOKEN;
if (!url || !token) throw new Error("PECULE_URL et PECULE_API_TOKEN requis dans .env");
const dir = path.resolve(option("--vers") ?? "data/sauvegardes");
mkdirSync(dir, { recursive: true });

console.log(`Sauvegarde de ${url}`);
const started = Date.now();
const res = await fetch(`${url}/api/backup`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok || !res.body) {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new Error(`/api/backup → HTTP ${res.status} ${body.error ?? ""}`);
}
const name = /filename="([^"/\\]+\.zip)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `pecule-sauvegarde-${new Date().toISOString().slice(0, 10)}.zip`;
const file = path.join(dir, name);
// Écrite sous un nom provisoire : le nom final ne désigne jamais qu'une archive vérifiée.
const partial = `${file}.partiel`;
let received = 0;
let shown = 0;
const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
body.on("data", (chunk: Buffer) => {
  received += chunk.length;
  if (received - shown >= 25 * 1_048_576) {
    shown = received;
    console.log(`  ${mo(received)} reçus…`);
  }
});
// L'archive porte toutes les données du foyer : lisible par son seul propriétaire.
await pipeline(body, createWriteStream(partial, { mode: 0o600 }));
console.log(`  ${mo(received)} téléchargés en ${Math.round((Date.now() - started) / 1000)} s, vérification…`);
if (!(await verify(partial))) {
  console.error(`✗ archive gardée pour examen : ${partial}`);
  process.exit(1);
}
renameSync(partial, file);
console.log(`→ ${file}`);
