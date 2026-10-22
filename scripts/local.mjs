// Local preview as a production build: fast page loads, demo identities still on (IM_LOCAL_DEMO=1).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Run Next's own entry with this Node, so it works with or without npm on the PATH and needs no shell.
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "--port", process.env.PORT ?? "3300"], {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env, IM_LOCAL_DEMO: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
