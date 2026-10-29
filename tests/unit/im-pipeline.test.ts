import { describe, expect, it } from "vitest";
import { defaultTile, IM_ACTION, installRank, isTileKey, TILES, TILE_KEYS, tileFor, waitingFor, type PipelineTile } from "@/server/queries/im-pipeline";
import { DEFAULT_DISPATCH_FLOW } from "@/domain/flow-defaults";

const groupsOf = (code: string) => DEFAULT_DISPATCH_FLOW.dispatchTypes!.find((t) => t.code === code)?.groups ?? [];

describe("IM pipeline bucketing", () => {
  it("puts every waiting-before-the-truck stage in Ready for dispatch", () => {
    for (const s of ["ready_for_dispatch", "site_readiness", "tax_invoice", "eway_bill", "dispatched"]) expect(tileFor(s, ["D1"])).toBe("ready");
  });

  it("maps the site stages to Dispatched, Received and the installation tiles", () => {
    expect(tileFor("received", ["D2"])).toBe("dispatched");
    expect(tileFor("installation_started", ["D2"])).toBe("received");
    expect(tileFor("installation_done", ["D1"])).toBe("install1");
    expect(tileFor("installation_done", ["D2"])).toBe("install2");
    for (const t of ["D3", "D3a", "D3b"]) expect(tileFor("installation_done", [t])).toBe("install3");
  });

  it("counts a truck with several types once, in its earliest installation", () => {
    expect(installRank(["D2", "D1"])).toBe(1);
    expect(installRank(["D3b", "D2"])).toBe(2);
    expect(tileFor("installation_done", ["D3a", "D3b"])).toBe("install3");
  });

  it("falls back to the definition's BOM groups for a renamed type, and to the 1st for an unknown one", () => {
    const custom = (code: string) => (code === "SH" ? ["shutters"] : code === "TOP" ? ["countertop"] : []);
    expect(installRank(["SH"], custom)).toBe(2);
    expect(installRank(["TOP"], custom)).toBe(3);
    expect(installRank(["??"], groupsOf)).toBe(1);
    expect(installRank([])).toBe(1);
  });

  it("leaves completed and unknown stages out of every tile", () => {
    expect(tileFor("completed", ["D1"])).toBeNull();
    expect(tileFor("something_new", ["D1"])).toBeNull();
  });

  it("names the IM's button only for stages the IM owns in the default flow", () => {
    const imStages = DEFAULT_DISPATCH_FLOW.stages.filter((s) => s.owner === "installation_manager").map((s) => s.code).sort();
    expect(Object.keys(IM_ACTION).sort()).toEqual(imStages);
    expect(IM_ACTION.received).toBe("Mark received");
  });

  it("says who is being waited for in plain words", () => {
    expect(waitingFor("factory_dispatch", "Factory / Dispatch")).toBe("Waiting for factory");
    expect(waitingFor("accounts", "Accounts")).toBe("Waiting for accounts");
    expect(waitingFor("qc", "QC")).toBe("Waiting for QC");
  });

  it("keeps tiles in the IM's order and opens the first tile with something to do", () => {
    expect(TILES.map((t) => t.key)).toEqual([...TILE_KEYS]);
    expect(isTileKey("install2")).toBe(true);
    expect(isTileKey("bogus")).toBe(false);
    const tiles = TILES.map((t) => ({ ...t, n: 0, overdue: 0, mine: 0 })) as PipelineTile[];
    expect(defaultTile(tiles)).toBe("ready");
    tiles[1]!.n = 2;
    expect(defaultTile(tiles)).toBe("dispatched");
    tiles[4]!.n = 1; tiles[4]!.mine = 1;
    expect(defaultTile(tiles)).toBe("install2");
  });
});
