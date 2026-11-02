/**
 * On Vercel a brand-new server copy starts with an empty demo database, and its first request may be an action or a
 * download, not a page. Every request-handling entry point must use database(), which fills an empty demo database;
 * calling getDb() directly crashed sign-in with "Unknown or inactive employee".
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The scheduled job runner handles no person's request and has nothing to do on an empty database.
const EXEMPT = new Set([path.normalize("src/app/api/jobs/run/route.ts")]);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

describe("request entry points", () => {
  it("never open the database without filling an empty demo database", () => {
    const direct = files("src/app").filter((f) => !EXEMPT.has(path.normalize(f)) && /\bgetDb\b/.test(fs.readFileSync(f, "utf8")));
    expect(direct).toEqual([]);
  });
});
