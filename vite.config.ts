/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Alias commun au front, au serveur (scripts/build-server.mjs) et aux tests : @/… = src/…
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Les tests du dépôt seulement : pas ceux d'une copie de travail qu'un outil aurait posée dans un dossier caché.
  test: { exclude: ["**/node_modules/**", "**/dist/**", "**/.*/**"] },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
});
