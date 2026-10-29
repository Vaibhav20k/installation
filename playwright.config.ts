/**
 * End-to-end runs against a production build on a throwaway database and file store (.e2e/), never the
 * local demo data or any external service. Uses the installed Chrome, so no browser download is needed.
 * Build first: `npm run build`, then `npm run test:e2e`.
 */
import { defineConfig } from "@playwright/test";
import path from "node:path";

const PORT = 3310;
const dir = path.resolve(__dirname, ".e2e");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, channel: process.env.PW_CHANNEL ?? "chrome", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    // Wipe the throwaway database before the server opens it, so every run starts from fresh demo data.
    command: "node -e \"require('fs').rmSync('.e2e',{recursive:true,force:true})\" && node scripts/local.mjs",
    url: `http://localhost:${PORT}/sign-in`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { PORT: String(PORT), IM_DATA_DIR: path.join(dir, "db"), IM_EVIDENCE_DIR: path.join(dir, "evidence"), IM_DISABLE_JOB_RUNNER: "1" },
  },
});
