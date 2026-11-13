import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Alias commun au front, au serveur (scripts/build-server.mjs) et aux tests : @/… = src/…
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    outDir: "dist/client",
    emptyOutDir: true,
    sourcemap: false,
  },
});
