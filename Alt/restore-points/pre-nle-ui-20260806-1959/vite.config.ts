import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = Number(process.env.PORT) || 4300;
const API_TARGET = `http://127.0.0.1:${API_PORT}`;

// Dev server for the Studio webapp (form + live <Player> preview).
// Separate from remotion.config.ts, which only configures the Remotion
// CLI (render/still). `publicDir` points at the same `public/` folder the
// Remotion composition uses via `staticFile()`, so both resolve asset URLs
// like `/assets/BG.png` identically. API traffic is proxied to Express.
export default defineConfig({
  root: "webapp",
  publicDir: "../public",
  base: "./",
  build: {
    outDir: "../dist-webapp",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 5183,
    proxy: {
      // Trailing path segments only — never proxy source files like /clientApi.ts
      "/api/": API_TARGET,
      "/uploads/": API_TARGET,
      "/media/": API_TARGET,
      "/assets/": API_TARGET,
      "/out/": API_TARGET,
    },
  },
  plugins: [react()],
});
