import { defineConfig } from "vite";
export default defineConfig({ root: import.meta.dirname, base: "./", build: { outDir: "dist", emptyOutDir: true, target: "es2022", rollupOptions: { input: import.meta.dirname + "/harness.html" } } });
