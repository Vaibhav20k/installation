import { describe, expect, it } from "vitest";
import { signUpload, sniff, verifyUpload } from "@/integrations/storage";

describe("upload tokens", () => {
  it("accept only the exact session and expiry they were signed for", () => {
    const t = signUpload("11111111-1111-4111-8111-111111111111", 1_800_000_000_000);
    expect(verifyUpload("11111111-1111-4111-8111-111111111111", 1_800_000_000_000, t)).toBe(true);
    expect(verifyUpload("11111111-1111-4111-8111-111111111112", 1_800_000_000_000, t)).toBe(false);
    expect(verifyUpload("11111111-1111-4111-8111-111111111111", 1_800_000_000_001, t)).toBe(false);
    expect(verifyUpload("11111111-1111-4111-8111-111111111111", 1_800_000_000_000, t.slice(0, -1) + (t.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(verifyUpload("11111111-1111-4111-8111-111111111111", 1_800_000_000_000, "short")).toBe(false);
  });
});

describe("content sniffing (extension and declared MIME are not trusted)", () => {
  const b = (...parts: Array<number[] | string>) => Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : Buffer.from(p))));
  it("recognises the allowed photo and video formats", () => {
    expect(sniff(b([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniff(b([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))?.mime).toBe("image/png");
    expect(sniff(b("RIFF", [0, 0, 0, 0], "WEBP"))?.mime).toBe("image/webp");
    expect(sniff(b([0, 0, 0, 0x18], "ftypheic"))?.mime).toBe("image/heic");
    expect(sniff(b([0, 0, 0, 0x18], "ftypisom"))?.mediaType).toBe("video");
    expect(sniff(b([0, 0, 0, 0x14], "ftypqt  "))?.mime).toBe("video/quicktime");
    expect(sniff(b([0x1a, 0x45, 0xdf, 0xa3]))?.mime).toBe("video/webm");
  });
  it("rejects anything else, including text, scripts and SVG", () => {
    for (const x of ["hello world", "<svg xmlns=", "#!/bin/sh", "MZ\u0090\u0000"]) expect(sniff(Buffer.from(x, "latin1"))).toBeNull();
  });
  it("recognises a PDF as a document (accepted only on dispatch-flow stages)", () => {
    expect(sniff(Buffer.from("%PDF-1.7", "latin1"))).toEqual({ mediaType: "document", mime: "application/pdf", ext: "pdf" });
  });
});
