import { expect, test } from '@playwright/test';

test('Sanjay can find himself and open daily controls without recording attendance', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sign-in');
  await page.getByRole('searchbox', { name: 'Find a person' }).fill('Sanjay');
  const person = page.locator('.identity-directory button').first();
  await expect(person).toContainText('Sanjay');
  await person.click();
  await expect(page).toHaveURL(/\/my-tasks$/);
  await expect(page.locator('.personal-intro')).toContainText('Sanjay');
  await expect(page.getByRole('heading', { name: 'Needs your action', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('sanjay-home.png'), fullPage: true });
  let posts = 0;
  page.on('request', r => { if (r.method() === 'POST') posts++; });
  await page.getByRole('navigation', { name: 'Your work shortcuts' }).getByRole('link', { name: 'Open My day', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today, Sanjay', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Attendance', exact: true }).click();
  await expect(page).toHaveURL(/\/my-day#attendance$/);
  await expect(page.locator('#attendance')).toBeVisible();
  expect(posts).toBe(0);
  await expect(page.getByText('Records your arrival and departure at a site.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('sanjay-day.png'), fullPage: true });
});

test('manager and department home retain role-specific work and the full overview', async ({ browser }, testInfo) => {
  for (const id of ['EMP-001', 'HUB-001']) {
    const context = await browser.newContext({ viewport: { width: 1365, height: 900 } });
    const page = await context.newPage();
    await page.goto('/sign-in');
    await page.getByRole('searchbox', { name: 'Find a person' }).fill(id);
    await page.locator('.identity-directory button').click();
    await expect(page).toHaveURL(/\/my-tasks$/);
    await expect(page.locator('.personal-intro')).toContainText(id);
    await expect(page.locator('.next-action .button.primary')).toBeVisible();
    if (id === 'HUB-001') await expect(page.getByText('You are not booked on any upcoming visit.')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${id}-home.png`), fullPage: true });
    await page.getByRole('navigation', { name: 'Your work shortcuts' }).getByRole('link', { name: 'Full overview', exact: true }).click();
    await expect(page).toHaveURL(/\?overview=1$/);
    await expect(page.getByText('This page could not load')).toHaveCount(0);
    await page.goto('/');
    await expect(page).toHaveURL(/\/my-tasks$/);
    await context.close();
  }
});

test('identity search handles no results and keeps the roster recoverable', async ({ page }) => {
  await page.goto('/sign-in');
  const search = page.getByRole('searchbox', { name: 'Find a person' });
  await search.fill('no-such-person');
  await expect(page.getByText('No matching person.', { exact: false })).toBeVisible();
  await search.fill('HUB');
  await expect(page.locator('.identity-directory button')).toHaveCount(4); // Sunita plus the three department users.
  await search.fill('');
  await expect(page.locator('.identity-directory button')).toHaveCount(41);
});
