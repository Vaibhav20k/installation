import { expect, test } from '@playwright/test';

test('temporary tutorials auto-play, pause, finish and never submit operational data', async ({ page }) => {
  await page.goto('/sign-in');
  await page.locator('button', { hasText: 'EMP-001' }).first().click();
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'));
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.getByRole('button', { name: 'See tutorial', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /steps · Automatic demo/ })).toHaveCount(10);
  await page.clock.install();
  await dialog.getByRole('button', { name: /Dispatch to installation/ }).click();
  await expect(dialog.getByRole('button', { name: 'Pause tutorial' })).toBeVisible();
  await page.clock.runFor(20000);
  await expect(dialog.getByText('Step 2 of 6', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Pause tutorial' }).click();
  await page.clock.runFor(30000);
  await expect(dialog.getByText('Step 2 of 6', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(dialog.getByText('Step 1 of 6', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'All tutorials' }).click();
  const titles = ['My Tasks and finding your work', 'Dispatch to installation', 'BOM and missing or damaged checks', 'Create and approve a Site Plan', 'Site punches and man-hours', 'Regularize a non-working day', 'Complaint and replacement journey', 'Preventive action projects', 'Reports and traceability', 'Admin setup and activation'];
  for (const title of titles) {
    await dialog.getByRole('button', { name: new RegExp(title) }).click();
    await dialog.getByRole('button', { name: 'Pause tutorial' }).click();
    await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible();
    while (await dialog.getByRole('button', { name: 'Next', exact: true }).count()) await dialog.getByRole('button', { name: 'Next', exact: true }).click();
    await dialog.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(dialog.getByText('Tutorial complete', { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Replay tutorial' }).click();
    await expect(dialog.getByRole('button', { name: 'Pause tutorial' })).toBeVisible();
    await dialog.getByRole('button', { name: 'All tutorials' }).click();
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'See tutorial', exact: true })).toBeFocused();
  expect(writes).toEqual([]);
});

test('tutorial player fits a phone and keeps its controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sign-in');
  await page.locator('button', { hasText: 'EMP-001' }).first().click();
  await page.waitForURL(u => !u.pathname.startsWith('/sign-in'));
  await page.getByRole('button', { name: 'See tutorial', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Complaint and replacement journey/ }).click();
  await dialog.getByRole('button', { name: 'Pause tutorial' }).click();
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const next = await dialog.getByRole('button', { name: 'Next', exact: true }).boundingBox();
  expect(next!.y + next!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: 'test-results/tutorial-mobile.png' });
  await dialog.getByRole('button', { name: 'Close tutorial' }).click();
  await expect(dialog).not.toBeVisible();
});
