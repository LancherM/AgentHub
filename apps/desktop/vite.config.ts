import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const root = __dirname;

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: path.join(root, "out/main"),
      lib: {
        entry: path.join(root, "electron/main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js"
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: path.join(root, "out/preload"),
      lib: {
        entry: path.join(root, "electron/preload.ts"),
        formats: ["cjs"],
        fileName: () => "preload.js"
      }
    }
  },
  renderer: {
    root,
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5174,
      strictPort: false
    },
    build: {
      outDir: path.join(root, "out/renderer"),
      rollupOptions: {
        input: path.join(root, "index.html")
      }
    }
  }
});
