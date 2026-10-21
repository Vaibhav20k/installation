import { afterEach, describe, expect, it, vi } from "vitest";
import { demoAuthEnabled } from "@/server/auth/actor";

describe("demo identities", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("are on in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(demoAuthEnabled()).toBe(true);
  });

  it("are off in a production build unless the local preview asks for them", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(demoAuthEnabled()).toBe(false);
    vi.stubEnv("IM_LOCAL_DEMO", "1");
    expect(demoAuthEnabled()).toBe(true);
  });

  it("stay off whenever IM_DISABLE_DEMO_AUTH is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("IM_LOCAL_DEMO", "1");
    vi.stubEnv("IM_DISABLE_DEMO_AUTH", "1");
    expect(demoAuthEnabled()).toBe(false);
  });
});
