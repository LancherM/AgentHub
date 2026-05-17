import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-hub/agent-adapters": path.resolve(__dirname, "packages/agent-adapters/src/index.ts"),
      "@agent-hub/cli": path.resolve(__dirname, "apps/cli/src/cli.ts"),
      "@agent-hub/context-compiler": path.resolve(__dirname, "packages/context-compiler/src/index.ts"),
      "@agent-hub/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@agent-hub/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@agent-hub/safety": path.resolve(__dirname, "packages/safety/src/index.ts"),
      "@agent-hub/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@agent-hub/task-runner": path.resolve(__dirname, "packages/task-runner/src/index.ts")
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    restoreMocks: true
  }
});
