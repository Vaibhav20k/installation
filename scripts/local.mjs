// Local preview as a production build: fast page loads, demo identities still on (IM_LOCAL_DEMO=1).
import { spawn } from "node:child_process";

const next = process.platform === "win32" ? "next.cmd" : "next";
const child = spawn(next, ["start", "--port", process.env.PORT ?? "3300"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, IM_LOCAL_DEMO: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
