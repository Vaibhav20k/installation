/**
 * Serves MapLibre's tile worker from the installed package. The bundler cannot follow the library's own worker
 * URL, so the map points here instead. The file is public library code, versioned by the pinned package.
 */
import fs from "node:fs/promises";
import path from "node:path";

let cached: Buffer | null = null;

export async function GET() {
  cached ??= await fs.readFile(path.join(process.cwd(), "node_modules", "maplibre-gl", "dist", "maplibre-gl-worker.mjs"));
  return new Response(new Uint8Array(cached), {
    headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=31536000, immutable" },
  });
}
