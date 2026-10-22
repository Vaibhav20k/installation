import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // "server-only" throws outside the Next.js server bundle; tests are server-side by definition.
  resolve: { alias: { "@": path.resolve(__dirname, "src"), "server-only": path.resolve(__dirname, "tests/support/server-only.ts") } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
