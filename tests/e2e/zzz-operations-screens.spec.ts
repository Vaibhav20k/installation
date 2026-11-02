/**
 * Runs after zz-operations.spec.ts has published the revised process in the throwaway database: the switch still
 * changes the menu, the Factory home shows the Packing tile, and nothing scrolls sideways on a phone.
 */
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, businessId: string) {
  await page.goto("/sign-in");
  await page.locator("button", { hasText: businessId }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}
const SHOTS = process.env.E2E_SHOT_DIR;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

test.describe("revised process on a laptop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("the switch swaps the process menu and the factory menu", async ({ page }) => {
    await signIn(page, "EMP-004");
    const rail = page.locator(".rail").getByRole("navigation", { name: "Sections" });
    const sw = page.locator(".rail").getByRole("radiogroup", { name: "Workspace" });
    await page.goto("/?overview=1");
    await expect(rail.getByRole("link", { name: /^Site Plans/ })).toBeVisible();
    await shot(page, "installation-laptop");
    await sw.getByRole("radio", { name: "Factory" }).click();
    await expect(rail.getByRole("link", { name: /^Site Plans/ })).toHaveCount(0);
    await expect(rail.getByRole("link", { name: /^Complaints/ })).toBeVisible();
    await page.goto("/?overview=1");
    await expect(page.locator("a.pipe-tile", { hasText: "Packing" })).toBeVisible();
    await expect(page.locator("a.pipe-tile", { hasText: "Payment & accounts" })).toBeVisible();
    await page.waitForTimeout(600);
    await shot(page, "factory-laptop");
  });
});

test.describe("revised process on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the factory pages fit", async ({ page }) => {
    await signIn(page, "EMP-004");
    await page.goto("/?overview=1");
    await page.locator(".appbar").getByRole("radiogroup", { name: "Workspace" }).getByRole("radio", { name: "Factory" }).click();
    await expect(page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^Complaints/ })).toBeVisible();
    for (const url of ["/?overview=1", "/complaints", "/dispatch"]) {
      await page.goto(url);
      await expect(page.getByText("This page could not load"), url).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
    }
    await page.goto("/?overview=1");
    await page.waitForTimeout(600);
    await shot(page, "factory-phone");
  });
});
