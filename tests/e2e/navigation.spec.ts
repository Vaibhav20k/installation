/**
 * The shorter menu (request of 28 Oct 2026): every old URL still opens with the right group and tab marked, the
 * phone bar holds four groups plus More, nothing scrolls sideways at phone width, and reduced motion stops motion.
 */
import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, businessId: string) {
  await page.goto("/sign-in");
  await page.locator("button", { hasText: businessId }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"));
}

const ADMIN = "EMP-004", IM = "EMP-001", CREW = "EMP-016";
const OLD_URLS: Array<[string, string, string | null]> = [
  ["/", "Home", null], ["/installations", "Sites", "Installations"], ["/planning", "Sites", "Planning"], ["/projects", "Sites", "Projects"],
  ["/dispatch", "Dispatch", null], ["/my-day", "My work", "My day"], ["/my-tasks", "My work", "My tasks"], ["/attendance", "My work", "Attendance"],
  ["/approvals", "Inbox", "To approve"], ["/requests", "Inbox", "My requests"], ["/timesheets", "Time & money", "Timesheets"], ["/expenses", "Time & money", "Expenses"],
  ["/people", "People", "People & Skills"], ["/skill-cards", "People", "Skill cards"], ["/reports", "Reports", null],
];

test.describe("desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("every old URL opens with its group and tab marked; the menu has at most 8 groups", async ({ page }) => {
    await signIn(page, ADMIN);
    for (const [url, group, tab] of OLD_URLS) {
      await page.goto(url);
      const rail = page.locator(".rail").getByRole("navigation", { name: "Sections" });
      await expect(rail.getByRole("link")).toHaveCount(8);
      await expect(rail.locator('a[aria-current="page"]'), url).toHaveText(new RegExp(`^${group.replace("&", "\\&")}`));
      if (tab) await expect(page.locator('.section-tabs a[aria-current="page"]'), url).toHaveText(new RegExp(`^${tab}`));
      else await expect(page.locator(".section-tabs"), url).toHaveCount(0);
    }
  });
  test("settings moved next to the person's name and still opens", async ({ page }) => {
    await signIn(page, ADMIN);
    await page.locator(".rail .settings-link").click();
    await expect(page).toHaveURL(/\/settings$/);
  });
  test("keyboard reaches the section tabs", async ({ page }) => {
    await signIn(page, IM);
    await page.goto("/timesheets");
    const tab = page.locator(".section-tabs a", { hasText: "Expenses" });
    await tab.focus();
    await expect(tab).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/expenses$/);
    await expect(page.locator('.section-tabs a[aria-current="page"]')).toHaveText(/^Expenses/);
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const [who, id, slots] of [["installation manager", IM, ["Sites", "Dispatch", "Inbox", "Home"]], ["crew", CREW, ["Today", "Time", "Inbox", "People"]]] as const) {
    test(`the ${who} gets four groups plus More, and no page scrolls sideways`, async ({ page }) => {
      await signIn(page, id);
      const bar = page.getByRole("navigation", { name: "Primary" });
      await expect(bar.getByRole("link")).toHaveText(slots.map((s) => new RegExp(`^${s}`)));
      for (const link of await bar.getByRole("link").all()) {
        await link.click();
        await page.waitForLoadState("networkidle");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), page.url()).toBe(true);
      }
      await bar.getByRole("button", { name: "More" }).click();
      await expect(page.getByRole("dialog", { name: "More sections" })).toBeVisible();
      await page.locator(".sheet-backdrop").click({ position: { x: 10, y: 10 } });
      await expect(page.getByRole("dialog", { name: "More sections" })).toHaveCount(0);
    });
  }
  const PAGES: Array<[string, string, string[]]> = [
    ["admin", ADMIN, ["/", "/installations", "/planning", "/planning?view=sheet", "/projects", "/projects?view=list", "/dispatch", "/dispatch?view=dashboard", "/approvals", "/expenses", "/timesheets", "/people", "/reports", "/settings"]],
    ["crew", CREW, ["/", "/projects", "/my-day", "/attendance", "/requests", "/expenses", "/timesheets", "/reports"]],
  ];
  for (const [who, id, urls] of PAGES) {
    test(`every ${who} page fits the phone width`, async ({ page }) => {
      await signIn(page, id);
      for (const url of urls) {
        await page.goto(url);
        await expect(page.getByText("This page could not load"), url).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), url).toBe(true);
      }
    });
  }
});

test.describe("reduced motion", () => {
  test.use({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  test("pages and lists do not animate", async ({ page }) => {
    await signIn(page, IM);
    await page.goto("/installations");
    expect(await page.locator(".page-enter").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    const rows = await page.locator(".install-list > li").evaluateAll((els) => els.map((el) => getComputedStyle(el).animationName));
    expect(rows.every((n) => n === "none")).toBe(true);
  });
});
