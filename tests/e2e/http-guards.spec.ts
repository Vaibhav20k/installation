/**
 * The HTTP layer, attacked directly (no browser UI): the permission-checked file route and the server actions
 * that are the module's API. Server action ids come from the build's manifest, as an attacker could find them.
 */
import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../.next/server/server-reference-manifest.json"), "utf8")) as { node: Record<string, { exportedName: string }> };
const actionId = (name: string) => Object.entries(manifest.node).find(([, v]) => v.exportedName === name)?.[0];

async function callAction(request: APIRequestContext, name: string, input: unknown, cookie?: string) {
  const id = actionId(name);
  expect(id, `server action ${name} in the build`).toBeTruthy();
  const res = await request.post("/dispatch", {
    headers: { "Next-Action": id!, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", ...(cookie ? { Cookie: cookie } : {}) },
    data: JSON.stringify([input]),
  });
  return { status: res.status(), body: await res.text() };
}

/** A real demo sign-in, then the session cookie it set (what a hostile insider would hold). */
async function cookieFor(browser: Browser, businessId: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/sign-in");
  await page.locator("button", { hasText: businessId }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
  const c = (await ctx.cookies()).find((x) => x.name === "im_demo_actor");
  await ctx.close();
  return `im_demo_actor=${c!.value}`;
}

test.describe("evidence file route", () => {
  test("refuses requests without a session, guessed ids and path tricks", async ({ request }) => {
    const random = crypto.randomUUID();
    expect((await request.get(`/api/evidence/file/${random}`)).status()).toBe(401);
    for (const bad of ["..%2F..%2Fpackage.json", "not-a-uuid", "%2e%2e%2f"]) expect((await request.get(`/api/evidence/file/${bad}`)).status()).toBe(404);
  });
});

test.describe("server actions called directly", () => {
  test("every dispatch action refuses a caller with no session", async ({ request }) => {
    for (const name of ["createDispatch", "advanceDispatch", "receiveDispatch", "moveDispatchBack", "advanceComplaint", "moveComplaintBack", "setFlowRoleMember", "saveFlowDefinition"]) {
      const r = await callAction(request, name, { dispatchId: crypto.randomUUID(), complaintId: crypto.randomUUID(), version: 1, stage: "site_readiness" });
      expect(r.body, name).toContain('"kind":"unauthenticated"');
      expect(r.body, name).not.toContain('"ok":true');
    }
  });
  test("an installer cannot create dispatches or edit the flow, and errors carry no stack traces", async ({ request, browser }) => {
    const cookie = await cookieFor(browser, "EMP-020");
    const create = await callAction(request, "createDispatch", { orderId: crypto.randomUUID(), types: ["D1"], factory: "Main factory", items: [{ componentId: crypto.randomUUID(), quantity: "1" }] }, cookie);
    expect(create.body).toMatch(/"kind":"(forbidden|not_found)"/);
    const cfg = await callAction(request, "saveFlowDefinition", { flow: "dispatch", definition: "{}", note: "hostile edit" }, cookie);
    expect(cfg.body).toContain('"kind":"forbidden"');
    const role = await callAction(request, "setFlowRoleMember", { roleCode: "management", employeeId: crypto.randomUUID(), member: true }, cookie);
    expect(role.body).toContain('"kind":"forbidden"');
    for (const b of [create.body, cfg.body, role.body]) expect(b).not.toMatch(/at .*\.(ts|js):\d+|node_modules|stack/i);
  });
});
