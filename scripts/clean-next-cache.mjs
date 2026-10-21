/**
 * OneDrive converts an existing .next folder into cloud placeholders between runs, after which
 * Next.js fails with "EINVAL: readlink .next/...". When the project lives under OneDrive, the
 * regenerable .next folder is removed before dev/build so it is always created fresh.
 * Moving the project out of OneDrive avoids this cold start entirely.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (/onedrive/i.test(root)) {
  fs.rmSync(path.join(root, ".next"), { recursive: true, force: true });
  console.log("OneDrive folder detected: cleared the .next build cache.");
}
