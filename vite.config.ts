import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // bash-parser sub-deps have broken jsnext:main pointing to non-existent files
      "iterable-transform-replace": path.resolve(__dirname, "node_modules/iterable-transform-replace/index.js"),
      "transform-spread-iterable": path.resolve(__dirname, "node_modules/transform-spread-iterable/index.js"),
    },
    // Exclude jsnext:main to avoid broken legacy field in bash-parser deps
    mainFields: ["module", "main"],
  },
  optimizeDeps: {
    include: ["bash-parser"],
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        overlay: path.resolve(__dirname, "overlay.html"),
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1422 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
