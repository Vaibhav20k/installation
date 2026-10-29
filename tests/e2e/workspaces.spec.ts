/**
 * Factory and Installation workspaces (docs/plans/workspaces-design.md): one switch moves the whole app to the
 * other side, each side shows only its own menu, factory staff open in Factory, and a link into the other side
 * switches over and says so. The e2e database runs in demo mode, so everyone has the switch.
 */
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, businessId: string) {
  await page.goto("/sign-in");
  await page.locator("button", { hasText: businessId }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

const rail = (page: Page) => page.locator(".rail").getByRole("navigation", { name: "Sections" });
const sw = (page: Page) => page.locator(".rail").getByRole("radiogroup", { name: "Workspace" });

test.describe("workspaces on a laptop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("an administrator switches between Installation and Factory, and each shows only its own menu", async ({ page }) => {
    await signIn(page, "EMP-004");
    await page.goto("/");
    await expect(sw(page).getByRole("radio", { name: "Installation" })).toHaveAttribute("aria-checked", "true");
    await expect(rail(page).getByRole("link")).toHaveText([/^Home/, /^Sites/, /^Dispatch/, /^My work/, /^Inbox/, /^Time & money/, /^People/, /^Reports/]);

    await sw(page).getByRole("radio", { name: "Factory" }).click();
    await expect(sw(page).getByRole("radio", { name: "Factory" })).toHaveAttribute("aria-checked", "true");
    await expect(rail(page).getByRole("link")).toHaveText([/^Home/, /^Dispatch/, /^Complaints/, /^Reports/, /^Setup/]);
    await expect(page.locator(".ws-personal")).toContainText("My attendance");

    // Still Factory after a reload: the choice is remembered.
    await page.reload();
    await expect(sw(page).getByRole("radio", { name: "Factory" })).toHaveAttribute("aria-checked", "true");

    // A site page opened from Factory switches back to Installation and says so.
    await page.goto("/installations");
    await expect(page.locator(".ws-moved")).toContainText("Switched to Installation");
    await expect(sw(page).getByRole("radio", { name: "Installation" })).toHaveAttribute("aria-checked", "true");
  });

  test("factory staff open in Factory", async ({ page }) => {
    await signIn(page, "HUB-001");
    await page.goto("/");
    await expect(sw(page).getByRole("radio", { name: "Factory" })).toHaveAttribute("aria-checked", "true");
    await expect(rail(page).getByRole("link", { name: /^Complaints/ })).toBeVisible();
    await expect(rail(page).getByRole("link", { name: /^Sites/ })).toHaveCount(0);

    // Tapping a tile swaps the list in place at once: no page reload, the address keeps the choice.
    const marker = await page.evaluate(() => ((window as unknown as { __noReload: number }).__noReload = Math.random()));
    await page.locator("a.pipe-tile", { hasText: "Accounts" }).click();
    await expect(page.locator(".pipe-list-head h3")).toHaveText(/^Accounts/, { timeout: 1000 });
    await expect(page).toHaveURL(/\?stage=accounts$/);
    expect(await page.evaluate(() => (window as unknown as { __noReload: number }).__noReload)).toBe(marker);
  });
});

test.describe("workspaces on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the switch sits in the top bar and the bottom bar follows the side", async ({ page }) => {
    await signIn(page, "EMP-004");
    const top = page.locator(".appbar").getByRole("radiogroup", { name: "Workspace" });
    await top.getByRole("radio", { name: "Factory" }).click();
    const bar = page.getByRole("navigation", { name: "Primary" });
    await expect(bar.getByRole("link")).toHaveText([/^Home/, /^Dispatch/, /^Complaints/, /^Reports/]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
