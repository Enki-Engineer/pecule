// Bundle le serveur Express en dist/server.mjs via Vite (Rolldown) :
// bundler natif chargé en module, immunisé au problème de
// permission d'esbuild sous pnpm sur certains hébergements mutualisés.
import path from "node:path";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { build } from "vite";
import { fileURLToPath, URL } from "node:url";

// Les dépendances node_modules et les builtins node:* restent résolus au runtime.
const isExternal = (id) => !id.startsWith(".") && !id.startsWith("@/") && !path.isAbsolute(id);

// La version en service est inscrite dans le serveur : il la connaît sans `package.json` à côté de lui (src/server/version.ts).
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

await build({
  configFile: false,
  define: { __PECULE_VERSION__: JSON.stringify(pkg.version), __PECULE_DEPUIS__: JSON.stringify(pkg.pecule?.depuis ?? pkg.version) },
  publicDir: false, // public/ est déjà copié dans dist/client par le build du front
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  build: {
    ssr: "server.ts",
    outDir: "dist",
    emptyOutDir: false, // ne pas effacer dist/client
    sourcemap: true,
    target: "node24",
    rollupOptions: {
      external: isExternal,
      // Un seul fichier : db.ts retrouve ses migrations à côté de server.mjs (pas de morceaux dans dist/assets).
      output: { entryFileNames: "server.mjs", format: "es", inlineDynamicImports: true },
    },
  },
  ssr: { target: "node" },
});
console.log("✓ serveur bundlé → dist/server.mjs");

// Fichiers historiques : absents d'un dépôt dont l'histoire est repliée dans le schéma de départ.
if (existsSync("src/server/migrations")) cpSync("src/server/migrations", "dist/migrations", { recursive: true });
cpSync("drizzle", "dist/drizzle", { recursive: true });
console.log("✓ migrations copiées → dist/migrations et dist/drizzle");
