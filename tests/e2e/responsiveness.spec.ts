import { expect,test } from '@playwright/test';
test('demo roster is grouped and switches person without a document reload',async({page})=>{
 await page.goto('/sign-in');
 for(const [name,count] of [['Administrator',1],['Managers',4],['Site supervisors',3],['Field crew',30],['Department users (HUB)',3]] as const){
  const section=page.locator('section').filter({has:page.getByRole('heading',{name,exact:true})});
  await expect(section.getByRole('button')).toHaveCount(count);
 }
 await page.locator('button',{hasText:'EMP-004'}).click();
 await page.waitForURL(u=>!u.pathname.startsWith('/sign-in'));
 const picker=page.getByRole('combobox',{name:'Switch person (demo)'}).first();
 await expect(picker.locator('optgroup[label="Department users (HUB)"] option')).toHaveCount(3);
 const im=await picker.locator('option',{hasText:'EMP-001'}).getAttribute('value');
 let documents=0;page.on('request',r=>{if(r.resourceType()==='document')documents++;});
 await picker.selectOption(im!);
 await expect(page.locator('.whoami')).toContainText('EMP-001');
 expect(documents).toBe(0);
 await expect(page.getByRole('button',{name:/Notifications/})).toBeVisible();
});
test('saving policy updates its panel without a second route fetch',async({page})=>{
 await page.goto('/sign-in');await page.locator('button',{hasText:'EMP-004'}).click();await page.waitForURL(u=>!u.pathname.startsWith('/sign-in'));
 await page.goto('/dispatch/setup');
 const policy=page.locator('section').filter({has:page.getByRole('heading',{name:'Operations policy',exact:true})});
 await policy.locator('[name=tier1Max]').fill('1000');await policy.locator('[name=tier2Max]').fill('5000');
 for(const key of ['installation','complaint']){await policy.locator(`[name=${key}Minutes]`).fill('480');await policy.locator(`[name=${key}Rate]`).fill('100');}
 let pageGets=0,posts=0;
 page.on('request',r=>{if(r.method()==='POST')posts++;if(r.method()==='GET' && (r.resourceType()==='document'||r.url().includes('_rsc=')) && !r.headers()['next-router-prefetch'])pageGets++;});
 const start=Date.now();
 await policy.getByRole('button',{name:'Save policy',exact:true}).click();
 await expect(policy.getByText('Policy saved. Existing plan snapshots remain unchanged.')).toBeVisible();
 console.log('Policy save completed in',Date.now()-start,'ms; POSTs:',posts,'extra page GETs:',pageGets);
 expect(posts).toBe(1);expect(pageGets).toBe(0);
 await expect(policy.locator('[name=installationMinutes]')).toHaveValue('480');
 await page.getByRole('button',{name:/Notifications/}).click();await expect(page.getByRole('dialog',{name:'Notifications'})).toBeVisible();
});
