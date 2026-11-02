import { test, expect, type Browser } from '@playwright/test';
async function signIn(browser: Browser, bid: string, mobile = false) { const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile }); const page = await context.newPage(); await page.goto('/sign-in'); await page.locator('button', { hasText: bid }).first().click(); await page.waitForURL(u => !u.pathname.startsWith('/sign-in')); return page; }
test('publish operations policy, route a dispatch task and create a mobile site plan', async ({ browser }) => {
    const admin = await signIn(browser, 'EMP-004');
    await admin.goto('/dispatch/setup');
    const policy = admin.locator('section').filter({ has: admin.getByRole('heading', { name: 'Operations policy', exact: true }) });
    await policy.locator('[name=tier1Max]').fill('1000');
    await policy.locator('[name=tier2Max]').fill('5000');
    for (const key of ['installation', 'complaint']) {
        await policy.locator(`[name=${key}Minutes]`).fill('480');
        await policy.locator(`[name=${key}Rate]`).fill('100');
    }
    await policy.getByRole('button', { name: 'Save policy', exact: true }).click();
    await expect(policy.getByText('Policy saved. Existing plan snapshots remain unchanged.')).toBeVisible();
    for (const [role, bid] of [['factory', 'HUB-001'], ['dispatch_department', 'HUB-001'], ['finance', 'HUB-002'], ['installation_head', 'HUB-005']]) {
        const select = admin.locator(`#rm-${role}`);
        const id = await select.locator('option', { hasText: bid }).getAttribute('value');
        await select.selectOption(id!);
        await select.locator('..').getByRole('button', { name: 'Add', exact: true }).click();
        await expect(select.locator('option', { hasText: bid })).toHaveCount(0);
    }
    await policy.getByText('Publish revised workflows', { exact: true }).click();
    await policy.getByRole('button', { name: 'Publish for new records' }).click();
    await expect(policy.getByText('Operations workflows published.')).toBeVisible();
    const factory = await signIn(browser, 'HUB-001');
    await factory.goto('/');
    await expect(factory).toHaveURL(/\/my-tasks$/);
    await factory.goto('/dispatch/new');
    const order = await factory.locator('#nd-o option', { hasText: 'ORD-001' }).getAttribute('value');
    await factory.selectOption('#nd-o', order!);
    await factory.locator('.flow-choice-row label', { hasText: 'Shutters' }).first().click();
    await factory.getByRole('button', { name: 'Mark ready for dispatch' }).click();
    await factory.waitForURL(/\/dispatch\/[0-9a-f-]{36}$/);
    const url = factory.url();
    await factory.getByRole('button', { name: 'Complete: Ready for Dispatch' }).click();
    await expect(factory.locator('.flow-head .flow-stage')).toHaveText('Site readiness');
    const im = await signIn(browser, 'EMP-001', true);
    const errors: string[] = [];
    im.on('pageerror', e => errors.push(e.message));
    await im.goto('/my-tasks');
    await expect(im.locator(`a[href="${new URL(url).pathname}"]`)).toBeVisible();
    await im.goto(url);
    await expect(im.getByText('Waiting for Finance: payment confirmation', { exact: false })).toBeVisible();
    expect(await im.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await im.goto('/site-plans');
    await im.getByText('Create site plan', { exact: true }).click();
    const site = im.locator('fieldset').filter({ has: im.locator('legend', { hasText: /^Sites$/ }) }).locator('input[type=checkbox]').first();
    const label = await site.locator('..').innerText();
    await site.check();
    const fieldset = im.locator('fieldset').filter({ has: im.locator('legend', { hasText: label.trim() }) }).first();
    await fieldset.locator('input[type=date]').nth(0).fill('2026-11-10');
    await fieldset.locator('input[type=date]').nth(1).fill('2026-11-10');
    await fieldset.locator('input[type=number]').fill('8');
    await fieldset.locator('fieldset').filter({ has: im.locator('legend', { hasText: 'Staff for this site' }) }).locator('input').first().check();
    await im.getByRole('button', { name: 'Create draft plans' }).click();
    await im.waitForURL(/\/site-plans\/[0-9a-f-]{36}$/);
    await expect(im.getByRole('heading', { name: 'Man-hours and budget' })).toBeVisible();
    expect(await im.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const stages = await im.locator('[aria-label="Plan lifecycle"] li').evaluateAll(nodes => nodes.map(n => { const r=n.getBoundingClientRect(); return {top:r.top,bottom:r.bottom}; }));
    for (let i=1;i<stages.length;i++) expect(stages[i]!.top).toBeGreaterThanOrEqual(stages[i-1]!.bottom);
    expect(errors).toEqual([]);
    await im.screenshot({path:'test-results/operations-site-plan-mobile.png',fullPage:true});
    await im.goto('/reports/operations');
    await expect(im.getByRole('heading', { name: 'Installation process reports' })).toBeVisible();
    expect(errors).toEqual([]);
});
