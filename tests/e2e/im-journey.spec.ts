/**
 * The Installation Manager's journey on a phone (390 px): site readiness (not ready, then ready), receipt with a
 * damaged line and a photo, installation started and done with photos. The other roles' steps (factory,
 * accounts) run in their own browser contexts, as in real use. Runs on a throwaway database (see config).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";

const JPEG = { name: "site.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 7), Buffer.from([0xff, 0xd9])]) };
const PDF = { name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") };
const PHONE = { width: 390, height: 844 };

async function signIn(browser: Browser, who: string, viewport = { width: 1280, height: 900 }, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/sign-in");
  await page.locator("button", { hasText: who }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
  return { page, errors };
}

const stageName = (p: Page) => p.locator(".flow-head .flow-stage");
async function noSideScroll(p: Page) { expect(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0); }

test("IM journey at phone width", async ({ browser }) => {
  // Factory: ORD-001, D1 (carcass), the default quantity.
  const factory = await signIn(browser, "HUB-001");
  await factory.page.goto("/dispatch/new");
  const order = await factory.page.locator("#nd-o option", { hasText: "ORD-001" }).getAttribute("value");
  await factory.page.selectOption("#nd-o", order!);
  await factory.page.locator(".flow-choice-row label", { hasText: "Carcass" }).first().click();
  await factory.page.getByRole("button", { name: "Mark ready for dispatch" }).click();
  await factory.page.waitForURL(/\/dispatch\/[0-9a-f-]{36}$/);
  const url = factory.page.url();

  // IM on a phone: not ready first (reason + date), then ready.
  const im = await signIn(browser, "EMP-001", PHONE, true);
  await im.page.goto(url);
  await expect(stageName(im.page)).toHaveText("Site readiness");
  await noSideScroll(im.page);
  await im.page.locator(".flow-choice-row label", { hasText: "Not ready" }).click();
  await im.page.fill("#sf-site_readiness-reason", "Flooring still being laid");
  await im.page.fill("#sf-site_readiness-expected_date", "2099-01-15");
  await im.page.getByRole("button", { name: /Complete: Site readiness/ }).click();
  await expect(im.page.locator(".flow-tag", { hasText: "Site not ready" })).toBeVisible();
  await im.page.locator(".flow-choice-row label", { hasText: /^\s*Ready\s*$/ }).click();
  await im.page.getByRole("button", { name: "Update site readiness" }).click();
  await expect(stageName(im.page)).toHaveText("Tax invoice");

  // Accounts: invoice and e-way bill, each with a PDF that must finish uploading first.
  const acc = await signIn(browser, "HUB-002");
  for (const [field, no, label, next] of [["#sf-tax_invoice-invoice_no", "INV-77", "Tax invoice", "E-way bill"], ["#sf-eway_bill-eway_no", "EWB-77", "E-way bill", "Dispatched"]] as const) {
    await acc.page.goto(url);
    await acc.page.fill(field, no);
    await acc.page.setInputFiles('input[type=file][accept="application/pdf"]', PDF);
    await expect(acc.page.getByText("1 ready.")).toBeVisible({ timeout: 30_000 });
    await acc.page.getByRole("button", { name: `Complete: ${label}` }).click();
    await expect(stageName(acc.page)).toHaveText(next);
  }
  await factory.page.goto(url);
  await factory.page.fill("#sf-dispatched-vehicle_no", "DL01 AB 2231");
  await factory.page.fill("#sf-dispatched-driver", "Ramesh 98100 00000");
  await factory.page.fill("#sf-dispatched-dispatch_date", "2026-10-28");
  await factory.page.getByRole("button", { name: "Complete: Dispatched" }).click();
  await expect(stageName(factory.page)).toHaveText("Received & MND");

  // IM: receipt with the carcass line damaged, quantity, reason and a photo.
  await im.page.goto(url);
  await expect(im.page.getByRole("button", { name: "Mark received in full" })).toBeVisible();
  await im.page.locator(".receive-line input[type=checkbox]").first().uncheck();
  await im.page.locator(".receive-issue label", { hasText: "Damaged" }).click();
  await im.page.locator(".receive-issue input[inputmode=decimal]").fill("2");
  await im.page.locator(".receive-issue textarea").fill("Two carcass side panels cracked");
  const raise = im.page.getByRole("button", { name: "Mark received and raise complaints" });
  await expect(raise).toBeDisabled();
  await im.page.setInputFiles('.receive-issue input[type=file][accept^="image/jpeg"]', JPEG);
  await expect(raise).toBeEnabled({ timeout: 30_000 });
  await noSideScroll(im.page);
  await raise.click();
  await expect(stageName(im.page)).toHaveText("Installation started");
  await expect(im.page.locator(".flow-tag", { hasText: "Partial" })).toBeVisible();
  await expect(im.page.locator('a[href^="/dispatch/complaints/"]')).toHaveCount(1);
  // The open complaint can't be overlooked: a red banner under the stepper jumps to the complaints list.
  await expect(im.page.locator(".complaint-banner")).toContainText("1 open complaint");
  await expect(im.page.locator(".complaint-banner")).toHaveAttribute("href", "#complaints");

  // Installation started, then done with a completion photo.
  await im.page.fill("#sf-installation_started-start_date", "2026-10-29");
  await im.page.getByRole("button", { name: "Complete: Installation started" }).click();
  await expect(stageName(im.page)).toHaveText("Installation done");
  const done = im.page.getByRole("button", { name: "Complete: Installation done" });
  await expect(done).toBeDisabled();
  await im.page.setInputFiles('input[type=file][accept^="image/jpeg"]', JPEG);
  await expect(done).toBeEnabled({ timeout: 30_000 });
  await done.click();
  await expect(im.page.locator(".flow-head")).toContainText("Completed");
  await noSideScroll(im.page);
  await im.page.screenshot({ path: "test-results/im-journey-done.png", fullPage: true });

  expect([...factory.errors, ...im.errors, ...acc.errors]).toEqual([]);
});
