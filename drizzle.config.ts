import { defineConfig } from "drizzle-kit";

/*
 * Migrations générées par `pnpm db:generate --name <nom>` dans drizzle/, appliquées au démarrage
 * par migrate() (src/server/db.ts). Pas de base locale : aucune connexion n'est nécessaire pour
 * générer ; `pnpm db:check` compare le schéma à la prod.
 */
export default defineConfig({
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  dialect: "mysql",
  strict: true,
  verbose: true,
});
