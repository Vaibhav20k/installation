/**
 * Evidence object storage adapter. Development uses a private folder outside the project (never OneDrive);
 * production needs a real private object store wired here. IM_EVIDENCE_STORAGE=off simulates an unavailable
 * store so the UI can show honest "unavailable" states. Bytes never go into database rows.
 */
import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";

export interface EvidenceStorage {
  kind: "local" | "unconfigured";
  label: string;
  write(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<number>;
  head(key: string, bytes: number): Promise<Buffer>;
  size(key: string): Promise<number>;
  stream(key: string, range?: { start: number; end: number }): fs.ReadStream;
  remove(key: string): Promise<void>;
}

function rootDir() {
  if (process.env.IM_EVIDENCE_DIR) return path.resolve(process.env.IM_EVIDENCE_DIR);
  const base = process.env.LOCALAPPDATA ?? process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return path.join(base, "magppie-installation-management", "evidence");
}

/** Keys are server-generated (asset id + extension); never trust a client path. */
function safePath(key: string) {
  if (!/^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/.test(key)) throw new Error("Invalid storage key");
  return path.join(rootDir(), key.slice(0, 2), key);
}

const local: EvidenceStorage = {
  kind: "local",
  label: "Local private folder (development adapter)",
  async write(key, body, maxBytes) {
    const file = safePath(key);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    const out = fs.createWriteStream(file, { flags: "wx" });
    let total = 0;
    try {
      const reader = body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new Error("too_large"); }
        if (!out.write(value)) await new Promise((r) => out.once("drain", r));
      }
      await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
      return total;
    } catch (e) {
      out.destroy();
      await fs.promises.rm(file, { force: true });
      throw e;
    }
  },
  async head(key, bytes) {
    const fh = await fs.promises.open(safePath(key), "r");
    try { const buf = Buffer.alloc(bytes); const { bytesRead } = await fh.read(buf, 0, bytes, 0); return buf.subarray(0, bytesRead); } finally { await fh.close(); }
  },
  async size(key) { return (await fs.promises.stat(safePath(key))).size; },
  stream(key, range) { return fs.createReadStream(safePath(key), range); },
  async remove(key) { await fs.promises.rm(safePath(key), { force: true }); },
};

const unconfigured: EvidenceStorage = {
  kind: "unconfigured",
  label: "Not configured",
  write: async () => { throw new Error("storage_unavailable"); },
  head: async () => { throw new Error("storage_unavailable"); },
  size: async () => { throw new Error("storage_unavailable"); },
  stream: () => { throw new Error("storage_unavailable"); },
  remove: async () => {},
};

export function evidenceStorage(): EvidenceStorage {
  if (process.env.IM_EVIDENCE_STORAGE === "off") return unconfigured;
  return local;
}

// Short-lived upload tokens: HMAC over session id + expiry. The secret stays server-side.
const g = globalThis as unknown as { __imUploadSecret?: string };
function secret() { return process.env.IM_EVIDENCE_SECRET ?? (g.__imUploadSecret ??= randomBytes(32).toString("hex")); }
export function signUpload(sessionId: string, expiresAt: number) { return createHmac("sha256", secret()).update(`${sessionId}.${expiresAt}`).digest("hex"); }
export function verifyUpload(sessionId: string, expiresAt: number, token: string) {
  const want = signUpload(sessionId, expiresAt);
  return token.length === want.length && createHmac("sha256", "cmp").update(want).digest("hex") === createHmac("sha256", "cmp").update(token).digest("hex");
}

/** Content sniffing: extension and browser MIME are not trusted. Returns the detected type or null. */
export function sniff(head: Buffer): { mediaType: "image" | "video"; mime: string; ext: string } | null {
  const ascii = (a: number, b: number) => head.subarray(a, b).toString("latin1");
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mediaType: "image", mime: "image/jpeg", ext: "jpg" };
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mediaType: "image", mime: "image/png", ext: "png" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { mediaType: "image", mime: "image/webp", ext: "webp" };
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return { mediaType: "video", mime: "video/webm", ext: "webm" };
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (["heic", "heix", "hevc", "heif", "mif1", "msf1"].includes(brand)) return { mediaType: "image", mime: "image/heic", ext: "heic" };
    if (brand === "qt  ") return { mediaType: "video", mime: "video/quicktime", ext: "mov" };
    if (["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "M4V ", "3gp4", "3gp5", "3gp6", "dash", "MSNV"].includes(brand)) return { mediaType: "video", mime: "video/mp4", ext: "mp4" };
  }
  return null;
}
