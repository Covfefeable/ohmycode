import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  optimizeDeps: { include: ["monaco-editor/editor/editor.api", "monaco-editor/language/json/monaco.contribution", "monaco-editor/editor/contrib/find/browser/findController", "monaco-editor/editor/contrib/folding/browser/folding"] },
  build: { outDir: "dist", sourcemap: false },
});
