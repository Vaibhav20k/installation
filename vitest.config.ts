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
    // Coverage of the dispatch flow: the state machine, permissions and MND/complaint logic must stay at 90%+.
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html"],
      include: ["src/domain/**", "src/server/**"],
      thresholds: {
        "src/domain/flow.ts": { lines: 90, branches: 90, functions: 90, statements: 90 },
        "src/server/services/flow-core.ts": { lines: 90, functions: 90, statements: 90 },
        "src/server/services/dispatch.ts": { lines: 90, functions: 90, statements: 90 },
        "src/server/services/complaint.ts": { lines: 90, functions: 90, statements: 90 },
      },
    },
  },
});
