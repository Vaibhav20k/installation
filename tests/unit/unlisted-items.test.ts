import { describe, expect, it } from "vitest";
import { PRIORITY_CODES, PRODUCT_TYPES, UNIT_CODES, priorityLabel, productTypeLabel } from "@/domain/unlisted-items";

// The dispatch groups allowed by component.dispatch_group (migration 014).
const GROUPS = ["carcass", "shutters", "countertop", "backsplash", "other"];

describe("unlisted item lists", () => {
  it("maps every product type to a real dispatch group, with unique codes", () => {
    for (const t of PRODUCT_TYPES) expect(GROUPS, t.code).toContain(t.group);
    expect(new Set(PRODUCT_TYPES.map((t) => t.code)).size).toBe(PRODUCT_TYPES.length);
    expect(PRODUCT_TYPES.every((t) => t.code.length >= 2 && t.code.length <= 40)).toBe(true);
  });

  it("matches the database priority check and defaults labels sensibly", () => {
    expect(PRIORITY_CODES).toEqual(["normal", "high", "urgent"]);
    expect(UNIT_CODES[0]).toBe("pcs");
    expect(priorityLabel("urgent")).toBe("Urgent");
    expect(priorityLabel(undefined)).toBe("Normal");
    expect(productTypeLabel("hardware")).toBe("Hardware");
    expect(productTypeLabel("retired_code")).toBe("retired_code");
    expect(productTypeLabel(null)).toBeNull();
  });
});
