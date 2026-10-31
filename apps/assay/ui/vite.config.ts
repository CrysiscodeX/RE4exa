// Vite config for the Assay web UI. `npx vite build ui` writes ui/dist; `npx vite ui` serves it with /api
// proxied to the mock server (`node ui/mock/server.ts --port 5179`) or a real `assay serve --port 5179`.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
const target = process.env.ASSAY_API ?? "http://127.0.0.1:5179";

export default defineConfig({
  root,
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    reportCompressedSize: true,
    // keep the bundled libraries' own @license comments (React, xterm, ...): their MIT terms ask
    // that the notice travel with every copy, and this way it does with nothing to maintain
    rolldownOptions: { output: { comments: { legal: true, annotation: false, jsdoc: false } } },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": { target, ws: true, changeOrigin: true },
    },
  },
});
