import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
const root = __dirname;
const workspaceRoot = path.resolve(root, "../..");
const localAgentHubPackages = [
  "@agent-hub/agent-adapters",
  "@agent-hub/context-compiler",
  "@agent-hub/core",
  "@agent-hub/db",
  "@agent-hub/safety",
  "@agent-hub/shared",
  "@agent-hub/task-runner"
];
const localAgentHubAliases = Object.fromEntries(
  localAgentHubPackages.map((packageName) => [
    packageName,
    path.join(
      workspaceRoot,
      "packages",
      packageName.replace("@agent-hub/", ""),
      "src/index.ts"
    )
  ])
);

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: localAgentHubPackages })],
    resolve: {
      alias: localAgentHubAliases
    },
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
    plugins: [externalizeDepsPlugin({ exclude: localAgentHubPackages })],
    resolve: {
      alias: localAgentHubAliases
    },
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
