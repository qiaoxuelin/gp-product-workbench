const {test,expect}=require('@playwright/test');

for(const url of ['/?demo=1','/apple.html'])test('automatic update reminder preserves editing and dismissal on '+url,async({page})=>{
  await page.clock.install();
  let version='0.2.2',checks=0,installs=0;
  await page.route('**/api/update/check',route=>{
    checks++;
    return route.fulfill({json:{currentVersion:'0.2.1',version,available:true,supported:true,page:'https://github.com/qiaoxuelin/gp-product-workbench/releases/latest',notes:'New release'}});
  });
  await page.route('**/api/update/start',route=>{installs++;return route.fulfill({json:{started:true}});});
  await page.goto(url);await expect(page.locator('#appVersion')).toContainText('PlayBatch v');
  await page.waitForFunction(()=>!!document.querySelector('#update')?.onclick&&!working);
  await page.clock.fastForward(6000);
  await expect(page.locator('#newUpdateNotice')).toContainText('0.2.2');
  await expect(page.locator('#modal')).not.toBeVisible();
  expect(installs).toBe(0);
  await page.locator('#dismissNewUpdate').click();
  await expect(page.locator('#newUpdateNotice')).toBeHidden();
  await page.reload();await expect(page.locator('#appVersion')).toContainText('PlayBatch v');
  await page.waitForFunction(()=>!!document.querySelector('#update')?.onclick&&!working);
  await page.clock.fastForward(6000);
  await expect(page.locator('#update')).toContainText('有新版');
  await expect(page.locator('#newUpdateNotice')).toBeHidden();
  version='0.2.3';
  await page.clock.fastForward(60*60*1000+6000);
  await expect(page.locator('#newUpdateNotice')).toContainText('0.2.3');
  await page.locator('#viewNewUpdate').click();
  await expect(page.locator('#dialogTitle')).toHaveText('检查更新');
  await expect(page.locator('#dialogBody')).toContainText('0.2.3');
  expect(checks).toBeGreaterThanOrEqual(3);expect(installs).toBe(0);
});

test('background network failure stays quiet and manual checking still reports errors',async({page})=>{
  await page.clock.install();
  await page.route('**/api/update/check',route=>route.fulfill({status:400,json:{error:'无法连接 GitHub'}}));
  await page.goto('/?demo=1');await expect(page.locator('#appVersion')).toContainText('PlayBatch v');
  await page.waitForFunction(()=>!!document.querySelector('#update')?.onclick&&!working);
  await page.clock.fastForward(6000);
  await expect(page.locator('#modal')).not.toBeVisible();
  await expect(page.locator('#newUpdateNotice')).toBeHidden();
  await page.locator('#update').click();
  await expect(page.locator('#dialogTitle')).toHaveText('检查更新未完成');
});
